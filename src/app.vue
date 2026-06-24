<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  createCamera,
  renderScene,
  type HeadlessCameraHandle,
  type HeadlessRenderHandle,
} from "@layoutit/voxcss";
import {
  logoUrl,
  socialCardUrl,
  tileTextures,
} from "./assets/voxjongAssets";
import { useMahjongSession } from "./composables/useMahjongSession";
import { useVoxjongSeo } from "./composables/useVoxjongSeo";
import { useVoxjongView } from "./composables/useVoxjongView";
import type { GameTile } from "./game/mahjong";
import { createSceneState, createTileVoxels } from "./render/voxels";

useVoxjongSeo(socialCardUrl);

const clickMoveTolerance = 11;
const pointerStart = ref<{
  id: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  tileId: number | null;
  cube: HTMLElement | null;
} | null>(null);
const sceneRoot = ref<HTMLElement | null>(null);
const sceneVersion = ref(0);
let selectedCubeEls: HTMLElement[] = [];
let hintedCubeEls: HTMLElement[] = [];
let refreshRafId: number | null = null;
let voxcssCameraHandle: HeadlessCameraHandle | null = null;
let voxcssRenderHandle: HeadlessRenderHandle | null = null;
let voxcssCameraElement: HTMLElement | null = null;

const {
  rotX,
  rotY,
  pan,
  tilt,
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
  consumeWallViewChange,
} = useVoxjongView(scheduleCubeVisualRefresh);

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

function undoMove(): void {
  if (!undoGameMove()) {
    return;
  }
  clearSelectedCubeVisual();
  clearHintCubeVisual();
  sceneVersion.value += 1;
  scheduleCubeVisualRefresh();
}

function redoMove(): void {
  if (!redoGameMove()) {
    return;
  }
  clearSelectedCubeVisual();
  clearHintCubeVisual();
  sceneVersion.value += 1;
  scheduleCubeVisualRefresh();
}

function parseGridLine(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseGridArea(
  value: string
): { x: number; y: number; x2: number; y2: number } | null {
  const [xText, yText, x2Text, y2Text] = value.split("/");
  const x = parseGridLine(xText);
  const y = parseGridLine(yText);
  const x2 = parseGridLine(x2Text);
  const y2 = parseGridLine(y2Text);
  if (x === null || y === null || x2 === null || y2 === null) {
    return null;
  }
  return { x, y, x2, y2 };
}

function resolveTileFromGridArea(target: EventTarget | null): GameTile | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const cube = target.closest(".voxcss-cube") as HTMLElement | null;
  const tileIdText = cube?.dataset.tileId;
  if (tileIdText) {
    const tileId = Number.parseInt(tileIdText, 10);
    if (Number.isFinite(tileId)) {
      const byId = activeTiles.value.find((entry) => entry.id === tileId);
      if (byId) {
        return byId;
      }
    }
  }

  let node: HTMLElement | null = target;
  while (node && node !== sceneRoot.value && !node.style.gridArea) {
    node = node.parentElement;
  }
  if (!node || !node.style.gridArea) {
    return null;
  }

  const parsedArea = parseGridArea(node.style.gridArea);
  if (!parsedArea) {
    return null;
  }

  const layer = node.closest(".voxcss-layer") as HTMLElement | null;
  let layerZ: number | null = null;
  if (layer && sceneRoot.value) {
    const layers = Array.from(
      sceneRoot.value.querySelectorAll<HTMLElement>(".voxcss-layer")
    );
    const index = layers.indexOf(layer);
    if (index >= 0) {
      layerZ = index;
    }
  }

  const candidates = activeTiles.value.filter(
    (tile) =>
      (layerZ === null || tile.z === layerZ) &&
      tile.gridX === parsedArea.x &&
      tile.gridY === parsedArea.y &&
      tile.gridX2 === parsedArea.x2 &&
      tile.gridY2 === parsedArea.y2
  );

  const fallbackCandidates =
    candidates.length > 0
      ? candidates
      : activeTiles.value.filter(
          (tile) =>
            tile.gridX === parsedArea.x &&
            tile.gridY === parsedArea.y &&
            tile.gridX2 === parsedArea.x2 &&
            tile.gridY2 === parsedArea.y2
        );
  if (!fallbackCandidates.length) {
    return null;
  }
  return (
    [...fallbackCandidates].sort((left, right) => right.z - left.z)[0] ?? null
  );
}

function resolveTileFromPoint(
  clientX: number,
  clientY: number
): GameTile | null {
  const doc = sceneRoot.value?.ownerDocument ?? document;
  const target = doc.elementFromPoint(clientX, clientY);
  return resolveTileFromGridArea(target);
}

function resolveCubeFromPoint(
  clientX: number,
  clientY: number
): HTMLElement | null {
  const doc = sceneRoot.value?.ownerDocument ?? document;
  const target = doc.elementFromPoint(clientX, clientY);
  if (!(target instanceof HTMLElement)) {
    return null;
  }
  return target.closest(".voxcss-cube") as HTMLElement | null;
}

