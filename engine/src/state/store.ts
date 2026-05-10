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

type GameState = {
  world: IndexedWorld | null;
  selectedLocationId: string | null;
  currentAreaId: string | null;
  combat: CombatState | null;
  questState: Record<string, QuestState>;
  dialogue: DialogueMessage[];
  worldMapOpen: boolean;
  exportOpen: boolean;
  activeNpcId: string | null;
  setWorld: (world: IndexedWorld) => void;
  setSelectedLocation: (locationId: string | null) => void;
  setCurrentArea: (areaId: string | null) => void;
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
  selectedLocationId: null,
  currentAreaId: null,
  combat: null,
  questState: {},
  dialogue: [],
  worldMapOpen: false,
  exportOpen: false,
  activeNpcId: null,
  setWorld: (world) => set({ world }),
  setSelectedLocation: (selectedLocationId) => set({ selectedLocationId }),
  setCurrentArea: (currentAreaId) => set({ currentAreaId }),
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
