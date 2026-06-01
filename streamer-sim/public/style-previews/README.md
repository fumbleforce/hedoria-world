# Baked art-style previews

Static thumbnails for the art-style presets shown in onboarding and Settings.
Files here are served at `/style-previews/<file>` in dev (Vite) and prod
(Cloudflare Workers serves the copied `dist/` output).

Save one image per preset, named exactly by its preset id:

- `cozy-neon.png`
- `anime-cel.png`
- `graphic-novel.png`
- `semi-real.png`
- `retro-sim.png`
- `pixel-art.png`
- `storybook.png`
- `synthwave.png`
- `claymation.png`
- `papercraft.png`

Square images. `.png` or `.webp` both work — keep the extension consistent with
what the UI resolves (see `bakedStylePreviewUrl` in `src/llm/imagePresets.ts`).
