import { db } from "../../persist/db";

const PORTRAIT_STORE_KEY = "portrait-v1";

function deterministicColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const color = Math.abs(hash % 0xffffff);
  return `#${color.toString(16).padStart(6, "0")}`;
}

function svgPortrait(name: string): string {
  const color = deterministicColor(name);
  const initials = name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">
  <rect width="128" height="128" fill="${color}" />
  <text x="64" y="72" font-size="42" text-anchor="middle" fill="white" font-family="Arial">${initials}</text>
</svg>
`.trim();
}

export async function getOrCreatePortraitDataUrl(entityName: string): Promise<string> {
  const key = `${PORTRAIT_STORE_KEY}:${entityName}`;
  const existing = (await db.meta.get(key))?.value;
  if (typeof existing === "string") {
    return existing;
  }
  const svg = svgPortrait(entityName);
  const dataUrl = `data:image/svg+xml;base64,${btoa(svg)}`;
  await db.meta.put({ key, value: dataUrl });
  return dataUrl;
}
