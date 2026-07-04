import {
  boxPolygons,
  type BoxFace,
  type BoxFaceOptions,
  type Polygon,
} from "@layoutit/polycss";
import { overlapOnAxis, type GameTile, type TileCode } from "../game/mahjong";

export type TileTextureMap = Record<TileCode, string> & Record<string, string>;

export type TilePalette = {
  top: string;
  side: string;
  bottom: string;
  blockedTop: string;
  blockedSide: string;
  blockedBottom: string;
  textureSet: "light" | "dark";
};

export const tilePalettes = {
  light: {
    top: "#f6ead0",
    side: "#e1d2af",
    bottom: "#dcc89f",
    blockedTop: "#f6ead0",
    blockedSide: "#e1d2af",
    blockedBottom: "#dcc89f",
    textureSet: "light",
  },
  dark: {
    top: "#1e1e1e",
    side: "#2a2a2a",
    bottom: "#181818",
    blockedTop: "#1e1e1e",
    blockedSide: "#2a2a2a",
    blockedBottom: "#181818",
    textureSet: "dark",
  },
} as const satisfies Record<string, TilePalette>;

export type TileFaceName = BoxFace;

export type TilePolygonData = {
  tileId: number;
  tileCode: TileCode;
  faceName: TileFaceName;
  selectable: boolean;
  blocked: boolean;
  gridX: number;
  gridY: number;
  gridX2: number;
  gridY2: number;
  z: number;
  textureSet: TilePalette["textureSet"];
  textureSource: string;
  textureSourcePath: string;
};

export type TileMeshSpec = {
  tileId: number;
  tileCode: TileCode;
  selectable: boolean;
  polygons: Polygon[];
};

const tileTopUvs: NonNullable<Polygon["uvs"]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const tileHeight = 0.5;
const gridUnitWorldScale = 0.5;

type GridDimensions = {
  rows: number;
  cols: number;
};

const sideFaceNames = ["right", "left", "front", "back"] as const satisfies
  readonly TileFaceName[];

const allFaceNames = [
  "right",
  "left",
  "front",
  "back",
  "top",
  "bottom",
] as const satisfies readonly TileFaceName[];

function faceData(
  tile: GameTile,
  faceName: TileFaceName,
  selectable: boolean,
  textureSet: TilePalette["textureSet"],
  textureSource: string
): TilePolygonData {
  return {
    tileId: tile.id,
    tileCode: tile.code,
    faceName,
    selectable,
    blocked: !selectable,
    gridX: tile.gridX,
    gridY: tile.gridY,
    gridX2: tile.gridX2,
    gridY2: tile.gridY2,
    z: tile.z,
    textureSet,
    textureSource,
    textureSourcePath:
      textureSet === "dark"
        ? `src/assets/dark/${tile.code}.png`
        : `src/assets/${tile.code}.png`,
  };
}

function tileColors(
  palette: TilePalette,
  selectable: boolean
): { top: string; side: string; bottom: string } {
  if (selectable) {
    return {
      top: palette.top,
      side: palette.side,
      bottom: palette.bottom,
    };
  }
  return {
    top: palette.blockedTop,
    side: palette.blockedSide,
    bottom: palette.blockedBottom,
  };
}

function createTileCellIndex(
  activeTiles: ReadonlyArray<GameTile>
): Map<string, GameTile> {
  const cells = new Map<string, GameTile>();
  for (const tile of activeTiles) {
    for (let gridX = tile.gridX; gridX < tile.gridX2; gridX += 1) {
      for (let gridY = tile.gridY; gridY < tile.gridY2; gridY += 1) {
        cells.set(`${gridX}:${gridY}:${tile.z}`, tile);
      }
    }
  }
  return cells;
}

function computeGridDimensions(
  activeTiles: ReadonlyArray<GameTile>
): GridDimensions {
  return activeTiles.reduce<GridDimensions>(
    (dimensions, tile) => {
      return {
        rows: Math.max(dimensions.rows, tile.gridX2),
        cols: Math.max(dimensions.cols, tile.gridY2),
      };
    },
    { rows: 1, cols: 1 }
  );
}

function hasCoveredTop(
  tile: GameTile,
  cells: ReadonlyMap<string, GameTile>
): boolean {
  const z = tile.z + 1;

  for (let gridX = tile.gridX; gridX < tile.gridX2; gridX += 1) {
    for (let gridY = tile.gridY; gridY < tile.gridY2; gridY += 1) {
      if (!cells.has(`${gridX}:${gridY}:${z}`)) {
        return false;
      }
    }
  }
  return true;
}

type Interval = {
  start: number;
  end: number;
};

function sideSpanRange(tile: GameTile, faceName: TileFaceName): Interval {
  if (faceName === "left" || faceName === "right") {
    return { start: tile.gridY, end: tile.gridY2 };
  }
  return { start: tile.gridX, end: tile.gridX2 };
}

function sideUnitCovered(
  tile: GameTile,
  faceName: TileFaceName,
  unitStart: number,
  activeTiles: ReadonlyArray<GameTile>
): boolean {
  const unitEnd = unitStart + 1;
  for (const other of activeTiles) {
    if (other.id === tile.id || other.z !== tile.z) {
      continue;
    }
    if (
      faceName === "right" &&
      other.gridX === tile.gridX2 &&
      overlapOnAxis(other.gridY, other.gridY2, unitStart, unitEnd)
    ) {
      return true;
    }
    if (
      faceName === "left" &&
      other.gridX2 === tile.gridX &&
      overlapOnAxis(other.gridY, other.gridY2, unitStart, unitEnd)
    ) {
      return true;
    }
    if (
      faceName === "front" &&
      other.gridY === tile.gridY2 &&
      overlapOnAxis(other.gridX, other.gridX2, unitStart, unitEnd)
    ) {
      return true;
    }
    if (
      faceName === "back" &&
      other.gridY2 === tile.gridY &&
      overlapOnAxis(other.gridX, other.gridX2, unitStart, unitEnd)
    ) {
      return true;
    }
  }
  return false;
}

