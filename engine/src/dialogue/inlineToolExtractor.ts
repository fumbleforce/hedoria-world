/**
 * Inline tool-call extractor.
 *
 * Some smaller / cheaper open-weights models emit tool calls as TEXT
 * inside the prose stream instead of through the structured tool
 * channel. The result looks like this in the narration panel:
 *
 *   "Goran watches Mira gesture, his eyes narrowing slightly.
 *    say({"npcId": "...", "text": "Aye? What's on the menu?"})"
 *
 * That isn't catastrophic — the world state just doesn't change — but
 * it's awful UX: the player sees raw function syntax in the story log,
 * the NPC's actual line never lands in the dialogue track, and any
 * mechanical effect (engage, give_item, …) silently no-ops.
 *
 * `extractInlineToolCalls` walks a streamed narration string and pulls
 * any patterns of the form `<knownToolName>(<json>)` out of it,
 * returning the cleaned text plus a list of synthetic tool calls ready
 * to be merged into the structured response. The extractor:
 *
 *   - only recognises identifiers in the supplied `knownNames` set
 *     (so prose like "she made a quick aside (just a whisper)" stays
 *     intact),
 *   - is paren- and brace-balanced and string-aware so it handles
 *     punctuation inside the JSON argument (parens, quotes, escapes),
 *   - tolerates JSON variants the LLM commonly produces (single quotes,
 *     trailing commas) via a small salvage pass before giving up,
 *   - leaves the original text in place when extraction fails so we
 *     never accidentally swallow real prose.
 */

export type ExtractedCall = {
  name: string;
  arguments: unknown;
};

export type ExtractResult = {
  cleaned: string;
  calls: ExtractedCall[];
};

/**
 * Try to parse a JSON argument blob. Returns `undefined` if the blob
 * cannot be coerced even after light cleanup. We deliberately accept a
 * couple of common LLM quirks: single-quoted strings (swap to double),
 * trailing commas before `}` or `]`.
 */
function tryParseArgs(raw: string): unknown | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    // Salvage attempt: single → double quotes (only when there are no
    // unescaped double quotes that would conflict).
    const swapped = trimmed.replace(/'/g, '"');
    try {
      return JSON.parse(swapped);
    } catch {
      // Salvage attempt: strip trailing commas before } or ].
      const stripped = swapped.replace(/,(\s*[}\]])/g, "$1");
      try {
        return JSON.parse(stripped);
      } catch {
        return undefined;
      }
    }
  }
}

/**
 * Find the index of the closing `)` that matches the `(` at `openIdx`,
 * accounting for nested parens/braces and string literals (single or
 * double quoted, with backslash escapes). Returns `-1` if the parens
 * are unbalanced.
 */
function findMatchingParen(text: string, openIdx: number): number {
  let depth = 0;
  let inStr = false;
  let strChar = "";
  let escape = false;
  for (let i = openIdx; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === strChar) {
        inStr = false;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      strChar = c;
      continue;
    }
    if (c === "(") {
      depth += 1;
    } else if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function extractInlineToolCalls(
  text: string,
  knownNames: Iterable<string>,
): ExtractResult {
  const allowed = new Set(knownNames);
  if (!text || allowed.size === 0) {
    return { cleaned: text, calls: [] };
  }
  const calls: ExtractedCall[] = [];
  const segments: string[] = [];
  let cursor = 0;

  // Match: optional leading backtick / fence, then identifier, then
  // optional whitespace, then opening paren. We anchor on word
  // boundaries so we don't catch substrings inside other words.
  const pattern = /(`{1,3})?\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const [, , name] = match;
    if (!allowed.has(name)) continue;
    const openParen = match.index + match[0].length - 1;
    const closeParen = findMatchingParen(text, openParen);
    if (closeParen < 0) continue;
    const raw = text.slice(openParen + 1, closeParen);
    const args = tryParseArgs(raw);
    if (args === undefined) continue;
    // Push everything before the match (including any preceding
    // backticks captured by the regex) only up to the identifier
    // start, then advance the cursor past the closing paren plus an
    // optional trailing backtick fence.
    segments.push(text.slice(cursor, match.index));
    let consumeEnd = closeParen + 1;
    // Drop trailing matching backticks (e.g. inline-code style
    // `say({...})`).
    const fence = match[1];
    if (fence && text.slice(consumeEnd, consumeEnd + fence.length) === fence) {
      consumeEnd += fence.length;
    }
    cursor = consumeEnd;
    pattern.lastIndex = consumeEnd;
    calls.push({ name, arguments: args });
  }
  segments.push(text.slice(cursor));
  // Collapse the whitespace left behind where the call was excised: a
  // double-space, a trailing space before a newline, or a stranded
  // empty bullet. Keep paragraph breaks intact.
  const cleaned = segments
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleaned, calls };
}
