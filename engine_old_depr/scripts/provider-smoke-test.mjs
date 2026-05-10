import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const configPath = path.resolve(root, "config.json");

function hasKey(name) {
  return typeof process.env[name] === "string" && process.env[name].length > 0;
}

async function main() {
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  const deathPrompt = config.death?.instructions ?? "";
  const report = {
    promptLength: deathPrompt.length,
    checks: [
      {
        provider: "gemini-2.5-flash",
        env: "GEMINI_API_KEY",
        ready: hasKey("GEMINI_API_KEY"),
      },
      {
        provider: "claude-haiku-4.5",
        env: "ANTHROPIC_API_KEY",
        ready: hasKey("ANTHROPIC_API_KEY"),
      },
      {
        provider: "llama-3.1-70b (ollama)",
        env: "OLLAMA_BASE_URL",
        ready: hasKey("OLLAMA_BASE_URL"),
      },
    ],
  };

  await fs.mkdir(path.resolve(root, "engine", "public", "reports"), { recursive: true });
  const outPath = path.resolve(root, "engine", "public", "reports", "provider-smoke-test.json");
  await fs.writeFile(outPath, JSON.stringify(report, null, 2));
  console.log(`Wrote smoke test readiness report: ${outPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
