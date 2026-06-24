import type { SceneState } from "@layoutit/voxcss";
import type { GameTile, TileCode } from "../game/mahjong";

export type TileTextureMap = Record<TileCode, string> & Record<string, string>;

export function createTileVoxels(
  activeTiles: ReadonlyArray<GameTile>,
  freeTileIds: ReadonlySet<number>,
  tileTextures: TileTextureMap
): SceneState["voxels"] {
  return activeTiles.map((tile) => {
    const isFree = freeTileIds.has(tile.id);
    const color = isFree ? "#f4e4bf" : "#dcc89f";
    return {
      x: tile.gridX,
      y: tile.gridY,
      z: tile.z,
      x2: tile.gridX2,
      y2: tile.gridY2,
      color,
      texture: tileTextures[tile.code] ?? tileTextures.Man1,
      shape: "cube" as const,
    };
  });
}

export function createSceneState(voxels: SceneState["voxels"]): SceneState {
  return {
    voxels,
    projection: "dimetric",
    showFloor: false,
    showWalls: false,
    mergeVoxels: false,
  };
}
