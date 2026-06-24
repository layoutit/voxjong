import { describe, expect, it } from "vitest";
import type { GameTile, TileCode } from "../game/mahjong";
import {
  createSceneState,
  createTileVoxels,
  type TileTextureMap,
} from "./voxels";

function tile(id: number, code: TileCode): GameTile {
  return {
    id,
    code,
    x: 1,
    y: 2,
    z: 3,
    x2: 2,
    y2: 3,
    gridX: 4,
    gridY: 5,
    gridX2: 6,
    gridY2: 7,
    removed: false,
  };
}

const textures = {
  Man1: "/man1.png",
  Man2: "/man2.png",
} as TileTextureMap;

describe("VoxCSS tile rendering", () => {
  it("projects active Mahjong tiles into VoxCSS voxels", () => {
    expect(createTileVoxels([tile(1, "Man2")], new Set([1]), textures)).toEqual(
      [
        {
          x: 4,
          y: 5,
          z: 3,
          x2: 6,
          y2: 7,
          color: "#f4e4bf",
          texture: "/man2.png",
          shape: "cube",
        },
      ]
    );
  });

  it("wraps voxels in the VoxJong scene settings", () => {
    const voxels = createTileVoxels([tile(1, "Man1")], new Set(), textures);

    expect(createSceneState(voxels)).toEqual({
      voxels,
      projection: "dimetric",
      showFloor: false,
      showWalls: false,
      mergeVoxels: false,
    });
  });
});
