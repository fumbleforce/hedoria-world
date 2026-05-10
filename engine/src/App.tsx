import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { CombatHud } from "./ui/CombatHud";
import { DbInspector } from "./ui/DbInspector";
import { DialoguePanel } from "./ui/DialoguePanel";
import { WorldMap } from "./render/worldmap/WorldMap";
import { SceneRenderer } from "./scene/SceneRenderer";
import { Overworld } from "./scene/Overworld";
import { NpcBillboards } from "./scene/NpcBillboards";
import { loadScenesBundleFromUrl } from "./scene/sceneLoader";
import { SceneCache } from "./scene/sceneCache";
import { validatePack } from "./world/loader";
import { buildWorldIndex, type ExpansionEntityRow } from "./world/indexer";
import {
  clearAiCache,
  ensureStoragePersistence,
  exportSaveJson,
  getOrCreateSave,
  listExpansionEntities,
  putExpansionEntity,
} from "./persist/saveLoad";
import { useGameStore } from "./state/store";
import { DeterministicRng } from "./rng/rng";
import { turnBasedModel } from "./rules/combat/turnBasedModel";
import { TIER_FALLBACKS } from "./rules/combat/tierFallbacks";
import { LlmAdapter } from "./llm/adapter";
import { MockProvider } from "./llm/mockProvider";
import { createGeminiProvider } from "./llm/providers";
import { buildNpcChatRequest } from "./llm/npcChat";
import type { LlmProvider } from "./llm/types";
import { resolveSkillCheck } from "./rules/skillResolution";
import { runExpansion } from "./expansion/engine";
import type { PackNpc } from "./schema/packSchema";
import { computeWorldLayout } from "./scene/sceneTransition";

const DEFAULT_SAVE_ID = "default-save";

function resolveLlmProvider(): LlmProvider {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY?.trim();
  if (apiKey) {
    const modelOverride = import.meta.env.VITE_GEMINI_TEXT_MODEL?.trim() || undefined;
    const provider = createGeminiProvider(apiKey, modelOverride);
    console.info(
      `[engine] Using Gemini provider: ${provider.id}. ` +
        `Override via VITE_GEMINI_TEXT_MODEL in engine/.env, or unset VITE_GEMINI_API_KEY to fall back to the mock.`,
    );
    return provider;
  }
  console.info(
    "[engine] VITE_GEMINI_API_KEY not set — using MockProvider. Copy engine/.env.example to engine/.env (or .env.local) and add a Gemini key to enable AI generation.",
  );
  return new MockProvider();
}

