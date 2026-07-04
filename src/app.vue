<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  createPolyPerspectiveCamera,
  createPolyScene,
  type ParseResult,
  type PolyMeshHandle,
  type PolyPerspectiveCameraHandle,
  type PolySceneHandle,
} from "@layoutit/polycss";
import {
  logoUrl,
  socialCardUrl,
  tileTextureSets,
} from "./assets/voxjongAssets";
import { useMahjongSession } from "./composables/useMahjongSession";
import { useVoxjongSeo } from "./composables/useVoxjongSeo";
import { useVoxjongView } from "./composables/useVoxjongView";
import type { GameTile } from "./game/mahjong";
import {
  createTileMeshSpecs,
  tilePalettes,
  type TileMeshSpec,
  type TilePolygonData,
} from "./render/voxels";

type ThemeName = "light" | "dark";
type ViewTransitionDocument = Document & {
  startViewTransition?: (
    updateCallback: () => void | Promise<void>
  ) => { finished: Promise<void>; skipTransition: () => void };
};

const clickMoveTolerance = 11;
const polyCameraZoomScale = 50;
const polySceneDepthOffset = 50;
const themeStorageKey = "voxjong-theme";
const runtimeConfig = useRuntimeConfig() as {
  public: {
    voxjongVersion?: unknown;
  };
};
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
let systemThemeQuery: MediaQueryList | null = null;
let tileTextureObserver: MutationObserver | null = null;
let tileTextureRefreshRafId: number | null = null;

const themePreference = ref<ThemeName | "system">("system");
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
  const version = runtimeConfig.public.voxjongVersion;
  return typeof version === "string" && version.trim()
    ? `v${version}`
    : "v0.0";
});

useVoxjongSeo(socialCardUrl, { themeColor: themeMetaColor });

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
} = useVoxjongView(scheduleTileVisualRefresh);

const {
  tiles,
  selectedTileId,
  totalTiles,
  activeTiles,
  remainingTiles,
  isWon,
  selectedTile,
  timerLabel,
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

function getSystemTheme(): ThemeName {
  return systemThemeQuery?.matches ? "dark" : "light";
}

function applyThemePreference(preference: ThemeName | "system"): void {
  themePreference.value = preference;
  resolvedTheme.value = preference === "system" ? getSystemTheme() : preference;
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

function syncSystemTheme(): void {
  if (themePreference.value === "system") {
    resolvedTheme.value = getSystemTheme();
  }
}

async function applyThemePreferenceAndWait(
  preference: ThemeName | "system"
): Promise<void> {
  applyThemePreference(preference);
  await nextTick();
}

function transitionThemePreference(preference: ThemeName): void {
  const doc = document as ViewTransitionDocument;
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  if (reduceMotion || typeof doc.startViewTransition !== "function") {
    applyThemePreference(preference);
    return;
  }

  doc.startViewTransition(() => applyThemePreferenceAndWait(preference));
}

function toggleTheme(): void {
  const nextTheme = resolvedTheme.value === "dark" ? "light" : "dark";
  transitionThemePreference(nextTheme);
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
    handle.element.classList.remove("is-selectable", "is-blocked");
  }
  for (const tile of activeTiles.value) {
    const mesh = findMeshForTile(tile);
    if (!mesh) {
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
  const selectedId = selectedTileId.value;

  if (hintedTileIds.value.length > 0) {
    clearHintState();
  }

  if (selectedId === tile.id) {
    selectedTileId.value = null;
    clearSelectedTileVisual();
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
    scheduleTileVisualRefresh();
    return;
  }

  const selectedTile = tiles.value.find((entry) => entry.id === selectedId);
  if (!selectedTile || selectedTile.removed) {
    selectedTileId.value = tile.id;
    setSelectedTileVisual(tile, mesh);
    scheduleTileVisualRefresh();
    return;
  }

  if (removePair(selectedTile.id, tile.id)) {
    clearSelectedTileVisual();
    clearHintTileVisual();
    sceneVersion.value += 1;
    scheduleTileVisualRefresh();
    return;
  }

  selectedTileId.value = tile.id;
  setSelectedTileVisual(tile, mesh);
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
  tileMesh: TileMeshSpec
): void {
  handle.element.dataset.tileId = String(tileMesh.tileId);
  handle.element.dataset.tileCode = tileMesh.tileCode;
  handle.element.dataset.selectable = String(tileMesh.selectable);

  for (const polygon of tileMesh.polygons) {
    const data = polygon.data as TilePolygonData | undefined;
    if (!data) {
      continue;
    }
    const faces = handle.element.querySelectorAll<HTMLElement>(
      `[data-facename="${data.faceName}"]`
    );
    for (const face of faces) {
      face.dataset.tileId = String(data.tileId);
      face.dataset.tileCode = data.tileCode;
      face.dataset.selectable = String(data.selectable);
      face.dataset.blocked = String(data.blocked);
      face.dataset.textureSet = data.textureSet;
      face.dataset.textureSource = data.textureSource;
      face.dataset.textureSourcePath = data.textureSourcePath;
      face.style.setProperty(
        "--tile-texture-url",
        data.faceName === "top" ? `url("${data.textureSource}")` : "none"
      );
    }
  }
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
  polySceneHandle.applyCamera();
  syncPolySceneDepthOffset();
}

function syncPolySceneDepthOffset(): void {
  const sceneElement = polySceneHandle?.sceneElement;
  if (!sceneElement) {
    return;
  }
  const depthOffsetPattern = new RegExp(
    `\\s*translateY\\(${polySceneDepthOffset}px\\)`,
    "g"
  );
  const transform = sceneElement.style.transform
    .replace(depthOffsetPattern, "")
    .trim();
  sceneElement.style.transform = transform.replace(
    /^(scale\([^)]+\))/,
    `$1 translateY(${polySceneDepthOffset}px)`
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
    const existingHandle = polyTileMeshHandles.get(tileMesh.tileId);
    if (existingHandle) {
      existingHandle.setPolygons(tileMesh.polygons, {
        merge: false,
        stableDom: true,
        recomputeAutoCenter: false,
      });
      syncPolyMeshMetadata(existingHandle, tileMesh);
      continue;
    }

    const handle = polySceneHandle.add(createTileParseResult(tileMesh), {
      id: `tile-${tileMesh.tileId}`,
      merge: false,
      stableDom: true,
    });
    syncPolyMeshMetadata(handle, tileMesh);
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
    autoCenter: true,
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

onMounted(() => {
  systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  applyThemePreference(readStoredThemePreference() ?? "system");
  systemThemeQuery.addEventListener("change", syncSystemTheme);
  requestAnimationFrame(() => {
    clampCurrentView();
    mountPolyScene();
    refreshTileVisuals();
  });
});

onBeforeUnmount(() => {
  systemThemeQuery?.removeEventListener("change", syncSystemTheme);
  systemThemeQuery = null;
  destroyPolyScene();
  clearSelectedTileVisual();
  clearHintTileVisual();
  if (refreshRafId !== null) {
    cancelAnimationFrame(refreshRafId);
    refreshRafId = null;
  }
});

function newGame(): void {
  sceneVersion.value += 1;
  resetGame();
  resetGestureState();
  pointerStart.value = null;
  clearSelectedTileVisual();
  clearHintTileVisual();
  scheduleTileVisualRefresh();
}

const tileMeshes = computed(() => {
  return createTileMeshSpecs(
    activeTiles.value,
    freeTileIds.value,
    tileTextureMap.value,
    tilePalette.value
  );
});

watch(
  [zoom, rotX, rotY],
  () => {
    syncPolyCamera();
    scheduleTileVisualRefresh();
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
