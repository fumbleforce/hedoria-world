export type Direction = "north" | "south" | "east" | "west";

export type SceneVerb = "talk" | "attack" | "trade" | "leave" | "engage";

export type PlayerIntent =
  | { kind: "region.move"; dx: number; dy: number }
  | { kind: "region.enterLocation"; locationId: string }
  | { kind: "location.move"; dx: number; dy: number }
  | { kind: "location.enterTile"; x: number; y: number }
  | { kind: "location.leave"; direction?: Direction }
  | { kind: "scene.leaveTile" }
  | { kind: "freetext"; text: string }
  | { kind: "scene.button"; verb: SceneVerb; groupId: string };
