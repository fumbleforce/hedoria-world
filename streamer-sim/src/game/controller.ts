import type { LlmAdapter } from "../llm/adapter";
import { extractJson } from "../llm/json";
import { type ImageBackend, generateRoomImage, generatePortrait } from "../llm/imageProvider";
import { savePortrait } from "../persist/imageStore";
import { diag } from "../diag/log";
import { useStore, type ActionMenu } from "../state/store";
import type { ChatMessage, DmLine, EventChoice, GameEvent, Metrics } from "./types";
import type { PlayerAction, ActionOption } from "./actions";
import { generateChatBurst, audienceSummary } from "./chatEngine";
import { evaluateAction } from "./evaluator";
import { resolveAction, totalViewers } from "./resolver";
import { rollEvent, type EventContext } from "./events";
import { multipliersFor, UPGRADES } from "./shop";
import { fillPrompt, PROMPTS, type PromptId } from "./prompts";
import { steeringForTier } from "./content";
import { initialAudience } from "./segments";
import { ZONE_MENUS, ZONES, type ZoneId } from "./studio";
import { GAME_BY_ID } from "./games";
import { ARCHETYPE_BY_ID } from "./archetypes";
import {
  advancePresence,
  audienceFromPresence,
  clearPresence,
} from "./presence";
import {
  relationshipLevel,
  seedCharacter,
  rollArchetype,
  type CharacterSheet,
} from "./characters";
import {
  advanceStalkerArc,
  checkMilestones,
  sourReview,
  type MilestoneOutcome,
} from "./relationships";
import {
  STREAM_START,
  NIGHT_END,
  TIME_COST,
  weightForIntensity,
  formatClock,
  type TimeWeight,
} from "./time";
import { clamp, pick, uid } from "../rng/rng";

const AMBIENT_GAP_MS = 850;
const AMBIENT_MAX = 3;

/**
 * Turn-based controller on an in-world clock. The player takes one action (or
 * just Continues); time passes, presence drifts, chat reacts, and mechanical
 * events fire with LLM-written narration. Every action runs:
 *   evaluate (LLM/local) → resolve (pure code) → narrate + react → advance time.
 */
