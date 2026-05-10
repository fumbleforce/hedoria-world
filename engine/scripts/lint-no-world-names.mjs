import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const srcRoot = path.resolve(root, "src");

const banned = ["Avenor", "Hedoria", "Sephilia", "Quelled", "Brotherhood"];
const allowedPath = path.normalize(path.resolve(root, "..", "packs", "hedoria"));

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await listFiles(full)));
    } else if (/\.(ts|tsx|js|mjs|json)$/.test(entry.name)) {
      output.push(full);
    }
  }
  return output;
}

async function main() {
  const files = await listFiles(srcRoot);
  const violations = [];
  for (const file of files) {
    if (path.normalize(file).startsWith(allowedPath)) continue;
    const text = await fs.readFile(file, "utf8");
    for (const term of banned) {
      if (text.includes(term)) {
        violations.push(`${path.relative(root, file)} contains banned world-specific token '${term}'`);
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(violations.join("\n"));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
