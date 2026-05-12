#!/usr/bin/env node
// Block tool — inspect and patch tabs via the candidate workflow.
//
// Read (prints to stdout, no mutation):
//   list <tab>                              List blocks in a tab + entry counts
//   keys <tab> <block>                      List entry keys
//   get <tab> <block> <key>                 Print one entry as JSON
//   find <tab> <block> <substring>          Fuzzy search keys + stringified values
//
// Write (authors candidates/<tab>.json — does NOT touch tabs/):
//   rename       <tab> <block> <oldKey> <newKey>           Rename, auto-updates `name` field
//   delete-key   <tab> <block> <key>                       Remove an entry
//   delete-field <tab> <block> <field>                     Strip field from every entry
//   set-field    <tab> <block> <key> <field> <jsonValue>   Patch one field, preserve rest
//
// Write commands always include the FULL entry in the candidate to avoid the
// merge script's one-level deep-merge from clobbering required fields.
//
// Cross-reference renames (the rename-entity command) also patch every place
// the old name was referenced — trait unlockedBy/excludedBy arrays, traitCategories
// listings, ability trait-type requirements — so callers don't have to chase
// references manually.

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '../..');
const tabsDir = path.join(projectRoot, 'tabs');
const candidatesDir = path.join(projectRoot, 'candidates');

