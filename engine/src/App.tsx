import { useEffect, useState } from "react";
import { boot, type BootResult } from "./boot";
import { useStore } from "./state/store";
import { RegionMap } from "./ui/RegionMap";
import { LocationMap } from "./ui/LocationMap";
import { SceneView } from "./ui/SceneView";
import { ShopPanel } from "./ui/ShopPanel";
import { InventoryPanel } from "./ui/InventoryPanel";
import { CharacterPanel } from "./ui/CharacterPanel";
import { DbInspector } from "./ui/DbInspector";
import { NarrationPanel } from "./ui/NarrationPanel";
import { ActionPrompt } from "./ui/ActionPrompt";
import { LoadingPill } from "./ui/LoadingPill";
import { SettingsPanel } from "./ui/SettingsPanel";

/**
 * Top-level mode router + HUD. The map is the only thing that occupies the
 * full viewport — every other piece of UI is a translucent overlay drawn on
 * top: the HUD strip clings to the top edge, the side rail floats at the
 * top-right with the active quests / region brief, and a thin hint sits at
 * the bottom. This is a "game with a UI on top" rather than "a website with
 * a map embedded in it".
 *
 * Boot runs once on mount. While it's resolving we show a small centered
 * boot card; if it fails we surface the error and stop rather than
 * rendering with a half-initialised store.
 */
