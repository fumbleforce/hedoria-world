import type { LlmCallKind, LlmCallStat } from "./types";
import { useStore } from "../state/store";

export type { LlmCallStat };

/**
 * Rolling per-kind LLM telemetry for the Settings "LLM" tab. Stored in the
 * zustand game store (not persisted) so the adapter and UI always share one
 * singleton — a module-level Map can diverge under Vite HMR.
 */
const RAW_LIMIT = 8000;
const counts = new Map<LlmCallKind, number>();

function approxTokens(chars: number): number {
  return Math.max(0, Math.round(chars / 4));
}

export function recordLlmCall(input: {
  kind: LlmCallKind;
  model: string;
  durationMs: number;
  prompt: string;
  response: string;
  ok: boolean;
  error?: string;
}): void {
  const count = (counts.get(input.kind) ?? 0) + 1;
  counts.set(input.kind, count);
  const stat: LlmCallStat = {
    kind: input.kind,
    model: input.model,
    durationMs: input.durationMs,
    promptChars: input.prompt.length,
    responseChars: input.response.length,
    promptTokens: approxTokens(input.prompt.length),
    responseTokens: approxTokens(input.response.length),
    rawPrompt: input.prompt.slice(0, RAW_LIMIT),
    rawResponse: input.response.slice(0, RAW_LIMIT),
    ok: input.ok,
    error: input.error,
    at: Date.now(),
    count,
  };
  useStore.setState((s) => {
    const byKind = new Map(s.llmStats.map((row) => [row.kind, row]));
    byKind.set(stat.kind, stat);
    return { llmStats: [...byKind.values()].sort((a, b) => b.at - a.at) };
  });
}

export function getLlmStats(): LlmCallStat[] {
  return useStore.getState().llmStats;
}

/** @deprecated Prefer `useStore((s) => s.llmStats)` in React components. */
export function subscribeLlmStats(fn: () => void): () => void {
  return useStore.subscribe((state, prev) => {
    if (state.llmStats !== prev.llmStats) fn();
  });
}

export function clearLlmStats(): void {
  counts.clear();
  useStore.setState({ llmStats: [] });
}
