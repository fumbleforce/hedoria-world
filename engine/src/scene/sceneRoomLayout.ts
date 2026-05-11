import type { EngagementGroup } from "../state/store";

export const SCENE_ROOM_COLS = 6;
export const SCENE_ROOM_ROWS = 4;

export type SceneRoomPlacement = {
  groupId: string;
  col: number;
  row: number;
};

export type SceneRoomLayoutResult = {
  /** Anchor cell for the player portrait (bottom-centre of the grid). */
  playerCol: number;
  playerRow: number;
  /** Groups placed on the grid; overflow groups appear only in the sidebar list. */
  placements: SceneRoomPlacement[];
};

/**
 * Deterministic slot assignment: scan rows top→bottom, cols left→right,
 * skipping the reserved player cell. At most `(cols * rows - 1)` groups
 * receive a cell; additional groups are omitted here by design.
 */
export function computeSceneRoomLayout(
  groupsInOrder: EngagementGroup[],
  cols: number = SCENE_ROOM_COLS,
  rows: number = SCENE_ROOM_ROWS,
): SceneRoomLayoutResult {
  const playerCol = Math.floor(cols / 2);
  const playerRow = rows - 1;

  const maxSlots = Math.max(0, cols * rows - 1);
  const groups = groupsInOrder.slice(0, maxSlots);

  const placements: SceneRoomPlacement[] = [];
  let gi = 0;

  for (let row = 0; row < rows && gi < groups.length; row += 1) {
    for (let col = 0; col < cols && gi < groups.length; col += 1) {
      if (col === playerCol && row === playerRow) {
        continue;
      }
      placements.push({
        groupId: groups[gi].id,
        col,
        row,
      });
      gi += 1;
    }
  }

  return { playerCol, playerRow, placements };
}
