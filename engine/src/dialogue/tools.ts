import type { ToolSpec } from "../llm/types";
import type { PlayerIntent } from "./playerIntent";
import type { ActionOutcome } from "../state/store";

/**
 * Catalogue of every tool the LLM is allowed to invoke. The tool-call
 * dispatcher in `dialogue/narrator.ts` validates each invocation against
 * the matching zod schema and rejects calls for tools NOT listed here.
 *
 * Tools are split into three groups for readability — the engine doesn't
 * actually care about the order:
 *
 *   1. Original NPC dialogue tools (kept unchanged so the existing chat /
 *      quest hand-off flow still works).
 *   2. New 2D-engine tools that drive the region/location/scene loops.
 *   3. Inventory + shop tools triggered by both LLM-narrated trades and
 *      direct player button clicks (in which case the UI synthesises a
 *      tool call instead of going through the LLM).
 */
export const DIALOGUE_TOOLS: ToolSpec[] = [
  // ---------------- 1. NPC dialogue (unchanged from the deprecated 3D engine)
  {
    name: "say",
    description:
      "Speak as a specific NPC. Use this for every NPC line in dialogue — it is REQUIRED whenever the player addresses an engaged NPC, asks them a question, or trades remarks with them. Never write NPC speech in the assistant content channel; that channel is narration only.",
    inputSchema: {
      type: "object",
      properties: {
        npcId: {
          type: "string",
          description:
            "Stable id of the speaker, e.g. `world-npc-saska-vorin`. Use the id from the engaged group's `npcs` list. For anonymous/procedural party crowds you may pass the group id; for unscripted single strangers you may omit.",
        },
        text: {
          type: "string",
          description:
            "The NPC's spoken line, first-person, in their voice. Do not include the speaker's name in the text itself — the engine prefixes it from npcId.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "offer_quest",
    description: "Offer a quest by id",
    inputSchema: {
      type: "object",
      properties: { questId: { type: "string" } },
      required: ["questId"],
    },
  },
  {
    name: "accept_quest",
    description: "Accept a quest",
    inputSchema: {
      type: "object",
      properties: { questId: { type: "string" } },
      required: ["questId"],
    },
  },
  {
    name: "update_quest_progress",
    description: "Write a progress update note",
    inputSchema: {
      type: "object",
      properties: { questId: { type: "string" }, note: { type: "string" } },
      required: ["questId", "note"],
    },
  },
  {
    name: "complete_quest",
    description: "Mark quest complete with evidence",
    inputSchema: {
      type: "object",
      properties: { questId: { type: "string" }, evidence: { type: "string" } },
      required: ["questId", "evidence"],
    },
  },
  {
    name: "fail_quest",
    description: "Mark quest failed",
    inputSchema: {
      type: "object",
      properties: { questId: { type: "string" }, reason: { type: "string" } },
      required: ["questId", "reason"],
    },
  },
  {
    name: "give_item",
    description: "Give an item to player",
    inputSchema: {
      type: "object",
      properties: { itemId: { type: "string" }, qty: { type: "number" } },
      required: ["itemId", "qty"],
    },
  },
  {
    name: "give_currency",
    description: "Give currency to player",
    inputSchema: {
      type: "object",
      properties: {
        gold: { type: "number" },
        silver: { type: "number" },
        copper: { type: "number" },
      },
    },
  },
  {
    name: "request_skill_check",
    description: "Request an engine skill check",
    inputSchema: {
      type: "object",
      properties: {
        skill: { type: "string" },
        difficulty: { type: "number" },
        stake: { type: "string" },
      },
      required: ["skill", "difficulty", "stake"],
    },
  },
  {
    name: "attack",
    description: "Legacy alias for start_combat from the 3D engine; routes to start_combat",
    inputSchema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
  {
    name: "end_dialogue",
    description: "End dialogue and return the player to scene mode",
    inputSchema: {
      type: "object",
      properties: { mood: { type: "string" } },
      required: ["mood"],
    },
  },
  {
    name: "apply_condition",
    description: "Apply or update a player condition used by future action evaluation",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        label: { type: "string" },
        severity: { type: "string" },
        effects: { type: "array", items: { type: "string" } },
        notes: { type: "string" },
        expiresAt: { type: "number" },
      },
      required: ["label"],
    },
  },
  {
    name: "clear_condition",
    description: "Remove a previously applied player condition by id",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "remember_fact",
    description: "Store a durable story fact the evaluator should consider in future turns",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        text: { type: "string" },
        scope: { type: "object" },
        importance: { type: "string", enum: ["minor", "normal", "critical"] },
        expiresAt: { type: "number" },
      },
      required: ["text"],
    },
  },
  {
    name: "forget_fact",
    description: "Forget a durable story fact by id",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["id"],
    },
  },

  // ---------------- 2. 2D-engine traversal + engagement
  {
    name: "narrate",
    description:
      "Append a piece of pure narration to the player-facing log. Use for ambient description; do not announce mechanical state changes (which are conveyed by other tools).",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "move_region",
    description:
      "Move the player one step on the region grid. Direction is one of north/south/east/west, OR provide explicit dx/dy in the range [-1,1].",
    inputSchema: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["north", "south", "east", "west"],
        },
        dx: { type: "number" },
        dy: { type: "number" },
      },
    },
  },
  {
    name: "travel_region",
    description:
      "Move the player along a route to the target region cell (x,y) in one journey. Use when the player chose a distant tile and confirmed travel; do not chain multiple move_region calls for the same intent.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "move_location",
    description:
      "Move the player one step on the active location grid. Same direction/dx/dy semantics as move_region.",
    inputSchema: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["north", "south", "east", "west"],
        },
        dx: { type: "number" },
        dy: { type: "number" },
      },
    },
  },
  {
    name: "enter_location",
    description:
      "Enter a location the player is currently standing on. The locationId must match a location-anchor tile at the player's current region position.",
    inputSchema: {
      type: "object",
      properties: { locationId: { type: "string" } },
      required: ["locationId"],
    },
  },
  {
    name: "leave_location",
    description:
      "Leave the current location, returning to the region grid. If `direction` is supplied, the player also steps one cell in that direction on the region grid (used by the four cardinal exit tiles on a location map).",
    inputSchema: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["north", "south", "east", "west"],
        },
      },
    },
  },
  {
    name: "enter_tile",
    description:
      "Enter the location tile at (x,y), transitioning to scene mode. Coordinates are validated against the active location grid.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "leave_tile",
    description: "Leave the current scene tile and return to the location grid.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "spawn_group",
    description:
      "Spawn a procedural **party** on this scene tile (same as `spawn_party`). Use for strangers the pack does not list: a lone traveler, OR a band of 2–3 world NPC ids (merchants, thieves, guards, rivals), OR leave npcIds empty for an anonymous crowd named in `name`/`summary`. Never put authored-on-tile characters here — they are already present as standalone **characters**. At most 3 npcIds per party.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        npcIds: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
      },
      required: ["id", "name"],
    },
  },
  {
    name: "spawn_party",
    description:
      "Alias of `spawn_group`. Spawn a procedural party: 0 ids (anonymous band), 1 id (lone NPC), or 2–3 ids (small group). Examples: caravan merchants, alley thieves, patrol guards.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        npcIds: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
      },
      required: ["id", "name"],
    },
  },
  {
    name: "dismiss_party",
    description:
      "Remove a procedural party from the scene (e.g. they leave, scatter, or you reform groups after persuasion). Cannot target authored characters (`world-npc-*`). To move someone between parties, dismiss the old party and spawn_party with the new npcIds composition.",
    inputSchema: {
      type: "object",
      properties: { groupId: { type: "string" } },
      required: ["groupId"],
    },
  },
  {
    name: "add_to_player_party",
    description:
      "Add a world NPC to the player's traveling party (shown under their portrait in the UI). Cap enforced by the engine. Use when they agree to travel together, are hired, or are rescued into the fold.",
    inputSchema: {
      type: "object",
      properties: { npcId: { type: "string" } },
      required: ["npcId"],
    },
  },
  {
    name: "remove_from_player_party",
    description:
      "Remove an NPC from the player's traveling party (they leave, die off-screen, betray, or stay behind). Does not remove scene engagement tiles — only the persistent companion strip.",
    inputSchema: {
      type: "object",
      properties: { npcId: { type: "string" } },
      required: ["npcId"],
    },
  },
  {
    name: "engage",
    description: "Engage with a previously-spawned NPC group.",
    inputSchema: {
      type: "object",
      properties: { groupId: { type: "string" } },
      required: ["groupId"],
    },
  },
  {
    name: "disengage",
    description:
      "Disengage from an NPC group. Refused while any group is locked.",
    inputSchema: {
      type: "object",
      properties: { groupId: { type: "string" } },
      required: ["groupId"],
    },
  },
  {
    name: "lock_engagement",
    description:
      "Lock the player into the current scene; disengage / leave_tile become impossible until unlock_engagement runs.",
    inputSchema: {
      type: "object",
      properties: { groupId: { type: "string" }, reason: { type: "string" } },
      required: ["groupId", "reason"],
    },
  },
  {
    name: "unlock_engagement",
    description: "Lift the engagement lock so the player can disengage / leave.",
    inputSchema: {
      type: "object",
      properties: { groupId: { type: "string" } },
      required: ["groupId"],
    },
  },
  {
    name: "start_combat",
    description:
      "Begin a turn-based combat encounter against the named group. Use when an NPC has signaled hostility.",
    inputSchema: {
      type: "object",
      properties: {
        groupId: { type: "string" },
        reason: { type: "string" },
      },
      required: ["groupId"],
    },
  },
  {
    name: "end_combat",
    description: "End the active combat encounter.",
    inputSchema: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          enum: ["victory", "defeat", "flee", "truce"],
        },
        summary: { type: "string" },
      },
      required: ["outcome"],
    },
  },

  // ---------------- 3. Inventory + shop
  {
    name: "open_shop",
    description:
      "Open the shop UI for a merchant NPC. The merchant's offers are derived from world data and any temporary stock the LLM provides.",
    inputSchema: {
      type: "object",
      properties: {
        npcId: { type: "string" },
        offers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              itemId: { type: "string" },
              price: { type: "number" },
              stock: { type: "number" },
            },
            required: ["itemId", "price"],
          },
        },
      },
      required: ["npcId"],
    },
  },
  {
    name: "close_shop",
    description: "Close the shop UI and return to scene mode.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "shop_buy",
    description: "Player buys qty of itemId at the offered price.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string" },
        qty: { type: "number" },
      },
      required: ["itemId", "qty"],
    },
  },
  {
    name: "shop_sell",
    description: "Player sells qty of itemId at the offered price.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string" },
        qty: { type: "number" },
      },
      required: ["itemId", "qty"],
    },
  },
  {
    name: "equip",
    description: "Equip itemId into the named slot, replacing any prior occupant.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string" },
        slot: {
          type: "string",
          enum: [
            "head",
            "body",
            "legs",
            "feet",
            "hands",
            "mainHand",
            "offHand",
            "trinket1",
            "trinket2",
          ],
        },
      },
      required: ["itemId", "slot"],
    },
  },
  {
    name: "unequip",
    description: "Remove whatever is in the named slot.",
    inputSchema: {
      type: "object",
      properties: {
        slot: {
          type: "string",
          enum: [
            "head",
            "body",
            "legs",
            "feet",
            "hands",
            "mainHand",
            "offHand",
            "trinket1",
            "trinket2",
          ],
        },
      },
      required: ["slot"],
    },
  },
  {
    name: "update_quest_objective",
    description:
      "Adjust an objective counter for a quest by `delta` (positive or negative). The dispatcher refuses if the quest is not active.",
    inputSchema: {
      type: "object",
      properties: {
        questId: { type: "string" },
        key: { type: "string" },
        delta: { type: "number" },
      },
      required: ["questId", "key", "delta"],
    },
  },
];

