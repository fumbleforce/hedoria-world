import { create } from "zustand";
import { createMachine } from "xstate";
import type { IndexedWorld } from "../world/indexer";
import type { CombatState } from "../rules/combat/tickModel";
import type { QuestState } from "../quests/state";

export const combatLifecycleMachine = createMachine({
  id: "combatLifecycle",
  initial: "idle",
  states: {
    idle: { on: { START: "combat" } },
    combat: { on: { DEFEAT: "defeat", VICTORY: "idle" } },
    defeat: { on: { RECOVER: "recovery" } },
    recovery: { on: { AFTERMATH: "aftermath" } },
    aftermath: { on: { IDLE: "idle" } },
  },
});

type DialogueMessage = {
  role: "player" | "npc";
  text: string;
};

/**
 * Top-level scene mode. The overworld is the default — the player walks
 * continuously across the regional ground. Interior is a sub-scene render
 * (door-portal exits) that keeps overworld state intact while showing an
 * indoor area as its own SceneSpec.
 */
export type SceneMode = "overworld" | "interior";

type GameState = {
  world: IndexedWorld | null;
  /** Continuous player position in overworld units (x, z). */
  playerPos: [number, number];
  /**
   * The location whose catchment circle the player currently occupies, or
   * null when the player is in the wilderness between locations.
   */
  nearestLocationId: string | null;
  /** Region grid cell the player is standing in; null only before boot. */
  currentRegionId: string | null;
  /** Which area the player is currently inside (interior mode) or null. */
  currentAreaId: string | null;
  /** When in interior mode, which location's interior is being shown. */
  interiorLocationId: string | null;
  sceneMode: SceneMode;
  /**
   * Camera azimuth around the player, in radians. 0 = camera due south of
   * player (looking north); π/4 = camera at SE (the default isometric view).
   * Drives both the 3D camera and the bottom-left compass rotation.
   */
  cameraAzimuth: number;
  /** Legacy: still exposed so the world map / HUD can highlight a target. */
  selectedLocationId: string | null;
  combat: CombatState | null;
  questState: Record<string, QuestState>;
  dialogue: DialogueMessage[];
  worldMapOpen: boolean;
  exportOpen: boolean;
  activeNpcId: string | null;
  setWorld: (world: IndexedWorld) => void;
  setSelectedLocation: (locationId: string | null) => void;
  setPlayerPos: (x: number, z: number) => void;
  setNearestLocation: (locationId: string | null) => void;
  setCurrentRegion: (regionId: string | null) => void;
  setCurrentArea: (areaId: string | null) => void;
  setSceneMode: (mode: SceneMode) => void;
  enterInterior: (locationId: string, areaId: string) => void;
  exitInterior: () => void;
  setCameraAzimuth: (azimuth: number) => void;
  setCombat: (combat: CombatState | null) => void;
  addDialogue: (message: DialogueMessage) => void;
  clearDialogue: () => void;
  upsertQuestState: (quest: QuestState) => void;
  toggleWorldMap: (open?: boolean) => void;
  toggleExport: (open?: boolean) => void;
  setActiveNpcId: (npcId: string | null) => void;
};

export const useGameStore = create<GameState>((set) => ({
  world: null,
  playerPos: [0, 0],
  nearestLocationId: null,
  currentRegionId: null,
  currentAreaId: null,
  interiorLocationId: null,
  sceneMode: "overworld",
  cameraAzimuth: Math.PI / 4,
  selectedLocationId: null,
  combat: null,
  questState: {},
  dialogue: [],
  worldMapOpen: false,
  exportOpen: false,
  activeNpcId: null,
  setWorld: (world) => set({ world }),
  setSelectedLocation: (selectedLocationId) => set({ selectedLocationId }),
  setPlayerPos: (x, z) => set({ playerPos: [x, z] }),
  setNearestLocation: (nearestLocationId) => set({ nearestLocationId }),
  setCurrentRegion: (currentRegionId) => set({ currentRegionId }),
  setCurrentArea: (currentAreaId) => set({ currentAreaId }),
  setSceneMode: (sceneMode) => set({ sceneMode }),
  enterInterior: (locationId, areaId) =>
    set({
      sceneMode: "interior",
      interiorLocationId: locationId,
      currentAreaId: areaId,
    }),
  exitInterior: () =>
    set({
      sceneMode: "overworld",
      interiorLocationId: null,
      currentAreaId: null,
    }),
  setCameraAzimuth: (cameraAzimuth) => set({ cameraAzimuth }),
  setCombat: (combat) => set({ combat }),
  addDialogue: (message) => set((state) => ({ dialogue: [...state.dialogue, message] })),
  clearDialogue: () => set({ dialogue: [] }),
  upsertQuestState: (quest) =>
    set((state) => ({ questState: { ...state.questState, [quest.questId]: quest } })),
  toggleWorldMap: (open) =>
    set((state) => ({ worldMapOpen: typeof open === "boolean" ? open : !state.worldMapOpen })),
  toggleExport: (open) =>
    set((state) => ({ exportOpen: typeof open === "boolean" ? open : !state.exportOpen })),
  setActiveNpcId: (activeNpcId) => set({ activeNpcId }),
}));
