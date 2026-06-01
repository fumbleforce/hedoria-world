import { useState } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import { UPGRADES, UPGRADE_CATEGORIES, UPGRADE_CATEGORY_LABEL, isDecoration } from "../game/shop";
import { activityVisible, purchasableActivities } from "../game/activities";
import { NICHES } from "../game/niches";
import { SEGMENTS } from "../game/segments";
import { CAMERA_SHOP, CAMERA_TIERS } from "../game/cameras";
import {
  CLOTHING_SHOP,
  filterClothingShop,
  type ClothingGenderFilter,
  type ClothingSlotFilter,
} from "../game/items";
import { CLOTHING_SLOTS, clothingSlotLabel, type ClothingSlot } from "../game/wardrobe";
import { useStoredImage } from "../persist/useStoredImage";
import type { Upgrade } from "../game/types";

const pct = (mult: number) => `${mult >= 1 ? "+" : ""}${Math.round((mult - 1) * 100)}%`;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n}`;

const GENDER_FILTERS: { id: ClothingGenderFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "female", label: "Women's" },
  { id: "male", label: "Men's" },
  { id: "unisex", label: "Unisex" },
];

const SLOT_FILTERS: { id: ClothingSlotFilter; label: string }[] = [
  { id: "all", label: "All slots" },
  ...CLOTHING_SLOTS.map((slot) => ({ id: slot as ClothingSlotFilter, label: clothingSlotLabel(slot) })),
];

/** Human-readable stat chips for a gear/furniture/apartment upgrade. */
function upgradeStats(u: Upgrade): string[] {
  const e = u.effects;
  const out: string[] = [];
  if (e.viewerMult && e.viewerMult !== 1) out.push(`${pct(e.viewerMult)} viewers`);
  if (e.hypeMult && e.hypeMult !== 1) out.push(`${pct(e.hypeMult)} hype`);
  if (e.incomeMult && e.incomeMult !== 1) out.push(`${pct(e.incomeMult)} income`);
  if (e.productionQuality) out.push(`${signed(e.productionQuality)} production`);
  if (e.comfortPerDay) out.push(`${signed(e.comfortPerDay)} comfort/day`);
  if (e.rentPerDay) out.push(`-$${e.rentPerDay}/day rent`);
  if (e.segmentAppeal) {
    for (const [seg, v] of Object.entries(e.segmentAppeal)) {
      if (v) out.push(`${SEGMENTS[seg as keyof typeof SEGMENTS].label} ${signed(v)} appeal`);
    }
  }
  return out;
}

function UpgradeShopCard({
  u,
  have,
  afford,
  controller,
}: {
  u: Upgrade;
  have: boolean;
  afford: boolean;
  controller: GameController;
}) {
  const decor = isDecoration(u);
  const previewId = useStore((s) => (decor ? s.decorationImages[u.id] : undefined));
  const preview = useStoredImage(previewId);
  const imageBusy = useStore((s) => s.imageBusy);
  const canGen = controller.canGenerateImages;
  const stats = upgradeStats(u);

  return (
    <div className={`shop__item ${have ? "shop__item--owned" : ""}`}>
      {decor && (
        <div className="shop__decorThumb">
          {preview ? (
            <img src={preview} alt={`${u.name} preview`} />
          ) : (
            <span className="shop__decorPlaceholder">no preview yet</span>
          )}
        </div>
      )}
      <div className="shop__name">{u.name}</div>
      <div className="shop__desc">{u.description}</div>
      {stats.length > 0 && (
        <div className="shop__stats">
          {stats.map((s, i) => (
            <span key={i} className="shop__stat">{s}</span>
          ))}
        </div>
      )}
      {decor && canGen && (
        <button
          className={`btn btn--mini ${imageBusy ? "is-loading" : ""}`}
          disabled={!!imageBusy}
          onClick={() => void controller.visualizeDecoration(u.id, !!preview)}
        >
          {preview ? "↻ Regenerate preview" : "👁 Visualize"}
        </button>
      )}
      <button
        className="btn btn--primary"
        disabled={have || !afford}
        onClick={() => controller.buyUpgrade(u.id)}
      >
        {have ? "Owned" : `Buy · $${u.cost}`}
      </button>
    </div>
  );
}

export function ShopPanel({ controller }: { controller: GameController }) {
  const open = useStore((s) => s.shopOpen);
  const owned = useStore((s) => s.ownedUpgrades);
  const ownedActivities = useStore((s) => s.ownedActivities);
  const cameras = useStore((s) => s.cameras);
  const cash = useStore((s) => s.metrics.cash);
  const contentTier = useStore((s) => s.settings.contentTier);
  const [genderFilter, setGenderFilter] = useState<ClothingGenderFilter>("all");
  const [slotFilter, setSlotFilter] = useState<ClothingSlotFilter>("all");
  if (!open) return null;

  const cats = UPGRADE_CATEGORIES;
  const library = purchasableActivities().filter((a) => activityVisible(a, contentTier, cameras));
  const hasPortable = cameras.some((c) => c.portable);
  const clothingItems = filterClothingShop(CLOTHING_SHOP, {
    gender: genderFilter,
    slot: slotFilter,
    tier: contentTier,
  });

  return (
    <div className="modal" onClick={() => useStore.getState().setShopOpen(false)}>
      <div className="modal__card modal__card--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>📦 Online Shop</h2>
          <span className="modal__cash">${cash.toFixed(0)}</span>
          <button className="modal__close" onClick={() => useStore.getState().setShopOpen(false)}>
            ✕
          </button>
        </div>

        <div className="shop__group">
          <h3>📷 Cameras</h3>
          <div className="shop__grid">
            {CAMERA_SHOP.map((c) => {
              const have = c.portable ? hasPortable : false;
              const afford = cash >= c.cost;
              const tier = CAMERA_TIERS[c.tier];
              return (
                <div key={c.id} className={`shop__item ${have ? "shop__item--owned" : ""}`}>
                  <div className="shop__name">{c.name}</div>
                  <div className="shop__desc">{c.description}</div>
                  <div className="shop__stats">
                    <span className="shop__stat">{tier.label} · quality {tier.quality}/3</span>
                    {tier.viewerMult !== 1 && (
                      <span className="shop__stat">{pct(tier.viewerMult)} viewers</span>
                    )}
                    {tier.hypeMult !== 1 && (
                      <span className="shop__stat">{pct(tier.hypeMult)} hype</span>
                    )}
                    {c.portable && <span className="shop__stat">Go live anywhere</span>}
                  </div>
                  <button
                    className="btn btn--primary"
                    disabled={have || !afford}
                    onClick={() => controller.buyCamera(c.id)}
                  >
                    {have ? "Owned" : `Buy · $${c.cost}`}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="shop__group shop__group--clothing">
          <h3>👗 Clothing</h3>
          <div className="shop__filters">
            <div className="shop__filterRow">
              <span className="shop__filterLabel">Style</span>
              <div className="shop__filterTabs">
                {GENDER_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`tab pick ${genderFilter === f.id ? "pick--selected" : ""}`}
                    onClick={() => setGenderFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="shop__filterRow">
              <span className="shop__filterLabel">Slot</span>
              <div className="shop__filterTabs shop__filterTabs--wrap">
                {SLOT_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`tab pick ${slotFilter === f.id ? "pick--selected" : ""}`}
                    onClick={() => setSlotFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {clothingItems.length === 0 ? (
            <p className="hint shop__hint">No pieces match these filters.</p>
          ) : (
            <div className="shop__grid">
              {clothingItems.map((c) => {
                const afford = cash >= c.cost;
                return (
                  <div key={c.id} className="shop__item">
                    <div className="shop__name">{c.name}</div>
                    <div className="shop__desc">{c.description}</div>
                    <div className="shop__stats">
                      <span className="shop__stat">{clothingSlotLabel(c.slot)}</span>
                      {c.gender !== "unisex" && (
                        <span className="shop__stat">
                          {c.gender === "female" ? "Women's" : "Men's"}
                        </span>
                      )}
                      {Object.entries(c.vibes).map(([v, n]) => (
                        <span key={v} className="shop__stat shop__stat--vibe">
                          {v} {signed(n as number)}
                        </span>
                      ))}
                    </div>
                    <button
                      className="btn btn--primary"
                      disabled={!afford}
                      onClick={() => controller.buyClothing(c.id)}
                    >
                      Buy · ${c.cost}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {library.length > 0 && (
          <div className="shop__group">
            <h3>Game Library</h3>
            <div className="shop__grid">
              {library.map((a) => {
                const have = ownedActivities.includes(a.id);
                const afford = cash >= (a.cost ?? 0);
                const pleases = a.pleases.map((p) => SEGMENTS[p].label).join(", ");
                const niches = a.nicheSynergy?.map((n) => NICHES[n].label).join(", ");
                return (
                  <div key={a.id} className={`shop__item ${have ? "shop__item--owned" : ""}`}>
                    <div className="shop__name">{a.emoji} {a.name}</div>
                    <div className="shop__desc">{a.blurb}</div>
                    {pleases && <div className="shop__meta">Pleases: {pleases}</div>}
                    {niches && <div className="shop__meta">Synergy: {niches}</div>}
                    <button
                      className="btn btn--primary"
                      disabled={have || !afford}
                      onClick={() => controller.buyActivity(a.id)}
                    >
                      {have ? "Owned" : `Buy · $${a.cost}`}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {cats.map((cat) => (
          <div key={cat} className="shop__group">
            <h3>{UPGRADE_CATEGORY_LABEL[cat]}</h3>
            {cat === "furniture" && (
              <p className="hint shop__hint">
                Décor builds audience appeal over time. Visualize items before buying — owned previews appear in generated room art.
              </p>
            )}
            <div className="shop__grid">
              {UPGRADES.filter((u) => u.category === cat).map((u) => (
                <UpgradeShopCard
                  key={u.id}
                  u={u}
                  have={owned.includes(u.id)}
                  afford={cash >= u.cost}
                  controller={controller}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