const TOOL_BY_NAME = new Map(DIALOGUE_TOOLS.map((t) => [t.name, t] as const));
const pick = (names: string[]): ToolSpec[] =>
  names
    .map((name) => TOOL_BY_NAME.get(name))
    .filter((tool): tool is ToolSpec => Boolean(tool));

export const META_TOOLS = pick(["narrate", "say", "remember_fact", "forget_fact"]);
export const CONDITION_TOOLS = pick(["apply_condition", "clear_condition"]);
export const MOVEMENT_TOOLS = pick([
  "move_region",
  "travel_region",
  "move_location",
  "enter_location",
  "leave_location",
  "enter_tile",
  "leave_tile",
]);

const MOVEMENT_TOOL_NAMES = new Set(MOVEMENT_TOOLS.map((t) => t.name));
export function isMovementTool(name: string): boolean {
  return MOVEMENT_TOOL_NAMES.has(name);
}

/**
 * Hard, programmatic mode → movement-tool allowlist. The available
 * transitions are 100% deterministic at any moment — they depend
 * exclusively on what mode we're currently in:
 *
 *   region  → move/travel on the region grid; enter_location to drop
 *             into a named location grid. There is nothing to "leave"
 *             from here.
 *   location → walk the location grid, enter a tile (→ scene), or
 *              leave_location back up to the region grid. `leave_tile`
 *              is meaningless (we aren't in a tile yet).
 *   scene   → leave_tile is the only valid transition (back to the
 *             location grid). `leave_location`, region/location moves,
 *             enter_location etc. would skip levels.
 *
 * This is enforced TWICE on purpose: the LLM never sees a wrong-mode
 * tool in the catalog (so it can't choose it), and if a stale catalog
 * or a hand-crafted call slips through, the dispatcher's `ensureMode`
 * check in narrator.ts still rejects it.
 */
