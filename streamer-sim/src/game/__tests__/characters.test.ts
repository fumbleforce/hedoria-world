import { describe, it, expect } from "vitest";
import {
  makeHandle,
  seedCharacter,
  normalizeCharacter,
  rollGender,
  rollPersonality,
  personalityProse,
  personalityAxes,
  personalityTable,
  seedVoiceProfile,
  seedOrigin,
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
    expect(c.origin.length).toBeGreaterThan(0);
    expect(c.nativeLanguage.length).toBeGreaterThan(0);
    expect(c.voiceProfile.length).toBeGreaterThan(0);
    expect(c.personality.warmth).toBeGreaterThanOrEqual(-5);
    expect(c.personality.warmth).toBeLessThanOrEqual(5);
    expect(c.personality.horny).toBeGreaterThanOrEqual(-5);
    expect(c.personality.horny).toBeLessThanOrEqual(5);
  });

  it("backfills personality, origin, and voice on legacy saves", () => {
    const arch = ARCHETYPE_BY_ID["cozy-regular"]!;
    const c = seedCharacter(arch, 1000);
    const legacy = JSON.parse(JSON.stringify(c)) as typeof c & { traits?: unknown };
    delete (legacy as { personality?: unknown }).personality;
    delete (legacy as { origin?: string }).origin;
    delete (legacy as { nativeLanguage?: string }).nativeLanguage;
    delete (legacy as { voiceProfile?: string }).voiceProfile;
    legacy.traits = { trait: "warm", intensity: 2, speechTic: "lol" };
    const fixed = normalizeCharacter(legacy);
    expect(fixed.personality).toBeTruthy();
    expect(fixed.origin).toBeTruthy();
    expect(fixed.nativeLanguage).toBeTruthy();
    expect(fixed.voiceProfile.length).toBeGreaterThan(0);
    expect(typeof fixed.personality.horny).toBe("number");
  });

  it("backfills horny on partial personality saves", () => {
    const arch = ARCHETYPE_BY_ID["cozy-regular"]!;
    const c = seedCharacter(arch, 1000);
    const legacy = JSON.parse(JSON.stringify(c)) as typeof c;
    delete (legacy.personality as { horny?: number }).horny;
    const fixed = normalizeCharacter(legacy);
    expect(fixed.personality.horny).toBeGreaterThanOrEqual(-5);
    expect(fixed.personality.horny).toBeLessThanOrEqual(5);
  });

  it("upgrades legacy -2..+2 personality saves to the granular scale", () => {
    const arch = ARCHETYPE_BY_ID["cozy-regular"]!;
    const c = seedCharacter(arch, 1000);
    const legacy = JSON.parse(JSON.stringify(c)) as typeof c;
    legacy.personality = {
      warmth: 2,
      energy: -1,
      formality: 0,
      boldness: -1,
      humor: 0,
      horny: 1,
      speechTic: "lol",
    };
    const fixed = normalizeCharacter(legacy);
    expect(fixed.personality.warmth).toBe(5);
    expect(fixed.personality.horny).toBe(3);
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

describe("personality and voice", () => {
  it("differentiates segment personality centers", () => {
    const hype = rollPersonality(ARCHETYPE_BY_ID["hype-fan"]!);
    const troll = rollPersonality(ARCHETYPE_BY_ID["troll"]!);
    const simp = rollPersonality(ARCHETYPE_BY_ID["simp"]!);
    expect(hype.energy).toBeGreaterThan(troll.warmth);
    expect(troll.warmth).toBeLessThanOrEqual(-2);
    expect(simp.horny).toBeGreaterThanOrEqual(3);
  });

  it("produces non-empty voice profiles without literal speech tics", () => {
    const arch = ARCHETYPE_BY_ID["cozy-regular"]!;
    const c = seedCharacter(arch, 1000);
    const profile = seedVoiceProfile(c.personality, seedOrigin(arch));
    expect(profile.length).toBeGreaterThan(20);
    expect(profile).not.toContain(`"${c.personality.speechTic}"`);
    expect(personalityProse(c.personality).length).toBeGreaterThan(0);
  });

  it("reveals personality at familiar but holds origin/age until regular", () => {
    const c = seedCharacter(ARCHETYPES[0], 1000);
    c.affinity = 20; // familiar
    const r = revealedSheet(c);
    expect(r.personalitySummary).toBeTruthy();
    expect(r.vibe).toBeTruthy();
    expect(r.origin).toBeNull();
    expect(r.age).toBeNull();
    expect(r.occupation).toBeNull();
  });

  it("reveals origin, age, occupation, and wants at regular", () => {
    const c = seedCharacter(ARCHETYPES[0], 1000);
    c.affinity = 40; // regular
    const r = revealedSheet(c);
    expect(r.origin).toBeTruthy();
    expect(r.age).not.toBeNull();
    expect(r.occupation).toBeTruthy();
    expect(r.motiveSurface).toBeTruthy();
  });

  it("does not reveal personal info from passive chat spam alone (no relationship)", () => {
    const c = seedCharacter(ARCHETYPES[0], 1000);
    c.affinity = 6; // stranger
    c.messageCount = 25; // chatted a lot in stream, but no bond
    const r = revealedSheet(c);
    expect(r.personalitySummary).toBeNull();
    expect(r.age).toBeNull();
    expect(r.origin).toBeNull();
  });

  it("does not leak personality just because the sheet was opened (known) on a stranger", () => {
    const c = seedCharacter(ARCHETYPES[0], 1000);
    c.affinity = 5; // stranger
    c.known = true; // opening the modal sets this
    c.messageCount = 0;
    c.interactionLog = [];
    const r = revealedSheet(c);
    expect(r.personalitySummary).toBeNull();
    expect(r.origin).toBeNull();
    expect(r.voiceProfile).toBeNull();
    expect(r.quirks).toBeNull();
    expect(r.vibe).toBeNull();
  });

  it("exposes raw personality axes for dev surfaces", () => {
    const c = seedCharacter(ARCHETYPES[0], 1000);
    const axes = personalityAxes(c.personality);
    expect(axes).toContain("warmth");
    expect(axes).toContain("horny");
    expect(axes).toMatch(/[+-]\d/);
  });

  it("uses distinct graduated words across the full axis range", () => {
    const base = { energy: 0, formality: 0, boldness: 0, humor: 0, horny: 0, speechTic: "" };
    const words = new Set<string>();
    for (let v = -5; v <= 5; v += 1) {
      words.add(personalityProse({ ...base, warmth: v }));
    }
    // 11 levels including 0 → at least several distinct descriptions, not 3.
    expect(words.size).toBeGreaterThanOrEqual(8);
  });

  it("builds a per-axis dev table with value, word, and effect", () => {
    const c = seedCharacter(ARCHETYPES[0], 1000);
    const table = personalityTable(c.personality);
    expect(table.length).toBe(6);
    for (const row of table) {
      expect(row.axis.length).toBeGreaterThan(0);
      expect(typeof row.value).toBe("number");
      expect(row.word.length).toBeGreaterThan(0);
      expect(row.effect.length).toBeGreaterThan(0);
    }
  });

  it("keeps the voice profile a short tag list, not prose", () => {
    const arch = ARCHETYPE_BY_ID["cozy-regular"]!;
    const c = seedCharacter(arch, 1000);
    const profile = seedVoiceProfile(c.personality, seedOrigin(arch));
    expect(profile).toContain(" · ");
    expect(profile.split(" · ").length).toBeLessThanOrEqual(6);
    // No multi-sentence prose.
    expect(profile).not.toMatch(/\.\s+[A-Z]/);
  });
});

describe("revealName", () => {
  it("seeds every character with a real name they know from the start", () => {
    const arch = ARCHETYPES[0];
    const c = seedCharacter(arch, 1000);
    expect(c.realName).toBeTruthy();
    // The player hasn't learned it yet.
    expect(c.displayName).toBe("");
  });

  it("reveals the character's own real name (consistent, not invented)", () => {
    const arch = ARCHETYPES[0];
    const c = seedCharacter(arch, 1000);
    expect(revealName(c)).toBe(c.realName);
  });

  it("fires regular milestone revealing their real name", () => {
    const arch = ARCHETYPES[0];
    const c = seedCharacter(arch, 1000);
    c.gender = "male";
    c.affinity = 36;
    const outcomes = checkMilestones(c, 34, 1, new Set());
    const regular = outcomes.find((o) => o.id === "regular");
    expect(regular?.patch?.displayName).toBe(c.realName);
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
