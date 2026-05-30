/**
 * Translate a plain JSON-Schema (lowercase types, the form OpenRouter wants)
 * into the OpenAPI-subset Gemini accepts for `responseSchema`. Gemini wants
 * UPPERCASE type names and only understands a small keyword set, so we map
 * types and drop anything it would reject (additionalProperties, min/max, etc.).
 */
const TYPE_MAP: Record<string, string> = {
  string: "STRING",
  number: "NUMBER",
  integer: "INTEGER",
  boolean: "BOOLEAN",
  array: "ARRAY",
  object: "OBJECT",
};

const ALLOWED = new Set(["type", "description", "enum", "items", "properties", "required", "nullable"]);

export function toGeminiSchema(schema: unknown): Record<string, unknown> | null {
  if (!schema || typeof schema !== "object") return null;
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(src)) {
    if (!ALLOWED.has(key)) continue;
    if (key === "type" && typeof value === "string") {
      out.type = TYPE_MAP[value] ?? value.toUpperCase();
    } else if (key === "items") {
      const items = toGeminiSchema(value);
      if (items) out.items = items;
    } else if (key === "properties" && value && typeof value === "object") {
      const props: Record<string, unknown> = {};
      for (const [propKey, propVal] of Object.entries(value as Record<string, unknown>)) {
        const conv = toGeminiSchema(propVal);
        if (conv) props[propKey] = conv;
      }
      out.properties = props;
    } else {
      out[key] = value;
    }
  }
  return out;
}