function clearHintCubeVisual(): void {
  for (const cube of hintedCubeEls) {
    cube.classList.remove("is-hint");
  }
  hintedCubeEls = [];
}

function clearHintState(): void {
  clearGameHintState();
  clearHintCubeVisual();
}

function clearSelectionAndHintState(): void {
  clearGameSelectionAndHintState();
  clearSelectedCubeVisual();
  clearHintCubeVisual();
}

function clearSelectedCubeVisual(): void {
  for (const cube of selectedCubeEls) {
    cube.classList.remove("is-active");
  }
  selectedCubeEls = [];
}

function setSelectedCubeVisual(
  tile: GameTile | null,
  preferredCube: HTMLElement | null = null
): void {
  clearSelectedCubeVisual();
  const cubes = tile ? findCubesForTile(tile) : [];
  if (preferredCube && !cubes.includes(preferredCube)) {
    cubes.unshift(preferredCube);
  }
  if (cubes.length === 0) {
    return;
  }
  for (const cube of cubes) {
    cube.classList.add("is-active");
  }
  selectedCubeEls = cubes;
}

function findCubesForTile(tile: GameTile): HTMLElement[] {
  const root = sceneRoot.value;
  if (!root) {
    return [];
  }
  const layers = Array.from(
    root.querySelectorAll<HTMLElement>(".voxcss-layer")
  );
  const layer = layers[tile.z];
  if (!layer) {
    return [];
  }
  const cubes = Array.from(layer.querySelectorAll<HTMLElement>(".voxcss-cube"));
  return cubes.filter((cube) => {
    const area = parseGridArea(cube.style.gridArea);
    return (
      area &&
      area.x === tile.gridX &&
      area.y === tile.gridY &&
      area.x2 === tile.gridX2 &&
      area.y2 === tile.gridY2
    );
  });
}

function syncCubeTileBindings(): void {
  const root = sceneRoot.value;
  if (!root) {
    return;
  }
  const allCubes = Array.from(
    root.querySelectorAll<HTMLElement>(".voxcss-cube")
  );
  for (const cube of allCubes) {
    delete cube.dataset.tileId;
  }

  for (const tile of activeTiles.value) {
    const cubes = findCubesForTile(tile);
    if (cubes.length === 0) {
      continue;
    }
    for (const cube of cubes) {
      cube.dataset.tileId = String(tile.id);
    }
  }
}

function syncCubeInteractivity(): void {
  const root = sceneRoot.value;
  if (!root) {
    return;
  }
  const allCubes = Array.from(
    root.querySelectorAll<HTMLElement>(".voxcss-cube")
  );
  for (const cube of allCubes) {
    cube.classList.remove("is-selectable", "is-blocked");
  }
  for (const tile of activeTiles.value) {
    const cubes = findCubesForTile(tile);
    if (cubes.length === 0) {
      continue;
    }
    const selectable = freeTileIds.value.has(tile.id);
    for (const cube of cubes) {
      cube.classList.add(selectable ? "is-selectable" : "is-blocked");
    }
  }
}

function refreshSelectionVisual(): void {
  const tile = selectedTile.value;
  if (!tile) {
    clearSelectedCubeVisual();
    return;
  }
  const cubes = findCubesForTile(tile);
  if (cubes.length === 0) {
    clearSelectedCubeVisual();
    return;
  }
  setSelectedCubeVisual(tile);
}

function refreshHintVisual(): void {
  clearHintCubeVisual();
  if (hintedTileIds.value.length !== 2) {
    return;
  }
  for (const id of hintedTileIds.value) {
    const tile = activeTiles.value.find((entry) => entry.id === id);
    if (!tile) {
      continue;
    }
    const cubes = findCubesForTile(tile);
    if (cubes.length === 0) {
      continue;
    }
    for (const cube of cubes) {
      cube.classList.add("is-hint");
      hintedCubeEls.push(cube);
    }
  }
}

function refreshCubeVisuals(): void {
  syncCubeTileBindings();
  syncCubeInteractivity();
  refreshSelectionVisual();
  refreshHintVisual();
}

function scheduleCubeVisualRefresh(): void {
  if (refreshRafId !== null) {
    return;
  }
  refreshRafId = requestAnimationFrame(() => {
    refreshRafId = null;
    refreshCubeVisuals();
  });
}

function showHint(): void {
  if (!showGameHint()) {
    clearHintCubeVisual();
    return;
  }
  refreshHintVisual();
}

