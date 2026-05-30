import type { LlmAdapter } from "../llm/adapter";
import { logLlmRaw } from "../llm/adapter";
import {
  type ImageBackend,
  fillImagePrompt,
} from "../llm/imageProvider";
import { effectiveImagePrompt } from "../llm/imagePresets";
import {
  type StoredImage,
  type ImageKind,
  putImage,
  getByCacheKey,
  getImage,
  deleteImage as deleteStoredImage,
  imageCacheKey,
} from "../persist/imageStore";
import { diag } from "../diag/log";
import { useStore, type ActionMenu } from "../state/store";
import type { ChatMessage, DmLine, EventChoice, GameEvent, Metrics } from "./types";
import type { PlayerAction, ActionOption, ActionVerdict } from "./actions";
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
  type CharacterSheet,
} from "./characters";
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
      const upgradesClause = upgrades.length ? `Nice touches: ${upgrades.join(", ")}.` : "";
      const prompt = fillImagePrompt(effectiveImagePrompt(s.settings, "roomPrompt"), {
        upgrades: upgradesClause,
        persona: s.settings.streamerPersona,
        name: s.settings.streamerName,
        style: this.imageStyle(),
      });
      const url = await this.runImage("room", prompt, []);
      s.setRoomImage(url);
      // Also register it in the media library so it appears in the Gallery.
      const rec: Omit<StoredImage, "slotId"> = {
        id: uid("img"),
        cacheKey: imageCacheKey(["room", s.settings.streamerName, prompt]),
        kind: "room",
        label: "Studio room",
        prompt,
        dataUrl: url,
        characterName: s.settings.streamerName,
        createdAt: Date.now(),
      };
      await putImage(rec);
      s.cacheImage(rec.id, url);
      s.setLastImage(rec.id);
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

  // ----------------------------------------------------------- image library

  /** Whether image generation is wired (a backend + key is present). */
  get canGenerateImages(): boolean {
    return this.imageBackend !== null;
  }

  /** The universal art-style line shared by every generated image. */
  private imageStyle(): string {
    return effectiveImagePrompt(this.s.settings, "imageStyle");
  }

  /**
   * Run one image generation, logging the FULL prompt, reference count, timing,
   * and a response summary to both the diag stream (logs/events.jsonl) and the
   * raw LLM sink (logs/llm-prompts.jsonl + logs/llm-debug.log). Image calls
   * bypass the text adapter, so without this they were never written to file.
   */
  private async runImage(kind: ImageKind, prompt: string, refs: string[]): Promise<string> {
    if (!this.imageBackend) throw new Error("no image backend configured");
    const model = this.imageBackend.id;
    const startedAt = performance.now();
    diag.info("world", "image request", { kind, model, refs: refs.length, prompt });
    try {
      const url = await this.imageBackend.generate(prompt, refs);
      const durationMs = Math.round(performance.now() - startedAt);
      const meta = describeDataUrl(url);
      diag.info("world", "image response", { kind, model, durationMs, mime: meta.mime, bytes: meta.bytes });
      logLlmRaw({
        kind: `image:${kind}`,
        model,
        durationMs,
        request: {
          system: "",
          messages: [{ role: "user", content: refs.length ? `${prompt}\n[+${refs.length} reference image(s)]` : prompt }],
          jsonMode: false,
        },
        response: { text: `[image ${meta.mime} ~${meta.bytes} bytes]` },
      });
      return url;
    } catch (err) {
      const durationMs = Math.round(performance.now() - startedAt);
      const msg = err instanceof Error ? err.message : String(err);
      diag.error("world", "image request failed", { kind, model, durationMs, error: msg, prompt });
      logLlmRaw({
        kind: `image:${kind}`,
        model,
        durationMs,
        request: { system: "", messages: [{ role: "user", content: prompt }], jsonMode: false },
        response: { text: `ERROR: ${msg}` },
      });
      throw err;
    }
  }

  /**
   * Core image helper: returns the cached image for a key, or generates a fresh
   * one (optionally templated from `refs`), stores it permanently, and hydrates
   * the in-memory cache. `force` bypasses the cache (regenerate).
   */
  private async genImage(opts: {
    kind: ImageKind;
    prompt: string;
    label: string;
    refs?: string[];
    sourceImageId?: string;
    meta?: Record<string, string>;
    force?: boolean;
    busyLabel: string;
  }): Promise<StoredImage | null> {
    const s = this.s;
    if (!this.imageBackend) {
      s.setToast("Set a Gemini or OpenRouter key to generate images.");
      return null;
    }
    // Key the cache on the resolved prompt (and any reference image) so editing a
    // prompt template, the description it embeds, or the source it templates from
    // naturally produces a fresh image.
    const cacheKey = imageCacheKey([opts.kind, s.settings.streamerName, opts.prompt, opts.sourceImageId]);
    if (!opts.force) {
      const hit = await getByCacheKey(cacheKey);
      if (hit) {
        s.cacheImage(hit.id, hit.dataUrl);
        if (opts.kind !== "body") s.setLastImage(hit.id);
        diag.info("world", "image cache hit", { kind: opts.kind, label: opts.label });
        return hit;
      }
    }
    if (s.imageBusy) {
      s.setToast("An image is already generating…");
      return null;
    }
    s.setImageBusy(opts.busyLabel);
    s.setToast(`${opts.busyLabel}… (this can take a while)`);
    try {
      const url = await this.runImage(opts.kind, opts.prompt, opts.refs ?? []);
      const rec: Omit<StoredImage, "slotId"> = {
        id: uid("img"),
        cacheKey,
        kind: opts.kind,
        label: opts.label,
        prompt: opts.prompt,
        dataUrl: url,
        characterName: s.settings.streamerName,
        meta: opts.meta,
        sourceImageId: opts.sourceImageId,
        createdAt: Date.now(),
      };
      const stored = await putImage(rec);
      s.cacheImage(stored.id, url);
      // The body T-pose is a template, not a "visualization" worth centering.
      if (opts.kind !== "body") s.setLastImage(stored.id);
      diag.info("world", "image generated", { kind: opts.kind, bytes: url.length });
      return stored;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      diag.error("world", "image failed", { kind: opts.kind, error: msg });
      s.setToast(`Image failed: ${msg}`);
      return null;
    } finally {
      s.setImageBusy(null);
    }
  }

  /** Generate the player character's portrait and reusable T-pose body. */
  async generateCharacter(description: string, force = false): Promise<void> {
    const s = this.s;
    const desc = description.trim();
    if (!desc) {
      s.setToast("Describe how your streamer looks first.");
      return;
    }
    s.setCharacter({ description: desc });
    const name = s.settings.streamerName;
    const vars = {
      name,
      description: desc,
      style: this.imageStyle(),
      gender: (s.settings.gender ?? "").trim(),
    };

    const portrait = await this.genImage({
      kind: "portrait",
      prompt: fillImagePrompt(effectiveImagePrompt(s.settings, "portraitPrompt"), vars),
      label: `${name} — portrait`,
      busyLabel: "Generating portrait",
      force,
    });
    if (portrait) s.setCharacter({ portraitId: portrait.id });

    // Build the body from the portrait so the face/outfit match — pass the
    // just-generated portrait as a reference image.
    const body = await this.genImage({
      kind: "body",
      prompt: fillImagePrompt(effectiveImagePrompt(s.settings, "bodyPrompt"), {
        ...vars,
        ...(portrait ? { match: "Match the face, hair, and outfit of the reference portrait exactly." } : {}),
      }),
      label: `${name} — body (template)`,
      refs: portrait ? [portrait.dataUrl] : undefined,
      sourceImageId: portrait?.id,
      busyLabel: "Generating body template",
      force,
    });
    if (body) s.setCharacter({ bodyId: body.id });

    if (portrait || body) {
      // The character changed, so every image templated from it (per-zone
      // presence renders) is now stale — drop them so they're regenerated.
      s.clearPresenceImages();
      s.setToast("Character visuals updated — re-visualize locations to refresh them.");
    }
  }

  /** The body data URL used as a templating reference, if available. */
  private async bodyRef(): Promise<{ url: string; id: string } | null> {
    const bodyId = this.s.character.bodyId;
    if (!bodyId) return null;
    const cached = this.s.imageCache[bodyId];
    if (cached) return { url: cached, id: bodyId };
    const rec = await getImage(bodyId);
    if (!rec) return null;
    this.s.cacheImage(rec.id, rec.dataUrl);
    return { url: rec.dataUrl, id: rec.id };
  }

  /** Generate (or fetch cached) the character placed in a given zone. */
  async generatePresence(zoneId: ZoneId, force = false): Promise<void> {
    const s = this.s;
    const desc = s.character.description.trim();
    if (!desc) {
      s.setToast("Create your character's look first (🎭 Character).");
      return;
    }
    const zone = ZONES[zoneId];
    if (!zone) return;
    const ref = await this.bodyRef();
    const rec = await this.genImage({
      kind: "presence",
      prompt: fillImagePrompt(effectiveImagePrompt(s.settings, "presencePrompt"), {
        name: s.settings.streamerName,
        description: desc,
        zone: zone.label,
        zoneDesc: zone.description,
        style: this.imageStyle(),
      }),
      label: `${s.settings.streamerName} — ${zone.label}`,
      refs: ref ? [ref.url] : undefined,
      sourceImageId: ref?.id,
      meta: { zone: zoneId },
      busyLabel: `Visualizing ${zone.label}`,
      force,
    });
    if (rec) s.setPresenceImage(zoneId, rec.id);
  }

  /** Generate an image of the current narrative beat and drop it in the feed. */
  async generateScene(force = false): Promise<void> {
    const s = this.s;
    const desc = s.character.description.trim();
    if (!desc) {
      s.setToast("Create your character's look first (🎭 Character).");
      return;
    }
    const narrative = this.recentNarrative();
    if (!narrative) {
      s.setToast("Nothing's happened yet to visualize.");
      return;
    }
    const ref = await this.bodyRef();
    const zone = ZONES[s.zone];
    const positionLabel = zone ? `${zone.label} — ${zone.description}` : "her studio";
    const rec = await this.genImage({
      kind: "scene",
      prompt: fillImagePrompt(effectiveImagePrompt(s.settings, "scenePrompt"), {
        name: s.settings.streamerName,
        description: desc,
        position: positionLabel,
        narrative,
        style: this.imageStyle(),
      }),
      label: narrative.slice(0, 60),
      refs: ref ? [ref.url] : undefined,
      sourceImageId: ref?.id,
      busyLabel: "Visualizing the scene",
      force,
    });
    if (rec) {
      s.pushStory({ kind: "image", text: rec.label, imageId: rec.id });
    }
  }

  /** Recent narration to seed a scene image (newest dm/outcome lines). */
  private recentNarrative(): string {
    const lines = this.s.story
      .filter((e) => e.kind === "dm" || e.kind === "outcome" || e.kind === "action")
      .slice(-4)
      .map((e) => e.text);
    return lines.join(" ").slice(-500).trim();
  }

  /** Force a fresh render for an existing stored image (same cache key). */
  async regenerateImage(rec: StoredImage): Promise<void> {
    const s = this.s;
    if (!this.imageBackend || s.imageBusy) return;
    if (rec.kind === "portrait" || rec.kind === "body") {
      await this.generateCharacter(s.character.description || rec.prompt, true);
      return;
    }
    if (rec.kind === "presence" && rec.meta?.zone) {
      await this.generatePresence(rec.meta.zone as ZoneId, true);
      return;
    }
    s.setImageBusy("Regenerating");
    try {
      const ref = rec.sourceImageId ? await this.bodyRef() : null;
      const url = await this.imageBackend.generate(rec.prompt, ref ? [ref.url] : undefined);
      const next: StoredImage = { ...rec, id: uid("img"), dataUrl: url, createdAt: Date.now() };
      await putImage(next);
      s.cacheImage(next.id, url);
      if (next.kind !== "body") s.setLastImage(next.id);
      s.setToast("Regenerated.");
    } catch (err) {
      s.setToast(`Regenerate failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      s.setImageBusy(null);
    }
  }

  /** Delete a stored image and detach it from any references that point to it. */
  async deleteImage(rec: StoredImage): Promise<void> {
    const s = this.s;
    await deleteStoredImage(rec.id);
    s.uncacheImage(rec.id);
    if (s.character.portraitId === rec.id) s.setCharacter({ portraitId: null });
    if (s.character.bodyId === rec.id) s.setCharacter({ bodyId: null });
    for (const [zone, id] of Object.entries(s.presenceImages)) {
      if (id === rec.id) s.setPresenceImage(zone as ZoneId, null);
    }
    s.setToast("Image deleted.");
  }

  /** Set a stored portrait/body as the active character image. */
  setActiveImage(rec: StoredImage): void {
    const s = this.s;
    s.cacheImage(rec.id, rec.dataUrl);
    if (rec.kind === "portrait") s.setCharacter({ portraitId: rec.id });
    else if (rec.kind === "body") s.setCharacter({ bodyId: rec.id });
    else if (rec.kind === "presence" && rec.meta?.zone) s.setPresenceImage(rec.meta.zone as ZoneId, rec.id);
    s.setToast("Set as active.");
  }

  /** Pull persisted image ids (portrait/body/presence) into the memory cache. */
  async hydrateImageCache(): Promise<void> {
    const s = this.s;
    const ids = [
      s.character.portraitId,
      s.character.bodyId,
      s.lastImageId,
      ...Object.values(s.presenceImages),
    ].filter((x): x is string => !!x);
    for (const id of ids) {
      if (s.imageCache[id]) continue;
      const rec = await getImage(id);
      if (rec) s.cacheImage(rec.id, rec.dataUrl);
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

    for (const id of res.arrivals) {
      const c = res.roster[id];
      if (c && c.affinity >= 35) {
        this.s.pushChat([this.sysChat(`${c.handle} (${relationshipLevel(c.affinity)}) joined`)]);
      }
    }
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

  /** A short, ever-changing read on her state — keeps per-beat narration fresh. */
  private vibeSummary(): string {
    const m = this.s.metrics;
    const band = (v: number) => (v >= 70 ? "high" : v >= 35 ? "okay" : "low");
    return `energy ${band(m.energy)}, mood ${band(m.mood)}, hype ${band(m.hype)}, ~${Math.round(totalViewers(this.s.audience))} watching`;
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
          recentChat: this.recentChatLines(),
          vibe: this.vibeSummary(),
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

          // Lead the beat with her ACTUAL spoken words (the real joke, answer,
          // flirt) so the performance reads first. Only then the stage direction
          // and the chat reacting to what she actually said — otherwise the feed
          // describes the reaction before she's even spoken.
          const say = await this.performLine(action, verdict);
          // She's TALKING on stream, not typing — her words live in the narrator
          // feed only, never in the chat panel (that's the audience).
          if (say) this.s.pushStory({ kind: "quote", text: say });

          // Brief stage direction (her demeanor) follows her words, then the
          // mechanical outcome summary.
          this.dm(verdict.narration);
          if (result.summary) this.outcome(result.summary);

          const count = clamp(Math.round(totalViewers(result.audience) / 6) + 2, 3, 8);
          // React to her ACTUAL words when we have them, else fall back to prose.
          const reactTo = say
            ? `${s.settings.streamerName} just said on stream: "${say}"`
            : action.source === "freeform"
              ? `${s.settings.streamerName} did/said: "${action.text}". (In the moment: ${verdict.narration})`
              : verdict.narration;
          const msgs = await generateChatBurst(this.llm, this.chatCtx(reactTo, count));
          this.s.pushChat(msgs);
          this.applyChatEffects(msgs);

          if (s.playing) s.setPlaying({ ...s.playing, roundsPlayed: s.playing.roundsPlayed + 1 });
        } else {
          // Offline: no chat to react, so the narration carries the whole beat.
          this.dm(verdict.narration);
        }

        const weight: TimeWeight = weightForIntensity(verdict.intensity);
        this.advanceTime(TIME_COST[weight]);
        if (s.session.isLive) this.afterBeat(verdict.narration);
      } finally {
        this.s.setResolving(false);
      }
    });
  }

  /**
   * Generate the streamer's ACTUAL spoken words for a live action (the real
   * joke, the real answer, the flirty line) as a first-person quote. Returns
   * null if it can't (so callers just skip the quote).
   */
  private async performLine(action: PlayerAction, verdict: ActionVerdict): Promise<string | null> {
    const s = this.s;
    if (this.llm.isMock) return mockPerformance(action, verdict);
    try {
      const res = await this.llm.complete(
        {
          system: this.resolvePrompt("performance"),
          messages: [
            {
              role: "user",
              content: [
                `You are LIVE on cam, at the ${ZONES[s.zone]?.label ?? "studio"}.`,
                `Audience right now: ${audienceSummary(s.audience)}`,
                `What you are doing this moment: ${action.text}`,
                verdict.tags.length ? `Vibe: ${verdict.tags.join(", ")}.` : "",
                `Recent chat:\n${this.recentChatLines().join("\n") || "(quiet)"}`,
                "Now say it out loud, in your own voice:",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
        },
        { kind: "chat" },
      );
      return cleanQuote(res.text);
    } catch (err) {
      diag.warn("chat", "performance line failed", { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
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

  private applyChatEffects(msgs: ChatMessage[]): void {
    const s = this.s;
    const mult = this.mults();
    let cash = 0, followers = 0, subscribers = 0, hype = 0, mood = 0, comfort = 0;
    const roster = { ...s.roster };
    let rosterChanged = false;

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
    }
  }

  // ----------------------------------------------------------- world / zones

  goToZone(zoneId: ZoneId): void {
    const s = this.s;
    s.setZone(zoneId);
    diag.debug("world", "move to zone", { zone: zoneId });
    // Returning to a place that has a cached position visualization makes it the
    // current center-stage image again.
    const presenceId = s.presenceImages[zoneId];
    if (presenceId) {
      s.setLastImage(presenceId);
      if (!s.imageCache[presenceId]) {
        void getImage(presenceId).then((rec) => rec && s.cacheImage(rec.id, rec.dataUrl));
      }
    }
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
    // Boundary-style choices cool a bound stalker.
    if (event.characterId && /block|boundary|report|don't open|wait them/i.test(choice.label)) {
      const c = s.roster[event.characterId];
      if (c) s.patchCharacter(c.id, { threat: Math.max(0, c.threat - 1), affinity: Math.max(0, c.affinity - 10) });
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
      const affinity = clamp(c.affinity + 3, 0, 100);
      const memory = await this.condenseMemory(c, t, reply);
      this.s.patchCharacter(id, { affinity, memory, known: true, lastSeenClock: s.clock });
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

/** Strip wrapping quotes / asterisks / name prefixes from a spoken line. */
function cleanQuote(text: string): string | null {
  let t = text.trim().replace(/\*+/g, "").trim();
  // Drop a leading "Name:" prefix if the model added one.
  t = t.replace(/^[A-Za-z0-9_ ]{1,24}:\s+/, "").trim();
  // Strip a single pair of surrounding quotes.
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  return t ? t.slice(0, 600) : null;
}

/** Offline canned spoken lines so the feature still works without an API key. */
function mockPerformance(action: PlayerAction, verdict: ActionVerdict): string | null {
  const tags = new Set(verdict.tags);
  if (tags.has("funny")) return "Okay okay — why don't skeletons fight each other? They don't have the guts!";
  if (tags.has("flirty") || tags.has("teasing")) return "Aww, you're all so sweet to me tonight… careful, you'll make me blush.";
  if (tags.has("grateful")) return "Seriously, thank you — you have no idea how much you all keep me going.";
  if (tags.has("vulnerable") || tags.has("personal")) return "Honestly? Some weeks are hard. But hanging out with you makes it lighter.";
  if (tags.has("boundary-setting")) return "Hey — that's not okay, and I'm not going to entertain it. Moving on.";
  if (tags.has("energetic") || tags.has("hype")) return "Let's GO chat! Turn it up, I'm feeling it tonight!";
  const t = action.text.replace(/[.!?]+$/, "").trim();
  return t ? `Alright chat — ${t}!` : null;
}

/** Summarize a generated data URL (mime + approx decoded byte size) for logs. */
function describeDataUrl(url: string): { mime: string; bytes: number } {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
  if (!m) return { mime: "url", bytes: url.length };
  return { mime: m[1], bytes: Math.round(m[2].length * 0.75) };
}
