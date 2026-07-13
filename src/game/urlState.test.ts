import { describe, expect, it } from "vitest";
import {
  gameUrlHash,
  gameUrlStateVersion,
  parseGameUrlHash,
  type GameUrlState,
} from "./urlState";

function encodedHash(bytes: number[], prefix = "#"): string {
  const encoded = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
  return `${prefix}${encoded}`;
}

function stateWithRemoved(removedTileIds: number[]): GameUrlState {
  return {
    version: gameUrlStateVersion,
    seed: 0xfedcba98,
    removedTileIds,
  };
}

describe("game URL state", () => {
  it("round-trips a compact removed-tile set", () => {
    const state = stateWithRemoved([2, 8, 13, 73, 91, 114]);
    const hash = gameUrlHash(state);

    expect(hash).toMatch(/^#[A-Za-z0-9_-]+$/u);
    expect(parseGameUrlHash(hash)).toEqual(state);
  });

  it("uses seven payload characters for fresh and completed games", () => {
    const freshHash = gameUrlHash(stateWithRemoved([]));
    const wonHash = gameUrlHash(
      stateWithRemoved(Array.from({ length: 144 }, (_, tileId) => tileId))
    );

    expect(freshHash.slice(1)).toHaveLength(7);
    expect(wonHash.slice(1)).toHaveLength(7);
    expect(parseGameUrlHash(freshHash)?.removedTileIds).toEqual([]);
    expect(parseGameUrlHash(wonHash)?.removedTileIds).toHaveLength(144);
  });

  it("chooses sparse lists or a bitmap to minimize every board state", () => {
    const sparseRemoved = [3, 17];
    const midpointRemoved = Array.from({ length: 72 }, (_, tileId) => tileId);
    const sparseRemaining = Array.from({ length: 142 }, (_, tileId) => tileId);

    expect(gameUrlHash(stateWithRemoved(sparseRemoved)).slice(1)).toHaveLength(
      10
    );
    expect(
      gameUrlHash(stateWithRemoved(midpointRemoved)).slice(1)
    ).toHaveLength(31);
    expect(
      gameUrlHash(stateWithRemoved(sparseRemaining)).slice(1)
    ).toHaveLength(10);
  });

  it("rejects unrelated, malformed, or future-version hashes", () => {
    expect(parseGameUrlHash("#g=ASxws8ADA6UFP25igmh_")).toBeNull();
    expect(parseGameUrlHash("#about")).toBeNull();
    expect(parseGameUrlHash("#not-valid-binary")).toBeNull();
    expect(parseGameUrlHash(encodedHash([8, 0, 0, 0, 0]))).toBeNull();
  });

  it("rejects odd, duplicate, and out-of-range tile sets", () => {
    expect(parseGameUrlHash(encodedHash([5, 0, 0, 0, 0, 3]))).toBeNull();
    expect(parseGameUrlHash(encodedHash([5, 0, 0, 0, 0, 3, 3]))).toBeNull();
    expect(() => gameUrlHash(stateWithRemoved([2, 2]))).toThrow(RangeError);
    expect(() => gameUrlHash(stateWithRemoved([2, 144]))).toThrow(RangeError);
  });
});
