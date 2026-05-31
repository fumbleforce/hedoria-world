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
import { useStore, type ActionMenu, setFeedbackContext, clearFeedbackContext } from "../state/store";
import type { ChatMessage, ContentTier, DmLine, EventChoice, GameEvent, Metrics, PendingEventSeed } from "./types";
import type { PlayerAction, ActionOption, ActionVerdict } from "./actions";
import { generateChatBurst, audienceSummary, chatBurstCount, chatAmbientPlan } from "./chatEngine";
import { evaluateAction } from "./evaluator";
import { resolveAction, totalViewers } from "./resolver";
import { occasionForDay } from "./calendar";
import { newlyCompletedGoals } from "./goals";
import { directDm, type DmEffect } from "./dmDirector";
import {
  authorEvent,
  resolveEvent as resolveDirectorEvent,
  parseEventEffects,
  type EventDirectorContext,
  type EventEffect,
  type EventSpec,
} from "./eventDirector";
import { multipliersFor, UPGRADES } from "./shop";
import { fillPrompt, PROMPTS, type PromptId } from "./prompts";
import { steeringForTier } from "./content";
import { initialAudience, SEGMENT_IDS } from "./segments";
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
  rollArchetypeForTime,
  rosterHandles,
  appendInteraction,
  hasBackstoryLayer,
  syncBackstoryString,
  characterVoiceBlock,
  pronouns,
  type CharacterSheet,
  type BackstoryLayer,
} from "./characters";
import {
  advanceStalkerArc,
  checkMilestones,
  sourReview,
  applyAffinity,
  decayAffinities,
  type MilestoneOutcome,
} from "./relationships";
import { extractMentions } from "./mentions";
import { BALANCE, type AffinitySource } from "./balance";
import { masteryXpForAction, masteryLevel } from "./mastery";
import { NICHES, nicheBaselineAppeal, nicheSpawnBias, type NicheId } from "./niches";
import { outfitAppeal } from "./outfits";
import type { SegmentId } from "./segments";
import {
  WAKE_TIME,
  TIME_COST,
  weightForIntensity,
  formatClock,
  clockAfterSleep,
  streamTooLate,
  streamElapsed,
  type TimeWeight,
} from "./time";
import { clamp, pick, uid } from "../rng/rng";

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
  /** Live beats since the last director-authored event scene. */
  private beatsSinceLastEvent = 999;
  /** In-world day when the last director event fired (offline throttle). */
  private lastEventDay = 0;

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
        gender: c.gender,
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
          gender: c.gender,
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

  // ----------------------------------------------------------- niche / novelty

  /** The current content key novelty is tracked against (the active niche). */
  private contentKey(): string {
    return this.s.settings.niche;
  }

  /** Current content freshness (1 = fresh, floored by BALANCE.novelty.floor). */
  private currentNovelty(): number {
    return this.s.contentNovelty[this.contentKey()] ?? 1;
  }

  /**
   * Combined passive baseline appeal per segment: targeted décor (gear
   * segmentAppeal) + the active niche's baseline + a global lift from production
   * quality (camera/mic/lighting appeal to everyone).
   */
  private baselineAppeal(): Partial<Record<SegmentId, number>> {
    const mult = this.mults();
    const out: Partial<Record<SegmentId, number>> = {};
    const add = (seg: SegmentId, v: number) => { out[seg] = (out[seg] ?? 0) + v; };
    for (const [seg, v] of Object.entries(mult.segmentAppeal) as [SegmentId, number][]) add(seg, v);
    for (const [seg, v] of Object.entries(nicheBaselineAppeal(this.s.settings.niche)) as [SegmentId, number][]) add(seg, v);
    for (const [seg, v] of Object.entries(outfitAppeal(this.s.settings.outfit)) as [SegmentId, number][]) add(seg, v);
    const global = mult.productionQuality * BALANCE.gear.productionQualityToAppeal;
    if (global) for (const seg of SEGMENT_IDS) add(seg, global);
    return out;
  }

  /** Combined spawn-weight bias: niche pull + targeted gear décor. */
  private spawnBias(): Partial<Record<SegmentId, number>> {
    const out: Partial<Record<SegmentId, number>> = { ...nicheSpawnBias(this.s.settings.niche) };
    const gear = this.mults().segmentAppeal;
    for (const [seg, v] of Object.entries(gear) as [SegmentId, number][]) {
      // Décor appeal also nudges who shows up, at a gentler rate than the niche.
      out[seg] = (out[seg] ?? 0) + v * 0.15;
    }
    return out;
  }

  /** A repeated format gets staler; freshness drains toward the floor. */
  private drainNovelty(): void {
    const key = this.contentKey();
    const cur = this.s.contentNovelty[key] ?? 1;
    const next = Math.max(BALANCE.novelty.floor, cur - BALANCE.novelty.drainPerRepeat);
    if (next !== cur) this.s.setNovelty(key, next);
  }

  /** Rest + variety restore freshness across all content (called on sleep). */
  private recoverNovelty(): void {
    for (const key of Object.keys(this.s.contentNovelty)) {
      const cur = this.s.contentNovelty[key];
      if (cur < 1) this.s.setNovelty(key, Math.min(1, cur + BALANCE.novelty.recoverPerRest));
    }
  }

  /**
   * Switch content niche. Shifts who shows up + baseline appeal going forward;
   * costs a small follower + freshness hit (you reset audience expectations).
   */
  setNiche(niche: NicheId): void {
    const s = this.s;
    if (s.settings.niche === niche) return;
    const prev = NICHES[s.settings.niche]?.label ?? s.settings.niche;
    s.setSettings({ niche });
    const followerCost = Math.round(s.metrics.followers * BALANCE.niche.switchFollowerCost);
    if (followerCost > 0) {
      setFeedbackContext(`switched from ${prev}`, "warn");
      s.patchMetrics({ followers: s.metrics.followers - followerCost });
      clearFeedbackContext();
    }
    // The new niche starts a little stale (you're rebuilding the format).
    s.setNovelty(niche, Math.max(BALANCE.novelty.floor, 1 - BALANCE.niche.switchNoveltyHit));
    s.logEvent(`Switched niche to ${NICHES[niche]?.label ?? niche}${followerCost > 0 ? ` (−${followerCost} followers)` : ""}.`);
    s.setToast(`Now streaming: ${NICHES[niche]?.label ?? niche}.`);
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

  /**
   * Drift the named cast + refresh segment populations from presence. Pass
   * `announce: false` when rebuilding transient presence (e.g. resuming a live
   * session after a reload) so the restored roster doesn't spam "joined" lines
   * for people who were already in the room.
   */
  private presenceTick(announce = true): void {
    const s = this.s;
    const intensity = this.intensity();
    // Gear/production quality grows the audience: scale the named-cast target and
    // the anonymous floor by the (previously dead) viewer multiplier.
    const viewerMult = this.mults().viewer;
    const target = Math.round(this.targetNamed() * viewerMult);
    const anon = Math.round(this.anonFloor() * viewerMult);
    const res = advancePresence(s.roster, s.clock, intensity, this.reputation(), target, s.audience);
    const audience = audienceFromPresence(res.roster, res.online, s.audience, anon, this.spawnBias());
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
        if (announce && streak >= 3) {
          this.s.pushChat([this.sysChat(`${c.displayName || c.handle} — ${streak} streams running 🔥`)]);
        }
      }
      if (announce && c.affinity >= 35) {
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
    this.recordInteraction(target.id, "threat", `Escalated to threat ${outcome.patch.threat}`);
    void this.enrichBackstory(target.id, `threat-${outcome.patch.threat}`);
    this.sysStory(outcome.story);
    if (outcome.chat) {
      s.pushChat([{ id: uid("msg"), user: target.handle, text: outcome.chat, kind: "creepy", characterId: target.id, ts: Date.now() }]);
    }
    s.setToast(`⚠ ${target.displayName || target.handle} is escalating.`);
    s.logEvent(`⚠ ${target.displayName || target.handle} escalated to threat ${outcome.patch.threat}.`);
    diag.info("event", "stalker escalated", { handle: target.handle, threat: outcome.patch.threat });
    // At max threat, the director must address it — no hardcoded confrontation modal.
    if (outcome.patch.threat === 3) {
      void this.maybeTryDirectorEvent(true);
      return true;
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
    if (s.eventScene) return s.setToast("You're in the middle of something — see it through first.");
    if (s.metrics.energy < 10) {
      s.setToast("Too exhausted to stream — sleep or eat first.");
      return;
    }
    diag.group("round", "GO LIVE", () => {
      s.clearChat();
      s.resetSession();
      s.setRoster(clearPresence(s.roster));
      s.setAudience(initialAudience());
      s.setSession({ isLive: true, round: 1, streamStartClock: s.clock });
      s.setPlaying(null);
    });
    this.lastNotifiedViewers = 0;
    this.streamMemory = "";
    this.beatsSinceSummary = 0;
    this.presenceTick();
    this.sysStory(`Day ${s.metrics.day} — you go live at ${formatClock(s.clock)}.`);
    s.logEvent(`Day ${s.metrics.day}: went live.`);
    this.applySeasonalBeat();
    this.dm("The 'LIVE' dot blinks red. Regulars filter in, saying hi as the numbers tick up.");
    // A due arc beat (sponsor deliverable, viral wave, …) opens the night.
    if (this.maybeArcEvent()) return;
    this.startAmbient("the stream just went live");
  }

  /**
   * Re-establish a live session that survived a reload. `session` is persisted,
   * but the transient presence flags / audience snapshot / viewer count are not,
   * so after boot we silently rebuild them around the restored session instead
   * of dropping the player offline. Loading is a no-op in-fiction: no chat lines
   * are fabricated and the ambient loop is NOT kicked here — it resumes on the
   * player's next action. No-op when the saved session was already offline.
   */
  resumeLive(): void {
    const s = this.s;
    if (!s.session.isLive) return;
    if (!s.session.streamStartClock) {
      s.setSession({ streamStartClock: Math.max(WAKE_TIME, s.clock - (s.session.seconds || 0)) });
    }
    this.lastNotifiedViewers = Math.round(s.metrics.currentViewers);
    this.streamMemory = "";
    this.beatsSinceSummary = 0;
    // Rebuild who's "in the room" (online flags + per-segment audience) from the
    // persisted roster — silently. Loading an existing state must not fabricate
    // anything: no "joined" lines, no fresh ambient chat. The persisted chat
    // history is restored as-is, and the ambient loop resumes on the player's
    // next action (resolve/event), so the stream picks up where it left off.
    this.presenceTick(false);
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
    const plan = chatAmbientPlan(this.s.metrics.hype, totalViewers(this.s.audience));
    if (plan.ticks <= 0) return;
    let pushed = 0;
    const step = async () => {
      if (!this.s.session.isLive || this.s.resolving || this.s.pendingEvent) return;
      const msgs = await generateChatBurst(this.llm, this.chatCtx(context, plan.perTick));
      if (!this.s.session.isLive || this.s.resolving) return;
      if (msgs.length) {
        this.s.pushChat(msgs.slice(0, plan.perTick));
        this.applyChatEffects(msgs.slice(0, plan.perTick));
        this.syncViewers();
      }
      pushed += 1;
      if (pushed < plan.ticks) this.ambientTimer = setTimeout(() => void step(), plan.gapMs);
    };
    this.ambientTimer = setTimeout(() => void step(), plan.gapMs);
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
      case "__door__": void this.answerDoor(); return;
      case "__open_shop__": this.s.setShopOpen(true); return;
      case "__outfit_cozy__": this.s.setSettings({ outfit: "cozy" }); return this.coded("You change into something soft and comfy. The cozy crowd melts.", { mood: 3, comfort: 4 }, "🧶 Cozy fit (cozy crowd ♥)", 10);
      case "__outfit_cute__": this.s.setSettings({ outfit: "cute" }); return this.coded("You pick a cute, photogenic fit. Hype picks up.", { mood: 3, hype: 4 }, "✨ Cute fit (hype ♥)", 10);
      case "__outfit_bold__": this.s.setSettings({ outfit: "bold" }); return this.coded("You go for something bold and eye-catching. Simps take notice.", { hype: 6, comfort: -3 }, "🔥 Bold fit (simps/whales ♥)", 10);
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
    if (s.eventScene) return this.eventContinue();
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
        const continueCount = chatBurstCount(
          s.metrics.hype,
          totalViewers(s.audience),
          "continue",
        );
        const msgs = await generateChatBurst(
          this.llm,
          this.chatCtx(`the scene continues — ${continuation}`, continueCount),
        );
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
    if (s.eventScene) return this.eventBeat(action.text);
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
          mastery: s.mastery,
          baselineAppeal: this.baselineAppeal(),
          novelty: this.currentNovelty(),
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

          const count = chatBurstCount(s.metrics.hype, totalViewers(result.audience), "action");
          // React to her ACTUAL words when we have them, else fall back to prose.
          const reactTo = say
            ? `${s.settings.streamerName} just said on stream: "${say}"`
            : action.source === "freeform"
              ? `${s.settings.streamerName} did/said: "${action.text}". (In the moment: ${verdict.narration})`
              : verdict.narration;
          const msgs = await generateChatBurst(this.llm, this.chatCtx(reactTo, count));
          this.s.pushChat(msgs);
          this.applyChatEffects(msgs);
          this.distributeActionAffinity(action, verdict);
          this.earnMasteryXp(verdict);
          this.drainNovelty();

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
      s.setSession({
        round: s.session.round + 1,
        seconds: streamElapsed(s.clock, s.session.streamStartClock ?? s.clock),
      });
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
    this.beatsSinceLastEvent += 1;
    if (s.metrics.energy <= 0) return this.endStream("ran out of energy");
    if (streamTooLate(s.clock)) return this.endStream("it got late");

    this.presenceTick();
    void this.refreshStreamMemory();
    this.checkGoals();

    // Stalker arc: advance the most-threatening online stalker, at most once a
    // day, when the room is "feeding" them (low comfort = oversharing). Its own
    // events (too-specific DM, door knock, confrontation) ride the normal roll.
    if (this.advanceStalkerArcs()) return;

    void this.maybeTryDirectorEvent(false, context);
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

  /** Raise the first due visit or follow-up seed, if any. Returns true if one fired. */
  private maybeArcEvent(): boolean {
    const s = this.s;
    if (s.pendingEvent || s.eventScene) return false;
    const visit = this.consumeDueVisit();
    if (visit) {
      void this.raiseEvent(visit);
      return true;
    }
    const due = this.consumeDueEventSeed();
    if (due) {
      void this.maybeTryDirectorEvent(true, undefined, due.seed);
      return true;
    }
    return false;
  }

  /** Shared post-resolution bookkeeping: event memory + goal checks. */
  private finishEvent(event: GameEvent, choiceLabel: string, resolution: string): void {
    const s = this.s;
    s.pushEventRecord({
      triggerId: event.triggerId ?? "unknown",
      title: event.title,
      day: s.metrics.day,
      choice: choiceLabel,
      resolution,
    });
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
  private applyMilestones(charId: string, outcomes: MilestoneOutcome[]): void {
    const s = this.s;
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
      this.recordInteraction(charId, "milestone", `Reached ${o.id}`);
      void this.enrichBackstory(charId, o.id);
    }
    if (followerDelta) s.patchMetrics({ followers: s.metrics.followers + followerDelta });
  }

  /** Word-of-mouth: a happy regular brings a compatible new viewer along. */
  private spawnReferredFriend(referrerId: string): void {
    const s = this.s;
    const referrer = s.roster[referrerId];
    if (!referrer) return;
    if (Object.values(s.roster).filter((c) => c.online).length >= 16) return;
    const arch = rollArchetypeForTime(this.intensity(), s.clock);
    const friend = seedCharacter(arch, s.clock, rosterHandles(s.roster));
    friend.referredBy = referrerId;
    // Arrives a touch warmer thanks to the friend who vouched for the channel.
    friend.affinity = clamp(friend.affinity + BALANCE.affinity.sources.referral, 0, 100);
    friend.lastInteractionDay = s.metrics.day;
    s.upsertCharacter(friend);
    const who = referrer.displayName || referrer.handle;
    this.sysStory(`${who} brought a friend — ${friend.handle} just showed up because of them.`);
    s.logEvent(`${who} referred a friend: ${friend.handle}.`);
  }

  /**
   * THE single affinity write path for the controller. Routes every change
   * through the ledger (diminishing returns + per-day soft cap + source
   * weighting), sets the feedback "why" context so the bubble/log explains the
   * cause, applies the patch, and runs milestone checks. Returns the real delta.
   */
  private bumpAffinity(
    charId: string,
    rawDelta: number,
    source: AffinitySource,
    extra?: Partial<CharacterSheet>,
  ): number {
    const s = this.s;
    const c = s.roster[charId];
    if (!c) return 0;
    const prevAffinity = c.affinity;
    const { patch, applied, reason } = applyAffinity(c, rawDelta, source, s.metrics.day);
    setFeedbackContext(applied !== 0 ? reason : undefined, applied >= 0 ? "good" : "warn");
    s.patchCharacter(charId, { ...patch, ...extra });
    clearFeedbackContext();
    const updated = this.s.roster[charId];
    if (updated) {
      const outcomes = checkMilestones(updated, prevAffinity, s.metrics.day, this.rosterTakenNames());
      if (outcomes.length) this.applyMilestones(charId, outcomes);
    }
    return applied;
  }

  /**
   * Recurring subscriber income, paid on a calendar cadence (e.g. every 30
   * in-world days) through the income path. Predictable recurring revenue vs.
   * one-off tips is a real strategic axis and the main early-game escape hatch.
   */
  private payRecurringSubs(day: number): void {
    const s = this.s;
    if (day % BALANCE.subs.cadenceDays !== 0) return;
    const subs = s.metrics.subscribers;
    if (subs <= 0) return;
    const gross = subs * BALANCE.subs.monthlyValue * this.mults().income;
    if (gross <= 0) return;
    setFeedbackContext(`monthly sub payout · ${subs} sub${subs > 1 ? "s" : ""}`, "good");
    s.patchMetrics({ cash: s.metrics.cash + gross });
    clearFeedbackContext();
    if (s.session.isLive) s.setSession({ earnings: s.session.earnings + gross });
    s.logEvent(`💰 Monthly sub payout: +$${gross.toFixed(0)} from ${subs} sub${subs > 1 ? "s" : ""}.`);
    s.setToast(`💰 Sub payout: +$${gross.toFixed(0)} from ${subs} subscriber${subs > 1 ? "s" : ""}!`);
  }

  /** Affinity earned from a tip, scaled by amount (reciprocal: bypasses the cap). */
  private tipAffinity(amount: number): number {
    return Math.min(amount * BALANCE.affinity.sources.tip.perDollar, BALANCE.affinity.sources.tip.max);
  }

  /**
   * Unified tip pipeline shared by live chat donations/subs and DM tips:
   * multipliers, session earnings (only while live), per-character tipped total,
   * affinity growth, and milestone checks all happen in one place.
   */
  private recordTip(charId: string | undefined, amount: number, opts?: { hype?: number }): void {
    if (amount <= 0) return;
    const s = this.s;
    const cashDelta = amount * this.mults().income;
    const metricsPatch: Partial<Metrics> = { cash: s.metrics.cash + cashDelta };
    if (opts?.hype) metricsPatch.hype = s.metrics.hype + opts.hype;
    setFeedbackContext("they tipped you", "good");
    s.patchMetrics(metricsPatch);
    clearFeedbackContext();
    if (s.session.isLive) s.setSession({ earnings: s.session.earnings + cashDelta });
    if (!charId) return;
    const c = s.roster[charId];
    if (!c) return;
    this.bumpAffinity(charId, this.tipAffinity(amount), "tip", {
      tipped: c.tipped + amount,
      lastSeenClock: s.clock,
    });
    this.recordInteraction(charId, "tip", `Tipped $${amount}`);
  }

  /**
   * Affinity that flows from a LIVE action itself (not the chat reacting to it):
   *  - @mentions (public/live only): a strong, targeted bonus to each named,
   *    online viewer — calling someone out by handle is intentional personalization.
   *  - connection-driven bonding: the verdict's `connection` score (how personal
   *    the beat was) distributed to ONLINE viewers whose segment actually liked
   *    the action, with per-stream repeat decay so looping one crowd-pleaser
   *    yields almost nothing after a couple of beats.
   * Keyed entirely off the verdict (connection/tags/appeal) — never off action id
   * or keywords — so a menu shortcut and a custom line are rewarded identically.
   */
  private distributeActionAffinity(action: PlayerAction, verdict: ActionVerdict): void {
    const s = this.s;
    const online = Object.values(s.roster).filter((c) => c.online);
    if (!online.length) return;

    // @mentions: targeted, short-circuits appeal weighting (lands on THEM).
    const mentioned = new Set(extractMentions(action.text, s.roster, true));
    for (const id of mentioned) {
      this.bumpAffinity(id, BALANCE.affinity.sources.mention, "mention", { lastSeenClock: s.clock });
    }

    const connection = verdict.connection ?? 0;
    if (connection > 0) {
      // Per-stream repeat decay keyed by the action's dominant tag.
      const tag = verdict.tags[0] ?? "generic";
      const counts = { ...(s.session.connectionTagCounts ?? {}) };
      const n = counts[tag] ?? 0;
      counts[tag] = n + 1;
      s.setSession({ connectionTagCounts: counts });
      const repeatMult = Math.pow(BALANCE.affinity.repeatTagDecay, n);

      for (const c of online) {
        if (mentioned.has(c.id)) continue; // already got the stronger mention bump
        const seg = ARCHETYPE_BY_ID[c.archetypeId]?.segment ?? "cozy";
        const appeal = verdict.appeal[seg] ?? 0;
        if (appeal <= 0) continue; // only viewers who liked the beat bond from it
        const appealWeight = clamp(appeal / 3, 0, 1);
        const raw = BALANCE.affinity.sources.action * connection * appealWeight * repeatMult;
        if (raw <= 0.001) continue;
        this.bumpAffinity(c.id, raw, "action", { lastSeenClock: s.clock });
      }
    }
  }

  /**
   * Earn mastery XP from a live action, keyed off the verdict's tags (uniform,
   * never per-action-id). Surfaces a level-up as a prominent alert — a veteran
   * spends less energy/comfort on the same act (the cost reduction lives in the
   * resolver via masteryCostMult).
   */
  private earnMasteryXp(verdict: ActionVerdict): void {
    const s = this.s;
    const gained = masteryXpForAction(verdict.tags, verdict.intensity);
    if (!Object.keys(gained).length) return;
    const before = s.mastery;
    s.addMasteryXp(gained);
    const after = this.s.mastery;
    for (const d of BALANCE.mastery.domains) {
      if (masteryLevel(after[d]) <= masteryLevel(before[d])) continue;
      const lvl = masteryLevel(after[d]);
      const label = d === "showmanship" ? "Showmanship" : "Composure";
      const note =
        d === "showmanship"
          ? "high-energy bits cost less energy now"
          : "intense bits cost less comfort now";
      s.pushFeedback([
        {
          id: uid("fb"),
          channel: "alert",
          key: `mastery-${d}`,
          text: `${label} Lv ${lvl}`,
          tone: "good",
          reason: note,
          ts: Date.now(),
        },
      ]);
      s.logEvent(`⭐ ${label} reached level ${lvl} — ${note}.`);
      s.setToast(`⭐ ${label} Lv ${lvl}! ${note}.`);
    }
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
        if (isTip) {
          // recordTip already handled affinity/lastSeen + milestones; only count
          // the message line here.
          s.patchCharacter(msg.characterId, { messageCount: cur.messageCount + 1 });
        } else {
          // Just being in chat barely moves the needle (ledger-weighted +0.05,
          // soft-capped per day) — presence isn't intimacy.
          this.bumpAffinity(msg.characterId, BALANCE.affinity.sources.chat, "chat", {
            messageCount: cur.messageCount + 1,
            lastSeenClock: s.clock,
          });
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
    if (s.eventScene) return s.setToast("You can't sleep — you're in the middle of something.");
    const mult = this.mults();
    const rent = mult.rentPerDay;
    const m = s.metrics;
    const newDay = m.day + 1;
    // Recurring utility bill on a calendar cadence — standing still loses money.
    const utilityDue =
      newDay % BALANCE.economy.utilityEveryDays === 0 ? BALANCE.economy.utilityAmount : 0;

    // Restorative overnight changes (energy/mood/comfort/hype) — surfaced as
    // their own bubbles, no money "why".
    s.patchMetrics({
      day: newDay,
      energy: Math.min(100, m.energy + BALANCE.recovery.sleepEnergy),
      mood: m.mood + BALANCE.recovery.sleepMood + mult.moodPerDay,
      hype: Math.max(15, m.hype * 0.6),
      comfort: m.comfort + BALANCE.recovery.sleepComfort,
    });
    // The money debit, explained.
    setFeedbackContext(utilityDue ? "rent & utilities" : "rent", "bad");
    s.patchMetrics({ cash: s.metrics.cash - rent - utilityDue });
    clearFeedbackContext();
    s.setClock(clockAfterSleep(s.clock));

    // Recurring subscriber income (Phase 4): predictable monthly payout, the
    // main early-game escape hatch, paid through the income path.
    this.payRecurringSubs(newDay);

    // Rest + variety freshen up repeated content.
    this.recoverNovelty();

    // Cool neglected bonds: anyone not interacted with past the grace window
    // loses affinity scaled by how close they were. Surfaced as cooling feedback.
    const decays = decayAffinities(s.roster, newDay);
    for (const d of decays) {
      setFeedbackContext(d.reason, "warn");
      s.patchCharacter(d.id, d.patch);
      clearFeedbackContext();
    }
    if (decays.length) {
      s.logEvent(`${decays.length} bond${decays.length > 1 ? "s" : ""} cooled from neglect.`);
    }

    const billLine = utilityDue ? ` Utilities: -$${utilityDue.toFixed(0)}.` : "";
    this.sysStory(`You sleep. Day ${newDay} begins. Rent: -$${rent.toFixed(0)}.${billLine}`);
    s.logEvent(`Day ${newDay} begins. Rent: -$${rent.toFixed(0)}.${billLine}`);
    diag.info("economy", "sleep / rent", { day: newDay, rent, utilityDue });
    s.setToast(
      s.metrics.cash < 0
        ? `Day ${newDay}. Bills of $${(rent + utilityDue).toFixed(0)} put you in the red!`
        : `Day ${newDay}. Rent: -$${rent.toFixed(0)}.${billLine}`,
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

  private async answerDoor(): Promise<void> {
    const s = this.s;
    if (s.session.isLive) return s.setToast("Not while you're live!");
    const visit = this.consumeDueVisit();
    if (visit) {
      await this.raiseEvent(visit);
      return;
    }
    const fired = await this.maybeTryDirectorEvent(false);
    if (!fired && !s.resolving) {
      this.coded("You open the door. Empty hallway — must've been the wind.", { comfort: -1 }, "🚪 No one there", 5);
    }
  }

  private async maybeOfflineEvent(): Promise<void> {
    const visit = this.consumeDueVisit();
    if (visit) {
      await this.raiseEvent(visit);
      return;
    }
    const due = this.consumeDueEventSeed();
    if (due) {
      await this.maybeTryDirectorEvent(true, undefined, due.seed);
      return;
    }
    const fired = await this.maybeTryDirectorEvent(false);
    if (!fired) {
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
    this.recordTip(charId, amount, { hype: 1 });
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
        characterVoiceBlock(c),
        `Your relationship with her: ${relationshipLevel(c.affinity)}.`,
        c.memory ? `What you remember about your past chats with her: ${c.memory}` : "",
        this.recentInteractionContext(c),
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

  // ----------------------------------------------------------- event director

  private buildEventDirectorContext(seed?: string): EventDirectorContext {
    const s = this.s;
    const mults = this.mults();
    const segParts = Object.entries(mults.segmentAppeal)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}+${v}`);
    const online = Object.values(s.roster)
      .filter((c) => c.online)
      .sort((a, b) => b.threat - a.threat || b.affinity - a.affinity)
      .slice(0, 10);
    const maxThreat = Math.max(0, ...online.map((c) => c.threat));
    const signals: EventDirectorContext["signals"] = [];
    if (maxThreat >= 3) {
      signals.push({ id: "threat-3", label: "A stalker has reached maximum threat", mustAddress: true });
    } else if (maxThreat >= 2) {
      signals.push({ id: "threat-2", label: "A stalker is highly escalated" });
    }
    if (!s.session.isLive && s.metrics.mood < 35 && s.metrics.comfort < 45) {
      signals.push({ id: "burnout", label: "Chronic low mood and comfort — burnout pressure", mustAddress: true });
    }
    if (s.metrics.cash < mults.rentPerDay * 2) {
      signals.push({ id: "rent-crunch", label: "Cash is tight relative to rent" });
    }
    if (s.metrics.hype > 65 && s.session.isLive) {
      signals.push({ id: "viral-potential", label: "High hype — something could snowball" });
    }
    if (s.metrics.energy < 25) signals.push({ id: "low-energy", label: "Running low on energy" });
    for (const c of online) {
      if (c.affinity >= 60 && c.relationship === "none" && c.threat <= 0) {
        signals.push({ id: `confidant-${c.id}`, label: `${c.handle} is very close — relationship milestone` });
      }
    }
    const noveltyKeys = Object.values(s.contentNovelty);
    const avgNovelty =
      noveltyKeys.length ? noveltyKeys.reduce((a, b) => a + b, 0) / noveltyKeys.length : 1;
    if (avgNovelty < 0.5) signals.push({ id: "content-stale", label: "Content feels repetitive" });

    return {
      settings: s.settings,
      metrics: s.metrics,
      isLive: s.session.isLive,
      recentNarrative: this.recentNarrative(),
      viewers: online.map((c) => ({
        id: c.id,
        handle: c.handle,
        displayName: c.displayName,
        archetype: ARCHETYPE_BY_ID[c.archetypeId]?.label ?? c.archetypeId,
        affinity: c.affinity,
        threat: c.threat,
        relationship: c.relationship,
        memory: c.memory,
      })),
      mastery: {
        showmanship: masteryLevel(s.mastery.showmanship),
        composure: masteryLevel(s.mastery.composure),
      },
      niche: s.settings.niche ?? "variety",
      outfit: s.settings.outfit ?? "cozy",
      productionQuality: mults.productionQuality,
      segmentAppealSummary: segParts.join(", "),
      pendingFollowups: s.pendingEventSeeds.map((p) => ({ day: p.day, seed: p.seed, charId: p.charId })),
      recentEventTitles: s.recentEvents.map((r) => r.title).slice(-14),
      signals,
      beatsSinceLastEvent: this.beatsSinceLastEvent,
      daysSinceLastEvent: s.metrics.day - this.lastEventDay,
      rosterIds: Object.keys(s.roster),
      upgradeIds: UPGRADES.map((u) => u.id),
      seed,
    };
  }

  private directorThrottleOk(mustAddress: boolean): boolean {
    const s = this.s;
    if (s.eventScene || s.visitor || s.pendingEvent) return false;
    if (mustAddress) return true;
    const E = BALANCE.events;
    if (s.session.isLive) return this.beatsSinceLastEvent >= E.minBeatsBetweenLive;
    return s.metrics.day - this.lastEventDay >= E.minDaysBetweenOffline;
  }

  private consumeDueEventSeed(): PendingEventSeed | undefined {
    const s = this.s;
    const due = s.pendingEventSeeds.find((p) => p.day <= s.metrics.day);
    if (!due) return undefined;
    s.removePendingEventSeed(due.id);
    return due;
  }

  /** State-driven event gate — replaces ambient rollEvent. Returns true if something started. */
  private async maybeTryDirectorEvent(
    mustAddress = false,
    ambientContext?: string,
    seed?: string,
  ): Promise<boolean> {
    const s = this.s;
    if (!this.directorThrottleOk(mustAddress)) {
      if (ambientContext && s.session.isLive) this.startAmbient(ambientContext);
      return false;
    }
    const ctx = this.buildEventDirectorContext(seed);
    const spec = await authorEvent(this.llm, ctx);
    if (!spec) {
      if (ambientContext && s.session.isLive) this.startAmbient(ambientContext);
      return false;
    }
    this.stopAmbient();
    this.markDirectorEventFired();
    if (spec.mode === "notice") {
      await this.deliverDirectorNotice(spec);
      if (ambientContext && s.session.isLive) this.startAmbient(ambientContext);
      return true;
    }
    await this.startEventScene(spec, seed);
    return true;
  }

  private markDirectorEventFired(): void {
    this.beatsSinceLastEvent = 0;
    this.lastEventDay = this.s.metrics.day;
  }

  private async deliverDirectorNotice(spec: EventSpec): Promise<void> {
    const s = this.s;
    this.dm(spec.opening);
    s.logEvent(`${spec.title}: ${spec.opening.slice(0, 80)}`);
    if (spec.effects?.length) await this.applyEventEffects(spec.effects);
    s.pushEventRecord({
      triggerId: "director-notice",
      title: spec.title,
      day: s.metrics.day,
      resolution: spec.opening.slice(0, 120),
    });
    s.setToast(spec.title);
    this.checkGoals();
  }

  private resolveEventCharId(spec: EventSpec): string | undefined {
    const ref = spec.characterRef;
    if (!ref || ref === "new") return undefined;
    if (ref.startsWith("online:")) return ref.slice("online:".length);
    if (this.s.roster[ref]) return ref;
    return undefined;
  }

  private async startEventScene(spec: EventSpec, seed?: string): Promise<void> {
    const s = this.s;
    const charId = this.resolveEventCharId(spec);
    s.startEventScene({
      title: spec.title,
      tone: spec.tone,
      charId,
      stakes: spec.stakes,
      beats: 0,
      transcript: `Start: ${spec.opening}`,
      netEffects: {},
      lines: [{ role: "system", text: spec.opening }],
      seed,
    });
    this.dm(spec.opening);
    s.logEvent(`Event scene: ${spec.title}`);
    s.setToast(spec.title);
    diag.info("event", "event scene started", { title: spec.title });
    // Apply any opening/setup effects the author attached (e.g. an incomingDm that
    // lands the message the scene is reacting to). End-of-scene consequences come
    // separately from resolveEvent.
    if (spec.effects?.length) await this.applyEventEffects(spec.effects);
    void this.generateEventImage(spec.opening);
  }

  async eventBeat(text: string): Promise<void> {
    const t = text.trim();
    if (!t) return;
    await this.runEventBeat(t);
  }

  async eventContinue(): Promise<void> {
    await this.runEventBeat(null);
  }

  async endEventScene(): Promise<void> {
    const s = this.s;
    if (!s.eventScene || s.resolving) return;
    await this.resolveEventScene("You decide to see this through and bring the moment to a close.");
  }

  private async runEventBeat(playerText: string | null): Promise<void> {
    const s = this.s;
    const scene = s.eventScene;
    if (!scene || s.resolving) return;
    s.setResolving(true);
    try {
      if (playerText) {
        s.pushEventSceneLine({ role: "me", text: playerText });
        s.pushStory({ kind: "action", text: `(You: ${playerText})` });
      } else {
        s.pushStory({ kind: "action", text: `(You hang back and let the moment unfold…)` });
      }
      const cue =
        playerText ?? "(The streamer stays quiet — show what happens next on its own initiative.)";
      const outcome = await this.judgeEventBeat(scene, cue, playerText === null);
      s.pushEventSceneLine({ role: "narrator", text: outcome.narration });
      this.dm(outcome.narration);
      if (outcome.effects.length) await this.applyEventEffects(outcome.effects);
      // Time drifts during a scene, but far slower than a normal turn so the
      // moment can breathe without burning the whole night.
      this.advanceTime(BALANCE.events.beatMinutes);
      const transcriptLine = playerText ? `You: ${playerText}` : "You: (waited and watched)";
      s.patchEventScene({
        beats: scene.beats + 1,
        transcript: `${scene.transcript}\n${transcriptLine}\nOutcome: ${outcome.narration}`,
      });
      if (outcome.sceneEnd) await this.resolveEventScene(outcome.resolution ?? "The moment reaches its natural end.");
    } finally {
      s.setResolving(false);
    }
  }

  private async resolveEventScene(endReason: string): Promise<void> {
    const s = this.s;
    const scene = s.eventScene;
    if (!scene) return;
    const ctx = this.buildEventDirectorContext(scene.seed);
    const effects = await resolveDirectorEvent(this.llm, ctx, scene.transcript);
    if (effects.length) await this.applyEventEffects(effects);
    this.outcome(endReason);
    s.pushEventRecord({
      triggerId: "director-scene",
      title: scene.title,
      day: s.metrics.day,
      resolution: endReason.slice(0, 120),
    });
    s.endEventScene();
    s.setToast("The moment passes.");
    s.logEvent(`Event resolved: ${scene.title}`);
    this.checkGoals();
    if (s.session.isLive) this.startAmbient("after the event");
  }

  private async judgeEventBeat(
    scene: NonNullable<ReturnType<typeof useStore.getState>["eventScene"]>,
    text: string,
    passive: boolean,
  ): Promise<{ narration: string; effects: EventEffect[]; sceneEnd: boolean; resolution?: string }> {
    const fallback = {
      narration: passive
        ? "The tension shifts — something unspoken hangs in the air, and the moment keeps moving whether you're ready or not."
        : "You push through the beat. The room — or the phone — reacts in ways you can't fully control yet.",
      effects: [] as EventEffect[],
      sceneEnd: false,
    };
    if (this.llm.isMock) return fallback;
    const c = scene.charId ? this.s.roster[scene.charId] : undefined;
    const req = {
      system: [
        this.resolvePrompt("narrator"),
        "You are narrating one beat of an interactive event scene in a streamer life-sim.",
        "Write vivid narration (3-5 sentences). Include spoken dialogue in quotes when someone speaks.",
        passive
          ? "The streamer hangs back — DO NOT invent their words. Let the situation evolve."
          : "React to what the streamer just said/did.",
        "Return modest `effects` (capability array) for small nudges; big payoffs come at scene end.",
        "Set sceneEnd true only when the arc naturally concludes THIS beat (rare).",
        scene.stakes ? `Stakes: ${scene.stakes}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      messages: [
        {
          role: "user" as const,
          content: [
            `Event: ${scene.title} (${scene.tone})`,
            c
              ? `Viewer involved: ${c.displayName || c.handle} (threat ${c.threat}, aff ${Math.round(c.affinity)})`
              : "",
            `Transcript:\n${scene.transcript.slice(-1400)}`,
            passive ? "The streamer waits silently." : `The streamer now: "${text}"`,
            `Beat ${scene.beats + 1}.`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      jsonMode: true,
      jsonSchema: EVENT_SCENE_SCHEMA,
    };
    try {
      const parsed = await completeJsonWithRepair(this.llm, req, (t) => this.parseEventSceneOutcome(t), "story");
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  private parseEventSceneOutcome(text: string): {
    narration: string;
    effects: EventEffect[];
    sceneEnd: boolean;
    resolution?: string;
  } | null {
    const json = extractJson<Record<string, unknown>>(text);
    if (!json || typeof json !== "object") return null;
    const narration = typeof json.narration === "string" ? json.narration.trim().slice(0, 800) : "";
    if (!narration) return null;
    const ctx = this.buildEventDirectorContext();
    const effects = Array.isArray(json.effects)
      ? parseEventEffects(JSON.stringify({ effects: json.effects }), ctx) ?? []
      : [];
    const sceneEnd = json.sceneEnd === true;
    const resolution = typeof json.resolution === "string" ? json.resolution.slice(0, 200) : undefined;
    return { narration, effects, sceneEnd, resolution };
  }

  /** Tolerant scene image from an opening beat — async, non-blocking. */
  private async generateEventImage(opening: string): Promise<void> {
    if (!this.canGenerateImages) return;
    const s = this.s;
    const desc = s.character.description.trim();
    if (!desc || !opening.trim()) return;
    try {
      const ref = await this.bodyRef();
      const zone = ZONES[s.zone];
      const positionLabel = zone
        ? `${zone.label} — ${zone.description.replace(/[.\s]+$/, "")}`
        : "her studio";
      const rec = await this.genImage({
        kind: "scene",
        prompt: fillImagePrompt(effectiveImagePrompt(s.settings, "scenePrompt"), {
          name: s.settings.streamerName,
          description: desc,
          position: positionLabel,
          narrative: opening.slice(0, 360),
          style: this.imageStyle(),
        }),
        label: s.eventScene?.title ?? "Event scene",
        refs: ref ? [ref.url] : undefined,
        sourceImageId: ref?.id,
        busyLabel: "Visualizing event",
      });
      if (rec && s.eventScene) s.patchEventScene({ imageId: rec.id });
    } catch {
      // Non-fatal
    }
  }

  async applyEventEffects(effects: EventEffect[]): Promise<void> {
    const s = this.s;
    const E = BALANCE.events;
    const alert = (key: string, reason: string, tone: "good" | "warn" | "neutral" | "bad" = "good", delta?: number) => {
      s.pushFeedback([{ id: uid("fb"), channel: "alert", key, delta, tone, reason, ts: Date.now() }]);
    };
    for (const e of effects) {
      switch (e.type) {
        case "metric": {
          const reason = e.note ?? `${e.key} shift`;
          setFeedbackContext(reason, e.delta >= 0 ? "good" : "warn");
          s.patchMetrics({ [e.key]: (s.metrics[e.key] as number) + e.delta });
          if (s.eventScene) {
            const prev = s.eventScene.netEffects[e.key] ?? 0;
            s.patchEventScene({ netEffects: { ...s.eventScene.netEffects, [e.key]: prev + e.delta } });
          }
          clearFeedbackContext();
          break;
        }
        case "money": {
          const reason = e.note ?? "event payout";
          setFeedbackContext(reason, e.amount >= 0 ? "good" : "warn");
          if (e.charRef) this.recordTip(e.charRef, e.amount, {});
          else {
            const cashDelta = e.amount * this.mults().income;
            s.patchMetrics({ cash: s.metrics.cash + cashDelta });
            if (s.session.isLive) s.setSession({ earnings: s.session.earnings + cashDelta });
          }
          clearFeedbackContext();
          break;
        }
        case "followers": {
          setFeedbackContext(e.note ?? "new followers", e.delta >= 0 ? "good" : "warn");
          s.patchMetrics({ followers: Math.max(0, s.metrics.followers + e.delta) });
          clearFeedbackContext();
          break;
        }
        case "subscribers": {
          setFeedbackContext(e.note ?? "subs", e.delta >= 0 ? "good" : "warn");
          s.patchMetrics({ subscribers: Math.max(0, s.metrics.subscribers + e.delta) });
          clearFeedbackContext();
          break;
        }
        case "affinity":
          if (s.roster[e.charRef]) {
            this.bumpAffinity(e.charRef, e.delta, "event");
          }
          break;
        case "threat": {
          const c = s.roster[e.charRef];
          if (!c) break;
          const next = clamp(c.threat + e.delta, E.threatMin, E.threatMax);
          setFeedbackContext(e.note ?? "threat shift", next > c.threat ? "bad" : "good");
          s.patchCharacter(e.charRef, { threat: next });
          clearFeedbackContext();
          break;
        }
        case "relationship": {
          const c = s.roster[e.charRef];
          if (!c) break;
          if (this.allowRelationship(e.relationship, c.affinity, s.settings.contentTier)) {
            s.patchCharacter(e.charRef, { relationship: e.relationship });
            alert("relationship", e.note ?? `now ${e.relationship}`);
            s.logEvent(`${c.displayName || c.handle} is now ${e.relationship} with you.`);
          }
          break;
        }
        case "revealName": {
          const c = s.roster[e.charRef];
          if (c && !c.displayName) {
            s.patchCharacter(e.charRef, { displayName: e.name, known: true });
            alert("reveal", `${c.handle} is ${e.name}`);
            s.logEvent(`${c.handle} revealed their name — ${e.name}.`);
          }
          break;
        }
        case "blockViewer": {
          const c = s.roster[e.charRef];
          if (!c) break;
          this.bumpAffinity(e.charRef, -20, "event", { online: false, threat: 0 });
          const sour = sourReview(c);
          setFeedbackContext(sour.log, "warn");
          s.patchMetrics({ followers: s.metrics.followers + sour.followerDelta });
          clearFeedbackContext();
          alert("block", e.note ?? `blocked ${c.handle}`, "warn");
          s.logEvent(`Blocked ${c.displayName || c.handle}.`);
          break;
        }
        case "spawnViewer":
          this.spawnEventViewer(e.archetypeHint);
          alert("spawn", e.note ?? "someone new showed up");
          break;
        case "grantUpgrade": {
          if (!s.ownedUpgrades.includes(e.upgradeId)) {
            s.addUpgrade(e.upgradeId);
            const up = UPGRADES.find((u) => u.id === e.upgradeId);
            alert("upgrade", e.note ?? `Unlocked: ${up?.name ?? e.upgradeId}`);
            s.logEvent(`Unlocked upgrade: ${up?.name ?? e.upgradeId}.`);
          }
          break;
        }
        case "grantItem": {
          setFeedbackContext(e.note ?? e.name, "good");
          s.patchMetrics({ mood: s.metrics.mood + 2, comfort: s.metrics.comfort + 1 });
          clearFeedbackContext();
          s.logEvent(`Received: ${e.name}.`);
          break;
        }
        case "masteryXp":
          s.addMasteryXp({ [e.domain]: e.amount });
          alert(`mastery-${e.domain}`, e.note ?? `${e.domain} practice`, "good", e.amount);
          break;
        case "raid": {
          const mult = clamp(e.size ?? 1, 1, E.raidSizeMax);
          const followers = 5 * mult;
          const hype = 4 * mult;
          setFeedbackContext(e.note ?? "incoming raid", "good");
          s.patchMetrics({ followers: s.metrics.followers + followers, hype: s.metrics.hype + hype });
          clearFeedbackContext();
          s.pushChat([this.sysChat(`🎉 Raid! ~${followers * 3} viewers pour in!`)]);
          break;
        }
        case "meetup": {
          const c = s.roster[e.charRef];
          if (!c) break;
          const alreadyPending = s.pendingVisits.some((v) => v.charId === e.charRef);
          const sceneActive = s.visitor?.charId === e.charRef;
          if (alreadyPending || sceneActive) break;
          s.addPendingVisit({ charId: e.charRef, hint: e.hint, day: s.metrics.day + (e.days ?? 0) });
          alert("meetup", e.note ?? `${c.displayName || c.handle} is coming over`);
          s.logEvent(`${c.displayName || c.handle} is coming over.`);
          s.setToast(`${c.displayName || c.handle} said they're coming over.`);
          break;
        }
        case "incomingDm": {
          const charId = e.charRef && s.roster[e.charRef] ? e.charRef : this.pickDmSender();
          if (!charId) break;
          const c = s.roster[charId];
          if (!c) break;
          const opener = e.message?.trim() || (await this.composeIncomingDm(c, e.note ?? ""));
          s.pushDm(charId, { role: "them", text: opener });
          if (s.openCharId !== charId) s.markDmUnread(charId);
          const label = c.displayName || c.handle;
          if (s.session.isLive) this.notify(`📨 New DM from ${label}`);
          s.setToast(`📨 New DM from ${label}`);
          s.logEvent(`📨 DM from ${label}: "${opener.slice(0, 60)}"`);
          alert("dm", e.note ?? `${label} messaged you`, "neutral");
          break;
        }
        case "scheduleFollowup": {
          if (s.pendingEventSeeds.length >= E.maxPendingFollowups) break;
          const id = uid("seed");
          s.addPendingEventSeed({
            id,
            day: s.metrics.day + e.days,
            seed: e.seed,
            charId: e.charRef,
          });
          alert("followup", e.note ?? `Follow-up in ${e.days} day(s)`, "neutral");
          s.logEvent(`Follow-up scheduled in ${e.days} day(s): ${e.seed.slice(0, 60)}`);
          break;
        }
        case "none":
          break;
      }
    }
  }

  private spawnEventViewer(archetypeHint?: string): void {
    const s = this.s;
    if (Object.values(s.roster).filter((c) => c.online).length >= BALANCE.events.onlineCap) return;
    const arch = rollArchetypeForTime(this.intensity(), s.clock);
    const c = seedCharacter(arch, s.clock, rosterHandles(s.roster));
    if (archetypeHint) {
      const note = archetypeHint.slice(0, 60);
      c.memory = note;
    }
    c.lastInteractionDay = s.metrics.day;
    s.upsertCharacter(c);
    this.sysStory(`${c.handle} just showed up — ${archetypeHint ?? "a new face in the crowd"}.`);
    s.logEvent(`New viewer: ${c.handle}.`);
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
    // Meeting in person is the strongest reciprocal signal — route it through
    // the ledger (cap-exempt visit source), then apply the non-affinity patch.
    s.patchCharacter(charId, {
      relationship: nextRel,
      threat: clamp(c.threat + scene.threatDelta, 0, 3),
      lastSeenClock: s.clock,
      lastVisitDay: s.metrics.day,
    });
    this.bumpAffinity(charId, scene.relationshipScore, "visit");
    const updated = this.s.roster[charId];
    if (updated) {
      // Milestones were already checked inside bumpAffinity above.
      const memory = await this.condenseMemory(updated, "you met in person at your apartment", endReason);
      s.patchCharacter(charId, { memory });
      this.recordInteraction(charId, "visit", `Met in person — ${endReason.slice(0, 80)}`);
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

  /** Seed a follow-up when an in-person visit ended warm (replaces hardcoded relationship arc). */
  private maybeStartVisitArc(charId: string): void {
    const s = this.s;
    const c = s.roster[charId];
    if (!c) return;
    if (c.threat >= 2) return;
    if (c.relationship !== "none" || c.affinity >= 60) {
      if (s.pendingEventSeeds.length >= BALANCE.events.maxPendingFollowups) return;
      s.addPendingEventSeed({
        id: uid("seed"),
        day: s.metrics.day + 2,
        seed: `something shifted with ${c.displayName || c.handle} after the visit — a follow-up beat`,
        charId,
      });
      this.sysStory(`Something shifted with ${c.displayName || c.handle} tonight — this might be going somewhere.`);
      s.logEvent(`Follow-up seeded: something real with ${c.displayName || c.handle}.`);
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
            characterVoiceBlock(c),
            `Relationship: ${c.relationship}, affinity ${Math.round(c.affinity)}, threat ${c.threat}.`,
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
    // Seed layer on first open — deeper layers unlock via milestones/threat.
    if (!c.backstoryLayers.length) void this.enrichBackstory(id, "seed");
  }

  /** Display names already taken in the roster (for unique reveals). */
  private rosterTakenNames(): Set<string> {
    return new Set(
      Object.values(this.s.roster)
        .map((c) => c.displayName.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  /** Append a capped per-character interaction log entry. */
  private recordInteraction(charId: string, kind: string, text: string): void {
    const s = this.s;
    const c = s.roster[charId];
    if (!c) return;
    s.patchCharacter(charId, {
      interactionLog: appendInteraction(c.interactionLog, {
        day: s.metrics.day,
        kind,
        text: text.slice(0, 200),
      }),
    });
  }

  /** Recent log lines for LLM continuity. */
  private recentInteractionContext(c: CharacterSheet): string {
    const recent = c.interactionLog.slice(-6);
    if (!recent.length) return "";
    return `Recent history with the streamer:\n${recent.map((e) => `- [${e.kind}] ${e.text}`).join("\n")}`;
  }

  /**
   * Append a backstory layer for a trigger (affinity milestone, threat step, or
   * first open). Idempotent per trigger id.
   */
  private async enrichBackstory(id: string, trigger: string): Promise<void> {
    const c = this.s.roster[id];
    if (!c || hasBackstoryLayer(c, trigger)) return;
    const arch = ARCHETYPE_BY_ID[c.archetypeId];
    const p = pronouns(c.gender);
    const prior = c.backstoryLayers.map((l) => l.text).join(" ");

    const mockText = trigger.startsWith("threat-")
      ? `${c.handle} is becoming fixated on ${c.traits.fixation ?? "getting closer"}. The obsession is no longer subtle.`
      : trigger === "seed"
        ? `${arch?.blurb ?? "A viewer."} ${p.subj} wants ${c.motive.surface}.`
        : `${p.subj.charAt(0).toUpperCase()}${p.subj.slice(1)} has opened up more — ${c.motive.need}.`;

    if (this.llm.isMock) {
      const layer: BackstoryLayer = { id: uid("layer"), trigger, text: mockText.slice(0, 400) };
      const layers = [...c.backstoryLayers, layer];
      this.s.patchCharacter(id, {
        backstoryLayers: layers,
        backstory: syncBackstoryString(layers),
        quirks: c.quirks || (arch ? pick(arch.lines) : ""),
      });
      return;
    }

    try {
      const taken = [...this.rosterTakenNames()].join(", ") || "none";
      const res = await this.llm.complete(
        {
          system: this.resolvePrompt("narrator"),
          messages: [
            {
              role: "user",
              content: [
                `Write ONE new backstory fragment for viewer ${c.handle} (${arch?.label}, ${c.gender}).`,
                `Trigger: ${trigger}. Prior layers: ${prior || "(none)"}.`,
                `Personality: ${characterVoiceBlock(c)}`,
                c.memory ? `Memory: ${c.memory}` : "",
                trigger.startsWith("threat-")
                  ? "Reveal something darker or more specific about their fixation. Escalate, don't contradict prior layers."
                  : "Add a human, specific detail that deepens who they are. Stay consistent with prior layers.",
                `Return JSON: {"text": "2-3 sentences third person"}. Do NOT invent a display name.`,
                `Names already used in roster (avoid): ${taken}.`,
              ].filter(Boolean).join("\n"),
            },
          ],
          jsonMode: true,
        },
        { kind: "story" },
      );
      const json = extractJson<{ text?: string }>(res.text);
      const text = (json?.text ?? mockText).slice(0, 400);
      const layer: BackstoryLayer = { id: uid("layer"), trigger, text };
      const layers = [...c.backstoryLayers, layer];
      this.s.patchCharacter(id, {
        backstoryLayers: layers,
        backstory: syncBackstoryString(layers),
      });
    } catch {
      const layer: BackstoryLayer = { id: uid("layer"), trigger, text: mockText.slice(0, 400) };
      const layers = [...c.backstoryLayers, layer];
      this.s.patchCharacter(id, {
        backstoryLayers: layers,
        backstory: syncBackstoryString(layers),
      });
    }
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
    this.recordTip(charId, amount, { hype: 1 });
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
    const arch = rollArchetypeForTime(this.intensity(), s.clock);
    const v = seedCharacter(arch, s.clock, rosterHandles(s.roster));
    v.known = true;
    v.online = s.session.isLive;
    s.upsertCharacter(v);
    s.logEvent(`[dev] Spawned ${v.handle} (${arch.label}).`);
    s.setToast(`Spawned ${v.handle}.`);
  }

  /** Generate a richer bio + quirks (and a name, if still unknown) on demand. */
  private async generateBackstory(id: string): Promise<void> {
    await this.enrichBackstory(id, "seed");
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
      // Talking 1:1 builds the relationship and a condensed memory. The first DM
      // exchange of the in-world day is the real bump; same-day follow-ups are
      // tokens, so sending five messages in one sitting ≈ one meaningful beat.
      const memory = await this.condenseMemory(c, t, reply);
      this.recordInteraction(id, "dm", `You: "${t.slice(0, 60)}" → ${c.handle}: "${reply.slice(0, 60)}"`);
      const day = s.metrics.day;
      const firstToday = c.lastDmAffinityDay !== day;
      this.bumpAffinity(
        id,
        firstToday ? BALANCE.affinity.sources.dmDaily : BALANCE.affinity.sources.dmRepeat,
        firstToday ? "dm" : "dmRepeat",
        { memory, known: true, lastSeenClock: s.clock, lastDmAffinityDay: day },
      );
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
      diag.info("world", "dm exchange", { handle: c.handle, affinity: Math.round(this.s.roster[id]?.affinity ?? c.affinity) });
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
        characterVoiceBlock(c),
        `Your relationship with her: ${relationshipLevel(c.affinity)}.`,
        c.memory ? `What you remember about your past chats with her: ${c.memory}` : "",
        this.recentInteractionContext(c),
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
    const logSnippet = c.interactionLog.slice(-8).map((e) => e.text).join("; ");
    if (this.llm.isMock) {
      const note = `chatted about "${mine.slice(0, 40)}"`;
      const base = logSnippet ? `${logSnippet}; ${note}` : note;
      return base.slice(-180);
    }
    try {
      const res = await this.llm.complete(
        {
          system: "Condense this relationship into ONE short memory line (<=160 chars) the viewer would remember. Merge with prior memory and recent history; keep the most important bits.",
          messages: [
            {
              role: "user",
              content: [
                `Prior memory: ${c.memory || "(none)"}`,
                logSnippet ? `Recent history: ${logSnippet}` : "",
                `Streamer said: ${mine}`,
                `${c.handle} replied: ${theirs}`,
                `New condensed memory:`,
              ].filter(Boolean).join("\n"),
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
          this.recordTip(charId, e.amount, {});
          s.pushDm(charId, { role: "them", kind: "gift", amount: e.amount, text: `sent $${e.amount}${e.note ? ` — ${e.note}` : ""}` });
          s.logEvent(`DM: ${c.displayName || c.handle} tipped $${e.amount}.`);
          break;
        case "gift":
          s.patchMetrics({ mood: s.metrics.mood + 2, comfort: s.metrics.comfort + 1 });
          s.pushDm(charId, { role: "them", kind: "gift", text: `sent a gift: ${e.item}` });
          s.logEvent(`DM: ${c.displayName || c.handle} sent a gift (${e.item}).`);
          // A gift is genuine reciprocal investment — strong, cap-exempt.
          this.bumpAffinity(charId, BALANCE.affinity.sources.gift, "gift");
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
          // Director-judged relationship move from the conversation. Signed
          // semantics preserved (losses bite in full); gains still diminish.
          this.bumpAffinity(charId, e.delta, "dm");
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
      this.bumpAffinity(charId, relationshipScore, "dm");
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

const EVENT_SCENE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    narration: { type: "string" },
    effects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          key: { type: "string" },
          delta: { type: "number" },
          amount: { type: "number" },
          charRef: { type: "string" },
          note: { type: "string" },
        },
        required: ["type"],
      },
    },
    sceneEnd: { type: "boolean" },
    resolution: { type: "string" },
  },
  required: ["narration"],
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
