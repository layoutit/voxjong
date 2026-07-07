export type TileTopArtBasis = {
  xAxis: [number, number];
  yAxis: [number, number];
};

export const defaultTileArtTransform = "rotate(180deg)";

const cssMatrixValuePattern = /matrix(?:3d)?\(([^)]+)\)/;
const axisEpsilon = 1e-6;
const matrixEpsilon = 1e-5;

function normalizeAxis(x: number, y: number): [number, number] | null {
  const length = Math.hypot(x, y);
  if (length <= axisEpsilon) {
    return null;
  }
  return [x / length, y / length];
}

function formatMatrixValue(value: number): string {
  const normalized = Math.abs(value) < matrixEpsilon ? 0 : value;
  const rounded = Number(normalized.toFixed(6));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export function parseCssTransform2dBasis(
  transform: string | null | undefined
): TileTopArtBasis | null {
  if (!transform || transform === "none") {
    return null;
  }

  const match = cssMatrixValuePattern.exec(transform);
  if (!match) {
    return null;
  }

  const values = match[1]
    .split(",")
    .map((entry) => Number.parseFloat(entry.trim()));
  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const isMatrix3d = transform.startsWith("matrix3d(");
  const xAxis = normalizeAxis(values[0] ?? 0, values[1] ?? 0);
  const yAxis = isMatrix3d
    ? normalizeAxis(values[4] ?? 0, values[5] ?? 0)
    : normalizeAxis(values[2] ?? 0, values[3] ?? 0);

  if (!xAxis || !yAxis) {
    return null;
  }

  return { xAxis, yAxis };
}

export function tileTopArtBasisKey(basis: TileTopArtBasis): string {
  return [...basis.xAxis, ...basis.yAxis]
    .map((value) => value.toFixed(3))
    .join(",");
}

export function majorityTileTopArtBasis(
  bases: ReadonlyArray<TileTopArtBasis | null>
): TileTopArtBasis | null {
  const counts = new Map<string, { basis: TileTopArtBasis; count: number }>();
  for (const basis of bases) {
    if (!basis) {
      continue;
    }
    const key = tileTopArtBasisKey(basis);
    const entry = counts.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      counts.set(key, { basis, count: 1 });
    }
  }

  let majority: { basis: TileTopArtBasis; count: number } | null = null;
  for (const entry of counts.values()) {
    if (!majority || entry.count > majority.count) {
      majority = entry;
    }
  }
  return majority?.basis ?? null;
}

export function tileArtTransformForBasis(
  basis: TileTopArtBasis | null,
  referenceBasis: TileTopArtBasis | null
): string {
  if (!basis || !referenceBasis) {
    return defaultTileArtTransform;
  }

  const [x0, x1] = basis.xAxis;
  const [y0, y1] = basis.yAxis;
  const determinant = x0 * y1 - y0 * x1;
  if (Math.abs(determinant) <= matrixEpsilon) {
    return defaultTileArtTransform;
  }

  const targetX: [number, number] = [
    -referenceBasis.xAxis[0],
    -referenceBasis.xAxis[1],
  ];
  const targetY: [number, number] = [
    -referenceBasis.yAxis[0],
    -referenceBasis.yAxis[1],
  ];

  const toLocal = ([vx, vy]: [number, number]): [number, number] => [
    (y1 * vx - y0 * vy) / determinant,
    (-x1 * vx + x0 * vy) / determinant,
  ];

  const [a, b] = toLocal(targetX);
  const [c, d] = toLocal(targetY);
  if (![a, b, c, d].every(Number.isFinite)) {
    return defaultTileArtTransform;
  }

  return `matrix(${formatMatrixValue(a)}, ${formatMatrixValue(
    b
  )}, ${formatMatrixValue(c)}, ${formatMatrixValue(d)}, 0, 0)`;
}
