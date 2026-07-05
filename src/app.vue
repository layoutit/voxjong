<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  buildPolyCameraSceneTransform,
  createPolyPerspectiveCamera,
  createPolyScene,
  type ParseResult,
  type PolyMeshHandle,
  type PolyPerspectiveCameraHandle,
  type PolySceneHandle,
} from "@layoutit/polycss";
import { logoUrl, tileTextureSets } from "./assets/voxjongAssets";
import { useMahjongSession } from "./composables/useMahjongSession";
import { clearSoundDurationMs, useSound } from "./composables/useSound";
import { useVoxjongView } from "./composables/useVoxjongView";
import { turtleCells, type GameTile } from "./game/mahjong";
import {
  computeTileGridDimensions,
  createTileMeshSpecs,
  tilePalettes,
  type TileMeshSpec,
  type TilePolygonData,
} from "./render/voxels";

type ThemeName = "light" | "dark";
type Vec3 = [number, number, number];

const clickMoveTolerance = 11;
const polyCameraZoomScale = 50;
const polySceneViewportOffset = { x: -10, y: -37 };

// Start-of-game "assemble the turtle" intro: each tile drops from off-screen
// into its resting place via a one-time requestAnimationFrame physics loop
// (gravity + a small bounce). Landing order follows the support graph so a tile
// only touches down after the tiles beneath it have settled. Occlusion-hidden
// faces are force-revealed while assembling (.is-assembling) so even
// fully-buried inner tiles fall as solid pieces.
const introTileDuration = 620; // base ms fall time per tile
const introTileDurationJitter = 620; // wide, so tiles fall at varied speeds (rain)
const introBaseSpread = 850; // ms window the ground-layer tiles rain across
const introTileExtraSpread = 150; // ms of random slack above a stacked tile's earliest land
// A supporting tile must be fully settled (bounce done) THIS long before the
// tile resting on it touches down.
const introSettleLead = 250;
const introBounceScreenPx = 9; // screen px of the little bounce on contact
const introBounceTime = 160; // ms of the bounce settle
const introLandingMinGap = 55; // ms min gap between landing ticks (throttle)
const introLandingSoundMax = 30; // max landing ticks across the intro
const introClearDuration = 380; // ms for a tile to fly off-screen
// Sweep spans the chips-in-sack clip so the disappearance is timed to the sound.
const introClearStagger = Math.max(80, clearSoundDurationMs - introClearDuration);
// New Game board-clear direction: "down" drops the board off the bottom of the
// screen; "right" (the original) slides it off the right edge.
const introClearDirection: "down" | "right" = "down";
const isAssembling = ref(false);
// True from initial mount until the drop-in positions tiles off-screen, so the
// un-textured board never flashes at rest while images preload.
const boardPreparing = ref(false);
let introPlans: IntroPlan[] = [];
let introRafId: number | null = null;
let introClearTimer: number | null = null;
// Bumped whenever a fresh intro sequence begins (mount / New Game); a pending
// async first-load intro checks it so it can't fire after being superseded.
let introGeneration = 0;
let removeGestureUnlock: (() => void) | null = null;
const turtleGridDimensions = computeTileGridDimensions(turtleCells);
const themeStorageKey = "voxjong-theme";
const themeMetaColors = {
  light: "#165930",
  dark: "#07110e",
} as const satisfies Record<ThemeName, string>;
const pointerStart = ref<{
  id: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  tileId: number | null;
  mesh: HTMLElement | null;
} | null>(null);
const sceneRoot = ref<HTMLElement | null>(null);
const sceneVersion = ref(0);
let selectedTileEls: HTMLElement[] = [];
let hintedTileEls: HTMLElement[] = [];
let refreshRafId: number | null = null;
let polyCameraHandle: PolyPerspectiveCameraHandle | null = null;
let polySceneHandle: PolySceneHandle | null = null;
const polyTileMeshHandles = new Map<number, PolyMeshHandle>();
let tileTextureObserver: MutationObserver | null = null;
let tileTextureRefreshRafId: number | null = null;

const themePreference = ref<ThemeName>("light");
const resolvedTheme = ref<ThemeName>("light");
const isDarkTheme = computed(() => resolvedTheme.value === "dark");
const themeToggleLabel = computed(() =>
  isDarkTheme.value ? "Light Mode" : "Dark Mode"
);
const themeToggleAriaLabel = computed(() =>
  isDarkTheme.value ? "Switch to light mode" : "Switch to dark mode"
);
const themeMetaColor = computed(() => themeMetaColors[resolvedTheme.value]);
const tilePalette = computed(() => tilePalettes[resolvedTheme.value]);
const tileTextureMap = computed(() => tileTextureSets[resolvedTheme.value]);
const voxjongVersionLabel = computed(() => {
  const version =
    typeof __VOXJONG_VERSION__ === "string" ? __VOXJONG_VERSION__ : "0.0";
  return version.trim() ? `v${version}` : "v0.0";
});
function computeTileMeshAutoCenterOffset(
  nextTileMeshes: ReadonlyArray<TileMeshSpec>
): Vec3 {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const tileMesh of nextTileMeshes) {
    for (const polygon of tileMesh.polygons) {
      for (const vertex of polygon.vertices) {
        minX = Math.min(minX, vertex[0]);
        minY = Math.min(minY, vertex[1]);
        minZ = Math.min(minZ, vertex[2]);
        maxX = Math.max(maxX, vertex[0]);
        maxY = Math.max(maxY, vertex[1]);
        maxZ = Math.max(maxZ, vertex[2]);
      }
    }
  }

  if (!Number.isFinite(minX + minY + minZ + maxX + maxY + maxZ)) {
    return [0, 0, 0];
  }

  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
}

