import { describe, expect, it } from "vitest";
import { extractJson } from "../json";

describe("extractJson", () => {
  it("parses valid JSON directly", () => {
    const v = extractJson<{ messages: unknown[] }>('{"messages":[{"user":"a","text":"hi","kind":"normal"}]}');
    expect(v?.messages).toHaveLength(1);
  });

  it("repairs unescaped quotes inside string values", () => {
    const broken =
      '{"messages":[{"user":"frag__xx","text":"lol "little moment" yeah right.","kind":"flirty"}]}';
    const v = extractJson<{ messages: Array<{ text: string }> }>(broken);
    expect(v?.messages[0]?.text).toBe('lol "little moment" yeah right.');
  });

  it("still handles fenced JSON", () => {
    const v = extractJson<{ ok: boolean }>('```json\n{"ok":true}\n```');
    expect(v?.ok).toBe(true);
  });

  it("leaves already-escaped quotes alone", () => {
    const v = extractJson<{ text: string }>('{"text":"she said \\"hi\\""}');
    expect(v?.text).toBe('she said "hi"');
  });
});
