import { useStore } from "../state/store";
import { UPGRADES, formatMultipliersSummary, formatUpgradeEffects, multipliersFor } from "../game/shop";
import type { UpgradeCategory } from "../game/types";

const CATEGORY_LABEL: Record<UpgradeCategory, string> = {
  gear: "Gear",
  furniture: "Furniture",
  apartment: "Apartment",
};

/** Owned upgrades and their passive effects. */
export function InventoryPanel() {
  const open = useStore((s) => s.inventoryOpen);
  const ownedIds = useStore((s) => s.ownedUpgrades);
  if (!open) return null;

  const close = () => useStore.getState().setInventoryOpen(false);
  const owned = UPGRADES.filter((u) => ownedIds.includes(u.id));
  const totals = formatMultipliersSummary(multipliersFor(ownedIds));
  const cats: UpgradeCategory[] = ["gear", "furniture", "apartment"];

  return (
    <div className="modal" onClick={close}>
      <div className="modal__card modal__card--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>🎒 Inventory</h2>
          <span className="modal__count">{owned.length} item{owned.length === 1 ? "" : "s"}</span>
          <button className="modal__close" onClick={close}>✕</button>
        </div>

        {owned.length === 0 ? (
          <div className="inventory__empty">
            <p>You haven't bought anything yet.</p>
            <button
              className="btn btn--primary"
              onClick={() => {
                close();
                useStore.getState().setShopOpen(true);
              }}
            >
              Open shop
            </button>
          </div>
        ) : (
          <>
            {totals.length > 0 && (
              <div className="inventory__totals">
                <div className="inventory__totals-label">Combined bonuses</div>
                <ul className="inventory__effects">
                  {totals.map((line) => (
                    <li key={line} className="inventory__effect inventory__effect--total">{line}</li>
                  ))}
                </ul>
              </div>
            )}

            {cats.map((cat) => {
              const items = owned.filter((u) => u.category === cat);
              if (!items.length) return null;
              return (
                <div key={cat} className="shop__group">
                  <h3>{CATEGORY_LABEL[cat]}</h3>
                  <div className="shop__grid">
                    {items.map((u) => {
                      const effects = formatUpgradeEffects(u.effects);
                      return (
                        <div key={u.id} className="shop__item inventory__item">
                          <div className="shop__name">{u.name}</div>
                          <div className="shop__desc">{u.description}</div>
                          {effects.length > 0 && (
                            <ul className="inventory__effects">
                              {effects.map((line) => (
                                <li key={line} className="inventory__effect">{line}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