const {
  rotX,
  rotY,
  zoom,
  zoomMin,
  zoomMaxCurrent,
  viewMode,
  setView,
  rotateByDragDelta,
  onZoomSliderInput,
  onWheelZoom,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  resetGestureState,
  clampCurrentView,
} = useVoxjongView();

const {
  tiles,
  selectedTileId,
  totalTiles,
  activeTiles,
  remainingTiles,
  isWon,
  selectedTile,
  timerLabel,
  clockRunning,
  freeTileIds,
  hasMoves,
  hintedTileIds,
  canUndo,
  canRedo,
  clearHintState: clearGameHintState,
  clearSelectionAndHintState: clearGameSelectionAndHintState,
  removePair,
  undoMove: undoGameMove,
  redoMove: redoGameMove,
  showHint: showGameHint,
  resetGame,
} = useMahjongSession();

const {
  muted: isMuted,
  preload: preloadSounds,
  unlock: unlockSounds,
  dispose: disposeSounds,
  toggleMuted: toggleSound,
  playSelect: playSelectSound,
  playMatch: playMatchSound,
  playLanding: playLandingSound,
  playClear: playClearSound,
} = useSound();

const soundToggleLabel = computed(() =>
  isMuted.value ? "Sound Off" : "Sound On"
);

function applyThemePreference(preference: ThemeName): void {
  themePreference.value = preference;
  resolvedTheme.value = preference;
}

function readStoredThemePreference(): ThemeName | null {
  try {
    const stored = window.localStorage.getItem(themeStorageKey);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function persistThemePreference(preference: ThemeName): void {
  try {
    window.localStorage.setItem(themeStorageKey, preference);
  } catch {
    return;
  }
}

function syncThemeMetaColor(color: string): void {
  if (typeof document === "undefined") {
    return;
  }
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  meta.content = color;
}

function toggleTheme(): void {
  const nextTheme = resolvedTheme.value === "dark" ? "light" : "dark";
  applyThemePreference(nextTheme);
  persistThemePreference(nextTheme);
}

function undoMove(): void {
  if (!undoGameMove()) {
    return;
  }
  clearSelectedTileVisual();
  clearHintTileVisual();
  sceneVersion.value += 1;
  scheduleTileVisualRefresh();
}

function redoMove(): void {
  if (!redoGameMove()) {
    return;
  }
  playMatchSound();
  clearSelectedTileVisual();
  clearHintTileVisual();
  sceneVersion.value += 1;
  scheduleTileVisualRefresh();
}

function parseTileId(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const tileId = Number.parseInt(value, 10);
  return Number.isFinite(tileId) ? tileId : null;
}

function resolveMeshElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }
  const meshHandle = polySceneHandle?.findMeshByElement(target);
  if (meshHandle) {
    return meshHandle.element;
  }
  return target.closest(".polycss-mesh") as HTMLElement | null;
}

function resolveTileFromMesh(mesh: HTMLElement | null): GameTile | null {
  const tileId = parseTileId(mesh?.dataset.tileId);
  if (tileId === null) {
    return null;
  }
  return activeTiles.value.find((entry) => entry.id === tileId) ?? null;
}

function resolveTileFromTarget(target: EventTarget | null): GameTile | null {
  return resolveTileFromMesh(resolveMeshElement(target));
}

function resolveTileFromPoint(
  clientX: number,
  clientY: number
): GameTile | null {
  const doc = sceneRoot.value?.ownerDocument ?? document;
  const target = doc.elementFromPoint(clientX, clientY);
  return resolveTileFromTarget(target);
}

function resolveMeshFromPoint(
  clientX: number,
  clientY: number
): HTMLElement | null {
  const doc = sceneRoot.value?.ownerDocument ?? document;
  const target = doc.elementFromPoint(clientX, clientY);
  return resolveMeshElement(target);
}

function findMeshForTile(tile: GameTile): HTMLElement | null {
  const handle = polyTileMeshHandles.get(tile.id);
  if (handle) {
    return handle.element;
  }
  return (
    sceneRoot.value?.querySelector<HTMLElement>(
      `.polycss-mesh[data-tile-id="${tile.id}"]`
    ) ?? null
  );
}

function clearHintTileVisual(): void {
  for (const mesh of hintedTileEls) {
    mesh.classList.remove("is-hint");
  }
  hintedTileEls = [];
}

function clearHintState(): void {
  clearGameHintState();
  clearHintTileVisual();
}

function clearSelectionAndHintState(): void {
  clearGameSelectionAndHintState();
  clearSelectedTileVisual();
  clearHintTileVisual();
}

function clearSelectedTileVisual(): void {
  for (const mesh of selectedTileEls) {
    mesh.classList.remove("is-active");
  }
  selectedTileEls = [];
}

function setSelectedTileVisual(
  tile: GameTile | null,
  preferredMesh: HTMLElement | null = null
): void {
  clearSelectedTileVisual();
  const mesh = preferredMesh ?? (tile ? findMeshForTile(tile) : null);
  if (!mesh) {
    return;
  }
  mesh.classList.add("is-active");
  selectedTileEls = [mesh];
}

function syncTileInteractivity(): void {
  for (const handle of polyTileMeshHandles.values()) {
    handle.element.classList.remove("is-selectable", "is-blocked", "is-removed");
  }
  for (const tile of tiles.value) {
    const mesh = findMeshForTile(tile);
    if (!mesh) {
      continue;
    }
    if (tile.removed) {
      mesh.classList.add("is-removed");
      continue;
    }
    const selectable = freeTileIds.value.has(tile.id);
    mesh.classList.add(selectable ? "is-selectable" : "is-blocked");
  }
}