export function App() {
  const [services, setServices] = useState<BootResult | null>(null);
  const [showInventory, setShowInventory] = useState(false);
  const [showCharacter, setShowCharacter] = useState(false);
  const [showDb, setShowDb] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const mode = useStore((s) => s.mode);
  const currentRegionId = useStore((s) => s.currentRegionId);
  const regionPos = useStore((s) => s.regionPos);
  const currentLocationId = useStore((s) => s.currentLocationId);
  const locationPos = useStore((s) => s.locationPos);
  const bootError = useStore((s) => s.bootError);
  const isLlmReady = useStore((s) => s.isLlmReady);
  const shop = useStore((s) => s.shop);
  const inventory = useStore((s) => s.inventory);
  const activeQuestIds = useStore((s) => s.activeQuestIds);
  const generating = useStore((s) => s.generating);
  const character = useStore((s) => s.character);
  const availablePacks = useStore((s) => s.availablePacks);
  const currentPackId = useStore((s) => s.currentPackId);
  const setCurrentPackId = useStore((s) => s.setCurrentPackId);

  useEffect(() => {
    let cancelled = false;
    void boot().then((result) => {
      if (!cancelled) setServices(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (bootError) {
    return (
      <div className="app">
        <div className="bootScreen">
          <div className="bootScreen__card">
            <span className="bootScreen__title">LLMRPG</span>
            <div style={{ color: "var(--danger)", marginBottom: 12 }}>
              Boot failed
            </div>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                textAlign: "left",
                fontSize: "0.78em",
                color: "var(--fg-2)",
                maxWidth: 480,
              }}
            >
              {bootError}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  if (!services) {
    return (
      <div className="app">
        <div className="bootScreen">
          <div className="bootScreen__card">
            <span className="bootScreen__title">LLMRPG</span>
            booting…
          </div>
        </div>
      </div>
    );
  }

  const { narrator, worldNarrator, tileImageCache, tileFiller, llm, imageProvider, world } =
    services;
  const isGeneratingRegion = !!generating.regionGridFor;
  const isGeneratingLocation = !!generating.locationGridFor;

  // Switching authored worlds rewires everything (config hash, save
  // row, tile cache, region anchors), so the cheapest correct path is
  // to persist the choice and reload. We push `?pack=<id>` to the URL
  // first so the new boot picks it up via the URL-param branch in
  // `resolvePackId` even before localStorage is read.
  const onSwitchPack = (nextPackId: string) => {
    if (!nextPackId || nextPackId === currentPackId) return;
    setCurrentPackId(nextPackId);
    const url = new URL(window.location.href);
    url.searchParams.set("pack", nextPackId);
    window.location.assign(url.toString());
  };

  // Crumb summary — shows the current locale, e.g. "Avenor → Red Harvest".
  const locationName = currentLocationId
    ? (world.locations[currentLocationId]?.name ?? currentLocationId)
    : null;
  const regionName = currentRegionId
    ? (world.regionsById[currentRegionId]?.name ?? currentRegionId)
    : "—";

  const bottomHint =
    mode === "scene"
      ? "Type an action below or use a group button · narration appears in the log"
      : null;

  return (
    <div className="app">
      <div className="app__canvas">
        {mode === "region" ? (
          <RegionMap
            imageCache={tileImageCache}
            worldNarrator={worldNarrator}
          />
        ) : null}
        {mode === "location" ? (
          <LocationMap
            imageCache={tileImageCache}
            worldNarrator={worldNarrator}
          />
        ) : null}
        {mode === "scene" ? <SceneView worldNarrator={worldNarrator} /> : null}
      </div>

      <NarrationPanel />

      <ActionPrompt worldNarrator={worldNarrator} />

      <header className="hud">
        <span className="hud__title">LLMRPG</span>
        {availablePacks.length > 0 ? (
          <label
            className="hud__pack"
            title="Switch to a different authored world. Each pack keeps its own save data."
          >
            <span className="hud__packLabel">World</span>
            <select
              className="hud__packSelect"
              value={currentPackId ?? ""}
              onChange={(e) => onSwitchPack(e.target.value)}
            >
              {availablePacks.map((p) => (
                <option key={p.packId} value={p.packId}>
                  {p.packName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span className="hud__crumbs">
          <span className="hud__crumb hud__crumb--strong">{regionName}</span>
          <span className="hud__sep">
            ({regionPos[0]},{regionPos[1]})
          </span>
          {locationName ? (
            <>
              <span className="hud__sep">›</span>
              <span className="hud__crumb hud__crumb--strong">
                {locationName}
              </span>
              <span className="hud__sep">
                ({locationPos[0]},{locationPos[1]})
              </span>
            </>
          ) : null}
          <span className="hud__sep">·</span>
          <span className="hud__crumb">mode: {mode}</span>
          {isGeneratingRegion ? <LoadingPill label="Building region" /> : null}
          {isGeneratingLocation ? (
            <LoadingPill label={`Building ${generating.locationGridFor}`} />
          ) : null}
        </span>
        <span className="hud__chip">
          {inventory.currency.gold}g {inventory.currency.silver}s{" "}
          {inventory.currency.copper}c
        </span>
        <span
          className={`hud__chip ${isLlmReady ? "hud__chip--live" : "hud__chip--mock"}`}
        >
          {isLlmReady ? "Live" : "Mock"}
        </span>
        <div className="hud__actions">
          {mode === "location" ? (
            <button
              type="button"
              onClick={() =>
                void worldNarrator.submitPlayerIntent({
                  kind: "location.leave",
                })
              }
            >
              Leave
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            title="Tile images, Gemini models, redraw & rebuild"
          >
            Settings
          </button>
          <button
            type="button"
            onClick={() => setShowCharacter(true)}
            title={
              character
                ? `${character.name} — view or edit your character`
                : "Create your character"
            }
          >
            {character?.name ? character.name : "Character"}
          </button>
          <button type="button" onClick={() => setShowInventory(true)}>
            Inventory
          </button>
          <button type="button" onClick={() => setShowDb(true)}>
            DB
          </button>
        </div>
      </header>

      <aside className="sideRail">
        {character ? (
          <section
            className="sideRail__card sideRail__card--character"
            onClick={() => setShowCharacter(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setShowCharacter(true);
              }
            }}
          >
            <div className="sideRail__charRow">
              <div className="sideRail__charAvatar">
                {character.portraitDataUrl ? (
                  <img
                    src={character.portraitDataUrl}
                    alt={`${character.name} portrait`}
                  />
                ) : (
                  <span aria-hidden="true">
                    {(character.name || "?")
                      .split(/\s+/)
                      .map((p) => p.charAt(0).toUpperCase())
                      .slice(0, 2)
                      .join("")}
                  </span>
                )}
              </div>
              <div className="sideRail__charText">
                <strong>{character.name || "Unnamed"}</strong>
                {character.background ? (
                  <p>{character.background.slice(0, 140)}{character.background.length > 140 ? "…" : ""}</p>
                ) : (
                  <p className="sideRail__hint">(no background written)</p>
                )}
              </div>
            </div>
          </section>
        ) : (
          <section className="sideRail__card">
            <h2>Character</h2>
            <p className="sideRail__hint">No character yet.</p>
            <button
              type="button"
              onClick={() => setShowCharacter(true)}
              style={{ marginTop: 6 }}
            >
              Create one
            </button>
          </section>
        )}

        <section className="sideRail__card">
          <h2>Active Quests</h2>
          {activeQuestIds.length === 0 ? (
            <p className="sideRail__hint">None.</p>
          ) : (
            <ul>
              {activeQuestIds.map((qid) => {
                const quest = world.world.quests[qid];
                if (!quest) return null;
                return (
                  <li key={qid}>
                    <strong>{quest.name ?? qid}</strong>
                    <div
                      style={{
                        fontSize: "0.86em",
                        color: "var(--fg-2)",
                        lineHeight: 1.4,
                        marginTop: 2,
                      }}
                    >
                      {quest.questStatement}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="sideRail__card">
          <h2>
            Region <small>{regionName}</small>
          </h2>
          <p className="sideRail__brief">
            {world.regionsById[currentRegionId]?.basicInfo?.slice(0, 600) ??
              "(no prose authored)"}
          </p>
        </section>
      </aside>

      {bottomHint ? <div className="bottomHint">{bottomHint}</div> : null}

      {shop ? <ShopPanel narrator={narrator} world={world} /> : null}
      {showInventory ? (
        <InventoryPanel
          narrator={narrator}
          world={world}
          onClose={() => setShowInventory(false)}
        />
      ) : null}
      {showCharacter ? (
        <CharacterPanel
          imageProvider={imageProvider}
          onClose={() => setShowCharacter(false)}
        />
      ) : null}
      {showDb ? <DbInspector onClose={() => setShowDb(false)} /> : null}
      {showSettings ? (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          tileImageCache={tileImageCache}
          tileFiller={tileFiller}
          llm={llm}
          world={world}
        />
      ) : null}
    </div>
  );
}
