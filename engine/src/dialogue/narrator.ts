import { z } from "zod";
import type { LlmAdapter } from "../llm/adapter";
import type { LlmResponse } from "../llm/types";
import type { TileFiller } from "../grid/tileFiller";
import type { TileImageCache } from "../grid/tileImageCache";
import { applyPathing } from "../grid/pathing";
import { getTile, type TileGrid } from "../grid/tilePrimitives";
import type { IndexedWorld } from "../world/indexer";
import { diag } from "../diag/log";
import {
  type EquipmentSlot,
  type EngagementGroup,
  MAX_PLAYER_PARTY_SIZE,
  type StoreState,
  useStore,
} from "../state/store";
import {
  REGION_GRID_H,
  REGION_GRID_W,
  LOCATION_GRID_H,
  LOCATION_GRID_W,
} from "../grid/tilePrimitives";
import {
  clearQuestMarkers,
  populateGridWithQuest,
} from "../quests/tilePopulator";
import { engagementGroupsFromAuthoredNpcs } from "../scene/npcPresence";

/**
 * The single mutation funnel: every change to the runtime store goes
 * through `Narrator.dispatch(toolCall)`. UI buttons synthesise tool calls
 * locally; the LLM sends them via `LlmResponse.toolCalls`. Either way the
 * dispatcher validates the args (zod), validates against current state,
 * applies the mutation, and may emit follow-up narration lines.
 *
 * The dispatcher does NOT itself call the LLM — it's purely a reducer.
 * Calling code that wants an LLM-narrated response composes:
 *
 *   const response = await llm.complete(request);
 *   await narrator.applyResponse(response);
 */

export type ToolCall = { name: string; arguments: Record<string, unknown> };

export type ToolResult = {
  ok: boolean;
  /** Player-facing message; empty string means silent success. */
  message?: string;
  /** Anything the caller may want to introspect (e.g. new mode after move). */
  data?: Record<string, unknown>;
};

export type NarratorContext = {
  llm: LlmAdapter;
  world: IndexedWorld;
  tileFiller: TileFiller;
  tileImageCache: TileImageCache;
};

type ToolHandler = (
  args: unknown,
  state: StoreState,
  ctx: NarratorContext,
) => Promise<ToolResult> | ToolResult;

type Direction = "north" | "south" | "east" | "west";
// Cartographer's convention (matches the deprecated 3D engine in
// engine_old_depr/src/scene/sceneTransition.ts and config.json):
//   +x = east, +y = NORTH.
// All internal coordinates — store, grid arrays, tool args, pathing —
// use this convention. The renderer (TileGridView) is the ONE place
// that performs a y-flip so the screen still shows north at the top.
const DIR_VECTORS: Record<Direction, [number, number]> = {
  north: [0, 1],
  south: [0, -1],
  east: [1, 0],
  west: [-1, 0],
};

function vectorFromArgs(direction?: string, dx?: number, dy?: number): [number, number] {
  if (typeof direction === "string" && direction in DIR_VECTORS) {
    return DIR_VECTORS[direction as Direction];
  }
  return [
    Math.max(-1, Math.min(1, dx ?? 0)),
    Math.max(-1, Math.min(1, dy ?? 0)),
  ];
}

// ---------------- arg schemas

const NoArgs = z.object({}).strict();

const NarrateSchema = z.object({ text: z.string().min(1) });
const SaySchema = z.object({ text: z.string().min(1) });

const MoveDirSchema = z
  .object({
    direction: z.enum(["north", "south", "east", "west"]).optional(),
    dx: z.number().int().optional(),
    dy: z.number().int().optional(),
  })
  .refine((v) => !!v.direction || v.dx !== undefined || v.dy !== undefined, {
    message: "Provide either `direction` or `dx`/`dy`",
  });

const EnterLocationSchema = z.object({ locationId: z.string().min(1) });
const EnterTileSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});

const SpawnGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  npcIds: z.array(z.string()).optional(),
  summary: z.string().optional(),
});
const GroupRefSchema = z.object({ groupId: z.string().min(1) });
const PlayerPartyNpcSchema = z.object({ npcId: z.string().min(1) });
const LockSchema = z.object({
  groupId: z.string().min(1),
  reason: z.string().min(1),
});