function selectTile(tile: GameTile, cube: HTMLElement | null): void {
  const selectedId = selectedTileId.value;

  if (hintedTileIds.value.length > 0) {
    clearHintState();
  }

  if (selectedId === tile.id) {
    selectedTileId.value = null;
    clearSelectedCubeVisual();
    scheduleCubeVisualRefresh();
    return;
  }

  const clickedIsFree = freeTileIds.value.has(tile.id);
  if (!clickedIsFree) {
    scheduleCubeVisualRefresh();
    return;
  }

  if (selectedId === null) {
    selectedTileId.value = tile.id;
    setSelectedCubeVisual(tile, cube);
    scheduleCubeVisualRefresh();
    return;
  }

  const selectedTile = tiles.value.find((entry) => entry.id === selectedId);
  if (!selectedTile || selectedTile.removed) {
    selectedTileId.value = tile.id;
    setSelectedCubeVisual(tile, cube);
    scheduleCubeVisualRefresh();
    return;
  }

  if (removePair(selectedTile.id, tile.id)) {
    clearSelectedCubeVisual();
    clearHintCubeVisual();
    // Force a scene remount to avoid stale cubes lingering after pair removal.
    sceneVersion.value += 1;
    scheduleCubeVisualRefresh();
    return;
  }

  selectedTileId.value = tile.id;
  setSelectedCubeVisual(tile, cube);
  scheduleCubeVisualRefresh();
}

function onScenePointerDown(event: PointerEvent): void {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const cube = target?.closest(".voxcss-cube") as HTMLElement | null;
  const downTile = cube ? resolveTileFromGridArea(cube) : null;
  pointerStart.value = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    tileId: downTile?.id ?? null,
    cube: cube ?? null,
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
    scheduleCubeVisualRefresh();
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
    scheduleCubeVisualRefresh();
    return;
  }
  const cube = start.cube ?? resolveCubeFromPoint(event.clientX, event.clientY);
  selectTile(tile, cube);
  scheduleCubeVisualRefresh();
}

function onScenePointerCancel(): void {
  pointerStart.value = null;
}

function syncVoxcssCamera(): void {
  if (!voxcssCameraHandle) {
    return;
  }
  voxcssCameraHandle.update({
    zoom: zoom.value,
    pan: pan.value,
    tilt: tilt.value,
    rotX: rotX.value,
    rotY: rotY.value,
    interactive: false,
    animate: false,
    perspective: 8000,
  });
}

function destroyVoxcssScene(): void {
  if (voxcssRenderHandle) {
    voxcssRenderHandle.destroy();
    voxcssRenderHandle = null;
    voxcssCameraHandle = null;
  } else if (voxcssCameraHandle) {
    voxcssCameraHandle.destroy();
    voxcssCameraHandle = null;
  }

  if (voxcssCameraElement?.parentElement) {
    voxcssCameraElement.parentElement.removeChild(voxcssCameraElement);
  }
  voxcssCameraElement = null;

  const root = sceneRoot.value;
  if (root) {
    const staleCameras = Array.from(
      root.querySelectorAll<HTMLElement>(".voxcss-camera")
    );
    for (const cameraNode of staleCameras) {
      cameraNode.remove();
    }
  }
}

function mountVoxcssScene(): void {
  const root = sceneRoot.value;
  if (!root) {
    return;
  }

  destroyVoxcssScene();
  const doc = root.ownerDocument ?? document;
  voxcssCameraElement = doc.createElement("div");
  voxcssCameraHandle = createCamera({
    element: voxcssCameraElement,
    zoom: zoom.value,
    pan: pan.value,
    tilt: tilt.value,
    rotX: rotX.value,
    rotY: rotY.value,
    interactive: false,
    animate: false,
    perspective: 8000,
  });
  voxcssRenderHandle = renderScene({
    element: root,
    camera: voxcssCameraHandle,
    scene: createSceneState(voxels.value),
  });
}

onMounted(() => {
  requestAnimationFrame(() => {
    clampCurrentView();
    mountVoxcssScene();
    syncVoxcssCamera();
    refreshCubeVisuals();
  });
});

onBeforeUnmount(() => {
  destroyVoxcssScene();
  clearSelectedCubeVisual();
  clearHintCubeVisual();
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
  clearSelectedCubeVisual();
  clearHintCubeVisual();
  scheduleCubeVisualRefresh();
}

const voxels = computed(() => {
  return createTileVoxels(activeTiles.value, freeTileIds.value, tileTextures);
});

watch(
  [zoom, pan, tilt, rotX, rotY],
  () => {
    if (consumeWallViewChange()) {
      mountVoxcssScene();
    }
    syncVoxcssCamera();
    scheduleCubeVisualRefresh();
  },
  { flush: "post" }
);

watch(
  voxels,
  (nextVoxels) => {
    if (!voxcssRenderHandle) {
      return;
    }
    voxcssRenderHandle.setScene(createSceneState(nextVoxels));
    scheduleCubeVisualRefresh();
  },
  { flush: "post" }
);

watch(
  sceneVersion,
  () => {
    mountVoxcssScene();
    scheduleCubeVisualRefresh();
  },
  { flush: "post" }
);
</script>

<template>
  <div class="app">
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
          <span class="logo-version">v0.2</span>
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
        <path d="M0 0l115 115h15l12 27 108 108V0z" fill="#fff" />
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
