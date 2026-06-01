import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import { UPGRADES, formatMultipliersSummary, formatUpgradeEffects, multipliersFor } from "../game/shop";
import { CAMERA_SHOP, formatCameraTier, cameraDisplayLabel } from "../game/cameras";
import { isClothingItem, ITEM_CATEGORIES, ITEM_CATEGORY_LABEL } from "../game/items";
import { canRemoveClothingSlot, clothingSlotLabel, underwearVisibleAtTier } from "../game/wardrobe";
import { UPGRADE_CATEGORIES, UPGRADE_CATEGORY_LABEL } from "../game/shop";

/** Owned upgrades, cameras, and inventory items. */
export function InventoryPanel({ controller }: { controller: GameController }) {
  const open = useStore((s) => s.inventoryOpen);
  const ownedIds = useStore((s) => s.ownedUpgrades);
  const cameras = useStore((s) => s.cameras);
  const inventory = useStore((s) => s.inventory);
  const equipped = useStore((s) => s.equippedClothing);
  const contentTier = useStore((s) => s.settings.contentTier);
  if (!open) return null;

  const close = () => useStore.getState().setInventoryOpen(false);
  const owned = UPGRADES.filter((u) => ownedIds.includes(u.id));
  const totals = formatMultipliersSummary(multipliersFor(ownedIds));
  const cats = UPGRADE_CATEGORIES;
  const itemCats = ITEM_CATEGORIES;
  const placedCams = cameras.filter((c) => c.zone || c.portable);
  const baggedCams = cameras.filter((c) => !c.zone && !c.portable);

  return (
    <div className="modal" onClick={close}>
      <div className="modal__card modal__card--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>🎒 Inventory</h2>
          <span className="modal__count">
            {owned.length + inventory.length + placedCams.length} item
            {owned.length + inventory.length + placedCams.length === 1 ? "" : "s"}
          </span>
          <button className="modal__close" onClick={close}>✕</button>
        </div>

        {placedCams.length > 0 && (
          <div className="shop__group">
            <h3>📷 Cameras</h3>
            <div className="shop__grid">
              {placedCams.map((c) => (
                <div key={c.id} className="shop__item inventory__item">
                  <div className="shop__name">{cameraDisplayLabel(c)}</div>
                  <div className="shop__desc">
                    {c.portable ? "Portable — stream from anywhere" : "Placed angle"}
                    {" · "}{formatCameraTier(c.tier)}
                  </div>
                </div>
              ))}
              {baggedCams.map((c) => (
                <div key={c.id} className="shop__item inventory__item">
                  <div className="shop__name">{c.label} (unplaced)</div>
                  <div className="shop__desc">{formatCameraTier(c.tier)} — place from a zone menu</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {inventory.length > 0 && (
          <>
            {itemCats.map((cat) => {
              const items = inventory
                .filter((i) => i.category === cat)
                .filter(
                  (item) =>
                    !isClothingItem(item)
                    || item.slot !== "underwear"
                    || underwearVisibleAtTier(contentTier),
                );
              if (!items.length) return null;
              return (
                <div key={cat} className="shop__group">
                  <h3>{ITEM_CATEGORY_LABEL[cat]}</h3>
                  <div className="shop__grid">
                    {items.map((item) => {
                      const wearing = Object.values(equipped).includes(item.id);
                      const isCloth = isClothingItem(item);
                      const canRemove = isCloth && canRemoveClothingSlot(item.slot, contentTier);
                      // Underwear can't be taken off below No-Limits: hide the button
                      // entirely (equipping a different piece is still allowed).
                      const hideTakeOff = isCloth && wearing && !canRemove && item.slot === "underwear";
                      // Top/bottom at wholesome: keep the button but disable it so the
                      // player sees clothes can only be swapped, not removed.
                      const disableTakeOff = isCloth && wearing && !canRemove && !hideTakeOff;
                      return (
                        <div key={item.id} className={`shop__item inventory__item ${wearing ? "shop__item--owned" : ""}`}>
                          <div className="shop__name">{item.name}{wearing ? " ✓" : ""}</div>
                          <div className="shop__desc">{item.description}</div>
                          {isCloth && (
                            <div className="shop__meta">
                              Slot: {clothingSlotLabel(item.slot)}
                              {Object.entries(item.vibes).map(([v, n]) => ` · ${v}+${n}`).join("")}
                            </div>
                          )}
                          {isCloth && !hideTakeOff && (
                            <button
                              className="btn btn--primary"
                              disabled={disableTakeOff}
                              title={disableTakeOff ? "Can't take this off at the current content level — change into something else instead." : undefined}
                              onClick={() => {
                                close();
                                if (wearing) void controller.unequipClothingSlot(item.slot);
                                else void controller.equipClothingItem(item.id);
                              }}
                            >
                              {wearing ? "Take off" : "Equip"}
                            </button>
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

        {owned.length === 0 && inventory.length === 0 && placedCams.length <= 1 ? (
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
                <div className="inventory__totals-label">Combined gear bonuses</div>
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
                  <h3>{UPGRADE_CATEGORY_LABEL[cat]}</h3>
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
