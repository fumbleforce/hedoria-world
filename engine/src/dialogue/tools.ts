import type { ToolSpec } from "../llm/types";

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
    description: "Speak as the NPC",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
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
      "Introduce an NPC group to the active scene tile. id must be unique within the engagement state; npcIds may reference world NPCs.",
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
