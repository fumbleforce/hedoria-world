import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const engineRoot = path.resolve(root, "engine");

/**
 * Tiny dotenv loader. Reads `engine/.env` and `engine/.env.local` (in Vite's
 * priority order: `.env.local` wins) and merges KEY=VALUE pairs into
 * process.env, without overwriting variables that are already set in the
 * shell. Lets a single `engine/.env` file power both the browser bundle
 * (Vite picks it up natively) and this Node CLI.
 *
 * Supports: `KEY=value`, `KEY="value with spaces"`, `KEY='value'`,
 * comments starting with `#`, blank lines.
 * Does NOT support: variable interpolation, multi-line values.
 */
function loadDotEnv() {
  const candidates = [".env", ".env.local"];
  for (const file of candidates) {
    const fullPath = path.resolve(engineRoot, file);
    if (!fsSync.existsSync(fullPath)) continue;
    const text = fsSync.readFileSync(fullPath, "utf8");
    for (const rawLine of text.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined || process.env[key] === "") {
        process.env[key] = value;
      }
    }
  }
}

loadDotEnv();

// Resolve the API key from any of the supported sources (shell or .env).
// VITE_-prefixed name is preferred so a single key powers browser + script.
const RESOLVED_API_KEY =
  process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
const RESOLVED_IMAGE_MODEL =
  process.env.VITE_GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image-preview";

// Mirrored verbatim from engine/src/scene/sceneSpec.ts. Keep in sync — the
// `lint:no-world-names` script checks for obvious drift.
const SURFACE_MATERIALS = [
  "stone",
  "earth",
  "sand",
  "metal",
  "wood",
  "water",
  "ice",
  "crystal",
  "energy",
  "void",
];
const SURFACE_CONDITIONS = ["pristine", "worn", "ruined", "scorched", "overgrown"];

const MATERIAL_DESCRIPTIONS = {
  stone: "natural stone surface, slabs and aggregate, subtle veining",
  earth: "packed soil and grass tussocks, organic earth texture",
  sand: "wind-shaped grains and shallow ripples",
  metal: "machined metal panels with seams and rivets",
  wood: "planks with visible grain and weathering",
  water: "still water surface with faint ripples",
  ice: "polycrystalline ice with refractive flecks",
  crystal: "tightly packed crystal facets, prismatic highlights",
  energy: "abstract energy field, soft glow, faint particles",
  void: "dim, near-featureless void surface, faint ambient sheen",
};

const CONDITION_DESCRIPTIONS = {
  pristine: "clean, well-kept, intact",
  worn: "weathered, faintly cracked, dust in seams",
  ruined: "broken, cracked, partially fallen, debris and gaps",
  scorched: "burnt, blackened, soot streaks, heat damage",
  overgrown: "moss, vines, lichen creeping across, organic fingers",
};

function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, value] = arg.split("=");
      return [key.replace(/^--/, ""), value ?? "true"];
    }),
  );
  return {
    pack: args.pack ?? "tinyworld",
    width: Number(args.width ?? 512),
    height: Number(args.height ?? 512),
    force: args.force === "true",
    mode: args.mode ?? (RESOLVED_API_KEY ? "live" : "mock"),
    model: args.model ?? RESOLVED_IMAGE_MODEL,
  };
}

function buildPrompt(material, condition) {
  return [
    `Material: ${material} — ${MATERIAL_DESCRIPTIONS[material]}.`,
    `Condition: ${condition} — ${CONDITION_DESCRIPTIONS[condition]}.`,
    "Output: one seamless tiling texture suitable for a flat ground plane, no objects, no people, no text, no genre-specific motifs.",
  ].join("\n");
}

async function liveGenerate(prompt, width, height, model) {
  const apiKey = RESOLVED_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No Gemini API key found. Set VITE_GEMINI_API_KEY in engine/.env (or GEMINI_API_KEY in the shell).",
    );
  }
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio: width === height ? "1:1" : `${width}:${height}`,
      },
    },
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini Image API ${response.status}: ${text.slice(0, 300)}`);
  }
  const json = await response.json();
  const part = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) {
    throw new Error("Gemini Image API: no inline image data in response");
  }
  return Buffer.from(part.inlineData.data, "base64");
}

function mockSolidPng(seedString, width, height) {
  let h = 2166136261;
  for (let i = 0; i < seedString.length; i += 1) {
    h ^= seedString.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const r = (h >> 16) & 0xff;
  const g = (h >> 8) & 0xff;
  const b = h & 0xff;
  return solidPng(width, height, [r, g, b]);
}

function solidPng(width, height, color) {
  const rgba = Buffer.alloc(width * height * 4 + height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    rgba[offset] = 0;
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = 255;
      offset += 4;
    }
  }
  return encodePngFromRaw(width, height, rgba);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function encodePngFromRaw(width, height, rawWithFilters) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlibStore(rawWithFilters);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(len + 12);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, "ascii");
  data.copy(buf, 8);
  const crc = crc32(buf.subarray(4, 8 + len));
  buf.writeUInt32BE(crc >>> 0, 8 + len);
  return buf;
}

function zlibStore(raw) {
  const blocks = [];
  let i = 0;
  while (i < raw.length) {
    const remaining = raw.length - i;
    const blockLen = Math.min(remaining, 0xffff);
    const isFinal = i + blockLen >= raw.length ? 1 : 0;
    const header = Buffer.alloc(5);
    header[0] = isFinal;
    header[1] = blockLen & 0xff;
    header[2] = (blockLen >> 8) & 0xff;
    const negLen = (~blockLen) & 0xffff;
    header[3] = negLen & 0xff;
    header[4] = (negLen >> 8) & 0xff;
    blocks.push(header);
    blocks.push(raw.subarray(i, i + blockLen));
    i += blockLen;
  }
  const adler = adler32(raw);
  const adlerBuf = Buffer.alloc(4);
  adlerBuf.writeUInt32BE(adler >>> 0, 0);
  return Buffer.concat([Buffer.from([0x78, 0x01]), ...blocks, adlerBuf]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(buf) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i += 1) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

async function main() {
  const { pack, width, height, force, mode, model } = parseArgs();
  const outDir = path.resolve(root, "packs", pack, "assets", "textures");
  await fs.mkdir(outDir, { recursive: true });
  const items = [];
  for (const material of SURFACE_MATERIALS) {
    for (const condition of SURFACE_CONDITIONS) {
      items.push({ material, condition, key: `${material}-${condition}` });
    }
  }
  process.stdout.write(
    `[prebake] mode=${mode}${mode === "live" ? ` model=${model}` : ""} pack=${pack} ${width}x${height} force=${force}\n`,
  );
  let written = 0;
  let skipped = 0;
  for (const item of items) {
    const outPath = path.join(outDir, `${item.key}.png`);
    if (!force) {
      try {
        await fs.access(outPath);
        skipped += 1;
        continue;
      } catch {
        // not found, proceed
      }
    }
    const prompt = buildPrompt(item.material, item.condition);
    let bytes;
    if (mode === "live") {
      try {
        bytes = await liveGenerate(prompt, width, height, model);
      } catch (err) {
        console.warn(`[prebake] live generate failed for ${item.key}: ${err.message}; falling back to mock`);
        bytes = mockSolidPng(item.key, width, height);
      }
    } else {
      bytes = mockSolidPng(item.key, width, height);
    }
    await fs.writeFile(outPath, bytes);
    written += 1;
    process.stdout.write(`[prebake] ${mode}: wrote ${item.key}.png\n`);
  }
  process.stdout.write(`[prebake] done — ${written} written, ${skipped} skipped (use --force to overwrite)\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