function refreshSelectionVisual(): void {
  const tile = selectedTile.value;
  if (!tile) {
    clearSelectedTileVisual();
    return;
  }
  setSelectedTileVisual(tile);
}

function refreshHintVisual(): void {
  clearHintTileVisual();
  if (hintedTileIds.value.length !== 2) {
    return;
  }
  for (const id of hintedTileIds.value) {
    const tile = activeTiles.value.find((entry) => entry.id === id);
    if (!tile) {
      continue;
    }
    const mesh = findMeshForTile(tile);
    if (!mesh) {
      continue;
    }
    mesh.classList.add("is-hint");
    hintedTileEls.push(mesh);
  }
}

function syncDirectTileTextureStyles(): void {
  const root = sceneRoot.value;
  if (!root) {
    return;
  }
  const topFaces = root.querySelectorAll<HTMLElement>(
    '[data-facename="top"][data-texture-source]'
  );
  for (const face of topFaces) {
    const textureSource = face.dataset.textureSource;
    if (!textureSource) {
      continue;
    }
    const textureUrl = `url("${textureSource}")`;
    if (face.style.getPropertyValue("--tile-texture-url") !== textureUrl) {
      face.style.setProperty("--tile-texture-url", textureUrl);
    }
  }
}

function scheduleDirectTileTextureStylesSync(): void {
  if (tileTextureRefreshRafId !== null) {
    return;
  }
  tileTextureRefreshRafId = requestAnimationFrame(() => {
    tileTextureRefreshRafId = null;
    syncDirectTileTextureStyles();
  });
}

function refreshTileVisuals(): void {
  syncDirectTileTextureStyles();
  syncTileInteractivity();
  refreshSelectionVisual();
  refreshHintVisual();
}

function scheduleTileVisualRefresh(): void {
  if (refreshRafId !== null) {
    return;
  }
  refreshRafId = requestAnimationFrame(() => {
    refreshRafId = null;
    refreshTileVisuals();
  });
}

function showHint(): void {
  if (!showGameHint()) {
    clearHintTileVisual();
    return;
  }
  refreshHintVisual();
}

function selectTile(tile: GameTile, mesh: HTMLElement | null): void {
  if (isAssembling.value) {
    return;
  }
  const selectedId = selectedTileId.value;

  if (hintedTileIds.value.length > 0) {
    clearHintState();
  }

  if (selectedId === tile.id) {
    selectedTileId.value = null;
    clearSelectedTileVisual();
    playSelectSound();
    scheduleTileVisualRefresh();
    return;
  }

  const clickedIsFree = freeTileIds.value.has(tile.id);
  if (!clickedIsFree) {
    scheduleTileVisualRefresh();
    return;
  }

  if (selectedId === null) {
    selectedTileId.value = tile.id;
    setSelectedTileVisual(tile, mesh);
    playSelectSound();
    scheduleTileVisualRefresh();
    return;
  }

  const selectedTile = tiles.value.find((entry) => entry.id === selectedId);
  if (!selectedTile || selectedTile.removed) {
    selectedTileId.value = tile.id;
    setSelectedTileVisual(tile, mesh);
    playSelectSound();
    scheduleTileVisualRefresh();
    return;
  }

  if (removePair(selectedTile.id, tile.id)) {
    clearSelectedTileVisual();
    clearHintTileVisual();
    playMatchSound();
    sceneVersion.value += 1;
    scheduleTileVisualRefresh();
    return;
  }

  selectedTileId.value = tile.id;
  setSelectedTileVisual(tile, mesh);
  playSelectSound();
  scheduleTileVisualRefresh();
}

function onScenePointerDown(event: PointerEvent): void {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const mesh = resolveMeshElement(target);
  const downTile = resolveTileFromMesh(mesh);
  pointerStart.value = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    tileId: downTile?.id ?? null,
    mesh: mesh ?? null,
  };
}

function onScenePointerMove(event: PointerEvent): void {
  if (event.buttons === 0) {
    return;
  }
  const start = pointerStart.value;
  if (!start || start.id !== event.pointerId) {
    return;
  }
  const deltaX = event.clientX - start.lastX;
  const deltaY = event.clientY - start.lastY;
  if (deltaX !== 0 || deltaY !== 0) {
    rotateByDragDelta(deltaX, deltaY);
    start.lastX = event.clientX;
    start.lastY = event.clientY;
  }
}

function onScenePointerUp(event: PointerEvent): void {
  const start = pointerStart.value;
  pointerStart.value = null;
  if (!start || start.id !== event.pointerId) {
    return;
  }

  const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
  if (moved > clickMoveTolerance) {
    scheduleTileVisualRefresh();
    return;
  }

  const startTile =
    start.tileId !== null
      ? activeTiles.value.find((entry) => entry.id === start.tileId) ?? null
      : null;
  const pointTile = resolveTileFromPoint(event.clientX, event.clientY);
  const tile = pointTile ?? startTile;
  if (!tile) {
    clearSelectionAndHintState();
    scheduleTileVisualRefresh();
    return;
  }
  const mesh = start.mesh ?? resolveMeshFromPoint(event.clientX, event.clientY);
  selectTile(tile, mesh);
  scheduleTileVisualRefresh();
}

function onScenePointerCancel(): void {
  pointerStart.value = null;
}

function createTileParseResult(tileMesh: TileMeshSpec): ParseResult {
  return {
    polygons: tileMesh.polygons,
    objectUrls: [],
    dispose: () => {},
    warnings: [],
    metadata: {
      meshes: [`tile-${tileMesh.tileId}`],
    },
  };
}

