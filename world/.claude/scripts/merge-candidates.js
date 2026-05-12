#!/usr/bin/env node
// Merge candidate batches into tabs/.
// Reads candidates/*.json (each file is a top-level map of block -> entries),
// dispatches each block to the right tabs/*.json file, and applies the entries.
//
// Behavior:
//   - For object-shaped blocks (most), entries are merged by key (existing keys overwritten).
//   - For array-shaped blocks, the candidate's value REPLACES the canon array (full replacement).
//     If you want to add a single trait/archetype/etc., your candidate must include the full array.
//   - Settings/config blocks (objects of objects) are deep-merged one level.
//   - storySettings.worldBackground is extracted into tabs/world-background.json automatically.
//   - **Deletion:** setting an entry to `null` in the candidate deletes that key from the canon block.
//     E.g. `{ "regions": { "Old Name": null, "New Name": {...} } }` renames in two steps.
//   - On success, candidate files are moved to candidates/.merged/<timestamp>-<filename>.
//
// Usage:
//   node .claude/scripts/merge-candidates.js              # merge all candidates/*.json
//   node .claude/scripts/merge-candidates.js foo.json     # merge a single file
//   node .claude/scripts/merge-candidates.js --dry-run    # show what would change

const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "../..");
const candidatesDir = path.join(projectRoot, "candidates");
const tabsDir = path.join(projectRoot, "tabs");
const archiveDir = path.join(candidatesDir, ".merged");

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

    worldBackground: "world-background",
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fileArgs = args.filter(a => !a.startsWith("--"));

if (!fs.existsSync(candidatesDir)) {
    console.error(`No candidates/ directory at ${candidatesDir}`);
    process.exit(1);
}

const files = (fileArgs.length ? fileArgs : fs.readdirSync(candidatesDir))
    .filter(f => f.endsWith(".json"))
    .map(f => path.isAbsolute(f) ? f : path.join(candidatesDir, f))
    .filter(f => fs.statSync(f).isFile());

if (!files.length) {
    console.log("No candidate files to merge.");
    process.exit(0);
}

// Load all affected tabs lazily.
const tabCache = {};
function loadTab(tab) {
    if (tabCache[tab]) return tabCache[tab];
    const p = path.join(tabsDir, `${tab}.json`);
    tabCache[tab] = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
    return tabCache[tab];
}

const changes = []; // [{file, block, tab, action, key?}]

for (const f of files) {
    const candidate = JSON.parse(fs.readFileSync(f, "utf8"));
    const fname = path.basename(f);

    for (const [block, value] of Object.entries(candidate)) {
        const tab = BLOCK_TO_TAB[block];
        if (!tab) {
            console.error(`  ✗ ${fname}: unknown block "${block}" — skipping.`);
            continue;
        }
        const tabData = loadTab(tab);

        if (block === "worldBackground") {
            tabData.worldBackground = value;
            changes.push({file: fname, block, tab, action: "set"});
            continue;
        }

        // storySettings.worldBackground - extract to its own tab.
        if (block === "storySettings" && value && typeof value === "object" && "worldBackground" in value) {
            const wb = loadTab("world-background");
            wb.worldBackground = value.worldBackground;
            changes.push({file: fname, block: "worldBackground", tab: "world-background", action: "set"});
            const rest = {...value};
            delete rest.worldBackground;
            value = rest;
            if (!Object.keys(value).length) continue;
        }

        const existing = tabData[block];
        if (Array.isArray(value)) {
            tabData[block] = value;
            changes.push({file: fname, block, tab, action: "replace-array", count: value.length});
        } else if (value && typeof value === "object") {
            if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                for (const [k, v] of Object.entries(value)) {
                    if (v === null) {
                        if (k in existing) {
                            delete existing[k];
                            changes.push({file: fname, block, tab, action: "delete", key: k});
                        } else {
                            changes.push({file: fname, block, tab, action: "delete-noop", key: k});
                        }
                    } else {
                        const action = k in existing ? "update" : "add";
                        existing[k] = v;
                        changes.push({file: fname, block, tab, action, key: k});
                    }
                }
            } else {
                tabData[block] = value;
                changes.push({file: fname, block, tab, action: "set"});
            }
        } else if (value === null) {
            if (block in tabData) {
                delete tabData[block];
                changes.push({file: fname, block, tab, action: "delete-block"});
            }
        } else {
            tabData[block] = value;
            changes.push({file: fname, block, tab, action: "set"});
        }
    }
}

// Report.
const byFile = {};
for (const c of changes) {
    byFile[c.file] = byFile[c.file] || [];
    byFile[c.file].push(c);
}
for (const [fname, list] of Object.entries(byFile)) {
    console.log(`\n${fname}:`);
    for (const c of list) {
        const detail = c.key ? ` "${c.key}"` : c.count !== undefined ? ` (${c.count} entries)` : "";
        console.log(`  ${c.action.padEnd(14)} ${c.block.padEnd(22)} → tabs/${c.tab}.json${detail}`);
    }
}

if (dryRun) {
    console.log("\n(dry run — no files written)");
    process.exit(0);
}

// Write affected tabs.
for (const [tab, data] of Object.entries(tabCache)) {
    const p = path.join(tabsDir, `${tab}.json`);
    fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

// Archive merged candidate files.
if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, {recursive: true});
const ts = new Date().toISOString().replace(/[:.]/g, "-");
for (const f of files) {
    const dest = path.join(archiveDir, `${ts}-${path.basename(f)}`);
    fs.renameSync(f, dest);
}

console.log(`\nMerged ${files.length} candidate file(s); archived to candidates/.merged/`);
console.log(`Run \`node .claude/scripts/build.js\` to rebuild config.json.`);
