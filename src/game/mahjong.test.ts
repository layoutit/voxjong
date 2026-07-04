import { describe, expect, it } from "vitest";
import {
  canPair,
  createGameTiles,
  createPairBag,
  getAvailablePairs,
  getFreeTileIds,
  getTileBlockingInfo,
  requiredTileNames,
  turtleCells,
  turtleLayout,
  type GameTile,
  type TileCode,
  type TileBounds,
} from "./mahjong";

function bounds(
  id: number,
  gridX: number,
  gridY: number,
  z = 0,
  width = 2,
  height = 2
): TileBounds {
  return {
    id,
    x: gridX,
    y: gridY,
    z,
    x2: gridX + width,
    y2: gridY + height,
    gridX,
    gridY,
    gridX2: gridX + width,
    gridY2: gridY + height,
  };
}

function tile(id: number, code: TileCode): GameTile {
  return {
    ...bounds(id, id, 0),
    code,
    removed: false,
  };
}

describe("Mahjong turtle layout", () => {
  it("builds the expected 144-cell board", () => {
    expect(turtleLayout()).toHaveLength(144);
    expect(turtleCells).toHaveLength(144);
    expect(new Set(turtleCells.map((cell) => cell.id)).size).toBe(144);
  });

  it("maps turtle coordinates to stable half-unit tile bounds", () => {
    expect(
      turtleCells.every((cell) => {
        return cell.gridX2 - cell.gridX === 2 && cell.gridY2 - cell.gridY === 2;
      })
    ).toBe(true);
    expect(turtleCells[0]).toMatchObject({
      id: 0,
      x: 2,
      y: 0,
      z: 0,
      x2: 4,
      y2: 2,
      gridX: 2,
      gridY: 0,
      gridX2: 4,
      gridY2: 2,
    });
    expect(turtleCells[84]).toMatchObject({
      id: 84,
      x: 0,
      y: 7,
      z: 0,
      x2: 2,
      y2: 9,
      gridX: 0,
      gridY: 7,
      gridX2: 2,
      gridY2: 9,
    });
    expect(turtleCells[143]).toMatchObject({
      id: 143,
      x: 13,
      y: 7,
      z: 4,
      x2: 15,
      y2: 9,
      gridX: 13,
      gridY: 7,
      gridX2: 15,
      gridY2: 9,
    });
  });
});

describe("Mahjong tile bags", () => {
  it("includes every required tile texture name", () => {
    expect(requiredTileNames).toHaveLength(42);
    expect(requiredTileNames).toContain("Man1");
    expect(requiredTileNames).toContain("Chun");
    expect(requiredTileNames).toContain("Flower4");
    expect(requiredTileNames).toContain("Season4");
  });

  it("creates 72 pair entries for a 144 tile deal", () => {
    const pairs = createPairBag();

    expect(pairs).toHaveLength(72);
    expect(pairs.flat()).toHaveLength(144);
  });

  it("creates a complete game deal", () => {
    const tiles = createGameTiles();

    expect(tiles).toHaveLength(144);
    expect(new Set(tiles.map((entry) => entry.id)).size).toBe(144);
    expect(tiles.every((entry) => requiredTileNames.includes(entry.code))).toBe(
      true
    );
  });
});

describe("Mahjong blocking rules", () => {
  it("blocks a tile when another tile overlaps its top half-unit rectangle", () => {
    const target = bounds(1, 10, 10);
    const top = bounds(2, 11, 11, 1);
    const info = getTileBlockingInfo(target, [target, top]);

    expect(info.blockedTop).toBe(true);
    expect(info.isFree).toBe(false);
    expect(info.topIds).toEqual([2]);
  });

  it("does not top-block when half-unit rectangles only touch edges", () => {
    const target = bounds(1, 10, 10);
    const touchingTop = bounds(2, 12, 10, 1);
    const info = getTileBlockingInfo(target, [target, touchingTop]);

    expect(info.blockedTop).toBe(false);
    expect(info.topIds).toEqual([]);
    expect(info.isFree).toBe(true);
  });

  it("keeps a tile free when only one horizontal side has exact edge contact", () => {
    const target = bounds(1, 10, 10);
    const left = bounds(2, 8, 11);
    const info = getTileBlockingInfo(target, [target, left]);

    expect(info.blockedLeft).toBe(true);
    expect(info.blockedRight).toBe(false);
    expect(info.isFree).toBe(true);
  });

  it("blocks a tile when both horizontal sides are blocked", () => {
    const target = bounds(1, 10, 10);
    const left = bounds(2, 8, 11);
    const right = bounds(3, 12, 11);
    const info = getTileBlockingInfo(target, [target, left, right]);

    expect(info.blockedLeft).toBe(true);
    expect(info.blockedRight).toBe(true);
    expect(info.isFree).toBe(false);
  });

  it("does not side-block without exact same-layer edge contact and span overlap", () => {
    const target = bounds(1, 10, 10);
    const gapLeft = bounds(2, 7, 11);
    const edgeOnlyLeft = bounds(3, 8, 12);
    const wrongLayerLeft = bounds(4, 8, 11, 1);
    const info = getTileBlockingInfo(target, [
      target,
      gapLeft,
      edgeOnlyLeft,
      wrongLayerLeft,
    ]);

    expect(info.blockedLeft).toBe(false);
    expect(info.leftIds).toEqual([]);
    expect(info.isFree).toBe(true);
  });

  it("reports free tile ids from half-unit blocking state", () => {
    const target = bounds(1, 10, 10);
    const left = bounds(2, 8, 11);
    const right = bounds(3, 12, 11);
    const top = bounds(4, 11, 11, 1);

    expect(getFreeTileIds([target, left])).toEqual([1, 2]);
    expect(getFreeTileIds([target, left, right])).toEqual([2, 3]);
    expect(getFreeTileIds([target, top])).toEqual([4]);
  });
});

describe("Mahjong pairing rules", () => {
  it("matches identical ordinary tiles", () => {
    expect(canPair("Man1", "Man1")).toBe(true);
    expect(canPair("Man1", "Man2")).toBe(false);
  });

  it("matches flowers with flowers and seasons with seasons", () => {
    expect(canPair("Flower1", "Flower4")).toBe(true);
    expect(canPair("Season1", "Season3")).toBe(true);
    expect(canPair("Flower1", "Season1")).toBe(false);
  });

  it("groups available pairs by Mahjong pairing category", () => {
    expect(
      getAvailablePairs([
        tile(1, "Man1"),
        tile(2, "Man1"),
        tile(3, "Flower1"),
        tile(4, "Flower4"),
        tile(5, "Season1"),
      ])
    ).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});
