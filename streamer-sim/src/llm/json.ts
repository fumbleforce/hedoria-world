/**
 * Robust JSON extraction from an LLM text response. Models often wrap JSON in
 * ```json fences, add a preamble ("Sure! Here's the chat:"), or append a
 * trailing note. A naive JSON.parse fails on all of those and the caller
 * silently falls back to canned content. This finds the first balanced JSON
 * object/array in the text and parses that.
 */
export function extractJson<T = unknown>(text: string): T | null {
  if (!text) return null;
  const trimmed = text.trim();

  // 1. Direct parse (fast path).
  const direct = tryParse<T>(trimmed);
  if (direct !== undefined) return direct;

  // 2. Strip code fences and retry.
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const fenced = tryParse<T>(unfenced);
  if (fenced !== undefined) return fenced;

  // 3. Scan for the first balanced { } or [ ] block, respecting strings.
  const block = findBalanced(unfenced);
  if (block) {
    const parsed = tryParse<T>(block);
    if (parsed !== undefined) return parsed;
  }
  return null;
}

function tryParse<T>(s: string): T | undefined {
  try {
    return JSON.parse(s) as T;
  } catch {
    return undefined;
  }
}

function findBalanced(s: string): string | null {
  const start = s.search(/[{[]/);
  if (start < 0) return null;
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
