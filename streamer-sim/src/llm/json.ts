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

  // 4. Models often put unescaped " inside string values (e.g. chat quoting a phrase).
  //    Escape inner quotes and retry before giving up.
  const repaired = repairUnescapedQuotes(unfenced);
  if (repaired !== unfenced) {
    const fromRepair = tryParse<T>(repaired);
    if (fromRepair !== undefined) return fromRepair;
    const repairedBlock = findBalanced(repaired);
    if (repairedBlock) {
      const parsed = tryParse<T>(repairedBlock);
      if (parsed !== undefined) return parsed;
    }
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

/** True when `"` at `i` closes a JSON string (next token is structural). */
function isClosingStringQuote(s: string, i: number): boolean {
  for (let j = i + 1; j < s.length; j += 1) {
    const c = s[j];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") continue;
    return c === ":" || c === "," || c === "}" || c === "]";
  }
  return true;
}

/**
 * Escape `"` that appear inside JSON string values but were not backslash-escaped
 * by the model. Common when chat text embeds unescaped quote characters inside a value.
 */
function repairUnescapedQuotes(s: string): string {
  const start = s.search(/[{[]/);
  if (start < 0) return s;

  let out = s.slice(0, start);
  let inStr = false;
  let esc = false;

  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (esc) {
      out += ch;
      esc = false;
      continue;
    }
    if (inStr) {
      if (ch === "\\") {
        out += ch;
        esc = true;
        continue;
      }
      if (ch === '"') {
        if (isClosingStringQuote(s, i)) {
          inStr = false;
          out += ch;
        } else {
          out += '\\"';
        }
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }
    out += ch;
  }
  return out;
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
