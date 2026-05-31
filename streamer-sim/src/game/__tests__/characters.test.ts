import { describe, it, expect } from "vitest";
import {
  makeHandle,
  seedCharacter,
  normalizeCharacter,
  rollGender,
  pronouns,
  revealedSheet,
  hasBackstoryLayer,
  appendInteraction,
  syncBackstoryString,
  rosterHandles,
} from "../characters";
import { revealName, checkMilestones } from "../relationships";
import { ARCHETYPE_BY_ID, ARCHETYPES } from "../archetypes";

describe("makeHandle", () => {
  it("generates unique handles against a taken set", () => {
    const arch = ARCHETYPE_BY_ID["hype-fan"]!;
    const taken = new Set<string>();
    const handles = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const h = makeHandle(arch, taken);
      expect(taken.has(h)).toBe(false);
      expect(handles.has(h)).toBe(false);
      taken.add(h);
      handles.add(h);
    }
  });

  it("produces varied handles across many rolls", () => {
    const arch = ARCHETYPE_BY_ID["cozy-regular"]!;
    const handles = new Set(Array.from({ length: 30 }, () => makeHandle(arch)));
    expect(handles.size).toBeGreaterThan(15);
  });
});

describe("gender and pronouns", () => {
  it("maps pronouns by gender", () => {
    expect(pronouns("female")).toEqual({ subj: "she", obj: "her", poss: "her" });
    expect(pronouns("male")).toEqual({ subj: "he", obj: "him", poss: "his" });
    expect(pronouns("nonbinary")).toEqual({ subj: "they", obj: "them", poss: "their" });
  });

  it("seeds gender on new characters", () => {
    const arch = ARCHETYPE_BY_ID["softboy"]!;
    const c = seedCharacter(arch, 1000);
    expect(["female", "male", "nonbinary"]).toContain(c.gender);
  });

  it("seeds age and occupation on new characters", () => {
    const arch = ARCHETYPE_BY_ID["cozy-regular"]!;
    const c = seedCharacter(arch, 1000);
    expect(c.age).toBeGreaterThanOrEqual(16);
    expect(c.age).toBeLessThanOrEqual(65);
    expect(c.occupation.length).toBeGreaterThan(0);
  });

  it("backfills age and occupation on legacy saves", () => {
    const arch = ARCHETYPE_BY_ID["cozy-regular"]!;
    const c = seedCharacter(arch, 1000);
    const legacy = JSON.parse(JSON.stringify(c)) as typeof c;
    delete (legacy as { age?: number }).age;
    legacy.occupation = "";
    const fixed = normalizeCharacter(legacy);
    expect(fixed.age).toBeGreaterThanOrEqual(16);
    expect(fixed.occupation.trim().length).toBeGreaterThan(0);
  });
});

describe("revealedSheet", () => {
  it("hides most fields for strangers who haven't interacted", () => {
    const arch = ARCHETYPE_BY_ID["lurker"]!;
    const c = seedCharacter(arch, 1000);
    c.affinity = 5;
    c.known = false;
    c.messageCount = 0;
    const r = revealedSheet(c);
    expect(r.displayName).toBeNull();
    expect(r.vibe).toBeNull();
    expect(r.motiveSurface).toBeNull();
    expect(r.threat).toBeNull();
  });

  it("reveals name and threat when earned", () => {
    const arch = ARCHETYPE_BY_ID["stalker"]!;
    const c = seedCharacter(arch, 1000);
    c.displayName = "Alex";
    c.known = true;
    c.threat = 2;
    c.backstoryLayers = [{ id: "1", trigger: "threat-2", text: "Dark detail." }];
    const r = revealedSheet(c);
    expect(r.displayName).toBe("Alex");
    expect(r.threat).toBe(2);
    expect(r.backstoryLayers.some((l) => l.trigger === "threat-2")).toBe(true);
  });
});

describe("backstory layers", () => {
  it("tracks layers by trigger", () => {
    const arch = ARCHETYPES[0];
    const c = seedCharacter(arch, 1000);
    expect(hasBackstoryLayer(c, "familiar")).toBe(false);
    c.backstoryLayers = [{ id: "a", trigger: "familiar", text: "Opened up." }];
    expect(hasBackstoryLayer(c, "familiar")).toBe(true);
    expect(syncBackstoryString(c.backstoryLayers)).toContain("Opened up");
  });
});

describe("interaction log", () => {
  it("caps log length", () => {
    let log = appendInteraction([], { day: 1, kind: "dm", text: "hi" });
    for (let i = 0; i < 50; i += 1) {
      log = appendInteraction(log, { day: 1, kind: "dm", text: `msg ${i}` });
    }
    expect(log.length).toBeLessThanOrEqual(40);
  });
});

describe("revealName", () => {
  it("picks gender-appropriate unique names", () => {
    const arch = ARCHETYPES[0];
    const c = seedCharacter(arch, 1000);
    c.gender = "female";
    const taken = new Set(["mara"]);
    const name = revealName(c, taken);
    expect(name.toLowerCase()).not.toBe("mara");
  });

  it("fires regular milestone with unique name", () => {
    const arch = ARCHETYPES[0];
    const c = seedCharacter(arch, 1000);
    c.gender = "male";
    c.affinity = 36;
    const outcomes = checkMilestones(c, 34, 1, new Set());
    const regular = outcomes.find((o) => o.id === "regular");
    expect(regular?.patch?.displayName).toBeTruthy();
  });
});

describe("rosterHandles", () => {
  it("collects handles from roster", () => {
    const a = seedCharacter(ARCHETYPES[0], 1);
    const b = seedCharacter(ARCHETYPES[1], 1, rosterHandles({ [a.id]: a }));
    const taken = rosterHandles({ [a.id]: a, [b.id]: b });
    expect(taken.has(a.handle)).toBe(true);
    expect(taken.has(b.handle)).toBe(true);
  });
});