const StartCombatSchema = z.object({
  groupId: z.string().min(1),
  reason: z.string().optional(),
});
const EndCombatSchema = z.object({
  outcome: z.enum(["victory", "defeat", "flee", "truce"]),
  summary: z.string().optional(),
});

const OpenShopSchema = z.object({
  npcId: z.string().min(1),
  offers: z
    .array(
      z.object({
        itemId: z.string(),
        price: z.number().int().nonnegative(),
        stock: z.number().int().nonnegative().default(99),
      }),
    )
    .optional(),
});
const ShopBuySellSchema = z.object({
  itemId: z.string().min(1),
  qty: z.number().int().positive(),
});
const EquipmentSlotEnum = z.enum([
  "head",
  "body",
  "legs",
  "feet",
  "hands",
  "mainHand",
  "offHand",
  "trinket1",
  "trinket2",
]);
const EquipSchema = z.object({
  itemId: z.string().min(1),
  slot: EquipmentSlotEnum,
});
const UnequipSchema = z.object({ slot: EquipmentSlotEnum });

const QuestRefSchema = z.object({ questId: z.string().min(1) });
const QuestObjectiveSchema = z.object({
  questId: z.string().min(1),
  key: z.string().min(1),
  delta: z.number().int(),
});
const GiveItemSchema = z.object({
  itemId: z.string().min(1),
  qty: z.number().int().positive(),
});
const GiveCurrencySchema = z.object({
  gold: z.number().int().optional(),
  silver: z.number().int().optional(),
  copper: z.number().int().optional(),
});

// ---------------- helpers

function inBounds(x: number, y: number, w: number, h: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h;
}

function ok(message?: string, data?: Record<string, unknown>): ToolResult {
  return { ok: true, message, data };
}
function fail(message: string): ToolResult {
  return { ok: false, message };
}

function ensureMode(state: StoreState, ...modes: Array<StoreState["mode"]>): boolean {
  return modes.includes(state.mode);
}

function emptyEngagementGroup(
  id: string,
  name: string,
  kind: EngagementGroup["kind"] = "party",
): EngagementGroup {
  return { id, name, npcIds: [], state: "idle", kind };
}

// ---------------- the Narrator class

export class Narrator {
  private readonly ctx: NarratorContext;
  private readonly handlers: Map<string, ToolHandler>;

  constructor(ctx: NarratorContext) {
    this.ctx = ctx;
    this.handlers = new Map();
    this.registerHandlers();
  }

  /**
   * Apply every tool call from an LLM response (in order). Returns the
   * results so callers can surface failures. The narration text in
   * `response.text` is appended via `narrate` semantics if no explicit
   * `narrate` tool was emitted.
   */
  async applyResponse(response: LlmResponse): Promise<ToolResult[]> {
    const calls = response.toolCalls ?? [];
    const out: ToolResult[] = [];
    let sawNarrate = false;
    for (const call of calls) {
      if (call.name === "narrate" || call.name === "say") sawNarrate = true;
      out.push(await this.dispatch(call));
    }
    const text = response.text?.trim();
    if (!sawNarrate && text) {
      out.push(await this.dispatch({ name: "narrate", arguments: { text } }));
    }
    return out;
  }