function syncPolyMeshMetadata(
  handle: PolyMeshHandle,
  tileMesh: TileMeshSpec,
  meshSignature = tileMeshSignature(tileMesh)
): void {
  // Only write attributes that actually changed. Positions never change between
  // games, so on a New Game reset almost everything here is identical (facename,
  // occlusion, spans, selectability) — only the tile codes/textures differ.
  // Guarding the writes keeps the reset from stalling the main thread (and
  // avoids needless MutationObserver churn on data-texture-source / style).
  const setData = (el: HTMLElement, key: string, value: string) => {
    if (el.dataset[key] !== value) {
      el.dataset[key] = value;
    }
  };
  const setClass = (el: HTMLElement, cls: string, on: boolean) => {
    if (el.classList.contains(cls) !== on) {
      el.classList.toggle(cls, on);
    }
  };

  setData(handle.element, "tileId", String(tileMesh.tileId));
  setData(handle.element, "tileCode", tileMesh.tileCode);
  setData(handle.element, "selectable", String(tileMesh.selectable));
  setData(handle.element, "removed", String(tileMesh.removed));
  setData(handle.element, "meshSignature", meshSignature);

  const faces = handle.element.querySelectorAll<HTMLElement>(
    "[data-poly-index]"
  );

  for (const face of faces) {
    const polygonIndex = Number.parseInt(face.dataset.polyIndex ?? "", 10);
    const polygon = Number.isFinite(polygonIndex)
      ? tileMesh.polygons[polygonIndex]
      : undefined;
    const data = polygon.data as TilePolygonData | undefined;
    if (!data) {
      continue;
    }
    if (face.getAttribute("data-facename") !== data.faceName) {
      face.setAttribute("data-facename", data.faceName);
    }
    setData(face, "faceKey", data.faceKey);
    setData(face, "faceVisible", String(data.faceVisible));
    setData(face, "tileId", String(data.tileId));
    setData(face, "tileCode", data.tileCode);
    setData(face, "selectable", String(data.selectable));
    setData(face, "blocked", String(data.blocked));
    setData(face, "removed", String(data.removed));
    setData(face, "textureSet", data.textureSet);
    setData(face, "textureSource", data.textureSource);
    setData(face, "textureSourcePath", data.textureSourcePath);
    if (data.spanStart !== undefined && data.spanEnd !== undefined) {
      setData(face, "spanStart", String(data.spanStart));
      setData(face, "spanEnd", String(data.spanEnd));
    } else {
      delete face.dataset.spanStart;
      delete face.dataset.spanEnd;
    }
    // A side face covering the tile's full extent on its axis is the clean
    // "box wall"; the intro reveals these (+ the top) so buried tiles fall as
    // whole boxes, while the partial-span duplicates stay hidden.
    const isFullSpanSide =
      data.faceName !== "top" &&
      data.spanStart !== undefined &&
      data.spanEnd !== undefined &&
      (data.faceName === "left" || data.faceName === "right"
        ? data.spanStart === data.gridY && data.spanEnd === data.gridY2
        : data.spanStart === data.gridX && data.spanEnd === data.gridX2);
    setClass(face, "is-full-span", isFullSpanSide);
    setClass(face, "is-face-hidden", !data.faceVisible);
    const url =
      data.faceName === "top" ? `url("${data.textureSource}")` : "none";
    if (face.style.getPropertyValue("--tile-texture-url") !== url) {
      face.style.setProperty("--tile-texture-url", url);
    }
  }
}

function meshPolygonCount(handle: PolyMeshHandle): number {
  return handle.element.querySelectorAll("[data-poly-index]").length;
}

function tileMeshSignature(tileMesh: TileMeshSpec): string {
  return tileMesh.polygons
    .map((polygon) => {
      const data = polygon.data as TilePolygonData | undefined;
      const vertices = polygon.vertices
        .map((vertex) =>
          vertex.map((value) => Number(value.toFixed(4))).join(",")
        )
        .join("|");
      return `${data?.faceKey ?? ""}:${data?.faceVisible ?? true}:${vertices}`;
    })
    .join(";");
}

function syncPolyCamera(): void {
  if (!polyCameraHandle || !polySceneHandle) {
    return;
  }
  polyCameraHandle.update({
    zoom: zoom.value * polyCameraZoomScale,
    rotX: rotX.value,
    rotY: rotY.value,
  });
  polySceneHandle.sceneElement.style.transform = buildPolyCameraSceneTransform(
    polyCameraHandle.state,
    { autoCenterOffset: tileMeshAutoCenterOffset.value, layoutScale: 1 }
  );
  syncPolySceneViewportOffset();
}

function syncPolySceneViewportOffset(): void {
  const sceneElement = polySceneHandle?.sceneElement;
  if (!sceneElement) {
    return;
  }
  const viewportOffsetPattern =
    /\s*translate\(-?\d+(?:\.\d+)?px,\s*-?\d+(?:\.\d+)?px\)/g;
  const transform = sceneElement.style.transform
    .replace(viewportOffsetPattern, "")
    .trim();
  sceneElement.style.transform = transform.replace(
    /^(scale\([^)]+\))/,
    `$1 translate(${polySceneViewportOffset.x}px, ${polySceneViewportOffset.y}px)`
  );
}