const MOVEMENT_BY_MODE: Record<"region" | "location" | "scene", string[]> = {
  region: ["move_region", "travel_region", "enter_location"],
  location: ["move_location", "enter_tile", "leave_location"],
  scene: ["leave_tile"],
};

/**
 * For structured (non-freetext) movement intents we additionally narrow
 * to the SINGLE canonical tool — even though the mode allowlist would
 * already exclude the wrong-level tools, the LLM doesn't need to be
 * tempted by `enter_location` when the user clicked "move_region". The
 * scoped table below is the intersection of (a) what makes sense for
 * this specific click and (b) what's legal in the current mode.
 */
const SCOPED_MOVEMENT_BY_INTENT: Record<string, string[]> = {
  "region.move": ["move_region"],
  "region.travelTo": ["travel_region"],
  "region.enterLocation": ["enter_location"],
  "location.move": ["move_location"],
  "location.enterTile": ["enter_tile"],
  "location.leave": ["leave_location"],
  "scene.leaveTile": ["leave_tile"],
};
export const ENGAGEMENT_TOOLS = pick([
  "spawn_group",
  "spawn_party",
  "dismiss_party",
  "engage",
  "disengage",
  "lock_engagement",
  "unlock_engagement",
  "start_combat",
  "end_combat",
  "end_dialogue",
]);
export const PARTY_TOOLS = pick(["add_to_player_party", "remove_from_player_party"]);
export const QUEST_TOOLS = pick([
  "offer_quest",
  "accept_quest",
  "update_quest_progress",
  "complete_quest",
  "fail_quest",
  "update_quest_objective",
]);
export const INVENTORY_TOOLS = pick([
  "give_item",
  "give_currency",
  "open_shop",
  "close_shop",
  "shop_buy",
  "shop_sell",
  "equip",
  "unequip",
]);