function App() {
  const [error, setError] = useState<string | null>(null);
  const [isBooted, setBooted] = useState(false);
  const [saveExport, setSaveExport] = useState("");
  const [llmAdapter, setLlmAdapter] = useState<LlmAdapter | null>(null);
  const [sceneCache, setSceneCache] = useState<SceneCache | null>(null);
  const [packId, setPackId] = useState<string>("");
  const [specVersion, setSpecVersion] = useState(0);
  const [npcReplying, setNpcReplying] = useState(false);
  const [dbInspectorOpen, setDbInspectorOpen] = useState(false);

  const setWorld = useGameStore((s) => s.setWorld);
  const world = useGameStore((s) => s.world);
  // We deliberately do NOT subscribe to `playerPos`. The Overworld
  // manages live position internally via a ref; subscribing here would
  // re-render App (and propagate to all 114 LocationProxy children
  // because nothing on this tree is React.memo'd) every time a movement
  // tick rolls in via the throttled persistence callback. We read
  // `playerPos` non-reactively below (`useGameStore.getState()`) only
  // when we need the snapshot for an Overworld remount.
  const setPlayerPos = useGameStore((s) => s.setPlayerPos);
  const nearestLocationId = useGameStore((s) => s.nearestLocationId);
  const setNearestLocation = useGameStore((s) => s.setNearestLocation);
  const currentRegionId = useGameStore((s) => s.currentRegionId);
  const setCurrentRegion = useGameStore((s) => s.setCurrentRegion);
  const sceneMode = useGameStore((s) => s.sceneMode);
  const interiorLocationId = useGameStore((s) => s.interiorLocationId);
  const enterInterior = useGameStore((s) => s.enterInterior);
  const exitInterior = useGameStore((s) => s.exitInterior);
  const selectedLocationId = useGameStore((s) => s.selectedLocationId);
  const setSelectedLocation = useGameStore((s) => s.setSelectedLocation);
  const currentAreaId = useGameStore((s) => s.currentAreaId);
  const combat = useGameStore((s) => s.combat);
  const setCombat = useGameStore((s) => s.setCombat);
  const dialogue = useGameStore((s) => s.dialogue);
  const addDialogue = useGameStore((s) => s.addDialogue);
  const clearDialogue = useGameStore((s) => s.clearDialogue);
  const worldMapOpen = useGameStore((s) => s.worldMapOpen);
  const toggleWorldMap = useGameStore((s) => s.toggleWorldMap);
  const exportOpen = useGameStore((s) => s.exportOpen);
  const toggleExport = useGameStore((s) => s.toggleExport);
  const activeNpcId = useGameStore((s) => s.activeNpcId);
  const setActiveNpcId = useGameStore((s) => s.setActiveNpcId);
  const cameraAzimuth = useGameStore((s) => s.cameraAzimuth);

  useEffect(() => {
    async function boot() {
      try {
        await ensureStoragePersistence();
        const worldResp = await fetch("/bundles/world.bundle.json");
        if (!worldResp.ok) throw new Error(`world bundle: ${worldResp.status}`);
        const worldBundle = (await worldResp.json()) as { packId?: string; data?: unknown };
        const loaded = validatePack(worldBundle.data ?? {});
        const detectedPack = worldBundle.packId ?? "default";
        setPackId(detectedPack);

        const scenes = await loadScenesBundleFromUrl("/bundles/scenes.bundle.json").catch(
          () => ({ regions: {}, locations: {}, areas: {} }),
        );

        const save = await getOrCreateSave(detectedPack, "world.bundle.json", "default-seed");
        const adapter = new LlmAdapter(resolveLlmProvider(), save.saveId);
        setLlmAdapter(adapter);

        const cache = new SceneCache({
          bundle: scenes,
          saveId: save.saveId,
          seed: save.seed,
          adapter,
          onSpecResolved: () => setSpecVersion((v) => v + 1),
        });
        await cache.hydrateFromSave();
        setSceneCache(cache);

        const rows = await listExpansionEntities(save.saveId);
        const indexed = buildWorldIndex(loaded.data, rows);
        setWorld(indexed);

        const layout = computeWorldLayout(indexed.pack);
        const startLoc = layout.locations[0];
        if (startLoc) {
          setPlayerPos(startLoc.position[0], startLoc.position[1]);
          setNearestLocation(startLoc.id);
          setCurrentRegion(startLoc.regionId);
          setSelectedLocation(startLoc.id);
        }
        setBooted(true);
      } catch (bootError) {
        setError(bootError instanceof Error ? bootError.message : String(bootError));
      }
    }
    boot().catch((bootError) => {
      setError(bootError instanceof Error ? bootError.message : String(bootError));
    });
  }, [setSelectedLocation, setNearestLocation, setCurrentRegion, setPlayerPos, setWorld]);

  const focusLocationId = sceneMode === "interior" ? interiorLocationId : nearestLocationId;
  const focusLocation = world && focusLocationId ? world.locations[focusLocationId] : undefined;
  const focusRegionId =
    sceneMode === "interior" && focusLocation ? focusLocation.region : currentRegionId;
  const focusRegion =
    world && focusRegionId ? world.pack.regions[focusRegionId] : undefined;
  const inWilderness = sceneMode === "overworld" && !nearestLocationId;

  const interiorComposed = useMemo(() => {
    if (!sceneCache || !world || sceneMode !== "interior") return undefined;
    if (!interiorLocationId || !currentAreaId) return undefined;
    const interiorLocation = world.locations[interiorLocationId];
    if (!interiorLocation) return undefined;
    const area = interiorLocation.areas?.[currentAreaId];
    void specVersion;
    return sceneCache.compose({
      regionId: interiorLocation.region,
      locationId: interiorLocationId,
      areaId: currentAreaId,
      prose: {
        region: world.pack.regions[interiorLocation.region]?.basicInfo ?? interiorLocation.region,
        location: interiorLocation.basicInfo ?? interiorLocation.name,
        area: area?.description ?? "",
      },
    });
  }, [sceneCache, world, sceneMode, interiorLocationId, currentAreaId, specVersion]);

  const visibleNpcsByLocation = useMemo<Record<string, PackNpc[]>>(() => {
    const out: Record<string, PackNpc[]> = {};
    if (!world) return out;
    for (const [locationId] of Object.entries(world.locations)) {
      const npcs = world.npcsByLocation.get(locationId) ?? [];
      out[locationId] = npcs.filter((n) => !n.currentArea); // outdoor NPCs only
    }
    return out;
  }, [world]);

  const interiorNpcs = useMemo<PackNpc[]>(() => {
    if (!world || sceneMode !== "interior" || !interiorLocationId || !currentAreaId) return [];
    const all = world.npcsByLocation.get(interiorLocationId) ?? [];
    return all.filter((n) => n.currentArea === currentAreaId);
  }, [world, sceneMode, interiorLocationId, currentAreaId]);

  const activeNpc: PackNpc | undefined = useMemo(() => {
    if (!world || !activeNpcId) return undefined;
    return world.pack.npcs[activeNpcId] ?? Object.values(world.pack.npcs).find((n) => n.name === activeNpcId);
  }, [world, activeNpcId]);

  function handleEnterLocation(locationId: string) {
    if (!world) return;
    const layout = computeWorldLayout(world.pack);
    const target = layout.locations.find((l) => l.id === locationId);
    if (!target) return;
    setPlayerPos(target.position[0], target.position[1]);
    setNearestLocation(target.id);
    setSelectedLocation(target.id);
    setActiveNpcId(null);
    toggleWorldMap(false);
  }

  function handleTalkToNpc(npc: PackNpc) {
    setActiveNpcId(npc.name);
    clearDialogue();
  }

  function startCombat() {
    if (!world || !activeNpc) return;
    const tierDefaults =
      world.pack.combatSettings.tierDefaults?.[activeNpc.tier] ??
      TIER_FALLBACKS[activeNpc.tier] ??
      TIER_FALLBACKS.trivial;
    setCombat({
      turn: 1,
      actors: [
        { id: "player", name: "You", hp: 120, hpMax: 120, ac: 12, tier: "strong" },
        {
          id: activeNpc.name,
          name: activeNpc.name,
          hp: activeNpc.hpMax,
          hpMax: activeNpc.hpMax,
          ac: tierDefaults.ac,
          tier: activeNpc.tier,
          npcType: activeNpc.type,
        },
      ],
      log: [`Combat started with ${activeNpc.name}.`],
    });
    setActiveNpcId(null);
  }

  function applyCombat(action: "attack" | "wait") {
    if (!combat) return;
    const rng = new DeterministicRng(`turn-${combat.turn}`);
    const next =
      action === "attack"
        ? turnBasedModel.step(
            combat,
            {
              kind: "attack",
              sourceId: "player",
              targetId: combat.actors[1]?.id ?? "",
              bonus: 4,
              damage: rng.int(4, 11),
            },
            rng,
          )
        : turnBasedModel.step(combat, { kind: "wait", sourceId: "player" }, rng);
    setCombat(next);
  }

  async function handleExport() {
    const json = await exportSaveJson(DEFAULT_SAVE_ID);
    setSaveExport(json);
    toggleExport(true);
  }

  async function handleClearAiCache() {
    const ok = window.confirm(
      "Clear LLM transcripts, classified scene specs, and generated textures for this save? Player state is preserved. Reload the page after to re-classify scenes from scratch.",
    );
    if (!ok) return;
    const removed = await clearAiCache(DEFAULT_SAVE_ID);
    console.info(
      `[engine] Cleared AI cache: ${removed.transcripts} transcripts, ${removed.sceneSpecs} scene specs, ${removed.textures} textures.`,
    );
    addDialogue({
      role: "npc",
      text: `[Cleared AI cache: ${removed.transcripts} transcripts, ${removed.sceneSpecs} scene specs, ${removed.textures} textures. Reload to re-classify.]`,
    });
  }

  async function handleNpcChat(text: string) {
    if (!llmAdapter || !activeNpc || npcReplying) return;
    addDialogue({ role: "player", text });
    console.log(`[chat] you: ${text}`);
    setNpcReplying(true);
    try {
      const request = buildNpcChatRequest({
        npc: activeNpc,
        world,
        history: dialogue,
        playerInput: text,
      });
      const reply = await llmAdapter.complete(request, { kind: "chat" });
      const trimmed = reply.text.trim();
      const replyText = trimmed.length > 0 ? trimmed : "…";
      console.log(`[chat] ${activeNpc.name}: ${replyText}`);
      addDialogue({ role: "npc", text: replyText });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[chat] error: ${message}`);
      addDialogue({ role: "npc", text: `[chat error: ${message}]` });
    } finally {
      setNpcReplying(false);
    }
  }

  async function handleSkillCheck() {
    if (!llmAdapter) return;
    const result = await resolveSkillCheck(
      llmAdapter,
      "athletics",
      12,
      "Leap over a collapsed bridge segment",
      "The party is under pressure and needs to cross quickly.",
    );
    addDialogue({ role: "npc", text: `[Skill ${result.outcome}] ${result.narration}` });
  }

  async function handleExpansion() {
    if (!llmAdapter || !world || !nearestLocationId) return;
    const row = await runExpansion(
      llmAdapter,
      { kind: "frontier", source: nearestLocationId },
      DEFAULT_SAVE_ID,
      world.pack,
    );
    if (!row) return;
    await putExpansionEntity(row);
    const rows = await listExpansionEntities(DEFAULT_SAVE_ID);
    const indexed = buildWorldIndex(world.pack, rows as ExpansionEntityRow[]);
    setWorld(indexed);
    addDialogue({
      role: "npc",
      text: `Expansion generated entity: ${row.entityType}/${row.entityId}`,
    });
  }

  if (error) {
    return <div className="bootScreen">Error: {error}</div>;
  }
  if (!isBooted || !world || !sceneCache) {
    return <div className="bootScreen">Booting engine...</div>;
  }

  return (
    <div className="gameRoot">
      {sceneMode === "overworld" ? (
        <Overworld
          pack={world.pack}
          cache={sceneCache}
          initialPlayerPos={useGameStore.getState().playerPos}
          playerLabel="You"
          // No-op: pushing every (throttled) movement tick into Zustand
          // would re-render App + Overworld + all 114 LocationProxy
          // children at ~4Hz for nothing — `playerPos` in the store is
          // only ever read for `initialPlayerPos` at boot.
          onNearestLocationChange={(id) => setNearestLocation(id)}
          onCurrentRegionChange={(id) => setCurrentRegion(id)}
          onExitInterior={({ locationId, areaId }) => {
            setSelectedLocation(locationId);
            enterInterior(locationId, areaId);
            setActiveNpcId(null);
          }}
          renderNpcsForLocation={(locationId) => {
            if (!sceneCache || !world) return null;
            const npcs = visibleNpcsByLocation[locationId] ?? [];
            if (npcs.length === 0) return null;
            const loc = world.locations[locationId];
            if (!loc) return null;
            // Passive: this is called for every visible location with NPCs.
            // The procedural placeholder is sufficient for billboard
            // anchoring; the focus location is classified eagerly via
            // prefetchNearby as the player approaches.
            const composed = sceneCache.compose({
              regionId: loc.region,
              locationId,
              prose: {
                region: world.pack.regions[loc.region]?.basicInfo ?? loc.region,
                location: loc.basicInfo ?? loc.name,
              },
              passive: true,
            });
            if (!composed) return null;
            return (
              <NpcBillboards
                spec={composed}
                npcs={npcs}
                onTalkToNpc={handleTalkToNpc}
                radius={Math.max(4, (loc.radius || 1) * 4)}
              />
            );
          }}
        />
      ) : interiorComposed ? (
        <SceneRenderer
          key={`interior::${interiorLocationId}::${currentAreaId}`}
          spec={interiorComposed}
          initialPlayerPosition={[0, 0, -interiorComposed.scale * 0.5]}
          playerLabel="You"
          onExitClick={(exit) => {
            // Any exit in an interior subscene returns to overworld.
            void exit;
            exitInterior();
            setActiveNpcId(null);
          }}
        >
          <NpcBillboards
            spec={interiorComposed}
            npcs={interiorNpcs}
            onTalkToNpc={handleTalkToNpc}
            preferAreaAnchors
          />
        </SceneRenderer>
      ) : (
        <div className="bootScreen">Entering interior…</div>
      )}

      <div className="hud hud-top-left">
        <div className="locationCard">
          <div className="locationCard__region">
            {focusRegion?.name ?? focusRegionId ?? "Unknown Region"}
          </div>
          <div className="locationCard__name">
            {inWilderness ? "Wilderness" : (focusLocation?.name ?? focusLocationId ?? "Open World")}
          </div>
          {sceneMode === "interior" && currentAreaId ? (
            <div className="locationCard__area">{currentAreaId}</div>
          ) : null}
          {sceneMode === "interior" && currentAreaId && focusLocation?.areas?.[currentAreaId]?.description ? (
            <div className="locationCard__desc">{focusLocation.areas[currentAreaId].description}</div>
          ) : inWilderness ? (
            <div className="locationCard__desc">
              Open ground between settlements. Walk toward a circle to enter a location.
            </div>
          ) : focusLocation?.basicInfo ? (
            <div className="locationCard__desc">{focusLocation.basicInfo}</div>
          ) : null}
        </div>
      </div>

      <div className="hud hud-top-right">
        <button type="button" onClick={() => toggleWorldMap(true)}>World Map</button>
        {sceneMode === "interior" ? (
          <button type="button" onClick={() => exitInterior()}>Leave Interior</button>
        ) : null}
        <button type="button" onClick={handleSkillCheck}>Skill Check</button>
        <button type="button" onClick={handleExpansion}>Expand</button>
        <button type="button" onClick={handleExport}>Save</button>
        <button
          type="button"
          onClick={() => setDbInspectorOpen(true)}
          title="View IndexedDB contents (transcripts, scene specs, textures, …)"
        >
          DB
        </button>
        <button type="button" onClick={handleClearAiCache} title="Clear LLM transcripts, scene specs, and textures">
          Reset AI cache
        </button>
      </div>

      {!combat && !activeNpc ? (
        <div className="hud hud-bottom-center">
          <div className="hint">
            Click the ground to walk. Click a door ring to enter / leave. Click an NPC to talk.
          </div>
        </div>
      ) : null}

      <Compass azimuth={cameraAzimuth} />


      {activeNpc ? (
        <div className="overlay overlay-bottom">
          <DialoguePanel
            npc={activeNpc}
            messages={
              npcReplying ? [...dialogue, { role: "npc", text: "…" }] : dialogue
            }
            onSend={(text) => {
              void handleNpcChat(text);
            }}
            disabled={npcReplying}
          />
          <div className="dialogueActions">
            <button type="button" onClick={startCombat}>Attack</button>
            <button type="button" onClick={() => setActiveNpcId(null)}>Leave</button>
          </div>
        </div>
      ) : null}

      {combat ? (
        <div className="overlay overlay-bottom">
          <CombatHud
            combat={combat}
            onAttack={() => applyCombat("attack")}
            onWait={() => applyCombat("wait")}
          />
          <div className="dialogueActions">
            <button type="button" onClick={() => setCombat(null)}>End Encounter</button>
          </div>
        </div>
      ) : null}

      {worldMapOpen ? (
        <div className="modal" onClick={() => toggleWorldMap(false)}>
          <div className="modal__inner" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h2>World Map</h2>
              <button type="button" onClick={() => toggleWorldMap(false)}>Close</button>
            </div>
            <WorldMap
              world={world}
              selectedLocationId={selectedLocationId}
              onSelectLocation={handleEnterLocation}
            />
          </div>
        </div>
      ) : null}

      {exportOpen ? (
        <div className="modal" onClick={() => toggleExport(false)}>
          <div className="modal__inner" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h2>Save Export</h2>
              <button type="button" onClick={() => toggleExport(false)}>Close</button>
            </div>
            <pre className="exportPreview">{saveExport}</pre>
          </div>
        </div>
      ) : null}

      {dbInspectorOpen ? (
        <DbInspector onClose={() => setDbInspectorOpen(false)} />
      ) : null}

      {packId ? null : null}
    </div>
  );
}

/**
 * Bottom-left compass. The overworld camera orbits the player at a yaw
 * angle (azimuth, in radians) controlled by the user's middle-mouse drag.
 * World-north (-z) projects onto the screen at exactly that same angle, so
 * we rotate the compass face by `azimuth` in degrees: at the default π/4
 * (= 45°) the painted N points to the upper-right of the screen, matching
 * the classic isometric view; turning the camera turns the compass with
 * it. Internal calc: 1 radian = 180/π degrees.
 */
function Compass({ azimuth }: { azimuth: number }) {
  const deg = (azimuth * 180) / Math.PI;
  return (
    <div className="compass" aria-hidden="true">
      <div className="compass__face" style={{ transform: `rotate(${deg}deg)` }}>
        <div className="compass__needle" />
        <div className="compass__hub" />
        <div className="compass__cardinal compass__cardinal--n">N</div>
        <div className="compass__cardinal compass__cardinal--e">E</div>
        <div className="compass__cardinal compass__cardinal--s">S</div>
        <div className="compass__cardinal compass__cardinal--w">W</div>
      </div>
    </div>
  );
}

export default App;
