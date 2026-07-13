import {
  canPair,
  createGameDeal,
  type GameDeal,
  type GameTile,
  type MoveRecord,
} from "./mahjong";
import { createSeededRandom } from "./random";
import type { GameUrlState } from "./urlState";

export type MahjongSessionSnapshot = {
  seed: number;
  deal: GameDeal;
  undoStack: MoveRecord[];
  redoStack: MoveRecord[];
  elapsedSeconds: number;
};

function createVersionedDeal(
  state: Pick<GameUrlState, "version" | "seed">
): GameDeal {
  // Keep this switch when deal generation changes: old shared URLs must retain
  // their original generator, while a new format version can select a new one.
  switch (state.version) {
    case 1:
      return createGameDeal(createSeededRandom(state.seed));
  }
}

function canPartitionIntoPairs(tiles: GameTile[]): boolean {
  const unpaired = [...tiles];
  while (unpaired.length > 0) {
    const first = unpaired.pop();
    if (!first) {
      return false;
    }
    const matchIndex = unpaired.findIndex((tile) =>
      canPair(first.code, tile.code)
    );
    if (matchIndex < 0) {
      return false;
    }
    unpaired.splice(matchIndex, 1);
  }
  return true;
}

export function createFreshSessionSnapshot(
  seed: number
): MahjongSessionSnapshot {
  return {
    seed,
    deal: createGameDeal(createSeededRandom(seed)),
    undoStack: [],
    redoStack: [],
    elapsedSeconds: 0,
  };
}

export function restoreSessionSnapshot(
  state: GameUrlState
): MahjongSessionSnapshot | null {
  const deal = createVersionedDeal(state);
  const removedIds = new Set(state.removedTileIds);
  if (removedIds.size !== state.removedTileIds.length) {
    return null;
  }
  const removedTiles = deal.tiles.filter((tile) => removedIds.has(tile.id));
  if (
    removedTiles.length !== state.removedTileIds.length ||
    !canPartitionIntoPairs(removedTiles)
  ) {
    return null;
  }
  for (const tile of deal.tiles) {
    tile.removed = removedIds.has(tile.id);
  }

  return {
    seed: state.seed,
    deal,
    undoStack: [],
    redoStack: [],
    elapsedSeconds: 0,
  };
}
