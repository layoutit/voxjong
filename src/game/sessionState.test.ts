import { describe, expect, it } from "vitest";
import {
  createFreshSessionSnapshot,
  restoreSessionSnapshot,
} from "./sessionState";
import { gameUrlStateVersion, type GameUrlState } from "./urlState";

function removedTileIds(seed: number, pairCount: number): number[] {
  return createFreshSessionSnapshot(seed).deal.removalOrder
    .slice(0, pairCount)
    .flatMap(([firstId, secondId]) => [firstId, secondId])
    .sort((left, right) => left - right);
}

describe("Mahjong session snapshots", () => {
  it("recreates the same deal from the same seed", () => {
    const first = createFreshSessionSnapshot(0x12345678);
    const second = createFreshSessionSnapshot(0x12345678);

    expect(second.deal.tiles).toEqual(first.deal.tiles);
    expect(second.deal.removalOrder).toEqual(first.deal.removalOrder);
  });

  it("restores removed tiles without prior timer or move history", () => {
    const seed = 0x87654321;
    const removedIds = removedTileIds(seed, 4);
    const state: GameUrlState = {
      version: gameUrlStateVersion,
      seed,
      removedTileIds: removedIds,
    };

    const restored = restoreSessionSnapshot(state);
    expect(restored).not.toBeNull();
    expect(restored?.elapsedSeconds).toBe(0);
    expect(restored?.undoStack).toEqual([]);
    expect(restored?.redoStack).toEqual([]);
    expect(
      restored?.deal.tiles
        .filter((tile) => tile.removed)
        .map((tile) => tile.id)
        .sort((left, right) => left - right)
    ).toEqual(removedIds);
  });

  it("rejects a removed set that cannot be partitioned into pairs", () => {
    const seed = 0x13572468;
    const [unpairedTileId] = removedTileIds(seed, 1);
    expect(unpairedTileId).toBeDefined();

    const state: GameUrlState = {
      version: gameUrlStateVersion,
      seed,
      removedTileIds: [unpairedTileId!],
    };

    expect(restoreSessionSnapshot(state)).toBeNull();
  });
});
