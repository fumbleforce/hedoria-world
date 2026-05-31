import type { LlmAdapter } from "../llm/adapter";
import { logLlmRaw, completeJsonWithRepair } from "../llm/adapter";
import { extractJson } from "../llm/json";
import {
  type ImageBackend,
  fillImagePrompt,
  generatePortrait,
  generateCharacterBody,
} from "../llm/imageProvider";
import {
  effectiveImagePrompt,
  getImagePreset,
  IMAGE_STYLE_PRESETS,
  type ImagePromptSet,
  type ImageStylePresetId,
} from "../llm/imagePresets";
import {
  type StoredImage,
  type ImageKind,
  putImage,
  getByCacheKey,
  getImage,
  deleteImage as deleteStoredImage,
  imageCacheKey,
  savePortrait,
  loadPortrait,
  saveCharacterBody,
  loadCharacterBody,
  stylePreviewKey,
  saveStylePreview,
  loadStylePreview,
} from "../persist/imageStore";
import { diag } from "../diag/log";
import { useStore, type ActionMenu } from "../state/store";
import type { ChatMessage, ContentTier, DmLine, EventChoice, GameEvent, Metrics } from "./types";
import type { PlayerAction, ActionOption, ActionVerdict } from "./actions";
import { generateChatBurst, audienceSummary } from "./chatEngine";
import { evaluateAction } from "./evaluator";
import { resolveAction, totalViewers } from "./resolver";
import { rollEvent, type EventContext } from "./events";
import { startArc, arcEventDue, advanceArc } from "./arcs";
import { occasionForDay } from "./calendar";
import { newlyCompletedGoals } from "./goals";
import { directDm, type DmEffect } from "./dmDirector";
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
/** Days after an in-person visit before the same viewer can arrange another. */
const VISIT_COOLDOWN_DAYS = 3;

/**
 * Turn-based controller on an in-world clock. The player takes one action (or
 * just Continues); time passes, presence drifts, chat reacts, and mechanical
 * events fire with LLM-written narration. Every action runs:
 *   evaluate (LLM/local) → resolve (pure code) → narrate + react → advance time.
 */
export class GameController {
  private ambientTimer: ReturnType<typeof setTimeout> | null = null;
  /** Rolling LLM-written summary of the current stream (running jokes, callbacks). */
  private streamMemory = "";
  /** Beats since the stream summary was last refreshed (throttles the summariser). */
  private beatsSinceSummary = 0;

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
  private async runImage(kind: ImageKind | "preview", prompt: string, refs: string[]): Promise<string> {
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
    // Trim the trailing period off the zone blurb so the template's own period
    // doesn't produce a stray ".." in the prompt.
    const positionLabel = zone
      ? `${zone.label} — ${zone.description.replace(/[.\s]+$/, "")}`
      : "her studio";
    const refs: string[] = ref ? [ref.url] : [];
    const name = s.settings.streamerName;
    let prompt = fillImagePrompt(effectiveImagePrompt(s.settings, "scenePrompt"), {
      name,
      description: desc,
      position: positionLabel,
      narrative,
      style: this.imageStyle(),
    });
    // If a guest is physically present (an in-person visit), put them in the frame.
    // Prefer their full-body T-pose reference (generated on demand) so their whole
    // likeness carries over; fall back to the portrait, then a text description.
    const guest = s.visitor ? s.roster[s.visitor.charId] : undefined;
    if (guest) {
      const guestName = guest.displayName || guest.handle;
      const guestUrl =
        (await this.ensureCharacterBody(guest.id)) ??
        (guest.hasPortrait ? await loadPortrait(guest.id) : null);
      if (guestUrl) {
        refs.push(guestUrl);
        prompt += ` Also in frame: ${guestName} — use the provided reference image for their likeness (face, hair, outfit, build). Show ${guestName} and ${name} together, interacting naturally.`;
      } else {
        prompt += ` Also in frame: ${guestName}, ${guest.vibe || "a viewer who came over to visit"}. Show them and ${name} together, interacting naturally.`;
      }
    }
    // The room art keeps the apartment's layout/look consistent across renders.
    if (s.roomImage) {
      refs.push(s.roomImage);
      prompt += ` Use the provided room reference image for the apartment — same layout, furniture, and style.`;
    }
    const rec = await this.genImage({
      kind: "scene",
      prompt,
      label: narrative.slice(0, 60),
      refs: refs.length ? refs : undefined,
      sourceImageId: ref?.id,
      busyLabel: "Visualizing the scene",
      force,
    });
    if (rec) {
      s.pushStory({ kind: "image", text: rec.label, imageId: rec.id });
    }
  }

