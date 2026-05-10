import { useStore, type EquipmentSlot } from "../state/store";
import type { Narrator } from "../dialogue/narrator";
import type { IndexedWorld } from "../world/indexer";

/**
 * Slots match the order the world's `tabs/settings.json itemSettings`
 * authors them in, but we keep the engine-level enum here so the panel
 * doesn't crash on worlds without that config block.
 */
const SLOT_ORDER: EquipmentSlot[] = [
  "head",
  "body",
  "legs",
  "feet",
  "hands",
  "mainHand",
  "offHand",
  "trinket1",
  "trinket2",
];

const SLOT_LABEL: Record<EquipmentSlot, string> = {
  head: "Head",
  body: "Body",
  legs: "Legs",
  feet: "Feet",
  hands: "Hands",
  mainHand: "Main hand",
  offHand: "Off hand",
  trinket1: "Trinket I",
  trinket2: "Trinket II",
};

type Props = {
  narrator: Narrator;
  world: IndexedWorld;
  onClose: () => void;
};

/**
 * Button-driven inventory panel. The player toggles equip/unequip via
 * concrete buttons; no text parsing. Every state mutation goes through
 * the dispatcher, so the LLM (mid-scene) can also synthesize the same
 * tool calls and stay in sync.
 */
export function InventoryPanel({ narrator, world, onClose }: Props) {
  const inventory = useStore((s) => s.inventory);

  const itemEntries = Object.entries(inventory.items);

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__inner inventoryPanel" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>Inventory</h2>
          <button type="button" onClick={onClose}>Close</button>
        </div>

        <section className="inventoryPanel__currency">
          <strong>Coin:</strong>{" "}
          {inventory.currency.gold}g {inventory.currency.silver}s {inventory.currency.copper}c
        </section>

        <section className="inventoryPanel__slots">
          <h3>Equipment</h3>
          <ul>
            {SLOT_ORDER.map((slot) => {
              const equipped = inventory.equipped[slot];
              return (
                <li key={slot}>
                  <strong>{SLOT_LABEL[slot]}:</strong>{" "}
                  {equipped ? itemNameFor(world, equipped) : <em>empty</em>}
                  {equipped ? (
                    <button
                      type="button"
                      className="inventoryPanel__action"
                      onClick={() =>
                        void narrator.dispatch({
                          name: "unequip",
                          arguments: { slot },
                        })
                      }
                    >
                      Unequip
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="inventoryPanel__items">
          <h3>Items</h3>
          {itemEntries.length === 0 ? (
            <p>(nothing)</p>
          ) : (
            <ul>
              {itemEntries.map(([itemId, qty]) => (
                <li key={itemId}>
                  <strong>{itemNameFor(world, itemId)}</strong> × {qty}
                  {validSlotFor(world, itemId).map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      className="inventoryPanel__action"
                      onClick={() =>
                        void narrator.dispatch({
                          name: "equip",
                          arguments: { itemId, slot },
                        })
                      }
                    >
                      Equip {SLOT_LABEL[slot]}
                    </button>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function itemNameFor(world: IndexedWorld, itemId: string): string {
  return world.world.items[itemId]?.name ?? itemId;
}

/**
 * Map an item's authored `slot` string to one or two engine-level
 * EquipmentSlot values. Worlds use freeform slot names (e.g. "trinket")
 * that fan out to multiple engine slots (trinket1, trinket2), so the
 * function returns a list rather than a single answer.
 */
function validSlotFor(world: IndexedWorld, itemId: string): EquipmentSlot[] {
  const def = world.world.items[itemId];
  if (!def) return [];
  const slot = def.slot.toLowerCase();
  switch (slot) {
    case "head":
    case "body":
    case "legs":
    case "feet":
    case "hands":
      return [slot as EquipmentSlot];
    case "mainhand":
    case "main_hand":
    case "main-hand":
      return ["mainHand"];
    case "offhand":
    case "off_hand":
    case "off-hand":
      return ["offHand"];
    case "trinket":
      return ["trinket1", "trinket2"];
    case "weapon":
      return ["mainHand", "offHand"];
    default:
      return [];
  }
}
