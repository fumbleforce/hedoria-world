import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import { UPGRADES } from "../game/shop";
import { purchasableActivities } from "../game/activities";
import { NICHES } from "../game/niches";
import { SEGMENTS } from "../game/segments";
import type { UpgradeCategory } from "../game/types";

const CATEGORY_LABEL: Record<UpgradeCategory, string> = {
  gear: "Gear",
  furniture: "Furniture",
  apartment: "Apartment",
};

export function ShopPanel({ controller }: { controller: GameController }) {
  const open = useStore((s) => s.shopOpen);
  const owned = useStore((s) => s.ownedUpgrades);
  const ownedActivities = useStore((s) => s.ownedActivities);
  const cash = useStore((s) => s.metrics.cash);
  if (!open) return null;

  const cats: UpgradeCategory[] = ["gear", "furniture", "apartment"];
  const library = purchasableActivities();

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
                return (
                  <div key={u.id} className={`shop__item ${have ? "shop__item--owned" : ""}`}>
                    <div className="shop__name">{u.name}</div>
                    <div className="shop__desc">{u.description}</div>
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