export function toolsForTurn(
  intent: PlayerIntent,
  outcome: ActionOutcome,
  mode: "region" | "location" | "scene",
): ToolSpec[] {
  const base = [...META_TOOLS, ...CONDITION_TOOLS];
  const add = (arr: ToolSpec[]) => {
    for (const tool of arr) {
      if (!base.some((t) => t.name === tool.name)) base.push(tool);
    }
  };
  const canonical = outcome.interpretation.canonicalIntent;
  const applyByIntent = (kind: string, scoped: boolean) => {
    const scopedMovement = SCOPED_MOVEMENT_BY_INTENT[kind];
    if (scopedMovement) {
      // Structured movement click: only expose THIS movement tool.
      // Don't tempt the model into a sibling like `leave_location`
      // when the user actually clicked "leave scene tile".
      if (scoped) {
        add(pick(scopedMovement));
      } else {
        add(MOVEMENT_TOOLS);
      }
      return;
    }
    if (kind === "scene.button") {
      add(ENGAGEMENT_TOOLS);
      add(INVENTORY_TOOLS);
      add(QUEST_TOOLS);
      return;
    }
    if (kind === "freetext") {
      // Freetext is interpretive — the model picks among many possible
      // mechanical effects, including movement at either scale, so give
      // it the broad catalogue.
      add(MOVEMENT_TOOLS);
      add(ENGAGEMENT_TOOLS);
      add(QUEST_TOOLS);
      add(PARTY_TOOLS);
      return;
    }
  };

  if (intent.kind === "freetext" && canonical && outcome.interpretation.confidence === "high") {
    // Semantic interpretation of free prose resolved to a specific
    // canonical click; treat the model as if the user had clicked it,
    // and apply the same tight scoping.
    applyByIntent(canonical.kind, true);
  } else {
    applyByIntent(intent.kind, intent.kind !== "freetext");
  }
  if (mode === "scene") {
    add(ENGAGEMENT_TOOLS);
    add(PARTY_TOOLS);
  }

  // Programmatic safety gate: strip any movement tool that isn't
  // legal in the current mode, no matter how it got into `base`. This
  // is the layer the user is asking for — even if a future code path
  // accidentally adds `leave_location` while we're in scene mode, the
  // LLM literally never sees it.
  const allowedMovement = new Set(MOVEMENT_BY_MODE[mode]);
  return base.filter(
    (t) => !MOVEMENT_TOOL_NAMES.has(t.name) || allowedMovement.has(t.name),
  );
}
