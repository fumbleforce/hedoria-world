import type { LlmAdapter } from "../llm/adapter";
import { SceneSpecSchema, type SceneSpec, type SceneScope } from "./sceneSpec";
import {
  buildRepairPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  type ScenePromptContext,
} from "./llm/scenePrompt";

export type ClassifyResult =
  | { ok: true; spec: SceneSpec; repaired: boolean; raw: string }
  | { ok: false; raw: string; error: string };

function safeJsonParse(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("empty response");
  }
  // Strip leading code fence if the model returned ```json ... ```.
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  const body = fenceMatch ? fenceMatch[1] : trimmed;
  return JSON.parse(body);
}

function expectedScopeMatch(spec: SceneSpec, ctx: ScenePromptContext): boolean {
  return spec.scope === ctx.scope;
}

/**
 * Lazy on-visit LLM scene classifier. Calls Gemini (or whatever provider the
 * adapter wraps) with a strict JSON-mode prompt, validates against the
 * SceneSpec Zod schema, and does one auto-repair retry on validation failure.
 *
 * Returns ok: true with the validated SceneSpec, or ok: false with the raw
 * response and error so the caller can quarantine and fall back to the
 * procedural placeholder.
 */
export async function classifyScene(
  adapter: LlmAdapter,
  ctx: ScenePromptContext,
): Promise<ClassifyResult> {
  const system = buildSystemPrompt();
  const user = buildUserPrompt(ctx);

  const first = await adapter.complete(
    {
      system,
      messages: [{ role: "user", content: user }],
      jsonMode: true,
    },
    { kind: "scene-classify" },
  );

  const firstAttempt = tryParseSpec(first.text, ctx);
  if (firstAttempt.ok) {
    return { ok: true, spec: firstAttempt.spec, repaired: false, raw: first.text };
  }

  const repairUser = buildRepairPrompt(first.text, firstAttempt.error);
  const second = await adapter.complete(
    {
      system,
      messages: [
        { role: "user", content: user },
        { role: "assistant", content: first.text },
        { role: "user", content: repairUser },
      ],
      jsonMode: true,
    },
    { kind: "scene-classify" },
  );
  const secondAttempt = tryParseSpec(second.text, ctx);
  if (secondAttempt.ok) {
    return { ok: true, spec: secondAttempt.spec, repaired: true, raw: second.text };
  }
  return { ok: false, raw: second.text, error: secondAttempt.error };
}

function tryParseSpec(
  raw: string,
  ctx: ScenePromptContext,
): { ok: true; spec: SceneSpec } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = safeJsonParse(raw);
  } catch (err) {
    return { ok: false, error: `parse: ${err instanceof Error ? err.message : String(err)}` };
  }
  const result = SceneSpecSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `validate: ${issues}` };
  }
  if (!expectedScopeMatch(result.data, ctx)) {
    return {
      ok: false,
      error: `scope mismatch: expected ${ctx.scope}, got ${result.data.scope}`,
    };
  }
  return { ok: true, spec: result.data };
}

export type ScopeKey = {
  scope: SceneScope;
  regionId?: string;
  locationId?: string;
  areaId?: string;
};

export function scopeKeyToString(key: ScopeKey): string {
  return `${key.scope}::${key.regionId ?? ""}::${key.locationId ?? ""}::${key.areaId ?? ""}`;
}
