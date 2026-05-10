import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const engineRoot = path.resolve(root, "engine");

async function readJsonIfExists(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

async function readSceneScope(packDir, scope) {
  const dir = path.join(packDir, "scenes", scope);
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if (err && err.code === "ENOENT") return {};
    throw err;
  }
  const out = {};
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const full = path.join(dir, entry);
    const json = await readJsonIfExists(full);
    if (!json) continue;
    const id = entry.replace(/\.json$/u, "");
    out[id] = json;
  }
  return out;
}

async function readScenesBundle(packName) {
  const packDir = path.resolve(root, "packs", packName);
  const regions = await readSceneScope(packDir, "regions");
  const locations = await readSceneScope(packDir, "locations");
  const areas = await readSceneScope(packDir, "areas");
  return { regions, locations, areas };
}

function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, value] = arg.split("=");
      return [key.replace(/^--/, ""), value ?? "true"];
    }),
  );
  return {
    mode: args.mode ?? "soft",
    pack: args.pack ?? "hedoria",
  };
}

function collectWarnings(world) {
  const warnings = [];
  const enumValues = {
    "locations.detailType": [...new Set(Object.values(world.locations ?? {}).map((x) => x.detailType))].sort(),
    "locations.complexityType": [...new Set(Object.values(world.locations ?? {}).map((x) => x.complexityType))].sort(),
    "npcs.tier": [...new Set(Object.values(world.npcs ?? {}).map((x) => x.tier))].sort(),
  };

  for (const [npcId, npc] of Object.entries(world.npcs ?? {})) {
    if (npc.faction && !world.factions?.[npc.faction]) {
      warnings.push(`dangling faction: npcs.${npcId}.faction -> ${npc.faction}`);
    }
    if (npc.currentLocation && !world.locations?.[npc.currentLocation]) {
      warnings.push(`dangling location: npcs.${npcId}.currentLocation -> ${npc.currentLocation}`);
    }
  }

  return { warnings, enumValues };
}

async function readPack(packName) {
  if (packName === "hedoria") {
    const fullConfigPath = path.resolve(root, "config.json");
    return JSON.parse(await fs.readFile(fullConfigPath, "utf8"));
  }
  const tinyworldPath = path.resolve(root, "packs", "tinyworld", "world.json");
  return JSON.parse(await fs.readFile(tinyworldPath, "utf8"));
}

async function main() {
  const { mode, pack } = parseArgs();
  const world = await readPack(pack);
  const { warnings, enumValues } = collectWarnings(world);

  const bundleDir = path.resolve(engineRoot, "public", "bundles");
  await fs.mkdir(bundleDir, { recursive: true });
  const worldBundle = {
    packId: pack,
    generatedAt: new Date().toISOString(),
    mode,
    data: world,
  };
  await fs.writeFile(path.join(bundleDir, "world.bundle.json"), JSON.stringify(worldBundle, null, 2));
  await fs.writeFile(
    path.join(bundleDir, "systems.bundle.json"),
    JSON.stringify(
      {
        combatSettings: world.combatSettings ?? {},
        resourceSettings: world.resourceSettings ?? {},
        attributeSettings: world.attributeSettings ?? {},
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(bundleDir, "content-index.json"),
    JSON.stringify(
      {
        locations: Object.keys(world.locations ?? {}),
        regions: Object.keys(world.regions ?? {}),
        npcs: Object.keys(world.npcs ?? {}),
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(bundleDir, "asset-bindings.json"),
    JSON.stringify(
      {
        biomes: {},
        silhouettes: {},
      },
      null,
      2,
    ),
  );

  const scenes = await readScenesBundle(pack);
  const scenesBundle = {
    packId: pack,
    generatedAt: new Date().toISOString(),
    scenes,
  };
  await fs.writeFile(
    path.join(bundleDir, "scenes.bundle.json"),
    JSON.stringify(scenesBundle, null, 2),
  );

  const textureSrc = path.resolve(root, "packs", pack, "assets", "textures");
  const textureDst = path.resolve(engineRoot, "public", "textures");
  let textures = [];
  try {
    const entries = await fs.readdir(textureSrc);
    await fs.mkdir(textureDst, { recursive: true });
    for (const entry of entries) {
      if (!entry.endsWith(".png")) continue;
      await fs.copyFile(path.join(textureSrc, entry), path.join(textureDst, entry));
      textures.push(entry);
    }
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
  }
  await fs.writeFile(
    path.join(bundleDir, "texture-index.json"),
    JSON.stringify(
      {
        packId: pack,
        generatedAt: new Date().toISOString(),
        baseUrl: "/textures/",
        keys: textures.map((file) => file.replace(/\.png$/u, "")).sort(),
      },
      null,
      2,
    ),
  );

  const diagnostics = {
    mode,
    warnings,
    errors: [],
    enumValues,
  };

  if (mode === "strict" && warnings.length > 0) {
    diagnostics.errors.push(...warnings);
    await fs.writeFile(path.join(bundleDir, "_diagnostics.json"), JSON.stringify(diagnostics, null, 2));
    throw new Error(`Strict compile failed with ${warnings.length} warning(s).`);
  }

  await fs.writeFile(path.join(bundleDir, "_diagnostics.json"), JSON.stringify(diagnostics, null, 2));
  console.log(`Compiled pack '${pack}' in ${mode} mode with ${warnings.length} warning(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
