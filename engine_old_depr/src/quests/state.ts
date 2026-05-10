export type QuestStatus = "available" | "active" | "completed" | "failed" | "abandoned";

export type QuestState = {
  questId: string;
  status: QuestStatus;
  acceptedAt?: number;
  completedAt?: number;
  progressNotes: string;
  completionEvidence?: string;
};

export function createQuestState(questId: string): QuestState {
  return {
    questId,
    status: "available",
    progressNotes: "",
  };
}

export function applyQuestProgress(
  state: QuestState,
  note: string,
  turn: number,
): QuestState {
  return {
    ...state,
    status: state.status === "available" ? "active" : state.status,
    acceptedAt: state.acceptedAt ?? turn,
    progressNotes: [state.progressNotes, note].filter(Boolean).join("\n"),
  };
}

export function completeQuest(
  state: QuestState,
  evidence: string,
  turn: number,
): QuestState {
  return {
    ...state,
    status: "completed",
    completedAt: turn,
    completionEvidence: evidence,
  };
}