function syncPolyTileMeshes(nextTileMeshes = tileMeshes.value): void {
  if (!polySceneHandle) {
    return;
  }

  const nextTileIds = new Set(nextTileMeshes.map((tile) => tile.tileId));
  for (const [tileId, handle] of polyTileMeshHandles) {
    if (!nextTileIds.has(tileId)) {
      handle.remove();
      polyTileMeshHandles.delete(tileId);
    }
  }

  for (const tileMesh of nextTileMeshes) {
    const nextSignature = tileMeshSignature(tileMesh);
    const existingHandle = polyTileMeshHandles.get(tileMesh.tileId);
    if (existingHandle) {
      if (
        meshPolygonCount(existingHandle) !== tileMesh.polygons.length ||
        existingHandle.element.dataset.meshSignature !== nextSignature
      ) {
        existingHandle.setPolygons(tileMesh.polygons, {
          merge: false,
          stableDom: true,
          recomputeAutoCenter: false,
        });
      }
      syncPolyMeshMetadata(existingHandle, tileMesh, nextSignature);
      continue;
    }

    const handle = polySceneHandle.add(createTileParseResult(tileMesh), {
      id: `tile-${tileMesh.tileId}`,
      excludeFromAutoCenter: true,
      merge: false,
      stableDom: true,
    });
    syncPolyMeshMetadata(handle, tileMesh, nextSignature);
    polyTileMeshHandles.set(tileMesh.tileId, handle);
  }
}

function destroyPolyScene(): void {
  polyTileMeshHandles.clear();
  tileTextureObserver?.disconnect();
  tileTextureObserver = null;
  polySceneHandle?.destroy();
  polySceneHandle = null;
  polyCameraHandle = null;

  const root = sceneRoot.value;
  if (root) {
    const staleCameras = Array.from(
      root.querySelectorAll<HTMLElement>(".polycss-camera")
    );
    for (const cameraNode of staleCameras) {
      cameraNode.remove();
    }
  }
  if (tileTextureRefreshRafId !== null) {
    cancelAnimationFrame(tileTextureRefreshRafId);
    tileTextureRefreshRafId = null;
  }
}

function preloadTileImages(): Promise<void> {
  const urls = new Set<string>();
  for (const tile of tiles.value) {
    if (tile.removed) {
      continue;
    }
    const url = tileTextureMap.value[tile.code];
    if (url) {
      urls.add(url);
    }
  }
  const loads = [...urls].map(
    (url) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.src = url;
        // decode() warms the *decoded* bitmap cache so the symbol paints
        // immediately mid-fall, instead of blank until the browser rasterizes.
        const done = () => resolve();
        img.decode().then(done, () => {
          // decode() can reject even when the bytes are already loaded — don't
          // wait on onload that will never re-fire in that case.
          if (img.complete) {
            done();
            return;
          }
          img.onload = done;
          img.onerror = done;
        });
      })
  );
  // Cap the wait so one slow/broken image can't stall the intro indefinitely.
  return Promise.race([
    Promise.all(loads).then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, 2500)),
  ]);
}

// The screen-space displacement (px) a tile gets per 1px of a local translate
// on the given axis. Used to solve for the X/Y combination that moves a tile
// straight up the screen, whatever the camera angle is.
function measureAxisVector(
  el: HTMLElement,
  axis: "X" | "Y",
  test: number
): { dx: number; dy: number } {
  // Measure from a clean baseline: the element may already carry a transform
  // (e.g. the off-screen sweep-out), which would poison the delta. Restore both
  // transform and transition afterwards so the caller's state is untouched.
  const prevTransform = el.style.transform;
  const prevTransition = el.style.transition;
  el.style.transition = "none";
  el.style.transform = "";
  void document.body.offsetHeight;
  const before = el.getBoundingClientRect();
  el.style.transform = `translate${axis}(${test}px)`;
  void document.body.offsetHeight;
  const after = el.getBoundingClientRect();
  el.style.transform = prevTransform;
  el.style.transition = prevTransition;
  return {
    dx: (after.left - before.left) / test,
    dy: (after.top - before.top) / test,
  };
}

type IntroPlan = {
  el: HTMLElement;
  startOffset: number; // px along the fall axis, off-screen above rest
  bounceOffset: number; // px of the little bounce-up on contact
  fallDelay: number; // ms before this tile starts falling
  fallTime: number; // ms of the accelerating fall
  landed: boolean;
};

function stopAssembleIntro(): void {
  if (introRafId !== null) {
    cancelAnimationFrame(introRafId);
    introRafId = null;
  }
  for (const plan of introPlans) {
    plan.el.style.willChange = "";
    plan.el.style.transition = "";
    plan.el.style.transform = "";
  }
  introPlans = [];
  isAssembling.value = false;
}

// New Game exit: fling the current tiles off the side of the screen (kept
// mounted) before the fresh board drops in. Uses the same screen-space
// calibration so the sweep direction is correct at any camera angle.
function runClearOut(onDone: () => void): void {
  const reduceMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const meshes: HTMLElement[] = [];
  for (const tile of tiles.value) {
    if (tile.removed) {
      continue;
    }
    const handle = polyTileMeshHandles.get(tile.id);
    if (handle) {
      meshes.push(handle.element);
    }
  }
  if (reduceMotion || meshes.length === 0) {
    onDone();
    return;
  }

  stopAssembleIntro();
  if (introClearTimer !== null) {
    window.clearTimeout(introClearTimer);
    introClearTimer = null;
  }
  playClearSound();

  const sample = meshes[0];
  const vX = measureAxisVector(sample, "X", 200);
  const vY = measureAxisVector(sample, "Y", 200);
  const det = vX.dx * vY.dy - vY.dx * vX.dy;
  // Screen displacement that carries a tile off the chosen edge.
  const width = sceneRoot.value?.clientWidth || window.innerWidth;
  const height = sceneRoot.value?.clientHeight || window.innerHeight;
  const screenX = introClearDirection === "down" ? 0 : width * 1.25;
  const screenY =
    introClearDirection === "down" ? height * 1.4 : width * 0.15;
  let localX = 0;
  let localY = 0;
  if (Math.abs(det) > 1e-6) {
    localX = (screenX * vY.dy - screenY * vY.dx) / det;
    localY = (screenY * vX.dx - screenX * vX.dy) / det;
  }

  // Sweep: rightmost tiles leave first.
  const positioned = meshes.map((el) => ({
    el,
    x: el.getBoundingClientRect().left,
  }));
  const maxX = Math.max(...positioned.map((p) => p.x));
  const minX = Math.min(...positioned.map((p) => p.x));
  const span = Math.max(1, maxX - minX);

  isAssembling.value = true;
  for (const item of positioned) {
    const delay =
      ((maxX - item.x) / span) * introClearStagger + Math.random() * 40;
    item.el.style.willChange = "transform";
    item.el.style.transition = `transform ${introClearDuration}ms cubic-bezier(0.4, 0, 1, 1) ${delay}ms`;
    item.el.style.transform = `translate3d(${localX}px, ${localY}px, 0)`;
  }

  introClearTimer = window.setTimeout(() => {
    introClearTimer = null;
    for (const item of positioned) {
      item.el.style.willChange = "";
      item.el.style.transition = "";
      // Leave the off-screen transform; the drop-in intro overwrites it.
    }
    onDone();
  }, introClearStagger + introClearDuration + 40);
}

