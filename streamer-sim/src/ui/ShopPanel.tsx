import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import { UPGRADES } from "../game/shop";
import { purchasableActivities } from "../game/activities";
import { NICHES } from "../game/niches";
import { SEGMENTS } from "../game/segments";
import { CAMERA_SHOP, CAMERA_TIERS } from "../game/cameras";
import { CLOTHING_SHOP } from "../game/items";
import { clothingSlotLabel } from "../game/wardrobe";
import type { Upgrade, UpgradeCategory } from "../game/types";

const CATEGORY_LABEL: Record<UpgradeCategory, string> = {
  gear: "Gear",
  furniture: "Furniture",
  apartment: "Apartment",
};

const pct = (mult: number) => `${mult >= 1 ? "+" : ""}${Math.round((mult - 1) * 100)}%`;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n}`;

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

export function ShopPanel({ controller }: { controller: GameController }) {
  const open = useStore((s) => s.shopOpen);
  const owned = useStore((s) => s.ownedUpgrades);
  const ownedActivities = useStore((s) => s.ownedActivities);
  const cameras = useStore((s) => s.cameras);
  const cash = useStore((s) => s.metrics.cash);
  if (!open) return null;

  const cats: UpgradeCategory[] = ["gear", "furniture", "apartment"];
  const library = purchasableActivities();
  const hasPortable = cameras.some((c) => c.portable);

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

        <div className="shop__group">
          <h3>👗 Clothing</h3>
          <div className="shop__grid">
            {CLOTHING_SHOP.map((c) => {
              const afford = cash >= c.cost;
              return (
                <div key={c.id} className="shop__item">
                  <div className="shop__name">{c.name}</div>
                  <div className="shop__desc">{c.description}</div>
                  <div className="shop__stats">
                    <span className="shop__stat">{clothingSlotLabel(c.slot)}</span>
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
            <h3>{CATEGORY_LABEL[cat]}</h3>
            <div className="shop__grid">
              {UPGRADES.filter((u) => u.category === cat).map((u) => {
                const have = owned.includes(u.id);
                const afford = cash >= u.cost;
                const stats = upgradeStats(u);
                return (
                  <div key={u.id} className={`shop__item ${have ? "shop__item--owned" : ""}`}>
                    <div className="shop__name">{u.name}</div>
                    <div className="shop__desc">{u.description}</div>
                    {stats.length > 0 && (
                      <div className="shop__stats">
                        {stats.map((s, i) => (
                          <span key={i} className="shop__stat">{s}</span>
                        ))}
                      </div>
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
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