  /**
   * Recent narration distilled into a short, *visual* prompt for a scene image:
   * we drop spoken dialogue and parenthetical meta-notes (e.g. "(you hang back…)")
   * since an image only cares about what's physically happening, then keep the
   * most recent sentences.
   */
  private recentNarrative(): string {
    const lines = this.s.story
      .filter((e) => e.kind === "dm" || e.kind === "outcome" || e.kind === "action")
      .slice(-3)
      .map((e) => e.text);
    const joined = lines.join(" ");
    // If a beat was almost entirely dialogue, stripping quotes can empty it out —
    // fall back to the lightly-tidied raw text so there's still something to draw.
    return visualizeNarrative(joined) || joined.replace(/\s{2,}/g, " ").trim().slice(-360);
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

  /**
   * Ensure a named character has a full-body T-pose reference, generating one on
   * demand (using their portrait as a likeness reference when available). Returns
   * the body data URL, or null if it can't be produced. Idempotent and safe to
   * fire-and-forget; subsequent callers reuse the stored body.
   */
  private async ensureCharacterBody(charId: string): Promise<string | null> {
    const s = this.s;
    const c = s.roster[charId];
    if (!c) return null;
    if (c.hasBody) {
      const existing = await loadCharacterBody(charId);
      if (existing) return existing;
    }
    if (!this.imageBackend) return null;
    // Another portrait/body render is in flight — skip for now; the next call
    // (or the next visualization) will pick it up once the lock frees.
    if (s.portraitBusyId) return c.hasPortrait ? await loadPortrait(charId) : null;
    s.setPortraitBusy(charId);
    s.setToast(`Sketching ${c.displayName || c.handle}…`);
    try {
      const portraitRef = c.hasPortrait ? (await loadPortrait(charId)) ?? undefined : undefined;
      const url = await generateCharacterBody(
        this.imageBackend,
        {
          name: c.displayName || c.handle,
          archetypeLabel: ARCHETYPE_BY_ID[c.archetypeId]?.label ?? "viewer",
          vibe: c.backstory || c.vibe,
          style: this.imageStyle(),
        },
        portraitRef,
      );
      await saveCharacterBody(charId, url);
      s.patchCharacter(charId, { hasBody: true });
      return url;
    } catch (err) {
      diag.warn("world", "character body gen failed", {
        charId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      s.setPortraitBusy(null);
    }
  }

  // ------------------------------------------------------ style-preset previews

  /**
   * A fixed common subject so every style preview differs ONLY by art style,
   * making the presets directly comparable at a glance.
   */
  private previewPrompt(preset: ImagePromptSet): string {
    return [
      "Upper-body character art of a friendly young woman video-game streamer with headphones,",
      "sitting at a glowing streaming desk with dual monitors and a webcam in a cozy studio apartment.",
      "Looking toward the camera with a warm expression.",
      "No text, no watermark, no UI. Square composition.",
      preset.imageStyle,
    ].join(" ");
  }

  /** Generate (or fetch cached) a preview thumbnail for one art-style preset. */
  async generateStylePreview(presetId: ImageStylePresetId, force = false): Promise<void> {
    const s = this.s;
    if (!this.imageBackend) {
      s.setToast("Set a Gemini or OpenRouter key to generate style previews.");
      return;
    }
    const preset = getImagePreset(presetId);
    const key = stylePreviewKey(preset.id, preset.imageStyle);
    if (!force) {
      const existing = await loadStylePreview(key);
      if (existing) {
        s.setStylePreview(preset.id, existing);
        return;
      }
    }
    if (s.imageBusy) {
      s.setToast("An image is already generating…");
      return;
    }
    s.setImageBusy(`Preview: ${preset.label}`);
    try {
      const url = await this.runImage("preview", this.previewPrompt(preset), []);
      await saveStylePreview(key, url);
      s.setStylePreview(preset.id, url);
    } catch (err) {
      diag.error("world", "style preview failed", {
        preset: preset.id,
        error: err instanceof Error ? err.message : String(err),
      });
      s.setToast(`Preview failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      s.setImageBusy(null);
    }
  }

  /** Generate previews for every preset (sequential; skips ones already cached). */
  async generateAllStylePreviews(force = false): Promise<void> {
    for (const p of IMAGE_STYLE_PRESETS) {
      await this.generateStylePreview(p.id, force);
    }
    this.s.setToast("Style previews ready.");
  }

  /** Load any already-generated previews into memory for the Settings UI. */
  async hydrateStylePreviews(): Promise<void> {
    const s = this.s;
    for (const p of IMAGE_STYLE_PRESETS) {
      if (s.stylePreviews[p.id]) continue;
      const url = await loadStylePreview(stylePreviewKey(p.id, p.imageStyle));
      if (url) s.setStylePreview(p.id, url);
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
    s.logEvent(`⚠ ${target.displayName || target.handle} escalated to threat ${outcome.patch.threat}.`);
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
    if (s.visitor) return s.setToast("You've got company over — see them out first.");
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
    this.streamMemory = "";
    this.beatsSinceSummary = 0;
    this.presenceTick();
    this.sysStory(`Day ${s.metrics.day} — you go live at ${formatClock(STREAM_START)}.`);
    s.logEvent(`Day ${s.metrics.day}: went live.`);
    this.applySeasonalBeat();
    this.dm("The 'LIVE' dot blinks red. Regulars filter in, saying hi as the numbers tick up.");
    // A due arc beat (sponsor deliverable, viral wave, …) opens the night.
    if (this.maybeArcEvent()) return;
    this.startAmbient("the stream just went live");
  }

  /**
   * Re-establish a live session that survived a reload. `session` is persisted,
   * but the transient parts of being live (online presence flags, the audience
   * snapshot, the ambient-chat loop, viewer count) are not — so after boot we
   * rebuild them around the restored session instead of dropping the player
   * offline. No-op when the saved session was already offline.
   */
  resumeLive(): void {
    const s = this.s;
    if (!s.session.isLive) return;
    this.lastNotifiedViewers = Math.round(s.metrics.currentViewers);
    this.streamMemory = "";
    this.beatsSinceSummary = 0;
    // Rebuild who's "in the room" (online flags + per-segment audience) from the
    // persisted roster, then resume the ambient chatter.
    this.presenceTick();
    this.startAmbient("the stream picks back up after a blip");
    diag.info("round", "resumed live session after reload", { round: s.session.round });
  }

  endStream(reason?: string): void {
    const s = this.s;
    if (!s.session.isLive) return;
    this.stopAmbient();
    this.streamMemory = "";
    this.beatsSinceSummary = 0;
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
    this.checkGoals();
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
      streamMemory: this.streamMemory,
      characterVoices: this.characterVoices(),
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

  /**
   * Each currently-online named regular paired with their own recent lines from
   * this stream, so the chat model keeps every personality stable across the
   * night rather than re-rolling a voice per burst.
   */
  private characterVoices(): Array<{ handle: string; lines: string[] }> {
    const online = new Set(this.onlineIds());
    const byChar = new Map<string, string[]>();
    for (const m of this.s.chat) {
      if (!m.characterId || !online.has(m.characterId) || m.kind === "system") continue;
      const arr = byChar.get(m.characterId) ?? [];
      // De-dupe per character: feeding a repeated line back as a "voice"
      // exemplar (e.g. "here we go" x3) reinforces it and the chat model just
      // echoes it again — a self-perpetuating repetition loop.
      const seen = new Set(arr.map((l) => l.toLowerCase()));
      const key = m.text.toLowerCase();
      if (!seen.has(key)) arr.push(m.text);
      byChar.set(m.characterId, arr);
    }
    const out: Array<{ handle: string; lines: string[] }> = [];
    for (const [id, lines] of byChar) {
      const c = this.s.roster[id];
      if (c && lines.length) out.push({ handle: c.handle, lines });
    }
    return out.slice(0, 8);
  }

  /** A short, ever-changing read on her state — keeps per-beat narration fresh. */
  private vibeSummary(): string {
    const m = this.s.metrics;
    const band = (v: number) => (v >= 70 ? "high" : v >= 35 ? "okay" : "low");
    return `energy ${band(m.energy)}, mood ${band(m.mood)}, hype ${band(m.hype)}, ~${Math.round(totalViewers(this.s.audience))} watching`;
  }

  /**
   * Roll a compact running summary of the stream so the chat/evaluator models can
   * reference earlier beats — running jokes, callbacks, "remember when" moments.
   * Throttled (every few beats) and cheap; folds the prior summary into the new
   * one so old context survives the chat/story ring buffers. No-op when mocked.
   */
  private async refreshStreamMemory(force = false): Promise<void> {
    const s = this.s;
    if (this.llm.isMock || !s.session.isLive) return;
    this.beatsSinceSummary += 1;
    if (!force && this.beatsSinceSummary < 3) return;
    this.beatsSinceSummary = 0;

    const recentStory = s.story
      .filter((e) => e.kind === "action" || e.kind === "dm" || e.kind === "outcome" || e.kind === "quote")
      .slice(-8)
      .map((e) => (e.kind === "quote" ? `${s.settings.streamerName} said: "${e.text}"` : e.text))
      .join("\n");
    const recentChat = this.recentChatLines().join("\n");
    try {
      const res = await this.llm.complete(
        {
          system:
            "You maintain a terse memory log for a livestream sim. Given the running summary and the latest beats, return an updated summary in 2-4 short sentences. Track running jokes, callbacks, recurring viewers, promises she made, and the current bit — drop stale detail. Plain prose only, no preamble.",
          messages: [
            {
              role: "user",
              content: [
                this.streamMemory ? `Running summary:\n${this.streamMemory}` : "Running summary: (stream just started)",
                recentStory ? `Latest beats:\n${recentStory}` : "",
                recentChat ? `Latest chat:\n${recentChat}` : "",
                "Updated summary:",
              ]
                .filter(Boolean)
                .join("\n\n"),
            },
          ],
        },
        { kind: "chat" },
      );
      const text = res.text.trim().replace(/^updated summary:?\s*/i, "").trim();
      if (text) this.streamMemory = text.slice(0, 700);
    } catch (err) {
      diag.warn("chat", "stream memory refresh failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
    // During an in-person visit, Continue lets the guest take the lead.
    if (s.visitor) return this.visitContinue();
    if (!s.session.isLive) {
      // Offline continue = potter around; maybe a knock/package/DM.
      this.advanceTime(TIME_COST.continue);
      await this.maybeOfflineEvent();
      return;
    }
    this.stopAmbient();
    s.setResolving(true);
    await diag.group("action", "continue", async () => {
      try {
        // Continue PICKS UP the current moment and moves it forward — if the last
        // beat only set something up (cued music to dance), she now actually does
        // it and it develops. It is NOT an idle "nothing happens" filler.
        const continuation = await this.narrateContinuation();
        this.dm(continuation);
        const msgs = await generateChatBurst(this.llm, this.chatCtx(`the scene continues — ${continuation}`, 4));
        this.s.pushChat(msgs);
        this.applyChatEffects(msgs);
        this.advanceTime(TIME_COST.continue);
        this.afterBeat(continuation);
      } finally {
        this.s.setResolving(false);
      }
    });
  }

  /**
   * Generate the next narrative beat when the player hits Continue: pick up from
   * the most recent story beats and actually advance the moment (follow through
   * on whatever was set up), rather than resetting or stalling.
   */
  private async narrateContinuation(): Promise<string> {
    const s = this.s;
    const playing = s.playing ? GAME_BY_ID[s.playing.gameId]?.name ?? "" : "";
    const fallback = () =>
      pick([
        "You stop hesitating and actually commit — the moment takes off and the room lifts with it.",
        "You follow through for real now, and it snowballs into something genuinely fun.",
        `You lean all the way into it${playing ? ` mid-${playing}` : ""}, and the energy kicks up a gear.`,
      ]);
    if (this.llm.isMock) return fallback();
    try {
      const res = await this.llm.complete(
        {
          system: this.resolvePrompt("narrator"),
          messages: [
            {
              role: "user",
              content: [
                `She is LIVE on cam at the ${ZONES[s.zone]?.label ?? "studio"}.`,
                playing ? `She is playing ${playing}.` : "",
                this.streamMemory ? `Stream so far: ${this.streamMemory}` : "",
                `Her current vibe: ${this.vibeSummary()}.`,
                this.recentStoryContext()
                  ? `The story so far (oldest first, newest last):\n${this.recentStoryContext()}`
                  : "",
                `Recent chat:\n${this.recentChatLines().join("\n") || "(quiet)"}`,
                "CONTINUE the scene from exactly here and MOVE IT FORWARD. If the most",
                "recent beat only set something up or was about to begin (e.g. cueing",
                "music to dance), she now ACTUALLY does it and it unfolds with a fresh,",
                "concrete development — a real next thing happens. Never reset the scene,",
                "never repeat the previous beat, and never say nothing happens. 1-3 vivid",
                "second-person sentences.",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
        },
        { kind: "story" },
      );
      const text = res.text.trim().replace(/\*+/g, "").trim();
      return text || fallback();
    } catch (err) {
      diag.warn("action", "continuation failed; using fallback", {
        error: err instanceof Error ? err.message : String(err),
      });
      return fallback();
    }
  }

  /** Recent story beats (action/quote/narration/outcome) for continuation context. */
  private recentStoryContext(): string {
    return this.s.story
      .filter((e) => e.kind === "action" || e.kind === "dm" || e.kind === "outcome" || e.kind === "quote")
      .slice(-5)
      .map((e) => (e.kind === "quote" ? `She said: "${e.text}"` : e.text))
      .join("\n")
      .slice(-700)
      .trim();
  }

  /**
   * The last few narration (stage-direction) lines, so the evaluator can SEE
   * what it just wrote and deliberately avoid repeating the same openings,
   * gestures, and phrasings beat after beat.
   */
  private recentNarrationLines(n = 4): string[] {
    return this.s.story
      .filter((e) => e.kind === "dm")
      .slice(-n)
      .map((e) => e.text.trim())
      .filter(Boolean);
  }

  async submitAction(action: PlayerAction): Promise<void> {
    const s = this.s;
    if (s.resolving) return;
    // While a visitor is present, every action is a beat in the in-person scene.
    if (s.visitor) return this.visitBeat(action.text);
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
          recentNarration: this.recentNarrationLines(),
          vibe: this.vibeSummary(),
          streamMemory: this.streamMemory,
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
          if (result.gainedFollowers > 0) {
            this.notify(`📈 +${result.gainedFollowers} new follower${result.gainedFollowers > 1 ? "s" : ""} · ${this.s.metrics.followers.toLocaleString()} total`);
          }
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
                this.streamMemory ? `Stream so far: ${this.streamMemory}` : "",
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
    void this.refreshStreamMemory();
    this.checkGoals();

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
      recentTriggerIds: s.recentEvents.map((r) => r.triggerId),
    };
  }

  // ----------------------------------------------------------- seasonal / arcs / goals

  /** If today is a holiday/anniversary/birthday, apply its tailwind + narrate. */
  private applySeasonalBeat(): void {
    const s = this.s;
    const occ = occasionForDay(s.metrics.day, { birthday: s.settings.streamerBirthday });
    if (!occ) return;
    const b = occ.bonus;
    const patch: Partial<Metrics> = {};
    if (b.hype) patch.hype = s.metrics.hype + b.hype;
    if (b.mood) patch.mood = s.metrics.mood + b.mood;
    if (b.cashTips) patch.cash = s.metrics.cash + b.cashTips;
    s.patchMetrics(patch);
    if (b.cashTips && s.session.isLive) {
      s.setSession({ earnings: s.session.earnings + b.cashTips });
    }
    this.sysStory(`${occ.name} — ${occ.seed}`);
    s.logEvent(occ.name);
    s.setToast(occ.name);
    diag.info("event", "seasonal beat", { id: occ.id, day: s.metrics.day });
  }

  /** Raise one scheduled DM meetup as an offline doorstep event, when due. */
  private consumeDueVisit(): GameEvent | null {
    const s = this.s;
    // Visits are an offline, at-home beat — never interrupt a live stream.
    if (s.session.isLive) return null;
    const due = s.pendingVisits.find((v) => v.day <= s.metrics.day);
    if (!due) return null;
    const c = s.roster[due.charId];
    if (!c) {
      s.clearPendingVisit(due.charId);
      return null;
    }
    s.clearPendingVisit(due.charId);
    // Stamp the cooldown the moment they show up at the door — whether or not you
    // let them in — so a stale "coming over" line in the DM history can't re-arrange
    // another visit on your very next message.
    s.patchCharacter(due.charId, { lastVisitDay: s.metrics.day });
    diag.info("world", "visit doorstep raised", { handle: c.handle, day: s.metrics.day });
    return this.buildVisitDoorEvent(c, due.hint);
  }

  private buildVisitDoorEvent(c: CharacterSheet, hint: string): GameEvent {
    const warm = c.threat <= 0 && c.affinity >= 45;
    const title = warm ? "🚪 A viewer arrives" : "🚪 Someone you know is at the door";
    const seed = warm
      ? `${c.displayName || c.handle} actually showed up after your DMs. They look nervous-excited in the hallway.`
      : `${c.displayName || c.handle} is outside your apartment door after your DMs. ${hint}`;
    return {
      id: uid("evt"),
      triggerId: "dm-visit-door",
      title,
      description: seed,
      narrationSeed: seed,
      tone: c.threat >= 1 ? "creepy" : "neutral",
      characterId: c.id,
      allowFreeform: true,
      freeformHint: "…or respond in your own words",
      choices: [
        { label: "Let them in", resolution: "You crack the door and let them step inside.", effects: { comfort: warm ? 2 : -2 } },
        { label: "Don't answer", resolution: "You stay quiet and wait them out behind the locked door.", effects: { comfort: c.threat >= 1 ? 4 : -1 } },
        { label: "Tell them to leave", resolution: "You keep the chain on and set a firm boundary through the door.", effects: { comfort: 3 } },
      ],
      stakes: "This is an in-person boundary moment. Reward caution and clear boundaries; let risky choices carry downside.",
    };
  }

  /** Raise the first due arc-stage event, if any. Returns true if one fired. */
  private maybeArcEvent(): boolean {
    const s = this.s;
    if (s.pendingEvent) return false;
    const visit = this.consumeDueVisit();
    if (visit) {
      void this.raiseEvent(visit);
      return true;
    }
    for (const arc of s.arcs) {
      const event = arcEventDue(arc, s.metrics.day);
      if (event) {
        void this.raiseEvent(event);
        return true;
      }
    }
    return false;
  }

  /** Start a multi-step arc when a seed event was resolved a particular way. */
  private maybeStartArc(event: GameEvent, choiceLabel: string): void {
    const s = this.s;
    const day = s.metrics.day;
    const label = choiceLabel.toLowerCase();
    if (event.triggerId === "brand-deal" && label.includes("take it")) {
      const offer = 50 + Math.round(s.metrics.followers / 4);
      s.addArc(startArc("sponsorship", { day, data: { brand: pick(BRANDS), offer } }));
      this.sysStory("You sign on with the sponsor — they'll expect a real segment in a day or two.");
      s.logEvent("Arc started: sponsorship deal.");
    } else if (event.triggerId === "viral-clip" && label.includes("lean")) {
      s.addArc(startArc("viral", { day, data: { topic: "your clip" } }));
      this.sysStory("You ride the clip. Word is spreading fast — this could snowball over the next day.");
      s.logEvent("Arc started: viral clip.");
    } else if (event.triggerId === "stalker-confront" && /block|report/.test(label)) {
      const c = event.characterId ? s.roster[event.characterId] : undefined;
      s.addArc(startArc("stalker-legal", { day, characterId: event.characterId, data: { handle: c?.displayName || c?.handle || "them" } }));
      s.logEvent(`Arc started: legal follow-up on ${c?.displayName || c?.handle || "them"}.`);
    }
  }

  /** Shared post-resolution bookkeeping: event memory, arc advance, goal checks. */
  private finishEvent(event: GameEvent, choiceLabel: string, resolution: string): void {
    const s = this.s;
    s.pushEventRecord({
      triggerId: event.triggerId ?? "unknown",
      title: event.title,
      day: s.metrics.day,
      choice: choiceLabel,
      resolution,
    });
    if (event.advancesArc) {
      const arc = s.arcs.find((a) => a.id === event.advancesArc!.id);
      if (arc) {
        const next = advanceArc(arc, s.metrics.day);
        if (next) s.updateArc(arc.id, next);
        else s.removeArc(arc.id);
      }
    }
    this.maybeStartArc(event, choiceLabel);
    this.checkGoals();
  }

  /** Award any soft objectives newly satisfied this tick. */
  private checkGoals(): void {
    const s = this.s;
    const done = newlyCompletedGoals(
      { metrics: s.metrics, peakViewers: s.metrics.peakViewers },
      s.completedGoals,
    );
    for (const g of done) {
      s.completeGoal(g.id);
      const patch: Partial<Metrics> = {};
      for (const [k, v] of Object.entries(g.reward) as Array<[keyof Metrics, number]>) {
        patch[k] = (s.metrics[k] as number) + v;
      }
      s.patchMetrics(patch);
      this.sysStory(`🎯 Goal reached — ${g.label}. ${g.rewardText}`);
      s.logEvent(`Goal: ${g.label}`);
      s.setToast(`🎯 ${g.label}`);
      diag.info("event", "goal completed", { id: g.id });
    }
  }

  // ----------------------------------------------------------- mini-games

  startGame(gameId: string): void {
    const g = GAME_BY_ID[gameId];
    if (!g) return;
    this.s.setGamePickerOpen(false);
    this.s.setPlaying({ gameId, roundsPlayed: 0 });
    this.dm(`You boot up ${g.name} ${g.emoji} and get settled. Chat reacts to the loading screen.`);
    this.outcome(`🎮 Now playing: ${g.name}`);
    this.s.logEvent(`Started playing ${g.name}.`);
    diag.info("action", "start game", { gameId });
    if (this.s.session.isLive) this.afterBeat(`just started playing ${g.name}`);
  }

  stopGame(): void {
    const g = this.s.playing ? GAME_BY_ID[this.s.playing.gameId] : null;
    this.s.setPlaying(null);
    if (g) {
      this.dm(`You wrap up ${g.name} and stretch. "Okay chat, what's next?"`);
      this.s.logEvent(`Stopped playing ${g.name}.`);
    }
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
      const who = s.roster[charId]?.displayName || s.roster[charId]?.handle || "a viewer";
      s.logEvent(`Milestone: ${who} → ${o.id}.`);
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
    s.logEvent(`${who} referred a friend: ${friend.handle}.`);
  }

  /**
   * Unified tip pipeline shared by live chat donations/subs and DM tips:
   * multipliers, session earnings (only while live), per-character tipped total,
   * affinity growth, and milestone checks all happen in one place.
   */
  private recordTip(charId: string | undefined, amount: number, opts?: { hype?: number; affinityDelta?: number }): void {
    if (amount <= 0) return;
    const s = this.s;
    const cashDelta = amount * this.mults().income;
    const metricsPatch: Partial<Metrics> = { cash: s.metrics.cash + cashDelta };
    if (opts?.hype) metricsPatch.hype = s.metrics.hype + opts.hype;
    s.patchMetrics(metricsPatch);
    if (s.session.isLive) s.setSession({ earnings: s.session.earnings + cashDelta });
    if (!charId) return;
    const c = s.roster[charId];
    if (!c) return;
    const prevAffinity = c.affinity;
    s.patchCharacter(charId, {
      tipped: c.tipped + amount,
      affinity: clamp(c.affinity + (opts?.affinityDelta ?? 0.6), 0, 100),
      lastSeenClock: s.clock,
    });
    const updated = this.s.roster[charId];
    if (!updated) return;
    const outcomes = checkMilestones(updated, prevAffinity, s.metrics.day);
    if (outcomes.length) this.applyMilestones(charId, outcomes);
  }

  private applyChatEffects(msgs: ChatMessage[]): void {
    const s = this.s;
    let followers = 0, subscribers = 0, hype = 0, mood = 0, comfort = 0;

    for (const msg of msgs) {
      const isTip = msg.kind === "donation" || msg.kind === "sub";
      switch (msg.kind) {
        case "donation":
          // recordTip owns the money + tipped + affinity + milestone path so a
          // chat tip and a DM tip behave identically.
          this.recordTip(msg.characterId, msg.amount ?? 0, { hype: 1 });
          break;
        case "sub":
          subscribers += 1;
          this.recordTip(msg.characterId, msg.amount ?? 5, { hype: 2 });
          break;
        case "follow": followers += 1; break;
        case "raid": followers += 5; hype += 4; break;
        case "troll": mood -= 0.6; break;
        case "creepy": comfort -= 1; break;
        default: break;
      }
      // Attribute the line to a named character. Tip kinds already had their
      // affinity/tipped/lastSeen bumped (and milestones checked) by recordTip
      // above, so here we only ever add messageCount for them; non-tip lines
      // also grant the small attribution-affinity and can cross a milestone.
      // We read fresh store state (not a stale snapshot) so recordTip's writes
      // are preserved instead of being clobbered.
      const cur = msg.characterId ? this.s.roster[msg.characterId] : undefined;
      if (msg.characterId && cur) {
        const prevAffinity = cur.affinity;
        s.patchCharacter(msg.characterId, {
          messageCount: cur.messageCount + 1,
          lastSeenClock: s.clock,
          ...(isTip ? {} : { affinity: clamp(cur.affinity + 0.6, 0, 100) }),
        });
        if (!isTip) {
          const upd = this.s.roster[msg.characterId];
          if (upd) {
            const outcomes = checkMilestones(upd, prevAffinity, s.metrics.day);
            if (outcomes.length) this.applyMilestones(msg.characterId, outcomes);
          }
        }
      }
    }
    if (followers || subscribers || hype || mood || comfort) {
      const m = s.metrics;
      s.patchMetrics({
        followers: m.followers + followers,
        subscribers: m.subscribers + subscribers,
        hype: m.hype + hype,
        mood: m.mood + mood,
        comfort: m.comfort + comfort,
      });
      if (followers > 0 || subscribers > 0) {
        s.setSession({
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
    if (s.visitor) return s.setToast("You can't sleep — someone's over right now.");
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
    s.logEvent(`Day ${m.day + 1} begins. Rent: -$${rent.toFixed(0)}.`);
    diag.info("economy", "sleep / rent", { day: m.day + 1, rent });
    s.setToast(
      m.cash - rent < 0
        ? `Day ${m.day + 1}. Rent of $${rent.toFixed(0)} put you in the red!`
        : `Day ${m.day + 1}. Rent: -$${rent.toFixed(0)}.`,
    );
    this.checkGoals();
    // A new day may bring a due visit or arc beat.
    this.maybeArcEvent();
  }

  private orderFood(): void {
    const s = this.s;
    if (s.metrics.cash < 15) return s.setToast("Not enough cash to order out.");
    this.coded("You order delivery. Twenty minutes later: a hot meal.", { cash: -15, energy: 18, mood: 6 }, "🛵 Ordered delivery (-$15)", 25);
  }

  private answerDoor(): void {
    const s = this.s;
    if (s.session.isLive) return s.setToast("Not while you're live!");
    const visit = this.consumeDueVisit();
    if (visit) {
      void this.raiseEvent(visit);
      return;
    }
    const ev = rollEvent(this.eventCtx(), { offlineOnly: true }) ?? null;
    if (ev) void this.raiseEvent(ev);
    else this.coded("You open the door. Empty hallway — must've been the wind.", { comfort: -1 }, "🚪 No one there", 5);
  }

  private async maybeOfflineEvent(): Promise<void> {
    const visit = this.consumeDueVisit();
    if (visit) {
      await this.raiseEvent(visit);
      return;
    }
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
    // Events that have a real in-game answer (a DM you can just reply to, or a
    // donation you can thank with the existing action) skip the modal entirely and
    // arrive passively — in the DM thread or as a 💸 ding — with a notification.
    if (ev.deliverAsDm) {
      await this.deliverIncomingDm(ev);
      return;
    }
    if (ev.deliverAsTip) {
      this.deliverIncomingTip(ev);
      return;
    }
    this.stopAmbient();
    const narrated = await this.narrateEvent(ev);
    this.s.setPendingEvent({ ...ev, description: narrated });
    diag.info("event", "event raised", { id: ev.id, title: ev.title, characterId: ev.characterId });
  }

  /**
   * Deliver a `deliverAsDm` event as a real incoming DM: an opener written in the
   * sender's voice lands in their thread, the thread is flagged unread, and a
   * lightweight notification fires — no modal, no canned choices. The player can
   * then reply in the DM panel where the DM director owns the consequences. We
   * still record it as an event so cooldowns treat the trigger as recently fired.
   */
  private async deliverIncomingDm(ev: GameEvent): Promise<void> {
    const s = this.s;
    const charId = ev.characterId ?? this.pickDmSender();
    if (!charId) return;
    const c = s.roster[charId];
    if (!c) return;
    const opener = await this.composeIncomingDm(c, ev.deliverAsDm ?? "");
    s.pushDm(charId, { role: "them", text: opener });
    if (s.openCharId !== charId) s.markDmUnread(charId);
    const label = c.displayName || c.handle;
    if (s.session.isLive) this.notify(`📨 New DM from ${label}`);
    s.setToast(`📨 New DM from ${label}`);
    s.logEvent(`📨 DM from ${label}: "${opener.slice(0, 60)}"`);
    s.pushEventRecord({
      triggerId: ev.triggerId ?? "dm",
      title: ev.title,
      day: s.metrics.day,
      choice: "dm",
      resolution: `DM from ${label}`,
    });
    diag.info("world", "incoming dm", { handle: c.handle, triggerId: ev.triggerId });
  }

  /**
   * Deliver a `deliverAsTip` event as a passive donation: the money lands through
   * the shared `recordTip` pipeline (same as a chat/DM tip), a 💸 line shows in
   * chat, and a toast "dings" — no modal. The player can then follow up with the
   * existing "🙏 Thank a supporter" action. Recorded for cooldowns like any event.
   */
  private deliverIncomingTip(ev: GameEvent): void {
    const s = this.s;
    const amount = ev.deliverAsTip ?? 0;
    if (amount <= 0) return;
    const charId = ev.characterId;
    const c = charId ? s.roster[charId] : undefined;
    const name = c?.displayName || c?.handle || "a viewer";
    this.recordTip(charId, amount, { hype: 1, affinityDelta: 0.9 });
    s.pushChat([
      { id: uid("tip"), user: c?.handle ?? "a_viewer", text: `donated $${amount}! 💸`, kind: "donation", amount, characterId: charId, ts: Date.now() },
    ]);
    s.setToast(`💸 $${amount} tip from ${name}!`);
    s.logEvent(`💸 ${name} tipped $${amount}.`);
    s.pushEventRecord({
      triggerId: ev.triggerId ?? "tip-spike",
      title: ev.title,
      day: s.metrics.day,
      choice: "tip",
      resolution: `$${amount} from ${name}`,
    });
    diag.info("world", "incoming tip", { handle: c?.handle, amount });
  }

  /** Fallback DM sender when no character was bound: a known regular, else anyone. */
  private pickDmSender(): string | null {
    const all = Object.values(this.s.roster);
    const known = all.filter((c) => c.known);
    const pool = known.length ? known : all;
    return pool.length ? pick(pool).id : null;
  }

  /** Write the sender's unsolicited opening line, in their voice. */
  private async composeIncomingDm(c: CharacterSheet, flavor: string): Promise<string> {
    const arch = ARCHETYPE_BY_ID[c.archetypeId];
    if (this.llm.isMock) return arch ? pick(arch.lines) : "hey, you around?";
    const req = {
      system: [
        `You are ${c.handle}, a viewer privately DMing the streamer ${this.s.settings.streamerName} out of the blue. You are NOT the streamer — you are the fan.`,
        `You are a ${arch?.label}: ${arch?.blurb}`,
        `You want: ${c.wants}. Your relationship with her: ${relationshipLevel(c.affinity)}.`,
        c.memory ? `What you remember about your past chats with her: ${c.memory}` : "",
        steeringForTier(this.s.settings),
        flavor ? `Open the conversation with ${flavor}.` : "Open the conversation.",
        `ONE short message that STARTS the conversation, lowercase, casual, like a real DM. No quotes, no stage directions.`,
      ].filter(Boolean).join("\n"),
      messages: [{ role: "user" as const, content: "(start the DM)" }],
    };
    try {
      const res = await this.llm.complete(req, { kind: "chat" });
      return res.text.trim().slice(0, 280) || (arch ? pick(arch.lines) : "hey");
    } catch {
      return arch ? pick(arch.lines) : "hey";
    }
  }

  private async narrateEvent(ev: GameEvent): Promise<string> {
    if (this.llm.isMock) return ev.narrationSeed;
    const s = this.s;
    const who = ev.characterId ? s.roster[ev.characterId] : undefined;
    const whoLine = who
      ? `The viewer involved: ${who.handle} — ${ARCHETYPE_BY_ID[who.archetypeId]?.label}, ${relationshipLevel(who.affinity)}.${who.memory ? " Memory: " + who.memory : ""}`
      : "";
    // Let narration lightly call back to a recent, different beat for continuity.
    const lastRec = [...s.recentEvents].reverse().find((r) => r.triggerId !== ev.triggerId);
    const callback = lastRec
      ? `You MAY lightly reference a recent beat for continuity (don't force it): "${lastRec.title}" on day ${lastRec.day}${lastRec.resolution ? ` — ${lastRec.resolution}` : ""}.`
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
                callback,
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
    const isDoorstep = event.triggerId === "dm-visit-door";
    const letIn = /let them in/i.test(choice.label);
    const charId = event.characterId;
    s.setPendingEvent(null);
    diag.info("event", "event resolved", { id: event.id, choice: choice.label });
    s.setToast(choice.resolution);
    this.finishEvent(event, choice.label, choice.resolution);
    if (isDoorstep && letIn && charId) {
      this.startVisitorScene(charId, "You let them in.");
      return;
    }
    // Some choices cut the night short (e.g. bailing on a power cut).
    if (s.session.isLive && event.triggerId === "power-cut" && /call it early/i.test(choice.label)) {
      this.endStream("power cut");
      return;
    }
    if (s.session.isLive) this.startAmbient("after that little moment");
  }

  /**
   * Resolve an event from a freeform, typed response. The LLM judges what the
   * player did and returns a bespoke resolution + metric effects — so events
   * aren't limited to the canned choices.
   */
  async resolveEventFreeform(event: GameEvent, text: string): Promise<void> {
    const s = this.s;
    const t = text.trim();
    if (!t || s.resolving) return;
    s.setResolving(true);
    try {
      const outcome = await this.judgeEventResponse(event, t);
      const patch: Partial<Metrics> = {};
      for (const [k, v] of Object.entries(outcome.effects) as Array<[keyof Metrics, number]>) {
        patch[k] = (s.metrics[k] as number) + v;
      }
      s.patchMetrics(patch);
      if (outcome.effects.cash && s.session.isLive) {
        s.setSession({ earnings: s.session.earnings + outcome.effects.cash });
      }
      this.s.pushStory({ kind: "action", text: `(You: ${t})` });
      this.dm(outcome.resolution);
      s.logEvent(`${event.title} → ${outcome.resolution}`);
      s.setPendingEvent(null);
      diag.info("event", "event resolved (freeform)", { id: event.id, effects: outcome.effects });
      this.finishEvent(event, "freeform", outcome.resolution);
      if (event.triggerId === "dm-visit-door" && event.characterId && /let.*in|come in|inside|open the door|invite/i.test(t)) {
        this.startVisitorScene(event.characterId, outcome.resolution);
        return;
      }
      if (s.session.isLive) this.startAmbient("after handling that your way");
    } finally {
      s.setResolving(false);
    }
  }

  /** LLM judge for a freeform event response → bespoke resolution + effects. */
  private async judgeEventResponse(
    event: GameEvent,
    text: string,
  ): Promise<{ resolution: string; effects: Partial<Metrics> }> {
    const fallback = {
      resolution: `You handle it your own way. ${text.slice(0, 80)}… and the moment passes.`,
      effects: { mood: 1 } as Partial<Metrics>,
    };
    if (this.llm.isMock) return fallback;
    const req = {
      system: [
        this.resolvePrompt("narrator"),
        "You are judging how a freeform player choice resolves during a streamer life-sim event.",
        "Return JSON: { resolution: string (1-2 vivid second-person sentences), effects: { hype?, energy?, mood?, comfort?, followers?, cash?, subscribers? } }.",
        "Effects are DELTAS. Keep stat deltas within -20..20, followers -30..60, cash -300..300. Be fair: reward clever/kind/brave responses, let reckless ones cost comfort/mood. Most responses are modest.",
      ].join("\n"),
      messages: [
        {
          role: "user" as const,
          content: [
            `EVENT: ${event.title}`,
            `Situation: ${event.description}`,
            event.stakes ? `Stakes: ${event.stakes}` : "",
            `The player responds, in their own words: "${text}"`,
            "Judge the outcome.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      jsonMode: true,
      jsonSchema: EVENT_OUTCOME_SCHEMA,
    };
    try {
      const parsed = await completeJsonWithRepair(this.llm, req, parseEventOutcome, "story");
      return parsed ?? fallback;
    } catch (err) {
      diag.warn("event", "freeform judge failed; using fallback", {
        error: err instanceof Error ? err.message : String(err),
      });
      return fallback;
    }
  }

  private startVisitorScene(charId: string, intro: string): void {
    const s = this.s;
    const c = s.roster[charId];
    if (!c) return;
    s.startVisitor({
      charId,
      beats: 0,
      transcript: `Start: ${intro}`,
      relationshipScore: 0,
      threatDelta: 0,
      suggestedRelationship: c.relationship,
      lines: [{ role: "system", text: intro }],
    });
    s.setZone("couch");
    s.logEvent(`You let ${c.displayName || c.handle} into your apartment.`);
    s.setToast(`${c.displayName || c.handle} is inside now.`);
    this.sysStory(`🏠 ${c.displayName || c.handle} steps inside. It's just the two of you now — the stream is off and the room is quiet.`);
    diag.info("world", "visit scene started", { handle: c.handle });
    // Warm up a full-body T-pose reference in the background so it's ready the
    // moment the player decides to visualize the scene.
    void this.ensureCharacterBody(charId);
  }

  /** Player-initiated graceful end to a visit (so they're never stuck). */
  async endVisit(): Promise<void> {
    const s = this.s;
    if (!s.visitor || s.resolving) return;
    await this.resolveVisit(s.visitor.charId, "You wind things down and walk them to the door.");
  }

  /** A player-typed beat in an active visit. */
  async visitBeat(text: string): Promise<void> {
    const t = text.trim();
    if (!t) return;
    await this.runVisitBeat(t);
  }

  /** "Continue" during a visit: the player hangs back and the guest takes the lead. */
  async visitContinue(): Promise<void> {
    await this.runVisitBeat(null);
  }

  /**
   * One beat of an in-person visit. `playerText` is what the streamer says/does;
   * pass `null` to let the moment play out (the guest acts on their own).
   */
  private async runVisitBeat(playerText: string | null): Promise<void> {
    const s = this.s;
    const scene = s.visitor;
    if (!scene || s.resolving) return;
    const c = s.roster[scene.charId];
    if (!c) return;
    s.setResolving(true);
    try {
      if (playerText) {
        s.pushVisitorLine({ role: "me", text: playerText });
        this.s.pushStory({ kind: "action", text: `(You: ${playerText})` });
      } else {
        this.s.pushStory({ kind: "action", text: `(You hang back and let ${c.displayName || c.handle} take the lead…)` });
      }
      const cue = playerText ?? "(The streamer stays quiet and just watches — show what the visitor does next on their own initiative.)";
      const outcome = await this.judgeVisitBeat(c, scene.transcript, cue, scene.beats, playerText === null);
      s.pushVisitorLine({ role: "narrator", text: outcome.narration });
      this.dm(outcome.narration);
      const patch: Partial<Metrics> = {};
      for (const [k, v] of Object.entries(outcome.effects) as Array<[keyof Metrics, number]>) {
        patch[k] = (s.metrics[k] as number) + v;
      }
      s.patchMetrics(patch);
      const transcriptLine = playerText ? `You: ${playerText}` : "You: (waited and watched)";
      s.patchVisitor({
        beats: scene.beats + 1,
        transcript: `${scene.transcript}\n${transcriptLine}\nOutcome: ${outcome.narration}`,
        relationshipScore: scene.relationshipScore + relationshipSignalScore({ type: "relationship", relationship: outcome.relationshipSignal }),
        threatDelta: scene.threatDelta + outcome.threatDelta,
        suggestedRelationship: outcome.relationshipSignal === "none" ? scene.suggestedRelationship : outcome.relationshipSignal,
      });
      // Visits never auto-end — the player decides when to wrap up via
      // "See them out" (endVisit). No judge-driven end, no hard cap.
    } finally {
      s.setResolving(false);
    }
  }

  private async resolveVisit(charId: string, endReason: string): Promise<void> {
    const s = this.s;
    const scene = s.visitor;
    const c = s.roster[charId];
    if (!scene || !c) {
      s.endVisitor();
      return;
    }
    let nextRel = c.relationship;
    if (scene.suggestedRelationship !== "none" && this.allowRelationship(scene.suggestedRelationship, c.affinity, s.settings.contentTier)) {
      nextRel = scene.suggestedRelationship;
    }
    const prevAffinity = c.affinity;
    s.patchCharacter(charId, {
      relationship: nextRel,
      affinity: clamp(c.affinity + scene.relationshipScore, 0, 100),
      threat: clamp(c.threat + scene.threatDelta, 0, 3),
      lastSeenClock: s.clock,
      lastVisitDay: s.metrics.day,
    });
    const updated = this.s.roster[charId];
    if (updated) {
      const memory = await this.condenseMemory(updated, "you met in person at your apartment", endReason);
      s.patchCharacter(charId, { memory });
      const outcomes = checkMilestones(updated, prevAffinity, s.metrics.day);
      if (outcomes.length) this.applyMilestones(charId, outcomes);
    }
    s.endVisitor();
    s.clearPendingVisit(charId);
    this.dm(endReason);
    s.logEvent(`Visit with ${c.displayName || c.handle} ended${nextRel !== "none" ? ` (${nextRel})` : ""}.`);
    s.setToast("The visit ends.");
    diag.info("world", "visit resolved", { handle: c.displayName || c.handle, relationship: nextRel, threatDelta: scene.threatDelta });
    // Emergent follow-up: a warm visit can blossom into a relationship arc; a
    // visit that crossed a line leaves the raised threat for the stalker systems.
    this.maybeStartVisitArc(charId);
  }

  /** Seed a budding-relationship arc when an in-person visit ended warm. */
  private maybeStartVisitArc(charId: string): void {
    const s = this.s;
    const c = s.roster[charId];
    if (!c) return;
    if (s.arcs.some((a) => a.kind === "relationship" && a.characterId === charId)) return;
    if (c.threat >= 2) return; // danger path is handled by threat / stalker systems
    if (c.relationship !== "none" || c.affinity >= 60) {
      s.addArc(startArc("relationship", { day: s.metrics.day, characterId: charId, data: { handle: c.displayName || c.handle } }));
      this.sysStory(`Something shifted with ${c.displayName || c.handle} tonight — this might be going somewhere.`);
      s.logEvent(`Arc started: something real with ${c.displayName || c.handle}.`);
    }
  }

  private async judgeVisitBeat(
    c: CharacterSheet,
    transcript: string,
    text: string,
    beats: number,
    passive = false,
  ): Promise<{
    narration: string;
    effects: Partial<Metrics>;
    relationshipSignal: CharacterSheet["relationship"];
    threatDelta: number;
  }> {
    const name = c.displayName || c.handle;
    const fallback = {
      narration: passive
        ? `${name} shifts on the couch, then breaks the silence. "So… this is wild, huh? I keep thinking I'm gonna wake up." They glance around your place, taking it in.`
        : `You handle the moment carefully, feeling the room out. ${name} watches you, waiting to see where this goes.`,
      effects: { mood: 1 } as Partial<Metrics>,
      relationshipSignal: "none" as CharacterSheet["relationship"],
      threatDelta: 0,
    };
    if (this.llm.isMock) return fallback;
    const req = {
      system: [
        this.resolvePrompt("narrator"),
        "You are narrating one beat of an in-person apartment visit between the streamer (the player) and a viewer who came over.",
        "Write the `narration` as a vivid, immersive beat of 3-5 sentences. It MUST include the visitor's actual spoken dialogue in quotation marks (what they SAY out loud, in their voice), not just a summary of their mood. Show body language, tone, and what they physically do, woven together with their lines.",
        passive
          ? "The streamer is hanging back this beat — DO NOT invent words or actions for the streamer. The VISITOR drives the moment: have them speak and act on their own initiative (ask a question, make a move, react to the silence)."
          : "React to what the streamer just said/did, then have the visitor respond in dialogue and action.",
        "Then judge consequences: `effects` (modest stat deltas), `relationshipSignal` (only when the dynamic clearly shifts), `threatDelta` (raise if the visitor crosses a line / the player is unsafe; lower if reassured).",
        "The visit keeps going until the PLAYER chooses to end it — never wrap it up, conclude it, or have the visitor leave on your own. Always continue the moment and leave it open.",
        "Stay in the established content tier. Keep effects realistic; most beats are small.",
      ].join("\n"),
      messages: [
        {
          role: "user" as const,
          content: [
            `Visitor: ${name} — a ${ARCHETYPE_BY_ID[c.archetypeId]?.label ?? "viewer"} (${c.relationship}, affinity ${Math.round(c.affinity)}, threat ${c.threat}). They want: ${c.wants}.`,
            c.memory ? `What they remember: ${c.memory}` : "",
            `Transcript so far:\n${transcript.slice(-1400)}`,
            passive ? "The streamer waits silently this beat — narrate what the VISITOR does next on their own." : `The streamer now: "${text}"`,
            `Beat number: ${beats + 1}.`,
            "Narrate this beat (with the visitor's spoken dialogue) and judge it.",
          ].filter(Boolean).join("\n"),
        },
      ],
      jsonMode: true,
      jsonSchema: VISIT_OUTCOME_SCHEMA,
    };
    try {
      const parsed = await completeJsonWithRepair(this.llm, req, parseVisitOutcome, "story");
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  // ----------------------------------------------------------- direct chat (DMs)

  openCharacter(id: string): void {
    const c = this.s.roster[id];
    if (!c) return;
    this.s.openCharacter(id);
    this.s.patchCharacter(id, { known: true });
    this.s.clearDmUnread(id);
    diag.info("world", "open character", { handle: c.handle });
    // Lazily flesh them out the first time you really look at them.
    if (!c.backstory) void this.generateBackstory(id);
  }

  // -------------------------------------------------------------- dev tools
  // Cheats for testing systems without grinding the game — wired up to the
  // Settings → Dev tab. Each routes through the normal pipelines so behaviour
  // matches the real thing.

  /** Dev: drop a viewer on your doorstep right now, skipping the DM/meetup flow. */
  devStartVisit(charId: string): void {
    const s = this.s;
    const c = s.roster[charId];
    if (!c) return;
    if (s.visitor) { s.setToast("A visit is already in progress."); return; }
    if (s.session.isLive) { s.setToast("Go offline first to host a visit."); return; }
    s.patchCharacter(charId, { known: true, lastVisitDay: s.metrics.day });
    s.clearPendingVisit(charId);
    this.startVisitorScene(charId, `${c.displayName || c.handle} drops by your place.`);
    s.logEvent(`[dev] Forced a visit from ${c.displayName || c.handle}.`);
  }

  /** Dev: simulate a tip from a viewer through the normal tip pipeline. */
  devTip(charId: string, amount: number): void {
    const s = this.s;
    const c = s.roster[charId];
    this.recordTip(charId, amount, { hype: 1, affinityDelta: 0.9 });
    s.setToast(`${c?.displayName || c?.handle || "Someone"} tipped $${amount}.`);
    s.logEvent(`[dev] ${c?.displayName || c?.handle || charId} tipped $${amount}.`);
  }

  /** Dev: nudge a character's affinity by `delta` (clamped 0-100). */
  devAddAffinity(charId: string, delta: number): void {
    const s = this.s;
    const c = s.roster[charId];
    if (!c) return;
    s.patchCharacter(charId, { affinity: clamp(c.affinity + delta, 0, 100), known: true });
  }

  /** Dev: set a character's threat level (0-3). */
  devSetThreat(charId: string, threat: number): void {
    const s = this.s;
    const c = s.roster[charId];
    if (!c) return;
    s.patchCharacter(charId, { threat: clamp(Math.round(threat), 0, 3) });
  }

  /** Dev: toggle a character online/offline. */
  devToggleOnline(charId: string): void {
    const s = this.s;
    const c = s.roster[charId];
    if (!c) return;
    s.patchCharacter(charId, { online: !c.online, known: true });
  }

  /** Dev: spawn a fresh random viewer straight into the roster. */
  devSpawnViewer(): void {
    const s = this.s;
    const arch = rollArchetype(this.intensity());
    const v = seedCharacter(arch, s.clock);
    v.known = true;
    v.online = s.session.isLive;
    s.upsertCharacter(v);
    s.logEvent(`[dev] Spawned ${v.handle} (${arch.label}).`);
    s.setToast(`Spawned ${v.handle}.`);
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
      const reply = await this.dmReply(c, history, id);
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
      const now = this.s.roster[id];
      if (now) {
        const effects = await directDm(this.llm, {
          settings: this.s.settings,
          character: now,
          history: this.s.dmThreads[id] ?? [],
          metrics: {
            cash: this.s.metrics.cash,
            comfort: this.s.metrics.comfort,
            mood: this.s.metrics.mood,
            day: this.s.metrics.day,
          },
          streamMemory: this.streamMemory,
        });
        await this.applyDmEffects(id, effects);
      }
      diag.info("world", "dm exchange", { handle: c.handle, affinity: Math.round(affinity) });
    } finally {
      this.s.setDmBusy(false);
    }
  }

  /** Build the DM reply request: the character replying in-voice to the thread. */
  private dmRequest(c: CharacterSheet, history: DmLine[]) {
    const arch = ARCHETYPE_BY_ID[c.archetypeId];
    // Map the running conversation to alternating chat turns. The streamer
    // ("me") is the user; the character ("them") is the assistant.
    const messages = history.map((l) => ({
      role: (l.role === "me" ? "user" : "assistant") as "user" | "assistant",
      content: l.text,
    }));
    return {
      system: [
        `You are ${c.handle}, a viewer privately DMing the streamer ${this.s.settings.streamerName}. You are NOT the streamer — you are the fan.`,
        `You are a ${arch?.label}: ${arch?.blurb}`,
        `You want: ${c.wants}. Your relationship with her: ${relationshipLevel(c.affinity)}.`,
        c.memory ? `What you remember about your past chats with her: ${c.memory}` : "",
        steeringForTier(this.s.settings),
        `Reply to her LAST message directly and relevantly, staying in character.`,
        `If she asks you a question, actually answer it. ONE short message, lowercase, casual, like a real DM. No quotes, no stage directions.`,
      ].filter(Boolean).join("\n"),
      messages: messages.length ? messages : [{ role: "user" as const, content: "hey" }],
    };
  }

  /**
   * Get the character's DM reply and push it into the thread. When streaming is
   * enabled and supported, a placeholder line is appended and filled token-by-
   * token; otherwise the full reply is pushed at once. Returns the final text.
   */
  private async dmReply(c: CharacterSheet, history: DmLine[], threadId: string): Promise<string> {
    const arch = ARCHETYPE_BY_ID[c.archetypeId];
    if (this.llm.isMock) {
      const reply = arch ? `${pick(arch.lines)}` : "haha yeah";
      this.s.pushDm(threadId, { role: "them", text: reply });
      return reply;
    }

    const req = this.dmRequest(c, history);
    if (this.s.settings.streamReplies && this.llm.canStream) {
      this.s.pushDm(threadId, { role: "them", text: "" });
      let acc = "";
      try {
        const res = await this.llm.stream(
          req,
          (delta) => {
            acc += delta;
            this.s.updateLastDm(threadId, acc);
          },
          { kind: "chat" },
        );
        const final = (res.text.trim() || acc.trim()) || "…";
        this.s.updateLastDm(threadId, final);
        return final;
      } catch (err) {
        diag.warn("chat", "dm stream failed", { error: err instanceof Error ? err.message : String(err) });
        const final = acc.trim() || (arch ? pick(arch.lines) : "…");
        this.s.updateLastDm(threadId, final);
        return final;
      }
    }

    try {
      const res = await this.llm.complete(req, { kind: "chat" });
      const reply = res.text.trim() || "…";
      this.s.pushDm(threadId, { role: "them", text: reply });
      return reply;
    } catch {
      const reply = arch ? pick(arch.lines) : "…";
      this.s.pushDm(threadId, { role: "them", text: reply });
      return reply;
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

  private async applyDmEffects(charId: string, effects: DmEffect[]): Promise<void> {
    const s = this.s;
    const c = s.roster[charId];
    if (!c) return;
    diag.info("world", "dm effects", { handle: c.handle, effects: effects.map((e) => e.type) });
    let relationshipScore = 0;
    let relationship: CharacterSheet["relationship"] = c.relationship;
    for (const e of effects) {
      switch (e.type) {
        case "tip":
          this.recordTip(charId, e.amount, { affinityDelta: 0.9 });
          s.pushDm(charId, { role: "them", kind: "gift", amount: e.amount, text: `sent $${e.amount}${e.note ? ` — ${e.note}` : ""}` });
          s.logEvent(`DM: ${c.displayName || c.handle} tipped $${e.amount}.`);
          break;
        case "gift":
          s.patchMetrics({ mood: s.metrics.mood + 2, comfort: s.metrics.comfort + 1 });
          s.pushDm(charId, { role: "them", kind: "gift", text: `sent a gift: ${e.item}` });
          s.logEvent(`DM: ${c.displayName || c.handle} sent a gift (${e.item}).`);
          break;
        case "image":
          if (!this.imageBackend) break;
          try {
            const prompt = [
              `Natural phone snapshot from ${c.handle}.`,
              `Subject: ${e.subject}.`,
              `Style: candid DM photo, no text overlay.`,
              this.imageStyle(),
            ].join(" ");
            const url = await this.runImage("preview", prompt, []);
            const rec = await putImage({
              id: uid("img"),
              cacheKey: imageCacheKey(["dm", c.id, e.subject, prompt]),
              kind: "scene",
              label: `${c.handle} DM image`,
              prompt,
              dataUrl: url,
              characterName: s.settings.streamerName,
              meta: { source: "dm", charId: c.id },
              createdAt: Date.now(),
            });
            s.cacheImage(rec.id, rec.dataUrl);
            s.pushDm(charId, { role: "them", kind: "image", imageId: rec.id, text: e.note || e.subject });
            s.logEvent(`DM: ${c.displayName || c.handle} sent a photo (${e.subject}).`);
          } catch {
            // Non-fatal: DM still progresses if image generation fails.
          }
          break;
        case "reveal":
          if (!c.displayName) {
            s.patchCharacter(charId, { displayName: e.name, known: true });
            s.logEvent(`DM: ${c.handle} revealed their name — ${e.name}.`);
          }
          break;
        case "request": {
          s.pushDm(charId, { role: "them", kind: "system", text: `request: ${e.ask}` });
          const cur = this.s.roster[charId];
          if (cur) {
            const note = `asked you to ${e.ask}`.slice(0, 90);
            s.patchCharacter(charId, { memory: cur.memory ? `${cur.memory}; ${note}`.slice(-180) : note });
          }
          s.logEvent(`DM: ${c.displayName || c.handle} asked you to ${e.ask}.`);
          break;
        }
        case "affinity": {
          const cur = this.s.roster[charId];
          if (!cur) break;
          const prev = cur.affinity;
          s.patchCharacter(charId, { affinity: clamp(cur.affinity + e.delta, 0, 100) });
          const upd = this.s.roster[charId];
          if (!upd) break;
          const outcomes = checkMilestones(upd, prev, s.metrics.day);
          if (outcomes.length) this.applyMilestones(charId, outcomes);
          break;
        }
        case "threat": {
          const cur = this.s.roster[charId];
          if (!cur) break;
          const nextThreat = clamp(cur.threat + e.delta, 0, 3);
          s.patchCharacter(charId, { threat: nextThreat });
          if (nextThreat !== cur.threat) s.logEvent(`DM: ${c.displayName || c.handle} threat → ${nextThreat}.`);
          break;
        }
        case "relationship":
          relationship = this.allowRelationship(e.relationship, c.affinity, s.settings.contentTier) ? e.relationship : relationship;
          break;
        case "meetup": {
          // Guard against double-booking: one already queued, one already
          // playing out, or a recent visit the director is re-detecting from the
          // older DM history. Without this, every subsequent DM could re-arrange
          // (and re-fire) a visit from the same person.
          const cur = this.s.roster[charId];
          const alreadyPending = s.pendingVisits.some((v) => v.charId === charId);
          const sceneActive = s.visitor?.charId === charId;
          const recentlyVisited = cur != null && cur.lastVisitDay >= 0 && s.metrics.day - cur.lastVisitDay < VISIT_COOLDOWN_DAYS;
          if (alreadyPending || sceneActive || recentlyVisited) {
            diag.info("world", "visit meetup skipped", { handle: c.handle, alreadyPending, sceneActive, recentlyVisited });
            break;
          }
          s.addPendingVisit({ charId, hint: e.hint, day: s.metrics.day });
          s.logEvent(`DM: ${c.displayName || c.handle} is coming over (day ${s.metrics.day}).`);
          s.setToast(`${c.displayName || c.handle} said they're coming over.`);
          diag.info("world", "visit scheduled", { handle: c.handle, day: s.metrics.day, hint: e.hint });
          break;
        }
        case "none":
          break;
      }
      relationshipScore += relationshipSignalScore(e);
    }
    if (relationship !== c.relationship) {
      s.patchCharacter(charId, { relationship });
      s.logEvent(`${c.displayName || c.handle} is now ${relationship} with you.`);
    }
    if (relationshipScore) {
      const cur = this.s.roster[charId];
      if (cur) s.patchCharacter(charId, { affinity: clamp(cur.affinity + relationshipScore, 0, 100) });
    }
  }

  private allowRelationship(
    rel: CharacterSheet["relationship"],
    affinity: number,
    tier: ContentTier,
  ): boolean {
    if (rel === "none") return true;
    if (affinity < 45) return false;
    if (rel === "romantic" || rel === "married") return true;
    return tier === "risque" || tier === "unhinged" || tier === "custom";
  }

  // ----------------------------------------------------------- shop

  buyUpgrade(id: string): void {
    const s = this.s;
    const up = UPGRADES.find((u) => u.id === id);
    if (!up || s.ownedUpgrades.includes(id)) return;
    if (s.metrics.cash < up.cost) return s.setToast("Not enough cash for that yet.");
    s.patchMetrics({ cash: s.metrics.cash - up.cost });
    s.addUpgrade(id);
    s.logEvent(`Bought ${up.name} (−$${up.cost}).`);
    diag.info("economy", "bought upgrade", { id, cost: up.cost });
    s.setToast(`Bought ${up.name}!`);
  }
}

function actionEcho(a: PlayerAction): string {
  return a.source === "freeform" ? `You: "${a.text}"` : `▸ ${a.text}`;
}

/**
 * Distill narration into a short visual description for an image prompt: drop
 * spoken dialogue (quoted) and parenthetical meta-notes, tidy punctuation, and
 * keep the most recent sentences (an image only needs what's physically there).
 */
function visualizeNarrative(raw: string): string {
  let t = raw
    .replace(/\([^)]*\)/g, " ")              // meta notes: "(you hang back…)"
    .replace(/[“"][^”"]*[”"]/g, " ")         // spoken dialogue in quotes
    .replace(/\s+([,.;:!?])/g, "$1")          // no space before punctuation
    .replace(/([,.;:!?])\1+/g, "$1")          // collapse "!!" / ".." runs
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;:!?–—-]+/, "")
    .trim();
  // Keep the tail (most recent beat), starting at a sentence boundary.
  if (t.length > 360) {
    const tail = t.slice(t.length - 360);
    const dot = tail.indexOf(". ");
    t = (dot >= 0 ? tail.slice(dot + 2) : tail).trim();
  }
  return t;
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

/** In-world sponsor names, picked when a brand-deal arc starts. */
const BRANDS = ["VoltFizz Energy", "PixelPaw Pet Co.", "NoctaBrew Coffee", "AuraGlow Skincare", "ByteSnacks", "Hyperion GG"];

const STAT_KEYS = ["hype", "energy", "mood", "comfort"] as const;
const EVENT_OUTCOME_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    resolution: { type: "string" },
    effects: {
      type: "object",
      properties: {
        hype: { type: "number" },
        energy: { type: "number" },
        mood: { type: "number" },
        comfort: { type: "number" },
        followers: { type: "number" },
        cash: { type: "number" },
        subscribers: { type: "number" },
      },
    },
  },
  required: ["resolution"],
};

const VISIT_OUTCOME_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    narration: { type: "string", description: "3-5 immersive sentences for this beat, INCLUDING the visitor's spoken dialogue in quotes." },
    effects: {
      type: "object",
      properties: {
        hype: { type: "number" },
        energy: { type: "number" },
        mood: { type: "number" },
        comfort: { type: "number" },
        followers: { type: "number" },
        cash: { type: "number" },
        subscribers: { type: "number" },
      },
    },
    relationshipSignal: { type: "string", enum: ["none", "romantic", "sexual", "dominant", "submissive", "married"] },
    threatDelta: { type: "number" },
  },
  required: ["narration", "relationshipSignal"],
};

/** Parse + sanitise the LLM's freeform-event verdict into safe metric deltas. */
function parseEventOutcome(text: string): { resolution: string; effects: Partial<Metrics> } | null {
  const json = extractJson<Record<string, unknown>>(text);
  if (!json || typeof json !== "object") return null;
  const resolution = typeof json.resolution === "string" ? json.resolution.trim() : "";
  if (!resolution) return null;
  const effects: Partial<Metrics> = {};
  const raw = (json.effects && typeof json.effects === "object" ? json.effects : {}) as Record<string, unknown>;
  for (const k of STAT_KEYS) {
    if (typeof raw[k] === "number") effects[k] = clamp(raw[k] as number, -20, 20);
  }
  if (typeof raw.followers === "number") effects.followers = clamp(raw.followers, -30, 60);
  if (typeof raw.cash === "number") effects.cash = clamp(raw.cash, -300, 300);
  if (typeof raw.subscribers === "number") effects.subscribers = clamp(raw.subscribers, -10, 20);
  return { resolution: resolution.slice(0, 400), effects };
}

function parseVisitOutcome(text: string): {
  narration: string;
  effects: Partial<Metrics>;
  relationshipSignal: CharacterSheet["relationship"];
  threatDelta: number;
} | null {
  const json = extractJson<Record<string, unknown>>(text);
  if (!json || typeof json !== "object") return null;
  const narration = typeof json.narration === "string" ? json.narration.trim().slice(0, 800) : "";
  if (!narration) return null;
  const effects: Partial<Metrics> = {};
  const raw = (json.effects && typeof json.effects === "object" ? json.effects : {}) as Record<string, unknown>;
  for (const k of STAT_KEYS) {
    if (typeof raw[k] === "number") effects[k] = clamp(raw[k] as number, -12, 12);
  }
  if (typeof raw.followers === "number") effects.followers = clamp(raw.followers, -20, 40);
  if (typeof raw.cash === "number") effects.cash = clamp(raw.cash, -200, 200);
  if (typeof raw.subscribers === "number") effects.subscribers = clamp(raw.subscribers, -8, 12);
  const relationshipSignalRaw = typeof json.relationshipSignal === "string" ? json.relationshipSignal : "none";
  const relationshipSignal: CharacterSheet["relationship"] =
    ["none", "romantic", "sexual", "dominant", "submissive", "married"].includes(relationshipSignalRaw)
      ? (relationshipSignalRaw as CharacterSheet["relationship"])
      : "none";
  const threatDelta = typeof json.threatDelta === "number" ? clamp(Math.round(json.threatDelta), -2, 2) : 0;
  return { narration, effects, relationshipSignal, threatDelta };
}

function relationshipSignalScore(effect: Pick<DmEffect, "type"> & Partial<{ relationship: CharacterSheet["relationship"] }>): number {
  if (effect.type !== "relationship") return 0;
  switch (effect.relationship) {
    case "romantic": return 4;
    case "sexual": return 5;
    case "dominant":
    case "submissive": return 3;
    case "married": return 6;
    default: return 0;
  }
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