function runAssembleIntro(): void {
  stopAssembleIntro();
  clockRunning.value = false; // don't count the intro; starts when it settles
  const reduceMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const activeTilesList = tiles.value.filter((tile) => !tile.removed);
  if (activeTilesList.length === 0 || reduceMotion) {
    boardPreparing.value = false; // show the (textured) board at rest
    clockRunning.value = true; // no animation → board is ready immediately
    return;
  }
  // Rain, not layers: schedule each tile's landing time from its support graph.
  // A tile rests on the tiles directly beneath it (z-1, overlapping footprint);
  // it may only touch down once every one of those has settled (landed + bounce)
  // for introSettleLead ms. Tiles with no one landing on them are free to rain
  // in whenever, at varied fall speeds — so it never looks lock-step.
  const overlaps = (a: GameTile, b: GameTile) =>
    a.gridX < b.gridX2 &&
    a.gridX2 > b.gridX &&
    a.gridY < b.gridY2 &&
    a.gridY2 > b.gridY;

  const maxFallTime = introTileDuration + introTileDurationJitter;
  const landingTime = new Map<number, number>();
  for (const tile of [...activeTilesList].sort((a, b) => a.z - b.z)) {
    let earliest = maxFallTime; // can't land before it has finished falling
    let supported = false;
    for (const other of activeTilesList) {
      if (other.z !== tile.z - 1 || !overlaps(tile, other)) {
        continue;
      }
      supported = true;
      const settled =
        (landingTime.get(other.id) ?? 0) + introBounceTime + introSettleLead;
      if (settled > earliest) {
        earliest = settled;
      }
    }
    const spread = supported ? introTileExtraSpread : introBaseSpread;
    landingTime.set(tile.id, earliest + Math.random() * spread);
  }

  const plans: IntroPlan[] = [];
  for (const tile of activeTilesList) {
    const handle = polyTileMeshHandles.get(tile.id);
    if (!handle) {
      continue;
    }
    const fallTime = introTileDuration + Math.random() * introTileDurationJitter;
    const land = landingTime.get(tile.id) ?? maxFallTime;
    plans.push({
      el: handle.element,
      startOffset: 0,
      bounceOffset: 0,
      fallDelay: Math.max(0, land - fallTime),
      fallTime,
      landed: false,
    });
  }
  if (plans.length === 0) {
    // No meshes to animate — don't leave the board hidden or the clock frozen.
    boardPreparing.value = false;
    clockRunning.value = true;
    return;
  }

  // Calibrate the straight-up-the-screen direction, then start every tile a
  // full viewport above its resting place (off-screen), whatever the camera
  // angle/units are.
  const sample = plans[0].el;
  const vX = measureAxisVector(sample, "X", 200);
  const vY = measureAxisVector(sample, "Y", 200);
  // Solve a·vX + b·vY = (0, -1): the local X/Y translate that moves a tile
  // straight UP the screen by 1px. No Z — a large translateZ breaks the symbol
  // paint under perspective and barely moves center tiles. (upX, upY) is that
  // per-pixel direction, shared by all tiles.
  const det = vX.dx * vY.dy - vY.dx * vX.dy;
  let upX = 0;
  let upY = -1;
  if (Math.abs(det) > 1e-6) {
    upX = vY.dx / det;
    upY = -vX.dx / det;
  } else if (Math.abs(vY.dy) > 1e-6) {
    upY = -1 / vY.dy;
  }
  const viewportHeight = sceneRoot.value?.clientHeight || window.innerHeight;
  const baseOffset = viewportHeight * 1.3; // screen px above rest (off-screen)

  const applyOffset = (el: HTMLElement, px: number) => {
    el.style.transform = `translate3d(${upX * px}px, ${upY * px}px, 0)`;
  };

  for (const plan of plans) {
    plan.startOffset = baseOffset * (1 + Math.random() * 0.18);
    plan.bounceOffset = introBounceScreenPx;
    plan.el.style.willChange = "transform";
    plan.el.style.transition = "none";
    applyOffset(plan.el, plan.startOffset);
  }
  void document.body.offsetHeight;

  introPlans = plans;
  isAssembling.value = true;
  boardPreparing.value = false; // tiles are off-screen now — safe to reveal
  let lastSoundAt = -Infinity;
  let soundsPlayed = 0;
  const startTime = performance.now();

  const step = (now: number) => {
    const time = now - startTime;
    let allDone = true;

    for (const plan of plans) {
      const local = time - plan.fallDelay;
      let offset: number;
      if (local <= 0) {
        offset = plan.startOffset;
        allDone = false;
      } else if (local < plan.fallTime) {
        // Accelerating fall: distance fallen grows with the square of time.
        const progress = local / plan.fallTime;
        offset = plan.startOffset * (1 - progress * progress);
        allDone = false;
      } else if (local < plan.fallTime + introBounceTime) {
        // Contact: fire a throttled click, then a small damped bounce.
        if (!plan.landed) {
          plan.landed = true;
          if (
            now - lastSoundAt > introLandingMinGap &&
            soundsPlayed < introLandingSoundMax
          ) {
            playLandingSound();
            lastSoundAt = now;
            soundsPlayed += 1;
          }
        }
        const bounce = (local - plan.fallTime) / introBounceTime; // 0..1
        offset = plan.bounceOffset * Math.sin(Math.PI * bounce) * (1 - bounce);
        allDone = false;
      } else {
        offset = 0;
      }
      applyOffset(plan.el, offset);
    }

    if (allDone) {
      stopAssembleIntro();
      clockRunning.value = true; // last piece landed → start the clock
      return;
    }
    introRafId = requestAnimationFrame(step);
  };
  introRafId = requestAnimationFrame(step);
}

