export const gameUrlStateVersion = 1 as const;
const gameHashPrefix = "#";
const maxEncodedStateLength = 64;
const tileCount = 144;
const bitmapByteLength = tileCount / 8;

const enum ProgressMode {
  None = 0,
  RemovedList = 1,
  RemainingList = 2,
  Bitmap = 3,
}

export type GameUrlState = {
  version: typeof gameUrlStateVersion;
  seed: number;
  removedTileIds: number[];
};

export type GameUrlHistoryMode = "push" | "replace";

function isIntegerInRange(
  value: unknown,
  min: number,
  max: number
): value is number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeSeed(bytes: Uint8Array): number {
  return (
    (bytes[1] ?? 0) +
    (bytes[2] ?? 0) * 0x100 +
    (bytes[3] ?? 0) * 0x1_0000 +
    (bytes[4] ?? 0) * 0x100_0000
  );
}

function seedBytes(seed: number): number[] {
  return [
    seed & 0xff,
    (seed >>> 8) & 0xff,
    (seed >>> 16) & 0xff,
    (seed >>> 24) & 0xff,
  ];
}

function sortedUniqueTileIds(values: ReadonlyArray<number>): number[] | null {
  if (values.length > tileCount || values.length % 2 !== 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  for (let index = 0; index < sorted.length; index += 1) {
    const tileId = sorted[index];
    if (
      !isIntegerInRange(tileId, 0, tileCount - 1) ||
      (index > 0 && tileId === sorted[index - 1])
    ) {
      return null;
    }
  }
  return sorted;
}

function isStrictlySortedTileList(values: Uint8Array): boolean {
  if (values.length > bitmapByteLength || values.length % 2 !== 0) {
    return false;
  }
  for (let index = 0; index < values.length; index += 1) {
    const tileId = values[index];
    if (
      tileId === undefined ||
      tileId >= tileCount ||
      (index > 0 && tileId <= (values[index - 1] ?? -1))
    ) {
      return false;
    }
  }
  return true;
}

function complementTileIds(tileIds: ReadonlyArray<number>): number[] {
  const included = new Set(tileIds);
  return Array.from({ length: tileCount }, (_, tileId) => tileId).filter(
    (tileId) => !included.has(tileId)
  );
}

function chooseProgressMode(
  removedTileIds: ReadonlyArray<number>
): ProgressMode {
  if (removedTileIds.length === 0) {
    return ProgressMode.None;
  }
  const remainingCount = tileCount - removedTileIds.length;
  if (
    removedTileIds.length <= bitmapByteLength &&
    removedTileIds.length <= remainingCount
  ) {
    return ProgressMode.RemovedList;
  }
  if (remainingCount < removedTileIds.length && remainingCount <= bitmapByteLength) {
    return ProgressMode.RemainingList;
  }
  return ProgressMode.Bitmap;
}

function encodeProgress(
  mode: ProgressMode,
  removedTileIds: ReadonlyArray<number>
): number[] {
  if (mode === ProgressMode.None) {
    return [];
  }
  if (mode === ProgressMode.RemovedList) {
    return [...removedTileIds];
  }
  if (mode === ProgressMode.RemainingList) {
    return complementTileIds(removedTileIds);
  }

  const bitmap = Array.from({ length: bitmapByteLength }, () => 0);
  for (const tileId of removedTileIds) {
    const byteIndex = Math.floor(tileId / 8);
    bitmap[byteIndex] = (bitmap[byteIndex] ?? 0) | (1 << (tileId % 8));
  }
  return bitmap;
}

function decodeProgress(mode: ProgressMode, payload: Uint8Array): number[] | null {
  if (mode === ProgressMode.None) {
    return payload.length === 0 ? [] : null;
  }
  if (mode === ProgressMode.RemovedList) {
    return payload.length > 0 && isStrictlySortedTileList(payload)
      ? [...payload]
      : null;
  }
  if (mode === ProgressMode.RemainingList) {
    return isStrictlySortedTileList(payload)
      ? complementTileIds([...payload])
      : null;
  }
  if (payload.length !== bitmapByteLength) {
    return null;
  }

  const removedTileIds: number[] = [];
  for (let tileId = 0; tileId < tileCount; tileId += 1) {
    const byte = payload[Math.floor(tileId / 8)] ?? 0;
    if ((byte & (1 << (tileId % 8))) !== 0) {
      removedTileIds.push(tileId);
    }
  }
  return removedTileIds.length % 2 === 0 ? removedTileIds : null;
}

export function encodeGameUrlState(state: GameUrlState): string {
  const removedTileIds = sortedUniqueTileIds(state.removedTileIds);
  if (
    state.version !== gameUrlStateVersion ||
    !isIntegerInRange(state.seed, 0, 0xffff_ffff) ||
    !removedTileIds
  ) {
    throw new RangeError("Invalid game URL state.");
  }

  const mode = chooseProgressMode(removedTileIds);
  const header = (state.version << 2) | mode;
  const bytes = [
    header,
    ...seedBytes(state.seed),
    ...encodeProgress(mode, removedTileIds),
  ];
  return encodeBase64Url(Uint8Array.from(bytes));
}

export function gameUrlHash(state: GameUrlState): string {
  return `${gameHashPrefix}${encodeGameUrlState(state)}`;
}

export function parseGameUrlHash(hash: string): GameUrlState | null {
  if (!hash.startsWith(gameHashPrefix)) {
    return null;
  }

  const encoded = hash.slice(gameHashPrefix.length);
  if (!encoded || encoded.length > maxEncodedStateLength) {
    return null;
  }

  try {
    const bytes = decodeBase64Url(encoded);
    if (bytes.length < 5) {
      return null;
    }
    const header = bytes[0];
    if (header === undefined || header >>> 2 !== gameUrlStateVersion) {
      return null;
    }
    const mode = header & 0b11;
    const removedTileIds = decodeProgress(mode, bytes.slice(5));
    if (!removedTileIds) {
      return null;
    }
    return {
      version: gameUrlStateVersion,
      seed: decodeSeed(bytes),
      removedTileIds,
    };
  } catch {
    return null;
  }
}

export function writeGameUrlState(
  state: GameUrlState,
  mode: GameUrlHistoryMode = "replace"
): void {
  const url = new URL(window.location.href);
  const nextHash = gameUrlHash(state);
  if (mode === "replace" && url.hash === nextHash) {
    return;
  }
  url.hash = nextHash;
  const method = mode === "push" ? "pushState" : "replaceState";
  window.history[method]({ voxjongGame: true }, "", url);
}
