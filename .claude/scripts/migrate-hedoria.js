#!/usr/bin/env node
// One-shot migration: hedoria/canon/*.json -> tabs/*.json
// Run from repo root: node .claude/scripts/migrate-hedoria.js

const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "../..");
const canonDir = path.join(projectRoot, "hedoria", "canon");
const tabsDir = path.join(projectRoot, "tabs");

// Block -> destination tab file (no extension)
const BLOCK_TO_TAB = {
    abilities: "abilities",

    aiInstructions: "ai-instructions",
    narratorStyle: "ai-instructions",
    death: "ai-instructions",
    resourceSettings: "ai-instructions",
    storySettings: "ai-instructions",

    characterArchetypes: "archetypes",
    locationArchetypes: "archetypes",
    regionArchetypes: "archetypes",
    encounterElements: "archetypes",
    authorSeeds: "archetypes",

    factions: "factions",
    items: "items",
    locations: "locations",
    npcs: "npcs",
    npcTypes: "npc-types",
    premadeCharacters: "premade-characters",
    quests: "quests",
    realms: "realms",
    regions: "regions",
    skills: "skills",
    storyStarts: "story-starts",
    traits: "traits",
    traitCategories: "traits",
    triggers: "triggers",
    worldLore: "world-lore",

    attributeSettings: "settings",
    skillSettings: "settings",
    locationSettings: "settings",
    itemSettings: "settings",
    combatSettings: "settings",
    otherSettings: "settings",

    configVersion: "meta",
    heroesVersion: "meta",
    embeddings: "meta",
    embeddingModel: "meta",
    embeddingDimension: "meta",
    mods: "meta",
    tipSettings: "meta",
    nameFilterSettings: "meta",
    randomNames: "meta",
};

// Accumulator: tab name -> { block: data, ... }
const tabs = {};
function addBlock(tab, block, data) {
    tabs[tab] = tabs[tab] || {};
    if (tabs[tab][block] !== undefined) {
        // Merge: if both are plain objects, shallow-merge; if both arrays, concat; else error.
        const existing = tabs[tab][block];
        if (Array.isArray(existing) && Array.isArray(data)) {
            tabs[tab][block] = existing.concat(data);
        } else if (
            existing && typeof existing === "object" && !Array.isArray(existing) &&
            data && typeof data === "object" && !Array.isArray(data)
        ) {
            tabs[tab][block] = { ...existing, ...data };
        } else {
            throw new Error(`Cannot merge block "${block}" — type mismatch.`);
        }
    } else {
        tabs[tab][block] = data;
    }
}

// Walk canon/, route every block.
const skipped = [];
for (const file of fs.readdirSync(canonDir)) {
    if (!file.endsWith(".json") || file === "_map.json") continue;
    const data = JSON.parse(fs.readFileSync(path.join(canonDir, file), "utf8"));
    for (const [block, value] of Object.entries(data)) {
        const tab = BLOCK_TO_TAB[block];
        if (!tab) {
            skipped.push(`${file}:${block}`);
            continue;
        }
        addBlock(tab, block, value);
    }
}

// Extract worldBackground from storySettings if present (Puppeteer keeps it in its own tab).
if (tabs["ai-instructions"]?.storySettings?.worldBackground !== undefined) {
    const bg = tabs["ai-instructions"].storySettings.worldBackground;
    delete tabs["ai-instructions"].storySettings.worldBackground;
    tabs["world-background"] = { worldBackground: bg };
}

// Tab field-order templates — preserve the order Puppeteer's stubs use so diffs stay readable.
const TAB_ORDER = {
    "ai-instructions": ["aiInstructions", "narratorStyle", "death", "resourceSettings", "storySettings"],
    archetypes: ["authorSeeds", "characterArchetypes", "locationArchetypes", "regionArchetypes", "encounterElements"],
    meta: ["configVersion", "heroesVersion", "embeddings", "embeddingModel", "embeddingDimension", "tipSettings", "nameFilterSettings", "randomNames", "mods"],
    settings: ["attributeSettings", "skillSettings", "locationSettings", "itemSettings", "combatSettings", "otherSettings"],
    traits: ["traitCategories", "traits"],
};

function ordered(tabName, obj) {
    const order = TAB_ORDER[tabName];
    if (!order) return obj;
    const out = {};
    for (const k of order) if (obj[k] !== undefined) out[k] = obj[k];
    for (const k of Object.keys(obj)) if (!(k in out)) out[k] = obj[k];
    return out;
}

// Ensure world-background tab exists even if Hedoria had no worldBackground.
if (!tabs["world-background"]) tabs["world-background"] = { worldBackground: "" };

// Write each tab.
const written = [];
for (const [tab, content] of Object.entries(tabs)) {
    const out = path.join(tabsDir, `${tab}.json`);
    fs.writeFileSync(out, JSON.stringify(ordered(tab, content), null, 2) + "\n");
    written.push(`tabs/${tab}.json`);
}

console.log("Migrated:", written.length, "tabs");
for (const w of written.sort()) console.log("  ✓", w);
if (skipped.length) {
    console.log("\nSkipped (no destination):");
    for (const s of skipped) console.log("  ?", s);
}