function mountPolyScene(): void {
  const root = sceneRoot.value;
  if (!root) {
    return;
  }

  destroyPolyScene();
  polyCameraHandle = createPolyPerspectiveCamera({
    zoom: zoom.value * polyCameraZoomScale,
    rotX: rotX.value,
    rotY: rotY.value,
    perspective: 8000,
  });
  polySceneHandle = createPolyScene(root, {
    camera: polyCameraHandle,
    textureBackend: "image",
    textureImageRendering: "auto",
    textureLeafSizing: "local",
    seamBleed: 0.1,
  });
  tileTextureObserver = new MutationObserver(scheduleDirectTileTextureStylesSync);
  tileTextureObserver.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-texture-source", "style"],
  });
  syncPolyTileMeshes();
  syncPolyCamera();
  scheduleDirectTileTextureStylesSync();
}

function unlockAudioOnFirstGesture(): void {
  const unlock = () => unlockSounds();
  removeGestureUnlock = () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
    removeGestureUnlock = null;
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

onMounted(() => {
  applyThemePreference(readStoredThemePreference() ?? "light");
  preloadSounds();
  unlockAudioOnFirstGesture();
  boardPreparing.value = true; // hide the board until the first drop-in
  const generation = ++introGeneration;
  requestAnimationFrame(() => {
    clampCurrentView();
    mountPolyScene();
    refreshTileVisuals();
    // Skip this first-load intro if a New Game (or unmount) superseded it while
    // images were preloading.
    void preloadTileImages().then(() => {
      if (generation === introGeneration) {
        runAssembleIntro();
      }
    });
  });
});

onBeforeUnmount(() => {
  introGeneration += 1; // invalidate any pending first-load intro
  removeGestureUnlock?.();
  destroyPolyScene();
  clearSelectedTileVisual();
  clearHintTileVisual();
  stopAssembleIntro();
  if (introClearTimer !== null) {
    window.clearTimeout(introClearTimer);
    introClearTimer = null;
  }
  if (refreshRafId !== null) {
    cancelAnimationFrame(refreshRafId);
    refreshRafId = null;
  }
  disposeSounds();
});

function newGame(): void {
  // Ignore repeat clicks while a board-clear sweep is already in flight.
  if (introClearTimer !== null) {
    return;
  }
  introGeneration += 1; // supersede any pending first-load intro
  clockRunning.value = false; // freeze the clock through sweep + drop-in
  clearSelectedTileVisual();
  clearHintTileVisual();
  // Sweep the CURRENT (textured) board off-screen, then reset + drop the new
  // one in once the tiles are gone. Resetting is deferred to onDone so the
  // sweep animates the old board, not a blank not-yet-textured one.
  // resetGame() replaces the tiles array, which already triggers the mesh
  // re-sync — bumping sceneVersion too would run that heavy sync a second time.
  runClearOut(() => {
    resetGame();
    resetGestureState();
    pointerStart.value = null;
    scheduleTileVisualRefresh();
    void nextTick(() => runAssembleIntro());
  });
}

const tileMeshes = computed(() => {
  return createTileMeshSpecs(
    tiles.value,
    freeTileIds.value,
    tileTextureMap.value,
    tilePalette.value,
    turtleGridDimensions,
    activeTiles.value
  );
});
const tileMeshAutoCenterOffset = computed(() =>
  computeTileMeshAutoCenterOffset(tileMeshes.value)
);

watch(
  themeMetaColor,
  (color) => {
    syncThemeMetaColor(color);
  },
  { immediate: true }
);

watch(
  [zoom, rotX, rotY],
  () => {
    syncPolyCamera();
  },
  { flush: "post" }
);

watch(
  tileMeshes,
  (nextTileMeshes) => {
    syncPolyTileMeshes(nextTileMeshes);
    scheduleTileVisualRefresh();
  },
  { flush: "post" }
);

watch(
  sceneVersion,
  () => {
    syncPolyTileMeshes();
    scheduleTileVisualRefresh();
  },
  { flush: "post" }
);
</script>

<template>
  <div class="app" :data-theme="resolvedTheme">
    <section
      ref="sceneRoot"
      class="scene"
      :class="{ 'is-assembling': isAssembling, 'is-preparing': boardPreparing }"
      @pointerdown.capture="onScenePointerDown"
      @pointermove.capture="onScenePointerMove"
      @pointerup.capture="onScenePointerUp"
      @pointercancel.capture="onScenePointerCancel"
      @wheel.prevent="onWheelZoom"
      @touchstart="onTouchStart"
      @touchmove.prevent="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    />

    <header class="sidebar">
      <div class="brand">
        <h1 class="sr-only">VoxJong 3D Mahjong Solitaire</h1>
        <div class="brand-mark">
          <img class="logo" :src="logoUrl" alt="VoxJong" />
          <span class="logo-version">{{ voxjongVersionLabel }}</span>
        </div>
      </div>

      <div class="controls">
        <button type="button" class="chip chip--button" @click="newGame">
          <span class="chip-button-label">New Game</span>
          <span class="chip-button-suit" aria-hidden="true">&hearts;</span>
        </button>
        <button
          type="button"
          class="chip chip--button chip--hint"
          :disabled="remainingTiles === 0 || !hasMoves"
          @click="showHint"
        >
          <span class="chip-button-label">Hints</span>
          <span class="chip-button-suit" aria-hidden="true">&diamondsuit;</span>
        </button>
        <button
          type="button"
          class="chip chip--button chip--theme"
          :aria-label="themeToggleAriaLabel"
          :aria-pressed="isDarkTheme"
          @click="toggleTheme"
        >
          <span class="chip-button-label">{{ themeToggleLabel }}</span>
          <span
            v-if="isDarkTheme"
            class="chip-button-suit"
            aria-hidden="true"
            >&clubs;</span
          >
          <span v-else class="chip-button-suit" aria-hidden="true"
            >&spades;</span
          >
        </button>
        <button
          type="button"
          class="chip chip--button chip--sound"
          :class="{ 'is-muted': isMuted }"
          aria-label="Sound"
          :aria-pressed="!isMuted"
          @click="toggleSound"
        >
          <span class="chip-button-label">{{ soundToggleLabel }}</span>
          <svg
            class="chip-button-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M4 9v6h4l5 5V4L8 9H4z"
            />
            <template v-if="isMuted">
              <path
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                d="M16 9l5 6M21 9l-5 6"
              />
            </template>
            <template v-else>
              <path
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"
              />
            </template>
          </svg>
        </button>
        <div class="move-controls">
          <button
            type="button"
            class="chip chip--button"
            :disabled="!canUndo"
            @click="undoMove"
          >
            <span class="chip-button-label">Undo</span>
          </button>
          <span class="move-separator">|</span>
          <button
            type="button"
            class="chip chip--button"
            :disabled="!canRedo"
            @click="redoMove"
          >
            <span class="chip-button-label">Redo</span>
          </button>
        </div>
        <article class="chip chip--timer">
          <strong>Time:</strong>
          <span class="chip-value">{{ timerLabel }}</span>
        </article>
        <article class="chip chip--tiles">
          <strong>Tiles:</strong>
          <span class="chip-value">{{ remainingTiles }}/{{ totalTiles }}</span>
        </article>
      </div>
    </header>

    <div class="zoom-dock">
      <div class="dock-row">
        <span class="zoom-label">View:</span>
        <div class="view-options" role="radiogroup" aria-label="View">
          <label
            class="view-option"
            :class="{ 'is-active': viewMode === 'isometric' }"
          >
            <input
              class="view-radio"
              type="radio"
              name="view-mode"
              value="isometric"
              :checked="viewMode === 'isometric'"
              @change="setView('isometric')"
            />
            <span>Isometric</span>
          </label>
          <span class="view-separator">/</span>
          <label
            class="view-option"
            :class="{ 'is-active': viewMode === 'topdown' }"
          >
            <input
              class="view-radio"
              type="radio"
              name="view-mode"
              value="topdown"
              :checked="viewMode === 'topdown'"
              @change="setView('topdown')"
            />
            <span>Top Down</span>
          </label>
        </div>
      </div>
      <div class="dock-row">
        <label class="zoom-label" for="zoom-slider">Zoom:</label>
        <input
          id="zoom-slider"
          class="zoom-slider"
          type="range"
          :min="zoomMin"
          :max="zoomMaxCurrent"
          step="0.01"
          :value="zoom"
          aria-label="Zoom"
          @input="onZoomSliderInput"
        />
      </div>
    </div>

    <a
      class="btn-github"
      rel="noopener"
      target="_blank"
      aria-label="View source on GitHub"
      href="https://github.com/LayoutitStudio/voxjong"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="55"
        height="55"
        viewBox="0 0 250 250"
      >
        <path
          class="github-corner-bg"
          d="M0 0l115 115h15l12 27 108 108V0z"
        />
        <path
          class="octo-arm"
          d="M128 109c-15-9-9-19-9-19 3-7 2-11 2-11-1-7 3-2 3-2 4 5 2 11 2 11-3 10 5 15 9 16"
        />
        <path
          class="octo-body"
          d="M115 115s4 2 5 0l14-14c3-2 6-3 8-3-8-11-15-24 2-41 5-5 10-7 16-7 1-2 3-7 12-11 0 0 5 3 7 16 4 2 8 5 12 9s7 8 9 12c14 3 17 7 17 7-4 8-9 11-11 11 0 6-2 11-7 16-16 16-30 10-41 2 0 3-1 7-5 11l-12 11c-1 1 1 5 1 5z"
        />
      </svg>
    </a>

    <div v-if="isWon" class="win-overlay" role="status" aria-live="polite">
      <div class="win-emoji" aria-hidden="true">🀄</div>
      <div class="win-title">You Win</div>
      <div class="win-time">Time: {{ timerLabel }}</div>
    </div>
  </div>
</template>

<style scoped src="./styles/app.css"></style>
