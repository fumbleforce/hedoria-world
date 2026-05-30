import type { LlmCallKind } from "./types";

/**
 * Lightweight, in-memory telemetry for the last LLM call of each kind, plus
 * rolling totals. Powers the Settings "LLM" tab (latency / approx token /
 * last-raw-response viewer) without touching the persisted game store. A tiny
 * pub/sub lets React re-render on each call.
 */
export interface LlmCallStat {
  kind: LlmCallKind;
  model: string;
  durationMs: number;
  /** Rough token estimate (~4 chars/token) for the prompt and the response. */
  promptTokens: number;
  responseTokens: number;
  promptChars: number;
  responseChars: number;
  /** Truncated raw request + response, for prompt debugging in-app. */
  rawPrompt: string;
  rawResponse: string;
  ok: boolean;
  error?: string;
  at: number;
  /** Total calls of this kind this session. */
  count: number;
}

const RAW_LIMIT = 8000;
const stats = new Map<LlmCallKind, LlmCallStat>();
const counts = new Map<LlmCallKind, number>();
const listeners = new Set<() => void>();
// Cached, stable snapshot for useSyncExternalStore (rebuilt only on change).
let snapshot: LlmCallStat[] = [];

function approxTokens(chars: number): number {
  return Math.max(0, Math.round(chars / 4));
}

function rebuildSnapshot(): void {
  snapshot = [...stats.values()].sort((a, b) => b.at - a.at);
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
  stats.set(input.kind, {
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
  });
  rebuildSnapshot();
  for (const l of listeners) l();
}

export function getLlmStats(): LlmCallStat[] {
  return snapshot;
}

export function subscribeLlmStats(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearLlmStats(): void {
  stats.clear();
  counts.clear();
  rebuildSnapshot();
  for (const l of listeners) l();
}
