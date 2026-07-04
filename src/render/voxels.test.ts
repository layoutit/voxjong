import { describe, expect, it } from "vitest";
import type { Polygon } from "@layoutit/polycss";
import { turtleCells, type GameTile, type TileCode } from "../game/mahjong";
import {
  computeTileGridDimensions,
  createTileMeshSpecs,
  createTilePolygons,
  tilePalettes,
  type TileFaceName,
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

function polygonForFace(polygons: Polygon[], faceName: TileFaceName): Polygon {
  const polygon =
    polygons.find(
      (entry) =>
        entry.data?.faceName === faceName && entry.data?.faceVisible !== false
    ) ?? polygons.find((entry) => entry.data?.faceName === faceName);
  if (!polygon) {
    throw new Error(`Expected ${faceName} polygon.`);
  }
  return polygon;
}

function visibleFaceNames(polygons: Polygon[]): Array<TileFaceName | undefined> {
  return polygons
    .filter((polygon) => polygon.data?.faceVisible !== false)
    .map((polygon) => polygon.data?.faceName);
}

describe("PolyCSS tile rendering", () => {
  it("projects active Mahjong tiles into PolyCSS mesh polygons", () => {
    const [mesh] = createTileMeshSpecs(
      [tile(1, "Man2")],
      new Set([1]),
      textures
    );

    expect(mesh).toMatchObject({
      tileId: 1,
      tileCode: "Man2",
      selectable: true,
    });
    expect(mesh?.polygons).toHaveLength(13);
    expect(visibleFaceNames(mesh?.polygons ?? [])).toEqual([
      "right",
      "left",
      "front",
      "back",
      "top",
    ]);

    const top = polygonForFace(mesh?.polygons ?? [], "top");
    expect(top).toMatchObject({
      vertices: [
        [0, 0.25, 2],
        [1, 0.25, 2],
        [1, 1.25, 2],
        [0, 1.25, 2],
      ],
      color: "#f6ead0",
      texture: "/man2.png",
      uvs: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      data: {
        tileId: 1,
        tileCode: "Man2",
        faceName: "top",
        faceKey: "top",
        faceVisible: true,
        selectable: true,
        blocked: false,
        gridX: 4,
        gridY: 5,
        gridX2: 6,
        gridY2: 7,
        z: 3,
      },
    });

    expect(polygonForFace(mesh?.polygons ?? [], "right")).toMatchObject({
      vertices: [
        [1, 0.25, 1.5],
        [1, 1.25, 1.5],
        [1, 1.25, 2],
        [1, 0.25, 2],
      ],
      color: "#e1d2af",
      data: {
        tileId: 1,
        tileCode: "Man2",
        faceName: "right",
        faceKey: "right:5:7",
        faceVisible: true,
        selectable: true,
        blocked: false,
      },
    });
  });

  it("culls a same-layer face only when an adjacent tile covers that side", () => {
    const base = tile(1, "Man1");
    const rightNeighbor: GameTile = {
      ...tile(2, "Man2"),
      gridX: base.gridX2,
      x: base.gridX2,
      gridX2: base.gridX2 + (base.gridX2 - base.gridX),
      x2: base.gridX2 + (base.gridX2 - base.gridX),
      gridY: base.gridY,
      y: base.gridY,
      gridY2: base.gridY2,
      y2: base.gridY2,
      z: base.z,
    };

    const meshSpecs = createTileMeshSpecs(
      [base, rightNeighbor],
      new Set([1, 2]),
      textures
    );
    const baseFaces = meshSpecs
      .find((mesh) => mesh.tileId === 1)
      ?.polygons.filter((polygon) => polygon.data?.faceVisible !== false)
      .map((polygon) => polygon.data?.faceName);
    const neighborFaces = meshSpecs
      .find((mesh) => mesh.tileId === 2)
      ?.polygons.filter((polygon) => polygon.data?.faceVisible !== false)
      .map((polygon) => polygon.data?.faceName);

    expect(baseFaces).toEqual(["left", "front", "back", "top"]);
    expect(neighborFaces).toEqual(["right", "front", "back", "top"]);
  });

  it("renders only the exposed side span for a partial half-offset neighbor", () => {
    const base = tile(1, "Man1");
    const partialRightNeighbor: GameTile = {
      ...tile(2, "Man2"),
      gridX: base.gridX2,
      x: base.gridX2,
      gridX2: base.gridX2 + 2,
      x2: base.gridX2 + 2,
      gridY: base.gridY + 1,
      y: base.gridY + 1,
      gridY2: base.gridY + 3,
      y2: base.gridY + 3,
      z: base.z,
    };

    const meshSpecs = createTileMeshSpecs(
      [base, partialRightNeighbor],
      new Set([1, 2]),
      textures
    );
    const baseMesh = meshSpecs.find((mesh) => mesh.tileId === 1);
    const baseRightFaces = baseMesh?.polygons.filter(
      (polygon) =>
        polygon.data?.faceName === "right" &&
        polygon.data?.faceVisible !== false
    );

    expect(baseRightFaces).toHaveLength(1);
    expect(baseRightFaces?.[0]?.vertices).toEqual([
      [0.5, 0, 1.5],
      [0.5, 0.5, 1.5],
      [0.5, 0.5, 2],
      [0.5, 0, 2],
    ]);
  });

  it("culls covered faces while keeping a rotation-safe exterior shell", () => {
    const activeTiles = turtleCells.map((cell): GameTile => {
      return {
        ...cell,
        code: "Man1",
        removed: false,
      };
    });
    const meshSpecs = createTileMeshSpecs(
      activeTiles,
      new Set(activeTiles.map((entry) => entry.id)),
      textures
    );
    const faceCounts = meshSpecs
      .flatMap((mesh) => mesh.polygons)
      .filter((polygon) => polygon.data?.faceVisible !== false)
      .reduce<Record<string, number>>((counts, polygon) => {
        const faceName = polygon.data?.faceName;
        if (!faceName) {
          return counts;
        }
        counts[faceName] = (counts[faceName] ?? 0) + 1;
        return counts;
      }, {});

    expect(meshSpecs).toHaveLength(144);
    expect(faceCounts).toEqual({
      left: 22,
      right: 22,
      front: 36,
      back: 36,
      top: 88,
    });
  });

  it("uses half-unit turtle bounds for centered upper tile geometry", () => {
    const activeTiles = turtleCells.map((cell): GameTile => {
      return {
        ...cell,
        code: "Man1",
        removed: false,
      };
    });
    const meshSpecs = createTileMeshSpecs(
      activeTiles,
      new Set(activeTiles.map((entry) => entry.id)),
      textures
    );
    const capMesh = meshSpecs.find((mesh) => mesh.tileId === 143);
    const capTop = polygonForFace(capMesh?.polygons ?? [], "top");

    expect(capTop).toMatchObject({
      vertices: [
        [-1.5, -1, 2.5],
        [-0.5, -1, 2.5],
        [-0.5, 0, 2.5],
        [-1.5, 0, 2.5],
      ],
      data: {
        tileId: 143,
        gridX: 13,
        gridY: 7,
        gridX2: 15,
        gridY2: 9,
        z: 4,
      },
    });
  });

  it("keeps remaining tile geometry stable when an edge tile is removed", () => {
    const activeTiles = turtleCells.map((cell): GameTile => {
      return {
        ...cell,
        code: "Man1",
        removed: false,
      };
    });
    const stableDimensions = computeTileGridDimensions(activeTiles);
    const rightEdgeTile = activeTiles.reduce((rightmost, entry) => {
      return entry.gridX2 > rightmost.gridX2 ? entry : rightmost;
    }, activeTiles[0] as GameTile);
    const remainingTiles = activeTiles.filter(
      (entry) => entry.id !== rightEdgeTile.id
    );
    const fullFreeIds = new Set(activeTiles.map((entry) => entry.id));
    const remainingFreeIds = new Set(remainingTiles.map((entry) => entry.id));
    const beforeStable = createTileMeshSpecs(
      activeTiles,
      fullFreeIds,
      textures,
      tilePalettes.light,
      stableDimensions
    );
    const afterStable = createTileMeshSpecs(
      remainingTiles,
      remainingFreeIds,
      textures,
      tilePalettes.light,
      stableDimensions
    );
    const afterDynamic = createTileMeshSpecs(
      remainingTiles,
      remainingFreeIds,
      textures
    );

    const beforeTop = polygonForFace(
      beforeStable.find((mesh) => mesh.tileId === 0)?.polygons ?? [],
      "top"
    );
    const afterStableTop = polygonForFace(
      afterStable.find((mesh) => mesh.tileId === 0)?.polygons ?? [],
      "top"
    );
    const afterDynamicTop = polygonForFace(
      afterDynamic.find((mesh) => mesh.tileId === 0)?.polygons ?? [],
      "top"
    );

    expect(rightEdgeTile.id).toBe(86);
    expect(afterStableTop.vertices).toEqual(beforeTop.vertices);
    expect(afterDynamicTop.vertices).not.toEqual(beforeTop.vertices);
  });

  it("marks blocked tile polygons and falls back to the Man1 top texture", () => {
    const [mesh] = createTileMeshSpecs(
      [tile(2, "Man3")],
      new Set(),
      textures
    );

    expect(mesh).toMatchObject({
      tileId: 2,
      tileCode: "Man3",
      selectable: false,
    });
    expect(polygonForFace(mesh?.polygons ?? [], "top")).toMatchObject({
      color: "#f6ead0",
      texture: "/man1.png",
      data: {
        tileId: 2,
        tileCode: "Man3",
        faceName: "top",
        selectable: false,
        blocked: true,
      },
    });
    expect(polygonForFace(mesh?.polygons ?? [], "front")).toMatchObject({
      color: "#e1d2af",
      data: {
        tileId: 2,
        tileCode: "Man3",
        faceName: "front",
        selectable: false,
        blocked: true,
      },
    });
  });

  it("uses the supplied dark palette for top, side, and bottom polygons", () => {
    const [mesh] = createTileMeshSpecs(
      [tile(1, "Man1")],
      new Set([1]),
      textures,
      tilePalettes.dark
    );

    expect(polygonForFace(mesh?.polygons ?? [], "top").color).toBe("#1e1e1e");
    expect(polygonForFace(mesh?.polygons ?? [], "front").color).toBe("#2a2a2a");
    expect(polygonForFace(mesh?.polygons ?? [], "right").color).toBe("#2a2a2a");
  });

  it("can flatten tile mesh specs into a scene polygon list", () => {
    expect(
      createTilePolygons(
        [tile(1, "Man1"), tile(2, "Man2")],
        new Set([1]),
        textures
      )
    ).toHaveLength(26);
  });
});
