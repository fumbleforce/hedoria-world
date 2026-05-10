import type { ToolSpec } from "../llm/types";

export const DIALOGUE_TOOLS: ToolSpec[] = [
  {
    name: "say",
    description: "Speak as the NPC",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  {
    name: "offer_quest",
    description: "Offer a quest by id",
    inputSchema: { type: "object", properties: { questId: { type: "string" } }, required: ["questId"] },
  },
  {
    name: "accept_quest",
    description: "Accept a quest",
    inputSchema: { type: "object", properties: { questId: { type: "string" } }, required: ["questId"] },
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
    description: "Start combat",
    inputSchema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
  {
    name: "end_dialogue",
    description: "End dialogue",
    inputSchema: {
      type: "object",
      properties: { mood: { type: "string" } },
      required: ["mood"],
    },
  },
];