export class GameController {
  private ambientTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly llm: LlmAdapter,
    private readonly imageBackend: ImageBackend | null = null,
  ) {}

  /** Whether LLM room-image generation is wired (a backend + key is present). */
  get canGenerateRoom(): boolean {
    return this.imageBackend !== null;
  }

  /** Generate a room background image via the image model. */
  async generateRoom(): Promise<void> {
    const s = this.s;
    if (!this.imageBackend) {
      s.setToast("Set a Gemini or OpenRouter key to generate room art.");
      return;
    }
    if (s.generatingRoom) return;
    s.setGeneratingRoom(true);
    s.setToast("Generating room art… (this can take a while)");
    try {
      const upgrades = s.ownedUpgrades
        .map((id) => UPGRADES.find((u) => u.id === id)?.name)
        .filter(Boolean) as string[];
      const url = await generateRoomImage(this.imageBackend, {
        persona: s.settings.streamerPersona,
        upgrades,
      });
      s.setRoomImage(url);
      s.setToast("Room art updated!");
    } catch (err) {
      diag.error("world", "room image failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      s.setToast(`Room art failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      s.setGeneratingRoom(false);
    }
  }

  clearRoom(): void {
    this.s.setRoomImage(null);
    this.s.setToast("Reverted to the default room art.");
  }

  /** Whether portrait generation is wired (an image backend is present). */
  get canGeneratePortrait(): boolean {
    return this.imageBackend !== null;
  }

  /** Generate (and cache) a portrait for a named character, on demand. */
  async generatePortrait(charId: string): Promise<void> {
    const s = this.s;
    const c = s.roster[charId];
    if (!c) return;
    if (!this.imageBackend) {
      s.setToast("Set a Gemini or OpenRouter key to generate portraits.");
      return;
    }
    if (s.portraitBusyId) return;
    s.setPortraitBusy(charId);
    s.setToast(`Generating a portrait for ${c.handle}…`);
    try {
      const url = await generatePortrait(this.imageBackend, {
        handle: c.handle,
        archetypeLabel: ARCHETYPE_BY_ID[c.archetypeId]?.label ?? "viewer",
        vibe: c.backstory || c.vibe,
      });
      await savePortrait(charId, url);
      s.patchCharacter(charId, { hasPortrait: true });
      s.setToast(`Portrait ready for ${c.handle}!`);
    } catch (err) {
      diag.error("world", "portrait failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      s.setToast(`Portrait failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      s.setPortraitBusy(null);
    }
  }

  private get s() {
    return useStore.getState();
  }
  private mults() {
    return multipliersFor(this.s.ownedUpgrades);
  }

  // ----------------------------------------------------------- prompts / DM log

  resolvePrompt(id: PromptId): string {
    const s = this.s;
    const body = s.promptOverrides[id] ?? PROMPTS[id].base;
    return fillPrompt(body, {
      name: s.settings.streamerName,
      persona: s.settings.streamerPersona,
      steering: steeringForTier(s.settings),
    });
  }

  private dm(text: string) {
    if (text) this.s.pushStory({ kind: "dm", text });
  }
  private outcome(text: string) {
    if (text) this.s.pushStory({ kind: "outcome", text });
  }
  private sysStory(text: string) {
    this.s.pushStory({ kind: "system", text });
  }
  private sysChat(text: string): ChatMessage {
    return { id: uid("sys"), user: "system", text, kind: "system", ts: Date.now() };
  }
  /** Push a status/notification line into the live chat (viewer/follow/sub etc). */
  private notify(text: string): void {
    this.s.pushChat([this.sysChat(text)]);
  }

  // ----------------------------------------------------------- viewer count

  /** Last viewer count we announced, so we only notify on real movement. */
  private lastNotifiedViewers = 0;

  /** Distinct non-system handles seen in recent chat — the visible room. */
  private distinctChatters(): number {
    const seen = new Set<string>();
    for (const m of this.s.chat.slice(-40)) {
      if (m.kind === "system" || m.user === "system") continue;
      seen.add(m.user.toLowerCase());
    }
    return seen.size;
  }

  /**
   * Keep the displayed viewer count in step with what the room actually looks
   * like. Presence (online roster + anon floor) is the base, but the chat is
   * often busier than presence alone — especially with LLM-invented handles that
   * aren't in the roster — so the count is grounded to at least the number of
   * distinct recent chatters. Announces meaningful changes in chat.
   */
  private syncViewers(): void {
    const s = this.s;
    if (!s.session.isLive) return;
    const presence = totalViewers(s.audience);
    const next = Math.max(presence, this.distinctChatters());
    const prev = Math.round(s.metrics.currentViewers);
    if (next === prev) return;
    s.patchMetrics({ currentViewers: next });
    s.setSession({ peak: Math.max(s.session.peak, next) });
    // Announce on real movement (>=2) so we don't spam single-viewer wobble.
    if (Math.abs(next - this.lastNotifiedViewers) >= 2) {
      const delta = next - this.lastNotifiedViewers;
      this.notify(`👀 ${next} watching (${delta > 0 ? "+" : ""}${delta})`);
      this.lastNotifiedViewers = next;
    }
  }

  // ----------------------------------------------------------- presence helpers

  private targetNamed(): number {
    const m = this.s.metrics;
    return clamp(Math.round(m.followers / 22) + 2, 2, 14);
  }
  private anonFloor(): number {
    const m = this.s.metrics;
    return Math.round(m.followers * 0.02 * (0.5 + m.hype / 100));
  }
  private reputation(): number {
    return Math.min(1, this.s.metrics.followers / 300);
  }

  /** Drift the named cast + refresh segment populations from presence. */
  private presenceTick(): void {
    const s = this.s;
    const intensity = this.intensity();
    const res = advancePresence(s.roster, s.clock, intensity, this.reputation(), this.targetNamed());
    const audience = audienceFromPresence(res.roster, res.online, s.audience, this.anonFloor());
    s.setRoster(res.roster);
    s.setAudience(audience);
    s.patchMetrics({ currentViewers: totalViewers(audience) });
    this.syncViewers();

    const day = s.metrics.day;
    for (const id of res.arrivals) {
      const c = res.roster[id];
      if (!c) continue;
      // Cross-stream continuity: count distinct stream-days + streaks.
      if (c.lastStreamDay < day) {
        const streak = c.lastStreamDay === day - 1 ? c.attendanceStreak + 1 : 1;
        this.s.patchCharacter(id, {
          lastStreamDay: day,
          streamsAttended: c.streamsAttended + 1,
          attendanceStreak: streak,
        });
        if (streak >= 3) {
          this.s.pushChat([this.sysChat(`${c.displayName || c.handle} — ${streak} streams running 🔥`)]);
        }
      }
      if (c.affinity >= 35) {
        this.s.pushChat([this.sysChat(`${c.displayName || c.handle} (${relationshipLevel(c.affinity)}) joined`)]);
      }
    }
  }

  /**
   * Advance the stalker escalation arc for the scariest online stalker. Returns
   * true if it raised an interrupting event (the threat-3 confrontation), so the
   * caller skips the normal event roll / ambient restart this beat.
   */
  private advanceStalkerArcs(): boolean {
    const s = this.s;
    const stalkers = Object.values(s.roster)
      .filter((c) => c.online && c.threat >= 1 && c.threat < 3)
      .sort((a, b) => b.threat - a.threat);
    if (!stalkers.length) return false;
    const target = stalkers[0];
    const fed = s.metrics.comfort < 75; // oversharing / not setting boundaries
    const outcome = advanceStalkerArc(target, s.metrics.day, fed);
    if (!outcome) return false;
    s.patchCharacter(target.id, outcome.patch);
    this.sysStory(outcome.story);
    if (outcome.chat) {
      s.pushChat([{ id: uid("msg"), user: target.handle, text: outcome.chat, kind: "creepy", characterId: target.id, ts: Date.now() }]);
    }
    s.setToast(`⚠ ${target.displayName || target.handle} is escalating.`);
    diag.info("event", "stalker escalated", { handle: target.handle, threat: outcome.patch.threat });
    // At max threat, force the confrontation rather than waiting for the roll.
    if (outcome.patch.threat === 3) {
      const ev = rollEvent(this.eventCtx());
      // rollEvent will heavily favour the threat-3 confront trigger; raise it.
      if (ev) {
        void this.raiseEvent(ev);
        return true;
      }
    }
    return false;
  }

  private intensity(): number {
    return this.s.settings.contentTier === "wholesome"
      ? 0
      : this.s.settings.contentTier === "flirty"
        ? 1
        : this.s.settings.contentTier === "risque"
          ? 2
          : 3;
  }

  private onlineIds(): string[] {
    return Object.values(this.s.roster).filter((c) => c.online).map((c) => c.id);
  }

  // ----------------------------------------------------------- stream control

  goLive(): void {
    const s = this.s;
    if (s.session.isLive) return;
    if (s.metrics.energy < 10) {
      s.setToast("Too exhausted to stream — sleep or eat first.");
      return;
    }
    diag.group("round", "GO LIVE", () => {
      s.clearChat();
      s.resetSession();
      s.setRoster(clearPresence(s.roster));
      s.setAudience(initialAudience());
      s.setClock(STREAM_START);
      s.setSession({ isLive: true, round: 1 });
      s.setPlaying(null);
    });
    this.lastNotifiedViewers = 0;
    this.presenceTick();
    this.sysStory(`Day ${s.metrics.day} — you go live at ${formatClock(STREAM_START)}.`);
    this.dm("The 'LIVE' dot blinks red. Regulars filter in, saying hi as the numbers tick up.");
    this.startAmbient("the stream just went live");
  }

  endStream(reason?: string): void {
    const s = this.s;
    if (!s.session.isLive) return;
    this.stopAmbient();
    const { earnings, newFollowers, peak, round } = s.session;
    s.setSession({ isLive: false });
    s.setPlaying(null);
    s.patchMetrics({ currentViewers: 0 });
    s.setRoster(clearPresence(s.roster));
    s.pushChat([this.sysChat(`— Stream ended${reason ? ` (${reason})` : ""} —`)]);
    this.sysStory(
      `Stream over after ${round} rounds — +${newFollowers} followers, peak ${peak}, $${earnings.toFixed(0)} earned.`,
    );
    s.logEvent(`Day ${s.metrics.day}: ${round} rounds · +${newFollowers} followers · $${earnings.toFixed(0)}.`);
    diag.info("round", "stream ended", { reason, round, earnings, newFollowers });
    s.setToast(`Stream over: +${newFollowers} followers, $${earnings.toFixed(0)} earned.`);
  }

  // ----------------------------------------------------------- ambient chat

  private startAmbient(context: string): void {
    this.stopAmbient();
    if (!this.s.session.isLive) return;
    let pushed = 0;
    const step = async () => {
      if (!this.s.session.isLive || this.s.resolving || this.s.pendingEvent) return;
      const msgs = await generateChatBurst(this.llm, this.chatCtx(context, 1));
      if (!this.s.session.isLive || this.s.resolving) return;
      if (msgs.length) {
        this.s.pushChat([msgs[0]]);
        this.applyChatEffects([msgs[0]]);
        this.syncViewers();
      }
      pushed += 1;
      if (pushed < AMBIENT_MAX) this.ambientTimer = setTimeout(() => void step(), AMBIENT_GAP_MS);
    };
    this.ambientTimer = setTimeout(() => void step(), AMBIENT_GAP_MS);
  }
  private stopAmbient(): void {
    if (this.ambientTimer) clearTimeout(this.ambientTimer);
    this.ambientTimer = null;
  }

  private chatCtx(actionContext: string, count: number) {
    const s = this.s;
    return {
      settings: s.settings,
      metrics: s.metrics,
      audience: s.audience,
      roster: s.roster,
      online: this.onlineIds(),
      systemPrompt: this.resolvePrompt("chat"),
      actionContext,
      recentChat: this.recentChatLines(),
      count,
    };
  }

  /** Last few non-system chat lines, "handle: text", for conversational flow. */
  private recentChatLines(): string[] {
    return this.s.chat
      .filter((m) => m.kind !== "system")
      .slice(-6)
      .map((m) => `${m.user}: ${m.text}`);
  }

  // ----------------------------------------------------------- action pipeline

  chooseOption(opt: ActionOption): void {
    this.s.setActionMenu(null);
    switch (opt.prompt) {
      case "__toggle_live__": return this.s.session.isLive ? this.endStream() : this.goLive();
      case "__sleep__": return this.sleep();
      case "__game_picker__": this.s.setGamePickerOpen(true); return;
      case "__cook__": return this.coded("You cook instant noodles. Energy and mood restored.", { energy: 15, mood: 4 }, "🍳 Cooked", 15);
      case "__coffee__": return this.coded("You brew a strong coffee. A jolt of energy.", { energy: 10 }, "☕ Coffee", 8);
      case "__nap__": return this.coded("You curl up for a quick power nap.", { energy: 22, mood: 3 }, "😴 Napped", 45);
      case "__freshen__": return this.coded("A hot shower. You feel human again.", { mood: 6, comfort: 5, energy: 4 }, "🚿 Freshened up", 20);
      case "__scroll__": return this.coded("You scroll fan mail in bed. Sweet messages, a couple of weird ones.", { mood: 3, comfort: -1 }, "📱 Read fan mail", 15);
      case "__order_food__": return this.orderFood();
      case "__door__": return this.answerDoor();
      case "__open_shop__": this.s.setShopOpen(true); return;
      case "__outfit_cozy__": return this.coded("You change into something soft and comfy.", { mood: 3, comfort: 4 }, "🧶 Cozy fit", 10);
      case "__outfit_cute__": return this.coded("You pick a cute, photogenic fit.", { mood: 3, hype: 4 }, "✨ Cute fit", 10);
      case "__outfit_bold__": return this.coded("You go for something bold and eye-catching.", { hype: 6, comfort: -3 }, "🔥 Bold fit", 10);
      default:
        void this.submitAction({ text: opt.prompt, source: "menu" });
    }
  }

  freeform(text: string): void {
    const t = text.trim();
    if (!t) return;
    this.s.setActionMenu(null);
    void this.submitAction({ text: t, source: "freeform" });
  }

  /** "Continue" — let the stream ride without a specific action. */
  async continueStory(): Promise<void> {
    const s = this.s;
    if (s.resolving) return;
    if (!s.session.isLive) {
      // Offline continue = potter around; maybe a knock/package/DM.
      this.advanceTime(TIME_COST.continue);
      await this.maybeOfflineEvent();
      return;
    }
    this.stopAmbient();
    s.setResolving(true);
    try {
      const playing = s.playing ? ` (playing ${GAME_BY_ID[s.playing.gameId]?.name})` : "";
      this.dm(pick([
        `You let the stream breathe${playing}, chatting idly as chat scrolls by.`,
        `A quiet stretch${playing}. You sip your drink and read messages.`,
        `You vibe with the chat for a bit${playing}, no agenda.`,
      ]));
      const msgs = await generateChatBurst(this.llm, this.chatCtx("a relaxed lull in the stream", 4));
      this.s.pushChat(msgs);
      this.applyChatEffects(msgs);
      // Gentle satisfaction settle + tiny tips already handled via chat.
      this.advanceTime(TIME_COST.continue);
      this.afterBeat("a relaxed lull");
    } finally {
      this.s.setResolving(false);
    }
  }

  async submitAction(action: PlayerAction): Promise<void> {
    const s = this.s;
    if (s.resolving) return;
    this.stopAmbient();
    s.setResolving(true);

    await diag.group("action", `action: "${action.text}" (${action.source})`, async () => {
      try {
        s.pushStory({ kind: "action", text: actionEcho(action) });

        const verdict = await evaluateAction(this.llm, action, {
          settings: s.settings,
          evaluatorPrompt: this.resolvePrompt("evaluator"),
          audienceSummary: audienceSummary(s.audience),
          isLive: s.session.isLive,
          zoneLabel: ZONES[s.zone]?.label ?? "the studio",
        });

        if (!verdict.plausible) {
          this.dm(verdict.reason ?? "That doesn't quite work right now.");
          s.setToast("That action isn't possible right now.");
          return;
        }

        // Mini-game flavor nudge.
        if (s.playing && s.session.isLive) {
          const g = GAME_BY_ID[s.playing.gameId];
          if (g) for (const seg of g.pleases) verdict.appeal[seg] = (verdict.appeal[seg] ?? 0) + 1;
        }

        this.dm(verdict.narration);

        const result = resolveAction({
          verdict,
          metrics: s.metrics,
          audience: s.audience,
          mult: this.mults(),
          contentTier: s.settings.contentTier,
          isLive: s.session.isLive,
        });
        s.patchMetrics(result.metricsPatch);
        s.setAudience(result.audience);
        if (s.session.isLive) {
          s.setSession({
            earnings: s.session.earnings + result.earned,
            newFollowers: s.session.newFollowers + result.gainedFollowers,
            peak: Math.max(s.session.peak, totalViewers(result.audience)),
          });
          if (result.gainedFollowers > 0) {
            this.notify(`📈 +${result.gainedFollowers} new follower${result.gainedFollowers > 1 ? "s" : ""} · ${this.s.metrics.followers.toLocaleString()} total`);
          }
          if (result.summary) this.outcome(result.summary);

          const count = clamp(Math.round(totalViewers(result.audience) / 6) + 2, 3, 8);
          // Give chat both what she literally did and the narrated result so it
          // can react to the actual content, not just the prose.
          const reactTo =
            action.source === "freeform"
              ? `${s.settings.streamerName} did/said: "${action.text}". (In the moment: ${verdict.narration})`
              : verdict.narration;
          const msgs = await generateChatBurst(this.llm, this.chatCtx(reactTo, count));
          this.s.pushChat(msgs);
          this.applyChatEffects(msgs);

          if (s.playing) s.setPlaying({ ...s.playing, roundsPlayed: s.playing.roundsPlayed + 1 });
        }

        const weight: TimeWeight = weightForIntensity(verdict.intensity);
        this.advanceTime(TIME_COST[weight]);
        if (s.session.isLive) this.afterBeat(verdict.narration);
      } finally {
        this.s.setResolving(false);
      }
    });
  }

  /** Coded (non-LLM) action: fixed mechanics + DM line + explicit time cost. */
  private coded(narration: string, patch: Partial<Metrics>, summary: string, minutes: number): void {
    const s = this.s;
    const next: Partial<Metrics> = {};
    for (const [k, v] of Object.entries(patch) as Array<[keyof Metrics, number]>) {
      next[k] = (s.metrics[k] as number) + v;
    }
    s.patchMetrics(next);
    this.dm(narration);
    this.outcome(summary);
    diag.info("action", "coded action", { summary, patch, minutes });
    this.advanceTime(minutes);
    if (s.session.isLive) this.afterBeat(narration);
  }

  // ----------------------------------------------------------- time + beats

  private advanceTime(minutes: number): void {
    const s = this.s;
    s.setClock(s.clock + minutes);
    if (s.session.isLive) {
      // Energy/hype drift scale with elapsed time.
      s.patchMetrics({
        energy: s.metrics.energy - minutes * 0.12,
        hype: s.metrics.hype - minutes * 0.1,
      });
      s.setSession({ round: s.session.round + 1, seconds: s.clock - STREAM_START });
    }
    diag.info("round", `clock ${formatClock(this.s.clock)}`, {
      round: this.s.session.round,
      energy: Math.round(this.s.metrics.energy),
      viewers: Math.round(this.s.metrics.currentViewers),
    });
  }

  /** Shared post-action housekeeping while live: end checks, presence, events. */
  private afterBeat(context: string): void {
    const s = this.s;
    if (s.metrics.energy <= 0) return this.endStream("ran out of energy");
    if (s.clock >= NIGHT_END) return this.endStream("it got late");

    this.presenceTick();

    // Stalker arc: advance the most-threatening online stalker, at most once a
    // day, when the room is "feeding" them (low comfort = oversharing). Its own
    // events (too-specific DM, door knock, confrontation) ride the normal roll.
    if (this.advanceStalkerArcs()) return;

    const ev = rollEvent(this.eventCtx());
    if (ev && Math.random() < 0.28) {
      void this.raiseEvent(ev);
      return;
    }
    this.startAmbient(context);
  }

  private eventCtx(): EventContext {
    const s = this.s;
    return {
      metrics: s.metrics,
      intensity: this.intensity(),
      isLive: s.session.isLive,
      roster: s.roster,
      online: this.onlineIds(),
    };
  }

  // ----------------------------------------------------------- mini-games

  startGame(gameId: string): void {
    const g = GAME_BY_ID[gameId];
    if (!g) return;
    this.s.setGamePickerOpen(false);
    this.s.setPlaying({ gameId, roundsPlayed: 0 });
    this.dm(`You boot up ${g.name} ${g.emoji} and get settled. Chat reacts to the loading screen.`);
    this.outcome(`🎮 Now playing: ${g.name}`);
    diag.info("action", "start game", { gameId });
    if (this.s.session.isLive) this.afterBeat(`just started playing ${g.name}`);
  }

  stopGame(): void {
    const g = this.s.playing ? GAME_BY_ID[this.s.playing.gameId] : null;
    this.s.setPlaying(null);
    if (g) this.dm(`You wrap up ${g.name} and stretch. "Okay chat, what's next?"`);
  }

  // ----------------------------------------------------------- chat effects

  /**
   * Apply the beats a relationship milestone unlocked: inline ones drop into the
   * feed and patch the character; event-kind ones interrupt with a choice modal
   * (only the first per call, to avoid clobbering pendingEvent). Word-of-mouth
   * (referred friends, follower bumps) rides along. Returns true if an event was
   * raised so callers can stop ambient chat.
   */
  private applyMilestones(charId: string, outcomes: MilestoneOutcome[]): boolean {
    const s = this.s;
    let raised = false;
    let followerDelta = 0;
    for (const o of outcomes) {
      // Record the milestone so it never refires.
      const cur = s.roster[charId];
      if (!cur) continue;
      s.patchCharacter(charId, {
        ...o.patch,
        milestones: [...cur.milestones, o.id],
      });
      if (o.story) this.sysStory(o.story);
      if (o.chat) {
        const c = s.roster[charId];
        if (c) s.pushChat([{ id: uid("msg"), user: c.handle, text: o.chat, kind: "normal", characterId: charId, ts: Date.now() }]);
      }
      if (o.spawnFriend) this.spawnReferredFriend(charId);
      if (o.followerDelta) followerDelta += o.followerDelta;
      if (o.kind === "event" && o.event && !raised && !s.pendingEvent) {
        void this.raiseEvent(o.event);
        raised = true;
      }
    }
    if (followerDelta) s.patchMetrics({ followers: s.metrics.followers + followerDelta });
    return raised;
  }

  /** Word-of-mouth: a happy regular brings a compatible new viewer along. */
  private spawnReferredFriend(referrerId: string): void {
    const s = this.s;
    const referrer = s.roster[referrerId];
    if (!referrer) return;
    if (Object.values(s.roster).filter((c) => c.online).length >= 16) return;
    const arch = rollArchetype(this.intensity());
    const friend = seedCharacter(arch, s.clock);
    friend.referredBy = referrerId;
    friend.affinity = clamp(friend.affinity + 6, 0, 100); // arrives a touch warmer
    s.upsertCharacter(friend);
    const who = referrer.displayName || referrer.handle;
    this.sysStory(`${who} brought a friend — ${friend.handle} just showed up because of them.`);
  }

  private applyChatEffects(msgs: ChatMessage[]): void {
    const s = this.s;
    const mult = this.mults();
    let cash = 0, followers = 0, subscribers = 0, hype = 0, mood = 0, comfort = 0;
    const roster = { ...s.roster };
    let rosterChanged = false;
    // Track affinity before this burst so we can fire milestones after.
    const prevAffinity = new Map<string, number>();

    for (const msg of msgs) {
      switch (msg.kind) {
        case "donation": cash += (msg.amount ?? 0) * mult.income; hype += 1; break;
        case "sub": subscribers += 1; cash += (msg.amount ?? 5) * mult.income; hype += 2; break;
        case "follow": followers += 1; break;
        case "raid": followers += 5; hype += 4; break;
        case "troll": mood -= 0.6; break;
        case "creepy": comfort -= 1; break;
        default: break;
      }
      // Attribute to a named character: grow relationship, log tips.
      if (msg.characterId && roster[msg.characterId]) {
        const c = roster[msg.characterId];
        if (!prevAffinity.has(c.id)) prevAffinity.set(c.id, c.affinity);
        roster[msg.characterId] = {
          ...c,
          messageCount: c.messageCount + 1,
          affinity: clamp(c.affinity + 0.6, 0, 100),
          tipped: c.tipped + (msg.amount ?? 0),
          lastSeenClock: s.clock,
        };
        rosterChanged = true;
      }
    }
    if (rosterChanged) s.setRoster(roster);
    // Fire any milestones the affinity bumps just unlocked.
    let eventRaised = false;
    for (const [id, prev] of prevAffinity) {
      const c = this.s.roster[id];
      if (!c) continue;
      const outcomes = checkMilestones(c, prev, s.metrics.day);
      if (outcomes.length) eventRaised = this.applyMilestones(id, outcomes) || eventRaised;
    }
    void eventRaised;
    if (cash || followers || subscribers || hype || mood || comfort) {
      const m = s.metrics;
      s.patchMetrics({
        cash: m.cash + cash,
        followers: m.followers + followers,
        subscribers: m.subscribers + subscribers,
        hype: m.hype + hype,
        mood: m.mood + mood,
        comfort: m.comfort + comfort,
      });
      if (cash > 0 || followers > 0) {
        s.setSession({
          earnings: s.session.earnings + cash,
          newFollowers: s.session.newFollowers + followers + subscribers,
        });
      }
      // Surface the gains as chat notifications.
      if (followers > 0) this.notify(`📈 +${followers} new follower${followers > 1 ? "s" : ""} · ${this.s.metrics.followers.toLocaleString()} total`);
      if (subscribers > 0) this.notify(`⭐ +${subscribers} new sub${subscribers > 1 ? "s" : ""}!`);
    }
  }

  // ----------------------------------------------------------- world / zones

  goToZone(zoneId: ZoneId): void {
    this.s.setZone(zoneId);
    diag.debug("world", "move to zone", { zone: zoneId });
  }

  openZoneMenu(zoneId: ZoneId): void {
    this.goToZone(zoneId);
    const zone = ZONES[zoneId];
    const menu = ZONE_MENUS[zoneId];
    if (!zone || !menu) return;
    const live = this.s.session.isLive;
    const options = menu.options.filter((o) => o.liveOnly === undefined || o.liveOnly === live);
    if (options.length === 0) {
      this.s.setToast(live ? "Nothing to do there mid-stream." : "End the stream to use that.");
      return;
    }
    const am: ActionMenu = {
      title: `${zone.label}`,
      subtitle: zone.description,
      options,
      allowFreeform: menu.allowFreeform,
    };
    this.s.setActionMenu(am);
  }

  sleep(): void {
    const s = this.s;
    if (s.session.isLive) return s.setToast("End the stream before bed.");
    const mult = this.mults();
    const rent = mult.rentPerDay;
    const m = s.metrics;
    s.patchMetrics({
      day: m.day + 1,
      energy: 100,
      mood: m.mood + 8 + mult.moodPerDay,
      hype: Math.max(15, m.hype * 0.6),
      comfort: m.comfort + 6,
      cash: m.cash - rent,
    });
    s.setClock(STREAM_START);
    this.sysStory(`You sleep. Day ${m.day + 1} begins. Rent: -$${rent.toFixed(0)}.`);
    diag.info("economy", "sleep / rent", { day: m.day + 1, rent });
    s.setToast(
      m.cash - rent < 0
        ? `Day ${m.day + 1}. Rent of $${rent.toFixed(0)} put you in the red!`
        : `Day ${m.day + 1}. Rent: -$${rent.toFixed(0)}.`,
    );
  }

  private orderFood(): void {
    const s = this.s;
    if (s.metrics.cash < 15) return s.setToast("Not enough cash to order out.");
    this.coded("You order delivery. Twenty minutes later: a hot meal.", { cash: -15, energy: 18, mood: 6 }, "🛵 Ordered delivery (-$15)", 25);
  }

  private answerDoor(): void {
    const s = this.s;
    if (s.session.isLive) return s.setToast("Not while you're live!");
    const ev = rollEvent(this.eventCtx(), { offlineOnly: true }) ?? null;
    if (ev) void this.raiseEvent(ev);
    else this.coded("You open the door. Empty hallway — must've been the wind.", { comfort: -1 }, "🚪 No one there", 5);
  }

  private async maybeOfflineEvent(): Promise<void> {
    const ev = rollEvent(this.eventCtx(), { offlineOnly: true });
    if (ev && Math.random() < 0.4) {
      await this.raiseEvent(ev);
    } else {
      this.dm(pick([
        "You tidy up a little and check your phone. Quiet evening.",
        "You stretch, water the one surviving plant, and scroll a bit.",
        "A calm moment to yourself before the next stream.",
      ]));
    }
  }

  // ----------------------------------------------------------- events

  /** Rewrite the event's mechanical seed into bespoke prose, then show it. */
  private async raiseEvent(ev: GameEvent): Promise<void> {
    this.stopAmbient();
    const narrated = await this.narrateEvent(ev);
    this.s.setPendingEvent({ ...ev, description: narrated });
    diag.info("event", "event raised", { id: ev.id, title: ev.title, characterId: ev.characterId });
  }

  private async narrateEvent(ev: GameEvent): Promise<string> {
    if (this.llm.isMock) return ev.narrationSeed;
    const s = this.s;
    const who = ev.characterId ? s.roster[ev.characterId] : undefined;
    const whoLine = who
      ? `The viewer involved: ${who.handle} — ${ARCHETYPE_BY_ID[who.archetypeId]?.label}, ${relationshipLevel(who.affinity)}.${who.memory ? " Memory: " + who.memory : ""}`
      : "";
    try {
      const res = await this.llm.complete(
        {
          system: this.resolvePrompt("narrator"),
          messages: [
            {
              role: "user",
              content: [
                `Write 1-2 vivid sentences narrating this beat for the player (second person).`,
                `Beat: ${ev.narrationSeed}`,
                whoLine,
                `Do not list the choices; just set the scene.`,
              ].filter(Boolean).join("\n"),
            },
          ],
        },
        { kind: "story" },
      );
      return res.text.trim() || ev.narrationSeed;
    } catch {
      return ev.narrationSeed;
    }
  }

  resolveEvent(event: GameEvent, choice: EventChoice): void {
    const s = this.s;
    const m = s.metrics;
    const patch: Partial<Metrics> = {};
    for (const [k, v] of Object.entries(choice.effects) as Array<[keyof Metrics, number]>) {
      patch[k] = (m[k] as number) + v;
    }
    s.patchMetrics(patch);
    if (choice.effects.cash && s.session.isLive) {
      s.setSession({ earnings: s.session.earnings + choice.effects.cash });
    }
    // Stalker arc resolution + cool-downs.
    if (event.characterId) {
      const c = s.roster[event.characterId];
      if (c) {
        const label = choice.label.toLowerCase();
        if (/block|report|move apartments|confront/.test(label)) {
          // Decisive resolution: arc ends. Block/move also remove them from view;
          // blocking dents growth via a sour review.
          const removed = /block|report|move apartments/.test(label);
          s.patchCharacter(c.id, {
            threat: 0,
            escalationDay: -1,
            affinity: Math.max(0, c.affinity - 20),
            online: removed ? false : c.online,
          });
          if (/block|report/.test(label)) {
            const sour = sourReview(c);
            s.patchMetrics({ followers: s.metrics.followers + sour.followerDelta });
            s.logEvent(sour.log);
          }
        } else if (/boundary|don't open|wait them/.test(label)) {
          // Softer boundary: step the arc down one notch.
          s.patchCharacter(c.id, {
            threat: Math.max(0, c.threat - 1),
            escalationDay: -1,
            affinity: Math.max(0, c.affinity - 10),
          });
        }
      }
    }
    this.dm(choice.resolution);
    s.logEvent(`${event.title} → ${choice.resolution}`);
    s.setPendingEvent(null);
    diag.info("event", "event resolved", { id: event.id, choice: choice.label });
    s.setToast(choice.resolution);
    if (s.session.isLive) this.startAmbient("after that little moment");
  }

  // ----------------------------------------------------------- direct chat (DMs)

  openCharacter(id: string): void {
    const c = this.s.roster[id];
    if (!c) return;
    this.s.openCharacter(id);
    this.s.patchCharacter(id, { known: true });
    diag.info("world", "open character", { handle: c.handle });
    // Lazily flesh them out the first time you really look at them.
    if (!c.backstory) void this.generateBackstory(id);
  }

  /** Generate a richer bio + quirks (and a name, if still unknown) on demand. */
  private async generateBackstory(id: string): Promise<void> {
    const c = this.s.roster[id];
    if (!c || c.backstory) return;
    const arch = ARCHETYPE_BY_ID[c.archetypeId];
    if (this.llm.isMock) {
      // Offline fallback: expand the archetype seed into a usable bio.
      this.s.patchCharacter(id, {
        backstory: `${arch?.blurb ?? "A viewer"} They want ${c.wants}.`,
        quirks: arch ? pick(arch.lines) : "",
      });
      return;
    }
    try {
      const res = await this.llm.complete(
        {
          system: this.resolvePrompt("narrator"),
          messages: [
            {
              role: "user",
              content: [
                `Invent a short, grounded backstory for a livestream viewer named ${c.handle} (archetype: ${arch?.label} — ${arch?.blurb}).`,
                `Return JSON: {"backstory": "2-3 sentences, third person", "quirks": "one short phrase", "name": "a plausible first name"}.`,
                `Keep it human and specific, not melodramatic.`,
              ].join("\n"),
            },
          ],
          jsonMode: true,
        },
        { kind: "story" },
      );
      const json = extractJson<{ backstory?: string; quirks?: string; name?: string }>(res.text);
      if (json) {
        this.s.patchCharacter(id, {
          backstory: (json.backstory ?? "").slice(0, 400) || `${arch?.blurb ?? ""}`,
          quirks: (json.quirks ?? "").slice(0, 120),
          ...(c.displayName ? {} : json.name ? { displayName: String(json.name).slice(0, 24) } : {}),
        });
      }
    } catch {
      this.s.patchCharacter(id, { backstory: arch?.blurb ?? "A regular viewer." });
    }
  }

  async sendDm(text: string): Promise<void> {
    const s = this.s;
    const id = s.openCharId;
    if (!id) return;
    const c = s.roster[id];
    if (!c || s.dmBusy) return;
    const t = text.trim();
    if (!t) return;
    s.pushDm(id, { role: "me", text: t });
    s.setDmBusy(true);
    try {
      // Pass the FULL running conversation (now including the line just pushed)
      // so replies are contextual instead of cold non-sequiturs.
      const history = this.s.dmThreads[id] ?? [];
      const reply = await this.dmReply(c, history);
      this.s.pushDm(id, { role: "them", text: reply });
      // Talking 1:1 builds the relationship and a condensed memory.
      const prevAffinity = c.affinity;
      const affinity = clamp(c.affinity + 3, 0, 100);
      const memory = await this.condenseMemory(c, t, reply);
      this.s.patchCharacter(id, { affinity, memory, known: true, lastSeenClock: s.clock });
      // A 1:1 talk can push past a relationship threshold.
      const updated = this.s.roster[id];
      if (updated) {
        const outcomes = checkMilestones(updated, prevAffinity, s.metrics.day);
        if (outcomes.length) this.applyMilestones(id, outcomes);
      }
      diag.info("world", "dm exchange", { handle: c.handle, affinity: Math.round(affinity) });
    } finally {
      this.s.setDmBusy(false);
    }
  }

  private async dmReply(c: CharacterSheet, history: DmLine[]): Promise<string> {
    const arch = ARCHETYPE_BY_ID[c.archetypeId];
    if (this.llm.isMock) {
      return arch ? `${pick(arch.lines)}` : "haha yeah";
    }
    try {
      // Map the running conversation to alternating chat turns. The streamer
      // ("me") is the user; the character ("them") is the assistant.
      const messages = history.map((l) => ({
        role: (l.role === "me" ? "user" : "assistant") as "user" | "assistant",
        content: l.text,
      }));
      const res = await this.llm.complete(
        {
          system: [
            `You are ${c.handle}, a viewer privately DMing the streamer ${this.s.settings.streamerName}. You are NOT the streamer — you are the fan.`,
            `You are a ${arch?.label}: ${arch?.blurb}`,
            `You want: ${c.wants}. Your relationship with her: ${relationshipLevel(c.affinity)}.`,
            c.memory ? `What you remember about your past chats with her: ${c.memory}` : "",
            steeringForTier(this.s.settings),
            `Reply to her LAST message directly and relevantly, staying in character.`,
            `If she asks you a question, actually answer it. ONE short message, lowercase, casual, like a real DM. No quotes, no stage directions.`,
          ].filter(Boolean).join("\n"),
          messages: messages.length ? messages : [{ role: "user", content: "hey" }],
        },
        { kind: "chat" },
      );
      return res.text.trim().slice(0, 280) || "…";
    } catch {
      return arch ? pick(arch.lines) : "…";
    }
  }

  private async condenseMemory(c: CharacterSheet, mine: string, theirs: string): Promise<string> {
    if (this.llm.isMock) {
      const note = `chatted about "${mine.slice(0, 40)}"`;
      return c.memory ? `${c.memory}; ${note}`.slice(-180) : note;
    }
    try {
      const res = await this.llm.complete(
        {
          system: "Condense this relationship into ONE short memory line (<=160 chars) the viewer would remember. Merge with prior memory; keep the most important bits.",
          messages: [
            {
              role: "user",
              content: `Prior memory: ${c.memory || "(none)"}\nStreamer said: ${mine}\n${c.handle} replied: ${theirs}\nNew condensed memory:`,
            },
          ],
        },
        { kind: "story" },
      );
      return res.text.trim().slice(0, 180) || c.memory;
    } catch {
      return c.memory;
    }
  }

  // ----------------------------------------------------------- shop

  buyUpgrade(id: string): void {
    const s = this.s;
    const up = UPGRADES.find((u) => u.id === id);
    if (!up || s.ownedUpgrades.includes(id)) return;
    if (s.metrics.cash < up.cost) return s.setToast("Not enough cash for that yet.");
    s.patchMetrics({ cash: s.metrics.cash - up.cost });
    s.addUpgrade(id);
    diag.info("economy", "bought upgrade", { id, cost: up.cost });
    s.setToast(`Bought ${up.name}!`);
  }
}

function actionEcho(a: PlayerAction): string {
  return a.source === "freeform" ? `You: "${a.text}"` : `▸ ${a.text}`;
}