  async dispatch(call: ToolCall): Promise<ToolResult> {
    const handler = this.handlers.get(call.name);
    if (!handler) {
      diag.warn("narrator", `unknown tool: ${call.name}`, {
        tool: call.name,
        arguments: call.arguments,
      });
      return fail(`Unknown tool: ${call.name}`);
    }
    const startedAt = performance.now();
    try {
      const state = useStore.getState();
      const result = await handler(call.arguments ?? {}, state, this.ctx);
      const durationMs = Math.round(performance.now() - startedAt);
      const level = result.ok ? "info" : "warn";
      diag[level]("narrator", `tool ${call.name} ${result.ok ? "ok" : "fail"}`, {
        tool: call.name,
        arguments: call.arguments,
        ok: result.ok,
        message: result.message,
        durationMs,
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      diag.error("narrator", `tool ${call.name} threw`, {
        tool: call.name,
        arguments: call.arguments,
        error: err instanceof Error ? err : msg,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return fail(`Tool ${call.name} failed: ${msg}`);
    }
  }

  // ------------------------------------------------------------ registration

  private registerHandlers(): void {
    const { handlers } = this;

    handlers.set("narrate", (raw) => {
      const args = NarrateSchema.parse(raw);
      useStore.getState().appendNarration(args.text);
      return ok();
    });

    handlers.set("say", (raw) => {
      const args = SaySchema.parse(raw);
      useStore.getState().appendDialogue({ role: "npc", text: args.text });
      return ok();
    });

    handlers.set("end_dialogue", (raw) => {
      NoArgs.partial().parse(raw);
      useStore.getState().clearDialogue();
      return ok();
    });

    // ------------------------------------------------------------ traversal

    handlers.set("move_region", async (raw, state, ctx) => {
      if (!ensureMode(state, "region")) return fail("Not in region mode");
      const args = MoveDirSchema.parse(raw);
      const grid = state.regionGrid;
      if (!grid) return fail("Region grid not loaded");
      const [dx, dy] = vectorFromArgs(args.direction, args.dx, args.dy);
      const nx = state.regionPos[0] + dx;
      const ny = state.regionPos[1] + dy;
      if (!inBounds(nx, ny, grid.width, grid.height)) {
        return fail("Edge of region.");
      }
      const target = getTile(grid, nx, ny);
      if (target && !target.passable) {
        return fail(`That way is impassable (${target.label ?? target.kind}).`);
      }
      useStore.getState().setRegionPos([nx, ny]);
      // Fire-and-forget pre-warm of the destination tile's image. Must be
      // mode-aware (per-tile vs. mosaic) — `getUrl` would force per-tile
      // even in mosaic mode, which both wastes a call AND blocks the move
      // for 30-50s while the per-tile image generates. The cell renderer
      // also pre-warms via its own useEffect, so this is just an extra
      // nudge, never something the move handler should await.
      if (target) {
        void ctx.tileImageCache
          .getUrlForTile(grid, nx, ny, target)
          .catch(() => null);
      }
      return ok(undefined, { regionPos: [nx, ny] });
    });

    handlers.set("move_location", async (raw, state, ctx) => {
      if (!ensureMode(state, "location")) return fail("Not in location mode");
      const args = MoveDirSchema.parse(raw);
      const grid = state.locationGrid;
      if (!grid) return fail("Location grid not loaded");
      const [dx, dy] = vectorFromArgs(args.direction, args.dx, args.dy);
      const nx = state.locationPos[0] + dx;
      const ny = state.locationPos[1] + dy;
      if (!inBounds(nx, ny, grid.width, grid.height)) {
        return fail("Edge of location.");
      }
      const target = getTile(grid, nx, ny);
      if (target && !target.passable) {
        return fail(`That way is impassable (${target.label ?? target.kind}).`);
      }
      useStore.getState().setLocationPos([nx, ny]);
      if (target) {
        void ctx.tileImageCache
          .getUrlForTile(grid, nx, ny, target)
          .catch(() => null);
      }
      return ok(undefined, { locationPos: [nx, ny] });
    });

    handlers.set("enter_location", async (raw, state, ctx) => {
      if (!ensureMode(state, "region")) return fail("Not in region mode");
      const args = EnterLocationSchema.parse(raw);
      const tile = state.regionGrid
        ? getTile(state.regionGrid, state.regionPos[0], state.regionPos[1])
        : undefined;
      if (!tile || tile.locationId !== args.locationId) {
        return fail("You are not standing on that location.");
      }
      const loc = ctx.world.locations[args.locationId];
      if (!loc) return fail(`Unknown location ${args.locationId}`);

      // Surface "generating…" while the location grid is being prepared so
      // the UI can show a mild loading indicator. The flag is cleared in
      // `finally` so a thrown filler doesn't leave the indicator stuck on.
      useStore.getState().setGenerating({ locationGridFor: args.locationId });
      let grid;
      try {
        grid = await ctx.tileFiller.getLocationGrid({
          location: loc,
          locationId: args.locationId,
          region: ctx.world.regionsById[loc.region ?? ""],
          regionBiome: state.regionGrid?.biome,
        });
      } finally {
        useStore.getState().setGenerating({ locationGridFor: undefined });
      }

      const store = useStore.getState();
      store.setLocationGrid(grid);
      store.setCurrentLocationId(args.locationId);
      store.setLocationPos([
        Math.floor(grid.width / 2),
        Math.floor(grid.height / 2),
      ]);
      store.setMode("location");
      return ok(undefined, { mode: "location", locationId: args.locationId });
    });

    handlers.set("leave_location", (raw, state) => {
      // Optional `direction`: if the player exits via one of the four
      // cardinal exit tiles, step the region position one cell in that
      // direction so the world position reflects which side of the
      // location they walked out of. Without a direction we simply pop
      // back to whatever cell they entered from.
      const args = z
        .object({
          direction: z.enum(["north", "south", "east", "west"]).optional(),
        })
        .parse(raw);
      const store = useStore.getState();
      store.setLocationGrid(null);
      store.setCurrentLocationId(null);
      store.setCurrentSceneTile(null);
      store.setEngagement({ groups: {}, lockReason: undefined });
      store.setMode("region");

      if (args.direction && state.regionGrid) {
        const [dx, dy] = DIR_VECTORS[args.direction];
        const nx = state.regionPos[0] + dx;
        const ny = state.regionPos[1] + dy;
        if (
          nx >= 0 &&
          ny >= 0 &&
          nx < state.regionGrid.width &&
          ny < state.regionGrid.height
        ) {
          const target = getTile(state.regionGrid, nx, ny);
          if (target && target.passable) {
            store.setRegionPos([nx, ny]);
            return ok(undefined, {
              mode: "region",
              regionPos: [nx, ny],
              direction: args.direction,
            });
          }
        }
        // The chosen direction would step out of bounds or onto an
        // impassable tile. Stay on the original cell (the player is
        // still safely back in region mode), but report the failure so
        // the UI can narrate "you find no path that way" if it wants to.
        return ok(undefined, {
          mode: "region",
          direction: args.direction,
          blocked: true,
        });
      }
      return ok(undefined, { mode: "region" });
    });

    handlers.set("enter_tile", (raw, state) => {
      if (!ensureMode(state, "location")) return fail("Not in location mode");
      const args = EnterTileSchema.parse(raw);
      const grid = state.locationGrid;
      if (!grid) return fail("Location grid not loaded");
      if (!inBounds(args.x, args.y, grid.width, grid.height)) {
        return fail("Tile out of bounds.");
      }
      const tile = getTile(grid, args.x, args.y);
      if (!tile) return fail("Tile missing.");
      if (!tile.passable) return fail(`That tile is impassable.`);
      const store = useStore.getState();
      store.setLocationPos([args.x, args.y]);
      store.setCurrentSceneTile({
        x: args.x,
        y: args.y,
        kind: tile.kind,
        label: tile.label,
      });
      const locationId = state.currentLocationId;
      const authoredGroups =
        locationId && tile
          ? engagementGroupsFromAuthoredNpcs(this.ctx.world, locationId, tile)
          : [];
      const groups: Record<string, EngagementGroup> = {};
      for (const g of authoredGroups) {
        groups[g.id] = g;
      }
      store.setEngagement({ groups, lockReason: undefined });
      store.setMode("scene");
      return ok(undefined, { mode: "scene" });
    });

    handlers.set("leave_tile", (raw, state) => {
      NoArgs.partial().parse(raw);
      if (state.engagement.lockReason) {
        return fail(`You can't leave: ${state.engagement.lockReason}`);
      }
      const store = useStore.getState();
      store.setCurrentSceneTile(null);
      store.setEngagement({ groups: {}, lockReason: undefined });
      store.setMode("location");
      return ok(undefined, { mode: "location" });
    });

    // ------------------------------------------------------------ engagement

    const spawnPartyFromArgs = (raw: unknown): ToolResult => {
      const args = SpawnGroupSchema.parse(raw);
      const ids = args.npcIds ?? [];
      if (ids.length > 3) {
        return fail(
          "Parties may list at most 3 world NPC ids. Split into multiple parties, use empty npcIds for an anonymous band, or spawn a lone stranger with a single id.",
        );
      }
      const group: EngagementGroup = {
        ...emptyEngagementGroup(args.id, args.name, "party"),
        npcIds: ids,
        summary: args.summary,
      };
      useStore.getState().setEngagementGroup(group);
      return ok();
    };
    handlers.set("spawn_group", (raw) => spawnPartyFromArgs(raw));
    handlers.set("spawn_party", (raw) => spawnPartyFromArgs(raw));

    handlers.set("dismiss_party", (raw, state) => {
      const args = GroupRefSchema.parse(raw);
      const group = state.engagement.groups[args.groupId];
      if (!group) return fail(`No party ${args.groupId}`);
      if (group.kind === "character" || args.groupId.startsWith("world-npc-")) {
        return fail(
          "Authored characters are standalone — they are not dismissed; they leave when the player leaves the tile.",
        );
      }
      if (state.engagement.lockReason) {
        return fail(`Locked: ${state.engagement.lockReason}`);
      }
      if (group.state === "locked") {
        return fail("Cannot dismiss a locked party; end combat or unlock engagement first.");
      }
      useStore.getState().removeEngagementGroup(args.groupId);
      return ok();
    });

    handlers.set("add_to_player_party", (raw) => {
      const args = PlayerPartyNpcSchema.parse(raw);
      const npc = this.ctx.world.world.npcs[args.npcId];
      if (!npc) return fail(`Unknown NPC "${args.npcId}".`);
      const store = useStore.getState();
      const cur = store.playerPartyNpcIds;
      if (cur.includes(args.npcId)) {
        return ok(undefined, { alreadyMember: true });
      }
      if (cur.length >= MAX_PLAYER_PARTY_SIZE) {
        return fail(
          `Player party full (${MAX_PLAYER_PARTY_SIZE} companions). Remove one with remove_from_player_party first.`,
        );
      }
      store.setPlayerPartyNpcIds([...cur, args.npcId]);
      return ok();
    });

    handlers.set("remove_from_player_party", (raw) => {
      const args = PlayerPartyNpcSchema.parse(raw);
      const store = useStore.getState();
      const cur = store.playerPartyNpcIds;
      if (!cur.includes(args.npcId)) {
        return fail(`"${args.npcId}" is not in the player's traveling party.`);
      }
      store.setPlayerPartyNpcIds(cur.filter((id) => id !== args.npcId));
      return ok();
    });

    handlers.set("engage", (raw, state) => {
      const args = GroupRefSchema.parse(raw);
      const group = state.engagement.groups[args.groupId];
      if (!group) return fail(`No group ${args.groupId}`);
      useStore.getState().setEngagementGroup({ ...group, state: "engaged" });
      return ok();
    });

    handlers.set("disengage", (raw, state) => {
      const args = GroupRefSchema.parse(raw);
      const group = state.engagement.groups[args.groupId];
      if (!group) return fail(`No group ${args.groupId}`);
      if (state.engagement.lockReason) {
        return fail(`Locked: ${state.engagement.lockReason}`);
      }
      if (group.state === "locked") {
        return fail(`${group.name} is holding you in place.`);
      }
      useStore.getState().setEngagementGroup({ ...group, state: "idle" });
      return ok();
    });

    handlers.set("lock_engagement", (raw, state) => {
      const args = LockSchema.parse(raw);
      const group = state.engagement.groups[args.groupId];
      if (!group) return fail(`No group ${args.groupId}`);
      const store = useStore.getState();
      store.setEngagementGroup({ ...group, state: "locked" });
      store.setLockReason(args.reason);
      return ok();
    });

    handlers.set("unlock_engagement", (raw, state) => {
      const args = GroupRefSchema.parse(raw);
      const group = state.engagement.groups[args.groupId];
      if (!group) return fail(`No group ${args.groupId}`);
      const store = useStore.getState();
      store.setEngagementGroup({ ...group, state: "engaged" });
      store.setLockReason(undefined);
      return ok();
    });

    // ------------------------------------------------------------ combat

    handlers.set("start_combat", (raw, state) => {
      const args = StartCombatSchema.parse(raw);
      const group = state.engagement.groups[args.groupId];
      if (!group) return fail(`No group ${args.groupId}`);
      const store = useStore.getState();
      store.setEngagementGroup({ ...group, state: "locked" });
      store.setLockReason(args.reason ?? `Combat with ${group.name}`);
      store.setCombat({
        turn: 0,
        actors: [],
        log: [`Combat begins with ${group.name}.`],
      });
      return ok();
    });

    handlers.set("end_combat", (raw) => {
      const args = EndCombatSchema.parse(raw);
      const store = useStore.getState();
      store.setCombat(null);
      store.setLockReason(undefined);
      if (args.summary) store.appendNarration(args.summary);
      return ok();
    });

    handlers.set("attack", (raw, state) => {
      // Legacy alias that bridges the old NPC dialogue tool to the new combat flow.
      const reason = (raw as { reason?: string } | null)?.reason ?? "Hostility erupts.";
      const firstGroupId = Object.keys(state.engagement.groups)[0];
      if (!firstGroupId) return fail("No group to attack.");
      return this.dispatch({
        name: "start_combat",
        arguments: { groupId: firstGroupId, reason },
      });
    });

    // ------------------------------------------------------------ shop / inv

    handlers.set("open_shop", (raw) => {
      const args = OpenShopSchema.parse(raw);
      useStore.getState().openShop({
        npcId: args.npcId,
        offers: (args.offers ?? []).map((o) => ({ ...o, stock: o.stock ?? 99 })),
      });
      return ok();
    });

    handlers.set("close_shop", (raw) => {
      NoArgs.partial().parse(raw);
      useStore.getState().openShop(null);
      return ok();
    });

    handlers.set("shop_buy", (raw, state) => {
      const args = ShopBuySellSchema.parse(raw);
      if (!state.shop) return fail("No active shop.");
      const offer = state.shop.offers.find((o) => o.itemId === args.itemId);
      if (!offer) return fail(`No offer for ${args.itemId}.`);
      if (offer.stock < args.qty) return fail(`Out of stock.`);
      const totalCopper = offer.price * args.qty;
      const wallet = state.inventory.currency;
      const walletCopper =
        wallet.gold * 10000 + wallet.silver * 100 + wallet.copper;
      if (walletCopper < totalCopper) return fail("Not enough coin.");
      const store = useStore.getState();
      store.adjustCurrency({ copper: -totalCopper });
      store.adjustItem(args.itemId, args.qty);
      // Decrement stock on the live offer.
      store.openShop({
        ...state.shop,
        offers: state.shop.offers.map((o) =>
          o.itemId === args.itemId ? { ...o, stock: o.stock - args.qty } : o,
        ),
      });
      return ok();
    });

    handlers.set("shop_sell", (raw, state) => {
      const args = ShopBuySellSchema.parse(raw);
      if (!state.shop) return fail("No active shop.");
      const offer = state.shop.offers.find((o) => o.itemId === args.itemId);
      if (!offer) return fail(`Merchant doesn't want ${args.itemId}.`);
      const have = state.inventory.items[args.itemId] ?? 0;
      if (have < args.qty) return fail(`You don't have ${args.qty} ${args.itemId}.`);
      const store = useStore.getState();
      store.adjustItem(args.itemId, -args.qty);
      store.adjustCurrency({ copper: offer.price * args.qty });
      return ok();
    });

    handlers.set("equip", (raw, state) => {
      const args = EquipSchema.parse(raw);
      const have = state.inventory.items[args.itemId] ?? 0;
      if (have < 1) return fail(`No ${args.itemId} in inventory.`);
      useStore.getState().setEquipped(args.slot as EquipmentSlot, args.itemId);
      return ok();
    });

    handlers.set("unequip", (raw) => {
      const args = UnequipSchema.parse(raw);
      useStore.getState().setEquipped(args.slot as EquipmentSlot, undefined);
      return ok();
    });

    handlers.set("give_item", (raw) => {
      const args = GiveItemSchema.parse(raw);
      useStore.getState().adjustItem(args.itemId, args.qty);
      return ok();
    });

    handlers.set("give_currency", (raw) => {
      const args = GiveCurrencySchema.parse(raw);
      useStore.getState().adjustCurrency(args);
      return ok();
    });

    // ------------------------------------------------------------ quests

    handlers.set("offer_quest", (raw, _state, ctx) => {
      const args = QuestRefSchema.parse(raw);
      if (!ctx.world.world.quests[args.questId]) {
        return fail(`Unknown quest ${args.questId}`);
      }
      // Offering doesn't mutate state on its own; presentation is via narration.
      useStore
        .getState()
        .appendNarration(`Quest offered: ${ctx.world.world.quests[args.questId].name ?? args.questId}`);
      return ok();
    });

    handlers.set("accept_quest", (raw, state, ctx) => {
      const args = QuestRefSchema.parse(raw);
      const quest = ctx.world.world.quests[args.questId];
      if (!quest) {
        return fail(`Unknown quest ${args.questId}`);
      }
      const store = useStore.getState();
      store.addActiveQuest(args.questId);
      store.appendNarration(`Quest accepted: ${args.questId}`);

      // Drop QuestMarker overlays onto the active grids so subsequent
      // narration / re-fills can present the quest in-world.
      const saveId = state.saveId;
      const seedBase = `${saveId}::${args.questId}`;
      if (state.regionGrid) {
        const populated = populateGridWithQuest({
          quest,
          questId: args.questId,
          grid: state.regionGrid,
          seed: `${seedBase}::region::${state.regionGrid.ownerId}`,
        });
        store.setRegionGrid(populated);
      }
      if (state.locationGrid) {
        const populated = populateGridWithQuest({
          quest,
          questId: args.questId,
          grid: state.locationGrid,
          seed: `${seedBase}::location::${state.locationGrid.ownerId}`,
        });
        store.setLocationGrid(populated);
      }
      return ok();
    });

    handlers.set("complete_quest", (raw, state) => {
      const args = z
        .object({ questId: z.string(), evidence: z.string() })
        .parse(raw);
      if (!state.activeQuestIds.includes(args.questId)) {
        return fail(`Quest ${args.questId} is not active.`);
      }
      const store = useStore.getState();
      store.removeActiveQuest(args.questId);
      store.appendNarration(`Quest completed: ${args.questId} (${args.evidence})`);
      if (state.regionGrid)
        store.setRegionGrid(clearQuestMarkers(state.regionGrid, args.questId));
      if (state.locationGrid)
        store.setLocationGrid(clearQuestMarkers(state.locationGrid, args.questId));
      return ok();
    });

    handlers.set("fail_quest", (raw, state) => {
      const args = z
        .object({ questId: z.string(), reason: z.string() })
        .parse(raw);
      if (!state.activeQuestIds.includes(args.questId)) {
        return fail(`Quest ${args.questId} is not active.`);
      }
      const store = useStore.getState();
      store.removeActiveQuest(args.questId);
      store.appendNarration(`Quest failed: ${args.questId} (${args.reason})`);
      if (state.regionGrid)
        store.setRegionGrid(clearQuestMarkers(state.regionGrid, args.questId));
      if (state.locationGrid)
        store.setLocationGrid(clearQuestMarkers(state.locationGrid, args.questId));
      return ok();
    });

    handlers.set("update_quest_progress", (raw) => {
      const args = z
        .object({ questId: z.string(), note: z.string() })
        .parse(raw);
      useStore
        .getState()
        .appendNarration(`Quest update [${args.questId}]: ${args.note}`);
      return ok();
    });

    handlers.set("update_quest_objective", (raw, state) => {
      const args = QuestObjectiveSchema.parse(raw);
      if (!state.activeQuestIds.includes(args.questId)) {
        return fail(`Quest ${args.questId} is not active.`);
      }
      const cur = state.questProgress[args.questId]?.[args.key] ?? 0;
      const next = cur + args.delta;
      useStore.getState().setQuestObjective(args.questId, args.key, next);
      return ok(undefined, { progress: next });
    });

    handlers.set("request_skill_check", (raw) => {
      const args = z
        .object({
          skill: z.string(),
          difficulty: z.number(),
          stake: z.string(),
        })
        .parse(raw);
      useStore
        .getState()
        .appendNarration(
          `Skill check: ${args.skill} vs ${args.difficulty} (${args.stake})`,
        );
      return ok();
    });
  }
}

/** Options for {@link ensureRegionGrid} / {@link ensureLocationGrid}. */
export type EnsureGridOptions = {
  /** When true, caller is responsible for calling {@link prewarmGridImages} after any image invalidation. */
  skipPrewarm?: boolean;
  /** Appended to the filler user prompt so the text LLM transcript cache cannot replay a stale grid. */
  llmCacheBuster?: string;
};

/**
 * Idempotent helper so the rest of the app can write
 *
 *   const grid = await ensureRegionGrid(narrator, regionId);
 *
 * and trust that the live store has the grid + image-cache primed.
 */
export async function ensureRegionGrid(
  ctx: NarratorContext,
  regionId: string,
  options?: EnsureGridOptions,
): Promise<TileGrid> {
  const region = ctx.world.regionsById[regionId];
  if (!region) {
    throw new Error(`Unknown region ${regionId}`);
  }
  const locations = ctx.world.locationsByRegion.get(regionId) ?? [];
  useStore.getState().setGenerating({ regionGridFor: regionId });
  let grid;
  try {
    grid = await ctx.tileFiller.getRegionGrid({
      region,
      regionId,
      locations,
      llmCacheBuster: options?.llmCacheBuster,
    });
  } finally {
    useStore.getState().setGenerating({ regionGridFor: undefined });
  }
  grid = applyPathing(grid);
  if (grid.width !== REGION_GRID_W || grid.height !== REGION_GRID_H) {
    // Defensive: make sure grid sizes match what the UI expects.
    throw new Error(
      `Region grid for ${regionId} has wrong size ${grid.width}x${grid.height}`,
    );
  }
  useStore.getState().setRegionGrid(grid);
  // Don't await — let images load progressively. Mode-aware: in
  // mosaic mode every cell's call dedupes to a single whole-grid
  // image request; in per-tile mode this prewarms each unique
  // (kind, biome) pair. Calling `getUrl(kind, biome)` directly here
  // would force per-tile mode even when the cache is in mosaic mode,
  // duplicating work and starving the mosaic request of API budget.
  if (!options?.skipPrewarm) {
    prewarmGridImages(ctx.tileImageCache, grid);
  }
  return grid;
}

export async function ensureLocationGrid(
  ctx: NarratorContext,
  locationId: string,
  regionBiome?: string,
  options?: EnsureGridOptions,
): Promise<TileGrid> {
  const location = ctx.world.locations[locationId];
  if (!location) {
    throw new Error(`Unknown location ${locationId}`);
  }
  const region = ctx.world.regionsById[location.region ?? ""];
  useStore.getState().setGenerating({ locationGridFor: locationId });
  let grid;
  try {
    grid = await ctx.tileFiller.getLocationGrid({
      location,
      locationId,
      region,
      regionBiome,
      llmCacheBuster: options?.llmCacheBuster,
    });
  } finally {
    useStore.getState().setGenerating({ locationGridFor: undefined });
  }
  if (grid.width !== LOCATION_GRID_W || grid.height !== LOCATION_GRID_H) {
    throw new Error(
      `Location grid for ${locationId} has wrong size ${grid.width}x${grid.height}`,
    );
  }
  useStore.getState().setLocationGrid(grid);
  if (!options?.skipPrewarm) {
    prewarmGridImages(ctx.tileImageCache, grid);
  }
  return grid;
}

/**
 * Kick off (but never await) the image generation for every cell of
 * a freshly-loaded grid. Routes through `getUrlForTile`, which picks
 * the right strategy based on the cache's current mode:
 *
 *   - per-tile: each unique (kind, biome) key fires one image call;
 *     duplicates within the grid dedupe inside the cache.
 *   - mosaic: all 25-100 calls dedupe to a single whole-grid image
 *     request via `mosaicInFlight`, so this is effectively one call
 *     per grid regardless of how many cells we iterate.
 *
 * The cell renderer triggers its own pre-warm via useEffect, so this
 * loop is technically redundant — but it ensures images start
 * generating the instant a grid is loaded into the store, even if
 * the renderer hasn't mounted yet.
 */
export function prewarmGridImages(cache: TileImageCache, grid: TileGrid): void {
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const tile = getTile(grid, x, y);
      if (!tile) continue;
      void cache.getUrlForTile(grid, x, y, tile).catch(() => null);
    }
  }
}
