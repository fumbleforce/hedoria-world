import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { CombatHud } from "./ui/CombatHud";
import { DialoguePanel } from "./ui/DialoguePanel";
import { WorldMap } from "./render/worldmap/WorldMap";
import { LocationScene } from "./render/scene/LocationScene";
import { validatePack } from "./world/loader";
import { buildWorldIndex, type ExpansionEntityRow } from "./world/indexer";
import {
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
import { resolveSkillCheck } from "./rules/skillResolution";
import { runExpansion } from "./expansion/engine";
import type { PackNpc } from "./schema/packSchema";

const DEFAULT_SAVE_ID = "default-save";

function App() {
  const [error, setError] = useState<string | null>(null);
  const [isBooted, setBooted] = useState(false);
  const [saveExport, setSaveExport] = useState("");
  const [llmAdapter, setLlmAdapter] = useState<LlmAdapter | null>(null);

  const setWorld = useGameStore((s) => s.setWorld);
  const world = useGameStore((s) => s.world);
  const selectedLocationId = useGameStore((s) => s.selectedLocationId);
  const setSelectedLocation = useGameStore((s) => s.setSelectedLocation);
  const currentAreaId = useGameStore((s) => s.currentAreaId);
  const setCurrentArea = useGameStore((s) => s.setCurrentArea);
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

  useEffect(() => {
    async function boot() {
      try {
        await ensureStoragePersistence();
        const response = await fetch("/bundles/world.bundle.json");
        const bundle = (await response.json()) as { data?: unknown };
        const loaded = validatePack(bundle.data ?? {});
        const save = await getOrCreateSave("hedoria", "world.bundle.json", "default-seed");
        setLlmAdapter(new LlmAdapter(new MockProvider(), save.saveId));
        const rows = await listExpansionEntities(save.saveId);
        const indexed = buildWorldIndex(loaded.data, rows);
        setWorld(indexed);
        const firstLocation = Object.keys(indexed.locations)[0] ?? null;
        setSelectedLocation(firstLocation);
        if (firstLocation) {
          const firstArea =
            Object.keys(indexed.locations[firstLocation]?.areas ?? {})[0] ?? null;
          setCurrentArea(firstArea);
        }
        setBooted(true);
      } catch (bootError) {
        setError(bootError instanceof Error ? bootError.message : String(bootError));
      }
    }
    boot().catch((bootError) => {
      setError(bootError instanceof Error ? bootError.message : String(bootError));
    });
  }, [setSelectedLocation, setCurrentArea, setWorld]);

  const location = world && selectedLocationId ? world.locations[selectedLocationId] : undefined;
  const region = location && world ? world.pack.regions[location.region] : undefined;
  const areaIds = location ? Object.keys(location.areas ?? {}) : [];
  const effectiveAreaId = currentAreaId && areaIds.includes(currentAreaId)
    ? currentAreaId
    : areaIds[0] ?? null;
  const currentArea = location && effectiveAreaId ? location.areas?.[effectiveAreaId] : undefined;

  const activeNpc: PackNpc | undefined = useMemo(() => {
    if (!world || !activeNpcId) return undefined;
    return world.pack.npcs[activeNpcId] ?? Object.values(world.pack.npcs).find((n) => n.name === activeNpcId);
  }, [world, activeNpcId]);

  function handleEnterLocation(locationId: string) {
    if (!world) return;
    setSelectedLocation(locationId);
    const firstArea = Object.keys(world.locations[locationId]?.areas ?? {})[0] ?? null;
    setCurrentArea(firstArea);
    setActiveNpcId(null);
    toggleWorldMap(false);
  }

  function handleTalkToNpc(npc: PackNpc) {
    setActiveNpcId(npc.name);
    clearDialogue();
    addDialogue({
      role: "npc",
      text: `${npc.name} regards you carefully. (Tier: ${npc.tier}${npc.faction ? `, ${npc.faction}` : ""})`,
    });
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
    if (!llmAdapter || !world || !selectedLocationId) return;
    const row = await runExpansion(
      llmAdapter,
      { kind: "frontier", source: selectedLocationId },
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
  if (!isBooted || !world || !selectedLocationId) {
    return <div className="bootScreen">Booting engine...</div>;
  }

  return (
    <div className="gameRoot">
      <LocationScene
        world={world}
        locationId={selectedLocationId}
        currentAreaId={effectiveAreaId}
        onMoveToArea={(areaId) => {
          setCurrentArea(areaId);
          setActiveNpcId(null);
        }}
        onTalkToNpc={handleTalkToNpc}
      />

      <div className="hud hud-top-left">
        <div className="locationCard">
          <div className="locationCard__region">{region?.name ?? location?.region ?? "Unknown Region"}</div>
          <div className="locationCard__name">{location?.name ?? selectedLocationId}</div>
          {currentArea ? (
            <div className="locationCard__area">{effectiveAreaId}</div>
          ) : null}
          {currentArea?.description ? (
            <div className="locationCard__desc">{currentArea.description}</div>
          ) : null}
        </div>
      </div>

      <div className="hud hud-top-right">
        <button type="button" onClick={() => toggleWorldMap(true)}>World Map</button>
        <button type="button" onClick={handleSkillCheck}>Skill Check</button>
        <button type="button" onClick={handleExpansion}>Expand</button>
        <button type="button" onClick={handleExport}>Save</button>
      </div>

      {!combat && !activeNpc ? (
        <div className="hud hud-bottom-center">
          <div className="hint">
            Click an area pad to move. Click an NPC to talk.
          </div>
        </div>
      ) : null}

      {activeNpc ? (
        <div className="overlay overlay-bottom">
          <DialoguePanel
            npc={activeNpc}
            messages={dialogue}
            onSend={(text) => {
              addDialogue({ role: "player", text });
              addDialogue({
                role: "npc",
                text: `${activeNpc.name}: I hear you. "${text}" — but words can be cheap here.`,
              });
            }}
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
    </div>
  );
}

export default App;
