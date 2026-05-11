import type { IndexedWorld } from "../world/indexer";
import type { WorldNpc } from "../schema/worldSchema";
import type { Tile } from "../grid/tilePrimitives";
import type { EngagementGroup } from "../state/store";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * True when an authored location sub-area id (npc.currentArea) matches the
 * tile the LLM filled for this cell. We compare slugs and allow substring
 * matches for cases like area "Taproom" vs kind "taproom-stalls".
 */
export function tileMatchesAuthoredArea(areaId: string, tile: Tile): boolean {
  const a = areaId.trim();
  if (!a) return true;
  const slugArea = slugify(a);
  if (!slugArea) return true;

  const kindSlug = slugify(tile.kind);
  const labelSlug = tile.label ? slugify(tile.label) : "";

  if (kindSlug === slugArea || labelSlug === slugArea) return true;
  if (tile.kind.trim().toLowerCase() === a.toLowerCase()) return true;
  if (tile.label?.trim().toLowerCase() === a.toLowerCase()) return true;

  const min = 4;
  if (slugArea.length >= min && kindSlug.length >= min) {
    if (kindSlug.includes(slugArea) || slugArea.includes(kindSlug)) return true;
  }
  if (slugArea.length >= min && labelSlug.length >= min) {
    if (labelSlug.includes(slugArea) || slugArea.includes(labelSlug)) return true;
  }
  return false;
}

export type NpcAtLocation = { npcId: string; npc: WorldNpc };

/**
 * NPCs authored as standing in this location who should appear on the given
 * tile. Empty `currentArea` means they roam the whole location (every tile).
 */
export function npcsForLocationTile(
  world: IndexedWorld,
  locationId: string,
  tile: Tile,
): NpcAtLocation[] {
  const out: NpcAtLocation[] = [];
  for (const [npcId, npc] of Object.entries(world.world.npcs)) {
    if (npc.currentLocation !== locationId) continue;
    if (npc.known === false) continue;
    const area = (npc.currentArea ?? "").trim();
    if (!area || tileMatchesAuthoredArea(area, tile)) {
      out.push({ npcId, npc });
    }
  }
  out.sort((x, y) => x.npcId.localeCompare(y.npcId));
  return out;
}

const GROUP_PREFIX = "world-npc-";

/**
 * One engagement group per authored NPC so talk / trade buttons target a
 * single `npcIds` entry. Ids are stable and namespaced so LLM `spawn_group`
 * ids are unlikely to collide.
 */
export function engagementGroupsFromAuthoredNpcs(
  world: IndexedWorld,
  locationId: string,
  tile: Tile,
): EngagementGroup[] {
  return npcsForLocationTile(world, locationId, tile).map(({ npcId, npc }) => {
    const name = npc.name?.trim() || npcId;
    return {
      id: `${GROUP_PREFIX}${npcId}`,
      name,
      npcIds: [npcId],
      state: "idle" as const,
      kind: "character" as const,
      summary: npc.type ? `${npc.type}` : undefined,
    };
  });
}