function exposedSideSpans(
  tile: GameTile,
  faceName: TileFaceName,
  activeTiles: ReadonlyArray<GameTile>
): Interval[] {
  const range = sideSpanRange(tile, faceName);
  const spans: Interval[] = [];
  let spanStart: number | null = null;

  for (let unit = range.start; unit < range.end; unit += 1) {
    if (!sideUnitCovered(tile, faceName, unit, activeTiles)) {
      spanStart ??= unit;
      continue;
    }
    if (spanStart !== null) {
      spans.push({ start: spanStart, end: unit });
      spanStart = null;
    }
  }

  if (spanStart !== null) {
    spans.push({ start: spanStart, end: range.end });
  }

  return spans;
}

function tilePolyBounds(
  tile: GameTile,
  dimensions: GridDimensions
): { min: [number, number, number]; max: [number, number, number] } {
  const xOrigin = dimensions.rows / 2 + 1;
  const yOrigin = dimensions.cols / 2 + 1;
  const z = tile.z * tileHeight;
  return {
    min: [
      (tile.gridX - xOrigin) * gridUnitWorldScale,
      (tile.gridY - yOrigin) * gridUnitWorldScale,
      z,
    ],
    max: [
      (tile.gridX2 - xOrigin) * gridUnitWorldScale,
      (tile.gridY2 - yOrigin) * gridUnitWorldScale,
      z + tileHeight,
    ],
  };
}

function polygonsForFace(
  bounds: ReturnType<typeof tilePolyBounds>,
  faceName: TileFaceName,
  color: string,
  options: BoxFaceOptions
): Polygon[] {
  const faces = Object.fromEntries(
    allFaceNames.map((entry) => [entry, entry === faceName ? options : false])
  ) as Partial<Record<TileFaceName, BoxFaceOptions | false>>;
  return boxPolygons({
    min: bounds.min,
    max: bounds.max,
    color,
    faces,
  });
}

function sideSpanBounds(
  bounds: ReturnType<typeof tilePolyBounds>,
  faceName: TileFaceName,
  span: Interval,
  dimensions: GridDimensions
): ReturnType<typeof tilePolyBounds> {
  const min = [...bounds.min] as [number, number, number];
  const max = [...bounds.max] as [number, number, number];
  const xOrigin = dimensions.rows / 2 + 1;
  const yOrigin = dimensions.cols / 2 + 1;

  if (faceName === "left" || faceName === "right") {
    min[1] = (span.start - yOrigin) * gridUnitWorldScale;
    max[1] = (span.end - yOrigin) * gridUnitWorldScale;
  } else {
    min[0] = (span.start - xOrigin) * gridUnitWorldScale;
    max[0] = (span.end - xOrigin) * gridUnitWorldScale;
  }

  return { min, max };
}

export function createTileMeshSpecs(
  activeTiles: ReadonlyArray<GameTile>,
  freeTileIds: ReadonlySet<number>,
  tileTextures: TileTextureMap,
  palette: TilePalette = tilePalettes.light
): TileMeshSpec[] {
  const cells = createTileCellIndex(activeTiles);
  const dimensions = computeGridDimensions(activeTiles);
  return activeTiles.flatMap((tile) => {
    const selectable = freeTileIds.has(tile.id);
    const colors = tileColors(palette, selectable);
    const texture = tileTextures[tile.code] ?? tileTextures.Man1;
    const bounds = tilePolyBounds(tile, dimensions);
    const polygons: Polygon[] = [];

    for (const faceName of sideFaceNames) {
      for (const span of exposedSideSpans(tile, faceName, activeTiles)) {
        polygons.push(
          ...polygonsForFace(
            sideSpanBounds(bounds, faceName, span, dimensions),
            faceName,
            colors.side,
            {
              data: faceData(
                tile,
                faceName,
                selectable,
                palette.textureSet,
                texture
              ),
            }
          )
        );
      }
    }

    if (!hasCoveredTop(tile, cells)) {
      polygons.push(
        ...polygonsForFace(bounds, "top", colors.side, {
          color: colors.top,
          texture,
          material: {
            texture,
            key: `${palette.textureSet}:${tile.code}`,
            presentation: {
              backend: "image",
              imageRendering: "auto",
              lighting: "source",
            },
          },
          uvs: tileTopUvs,
          data: faceData(tile, "top", selectable, palette.textureSet, texture),
        })
      );
    }

    if (polygons.length === 0) {
      return [];
    }

    return {
      tileId: tile.id,
      tileCode: tile.code,
      selectable,
      polygons,
    };
  });
}

export function createTilePolygons(
  activeTiles: ReadonlyArray<GameTile>,
  freeTileIds: ReadonlySet<number>,
  tileTextures: TileTextureMap,
  palette: TilePalette = tilePalettes.light
): Polygon[] {
  return createTileMeshSpecs(
    activeTiles,
    freeTileIds,
    tileTextures,
    palette
  ).flatMap((tile) => tile.polygons);
}