function die(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function loadTab(tab) {
  const p = path.join(tabsDir, `${tab}.json`);
  if (!fs.existsSync(p)) die(`No such tab: ${tab} (looked at ${p})`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadCandidate(tab) {
  const p = path.join(candidatesDir, `${tab}.json`);
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveCandidate(tab, data) {
  if (!fs.existsSync(candidatesDir)) fs.mkdirSync(candidatesDir, { recursive: true });
  const p = path.join(candidatesDir, `${tab}.json`);
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

function getBlock(tabData, block) {
  if (!(block in tabData)) {
    die(`Block "${block}" not found in tab. Available: ${Object.keys(tabData).join(', ')}`);
  }
  return tabData[block];
}

function isObjectBlock(b) {
  return b !== null && typeof b === 'object' && !Array.isArray(b);
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

// Effective state: canon merged with pending candidate edits.
// Candidate values overwrite canon by key; `null` in candidate marks a delete.
function loadEffective(tab) {
  const canon = loadTab(tab);
  const cand = loadCandidate(tab);
  for (const [block, blockEdits] of Object.entries(cand)) {
    if (!isObjectBlock(blockEdits)) {
      canon[block] = blockEdits;
      continue;
    }
    if (!isObjectBlock(canon[block])) {
      canon[block] = {};
    }
    for (const [key, value] of Object.entries(blockEdits)) {
      if (value === null) delete canon[block][key];
      else canon[block][key] = value;
    }
  }
  return canon;
}

// ============ Read commands ============

function cmdList(tab) {
  const data = loadEffective(tab);
  for (const [block, value] of Object.entries(data)) {
    if (isObjectBlock(value)) {
      console.log(`${block}: ${Object.keys(value).length} entries`);
    } else if (Array.isArray(value)) {
      console.log(`${block}: array (${value.length})`);
    } else {
      console.log(`${block}: ${typeof value}`);
    }
  }
}

function cmdKeys(tab, block) {
  const b = getBlock(loadEffective(tab), block);
  if (!isObjectBlock(b)) die(`Block "${block}" is not an object`);
  for (const k of Object.keys(b)) console.log(k);
}

function cmdGet(tab, block, key) {
  const b = getBlock(loadEffective(tab), block);
  if (!isObjectBlock(b)) die(`Block "${block}" is not an object`);
  if (!(key in b)) {
    const ks = Object.keys(b);
    die(`Key "${key}" not found. Available (${ks.length}): ${ks.slice(0, 10).join(', ')}${ks.length > 10 ? '...' : ''}`);
  }
  console.log(JSON.stringify(b[key], null, 2));
}

// Scan all tabs for a term. Shows hit locations as JSON paths plus a
// surrounding-text snippet. Use this for cross-tab audits (e.g. "where does
// the term 'mark' appear?", "find every reference to a renamed entity").
function cmdScan(pattern, opts) {
  const flags = opts.caseSensitive ? 'g' : 'gi';
  let re;
  if (opts.regex) {
    re = new RegExp(pattern, flags);
  } else if (opts.word) {
    re = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, flags);
  } else {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&'), flags);
  }

  const ctx = opts.contextChars || 60;
  const tabFiles = fs.readdirSync(tabsDir).filter(f => f.endsWith('.json')).sort();
  let totalHits = 0;

  function walk(node, pathParts, onString) {
    if (typeof node === 'string') {
      onString(pathParts.join('.'), node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, [...pathParts, `[${i}]`], onString));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        walk(v, [...pathParts, k], onString);
      }
    }
  }

  function snippet(text, matchRe) {
    matchRe.lastIndex = 0;
    const m = matchRe.exec(text);
    if (!m) return text.slice(0, ctx * 2);
    const start = Math.max(0, m.index - ctx);
    const end = Math.min(text.length, m.index + m[0].length + ctx);
    let s = text.slice(start, end).replace(/\n/g, ' ');
    if (start > 0) s = '…' + s;
    if (end < text.length) s = s + '…';
    return s;
  }

  for (const file of tabFiles) {
    const tab = file.replace(/\.json$/, '');
    const data = JSON.parse(fs.readFileSync(path.join(tabsDir, file), 'utf8'));
    const hits = [];
    walk(data, [], (jpath, value) => {
      if (re.test(value)) hits.push({ jpath, value });
    });
    if (hits.length > 0) {
      console.log(`--- ${tab}.json (${hits.length} hit${hits.length > 1 ? 's' : ''}) ---`);
      for (const h of hits) {
        console.log(`  ${h.jpath}`);
        console.log(`    ${snippet(h.value, re)}`);
      }
      totalHits += hits.length;
    }
  }
  console.error(`${totalHits} total hit${totalHits === 1 ? '' : 's'} across ${tabFiles.length} tab${tabFiles.length === 1 ? '' : 's'}`);
}

function cmdFind(tab, block, substring) {
  const b = getBlock(loadEffective(tab), block);
  if (!isObjectBlock(b)) die(`Block "${block}" is not an object`);
  const sub = substring.toLowerCase();
  let matches = 0;
  for (const [key, value] of Object.entries(b)) {
    const keyMatch = key.toLowerCase().includes(sub);
    const valueMatch = JSON.stringify(value).toLowerCase().includes(sub);
    if (keyMatch || valueMatch) {
      const where = keyMatch && valueMatch ? 'key+value' : keyMatch ? 'key' : 'value';
      console.log(`${key}  [${where}]`);
      matches++;
    }
  }
  console.error(`${matches} match(es) of ${Object.keys(b).length} entries`);
}

// ============ Write commands ============

function cmdRename(tab, block, oldKey, newKey) {
  const b = getBlock(loadEffective(tab), block);
  if (!isObjectBlock(b)) die(`Block "${block}" is not an object`);
  if (!(oldKey in b)) die(`Key "${oldKey}" not found in ${block}`);
  if (oldKey === newKey) die(`Old and new keys are identical`);

  const entry = clone(b[oldKey]);
  let renamedNameField = false;
  if (entry && typeof entry === 'object' && 'name' in entry) {
    entry.name = newKey;
    renamedNameField = true;
  }

  const cand = loadCandidate(tab);
  cand[block] = cand[block] || {};
  cand[block][oldKey] = null;
  cand[block][newKey] = entry;
  saveCandidate(tab, cand);

  console.log(`renamed ${block}.${oldKey} -> ${newKey} in candidates/${tab}.json`);
  if (renamedNameField) console.log(`  (also updated 'name' field on entry)`);
  console.log(`run: node .claude/scripts/merge-candidates.js`);
}

function cmdDeleteKey(tab, block, key) {
  const b = getBlock(loadEffective(tab), block);
  if (!isObjectBlock(b)) die(`Block "${block}" is not an object`);
  if (!(key in b)) die(`Key "${key}" not found in ${block}`);

  const cand = loadCandidate(tab);
  cand[block] = cand[block] || {};
  cand[block][key] = null;
  saveCandidate(tab, cand);

  console.log(`queued delete ${block}.${key} in candidates/${tab}.json`);
  console.log(`run: node .claude/scripts/merge-candidates.js`);
}

function cmdDeleteField(tab, block, field) {
  const b = getBlock(loadEffective(tab), block);
  if (!isObjectBlock(b)) die(`Block "${block}" is not an object`);

  const cand = loadCandidate(tab);
  cand[block] = cand[block] || {};
  let touched = 0;
  for (const [key, value] of Object.entries(b)) {
    if (value && typeof value === 'object' && field in value) {
      const copy = clone(value);
      delete copy[field];
      cand[block][key] = copy;
      touched++;
    }
  }
  if (!touched) die(`No entry in ${block} has a "${field}" field`);
  saveCandidate(tab, cand);

  console.log(`stripped "${field}" from ${touched} entries in ${block}`);
  console.log(`run: node .claude/scripts/merge-candidates.js`);
}

function cmdSetField(tab, block, key, field, jsonValue) {
  const b = getBlock(loadEffective(tab), block);
  if (!isObjectBlock(b)) die(`Block "${block}" is not an object`);
  if (!(key in b)) die(`Key "${key}" not found in ${block}`);

  let value;
  try { value = JSON.parse(jsonValue); }
  catch (e) { die(`Invalid JSON value: ${jsonValue} (${e.message})`); }

  const cand = loadCandidate(tab);
  cand[block] = cand[block] || {};
  // Build full entry: start from canon, layer any pending candidate edits, apply this patch.
  // Writing the full entry sidesteps merge-candidates.js's one-level deep-merge.
  const entry = clone(b[key]);
  if (cand[block][key] && typeof cand[block][key] === 'object') {
    Object.assign(entry, cand[block][key]);
  }
  entry[field] = value;
  cand[block][key] = entry;
  saveCandidate(tab, cand);

  console.log(`set ${block}.${key}.${field} = ${jsonValue}`);
  console.log(`run: node .claude/scripts/merge-candidates.js`);
}

// ============ Cross-reference renames ============

// Renames the trait entry AND every reference to it across:
//   - other traits' unlockedBy / excludedBy arrays
//   - traitCategories.<*>.traits arrays
//   - abilities.<*>.requirements where type === "trait"
function renameTraitEntity(oldName, newName) {
  if (oldName === newName) die(`Old and new names are identical`);

  const traits = loadEffective('traits');
  if (!traits.traits || !(oldName in traits.traits)) {
    die(`Trait "${oldName}" not found in tabs/traits.json`);
  }

  const traitsCand = loadCandidate('traits');
  traitsCand.traits = traitsCand.traits || {};

  // 1. Rename the trait entry itself
  const entry = clone(traits.traits[oldName]);
  if (entry && typeof entry === 'object' && 'name' in entry) entry.name = newName;
  traitsCand.traits[oldName] = null;
  traitsCand.traits[newName] = entry;

  // 2. Update unlockedBy / excludedBy arrays in OTHER traits
  let crossTraitCount = 0;
  for (const [tname, tdef] of Object.entries(traits.traits)) {
    if (tname === oldName) continue;
    let touched = false;
    const updated = clone(tdef);
    for (const arrField of ['unlockedBy', 'excludedBy']) {
      if (Array.isArray(updated[arrField]) && updated[arrField].includes(oldName)) {
        updated[arrField] = updated[arrField].map(x => x === oldName ? newName : x);
        touched = true;
      }
    }
    if (touched) {
      traitsCand.traits[tname] = updated;
      crossTraitCount++;
    }
  }

  // 3. Update traitCategories.*.traits arrays
  let categoryCount = 0;
  if (traits.traitCategories) {
    traitsCand.traitCategories = traitsCand.traitCategories || {};
    for (const [catName, cat] of Object.entries(traits.traitCategories)) {
      if (Array.isArray(cat.traits) && cat.traits.includes(oldName)) {
        const updated = clone(cat);
        updated.traits = updated.traits.map(x => x === oldName ? newName : x);
        traitsCand.traitCategories[catName] = updated;
        categoryCount++;
      }
    }
  }

  saveCandidate('traits', traitsCand);

  // 4. Update abilities.<*>.requirements[].variable where type === "trait"
  let abilCount = 0;
  const abilities = loadEffective('abilities');
  if (abilities.abilities) {
    const abilCand = loadCandidate('abilities');
    abilCand.abilities = abilCand.abilities || {};
    for (const [aname, adef] of Object.entries(abilities.abilities)) {
      if (!Array.isArray(adef.requirements)) continue;
      const hasRef = adef.requirements.some(r => r && r.type === 'trait' && r.variable === oldName);
      if (!hasRef) continue;
      const updated = clone(adef);
      updated.requirements = updated.requirements.map(r =>
        (r && r.type === 'trait' && r.variable === oldName) ? { ...r, variable: newName } : r
      );
      abilCand.abilities[aname] = updated;
      abilCount++;
    }
    if (abilCount > 0) saveCandidate('abilities', abilCand);
  }

  console.log(`renamed trait: ${oldName} -> ${newName}`);
  console.log(`  + updated ${crossTraitCount} other traits' unlockedBy/excludedBy arrays`);
  console.log(`  + updated ${categoryCount} traitCategories listings`);
  console.log(`  + updated ${abilCount} abilities' trait requirements`);
  console.log(`Candidates written to candidates/. Review then merge with merge-candidates.js.`);
}

function cmdRenameEntity(kind, oldName, newName) {
  switch (kind) {
    case 'trait':
      return renameTraitEntity(oldName, newName);
    default:
      die(`Unsupported kind: ${kind}. Currently supports: trait. (Add more kinds in block-tool.js as needed.)`);
  }
}

// ============ Dispatch ============

const usage = `Usage:
  Read:
    node block-tool.js list <tab>
    node block-tool.js keys <tab> <block>
    node block-tool.js get <tab> <block> <key>
    node block-tool.js find <tab> <block> <substring>
    node block-tool.js scan <pattern> [--word] [--regex] [--case-sensitive]
                                      Cross-tab audit. Shows JSON path + snippet for every hit.
                                      --word wraps pattern in word-boundary anchors.
  Write (authors candidates/<tab>.json):
    node block-tool.js rename        <tab> <block> <oldKey> <newKey>
    node block-tool.js delete-key    <tab> <block> <key>
    node block-tool.js delete-field  <tab> <block> <field>
    node block-tool.js set-field     <tab> <block> <key> <field> <jsonValue>
    node block-tool.js rename-entity <kind> <oldName> <newName>
                                      Renames an entity across all its references.
                                      kinds: trait`;

const args = process.argv.slice(2);
const cmd = args[0];

const dispatch = {
  'list':         { argc: 2, run: () => cmdList(args[1]) },
  'keys':         { argc: 3, run: () => cmdKeys(args[1], args[2]) },
  'get':          { argc: 4, run: () => cmdGet(args[1], args[2], args[3]) },
  'find':         { argc: 4, run: () => cmdFind(args[1], args[2], args[3]) },
  'rename':       { argc: 5, run: () => cmdRename(args[1], args[2], args[3], args[4]) },
  'delete-key':   { argc: 4, run: () => cmdDeleteKey(args[1], args[2], args[3]) },
  'delete-field': { argc: 4, run: () => cmdDeleteField(args[1], args[2], args[3]) },
  'set-field':    { argc: 6, run: () => cmdSetField(args[1], args[2], args[3], args[4], args[5]) },
  'rename-entity':{ argc: 4, run: () => cmdRenameEntity(args[1], args[2], args[3]) },
};

if (!cmd || cmd === '-h' || cmd === '--help') {
  console.log(usage);
  process.exit(0);
}

// scan has variable args (flags) — handle separately
if (cmd === 'scan') {
  const flagArgs = args.slice(1);
  const opts = { regex: false, word: false, caseSensitive: false };
  const positional = [];
  for (const a of flagArgs) {
    if (a === '--regex') opts.regex = true;
    else if (a === '--word') opts.word = true;
    else if (a === '--case-sensitive') opts.caseSensitive = true;
    else if (a.startsWith('--')) die(`Unknown flag: ${a}\n\n${usage}`);
    else positional.push(a);
  }
  if (positional.length !== 1) die(`scan requires exactly one pattern.\n\n${usage}`);
  if (opts.regex && opts.word) die(`--regex and --word are mutually exclusive`);
  cmdScan(positional[0], opts);
  process.exit(0);
}

const handler = dispatch[cmd];
if (!handler) die(`Unknown command: ${cmd}\n\n${usage}`);
if (args.length !== handler.argc) die(`Wrong arg count for "${cmd}".\n\n${usage}`);
handler.run();
