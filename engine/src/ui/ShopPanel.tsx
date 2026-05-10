import { useStore } from "../state/store";
import type { Narrator } from "../dialogue/narrator";
import type { IndexedWorld } from "../world/indexer";

/**
 * Button-driven shop UI. The merchant's offers come from the `open_shop`
 * tool call (LLM-emitted, with itemId/price/stock). Buy and sell each
 * route through their own tool calls so the dispatcher can validate
 * inventory and currency state every time.
 */
type Props = {
  narrator: Narrator;
  world: IndexedWorld;
};

export function ShopPanel({ narrator, world }: Props) {
  const shop = useStore((s) => s.shop);
  const inventory = useStore((s) => s.inventory);

  if (!shop) return null;

  const merchant = world.world.npcs[shop.npcId];

  return (
    <div
      className="modal"
      onClick={() =>
        void narrator.dispatch({ name: "close_shop", arguments: {} })
      }
    >
      <div
        className="modal__inner shopPanel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2>Shop {merchant ? `— ${merchant.name}` : ""}</h2>
          <button
            type="button"
            onClick={() =>
              void narrator.dispatch({ name: "close_shop", arguments: {} })
            }
          >
            Close
          </button>
        </div>

        <section>
          <h3>For sale</h3>
          {shop.offers.length === 0 ? (
            <p>The merchant has nothing on offer.</p>
          ) : (
            <ul className="shopPanel__offers">
              {shop.offers.map((offer) => (
                <li key={offer.itemId}>
                  <span>
                    <strong>{itemNameFor(world, offer.itemId)}</strong>
                    {" — "}
                    {offer.price}c
                    {" — "}
                    stock {offer.stock}
                  </span>
                  <button
                    type="button"
                    disabled={offer.stock <= 0}
                    onClick={() =>
                      void narrator.dispatch({
                        name: "shop_buy",
                        arguments: { itemId: offer.itemId, qty: 1 },
                      })
                    }
                  >
                    Buy 1
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>Your goods</h3>
          {Object.keys(inventory.items).length === 0 ? (
            <p>Nothing to sell.</p>
          ) : (
            <ul className="shopPanel__offers">
              {Object.entries(inventory.items).map(([itemId, qty]) => {
                const matchingOffer = shop.offers.find(
                  (o) => o.itemId === itemId,
                );
                return (
                  <li key={itemId}>
                    <span>
                      <strong>{itemNameFor(world, itemId)}</strong> × {qty}
                      {matchingOffer ? ` (sells for ${matchingOffer.price}c)` : ""}
                    </span>
                    <button
                      type="button"
                      disabled={!matchingOffer}
                      onClick={() =>
                        void narrator.dispatch({
                          name: "shop_sell",
                          arguments: { itemId, qty: 1 },
                        })
                      }
                    >
                      Sell 1
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <footer className="shopPanel__wallet">
          <strong>Coin:</strong>{" "}
          {inventory.currency.gold}g {inventory.currency.silver}s {inventory.currency.copper}c
        </footer>
      </div>
    </div>
  );
}

function itemNameFor(world: IndexedWorld, itemId: string): string {
  return world.world.items[itemId]?.name ?? itemId;
}
