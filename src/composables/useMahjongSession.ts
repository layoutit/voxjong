import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  canPair,
  createGameTiles,
  getAvailablePairs,
  getFreeTileIds,
  turtleCells,
  type GameTile,
  type MoveRecord,
} from "../game/mahjong";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function useMahjongSession() {
  const tiles = ref<GameTile[]>(createGameTiles());
  const selectedTileId = ref<number | null>(null);
  const elapsedSeconds = ref(0);
  const hintedTileIds = ref<number[]>([]);
  const hintPairIndex = ref(0);
  const undoStack = ref<MoveRecord[]>([]);
  const redoStack = ref<MoveRecord[]>([]);
  // The clock only runs once the board is ready to play (set true after the
  // assemble intro finishes), so the timer doesn't count the animation.
  const clockRunning = ref(false);
  let timerId: ReturnType<typeof setInterval> | null = null;

  const activeTiles = computed(() =>
    tiles.value.filter((tile) => !tile.removed)
  );
  const remainingTiles = computed(() => activeTiles.value.length);
  const isWon = computed(() => remainingTiles.value === 0);
  const selectedTile = computed(() =>
    selectedTileId.value === null
      ? null
      : activeTiles.value.find(
          (tile) => tile.id === selectedTileId.value && !tile.removed
        ) ?? null
  );
  const timerLabel = computed(() => formatElapsed(elapsedSeconds.value));
  const freeTileIds = computed(() => {
    return new Set<number>(getFreeTileIds(activeTiles.value));
  });
  const freeTiles = computed(() =>
    activeTiles.value.filter((tile) => freeTileIds.value.has(tile.id))
  );
  const availablePairs = computed(() => getAvailablePairs(freeTiles.value));
  const hasMoves = computed(() => availablePairs.value.length > 0);
  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  function restartTimer(): void {
    elapsedSeconds.value = 0;
    clockRunning.value = false;
  }

  function startTimer(): void {
    if (timerId !== null) {
      return;
    }
    timerId = setInterval(() => {
      if (clockRunning.value && !isWon.value) {
        elapsedSeconds.value += 1;
      }
    }, 1000);
  }

  function stopTimer(): void {
    if (timerId === null) {
      return;
    }
    clearInterval(timerId);
    timerId = null;
  }

  function clearHintState(): void {
    hintedTileIds.value = [];
    hintPairIndex.value = 0;
  }

  function clearSelectionAndHintState(): void {
    selectedTileId.value = null;
    clearHintState();
  }

  function clearMoveHistory(): void {
    undoStack.value = [];
    redoStack.value = [];
  }

  function applyMoveRemoval(move: MoveRecord): boolean {
    const first = tiles.value.find((tile) => tile.id === move.firstId);
    const second = tiles.value.find((tile) => tile.id === move.secondId);
    if (!first || !second) {
      return false;
    }
    first.removed = true;
    second.removed = true;
    return true;
  }

  function applyMoveRestore(move: MoveRecord): boolean {
    const first = tiles.value.find((tile) => tile.id === move.firstId);
    const second = tiles.value.find((tile) => tile.id === move.secondId);
    if (!first || !second) {
      return false;
    }
    first.removed = false;
    second.removed = false;
    return true;
  }

  function recordRemovedPair(firstId: number, secondId: number): void {
    undoStack.value.push({ firstId, secondId });
    redoStack.value = [];
  }

  function removePair(firstId: number, secondId: number): boolean {
    const first = activeTiles.value.find((tile) => tile.id === firstId);
    const second = activeTiles.value.find((tile) => tile.id === secondId);
    if (!first || !second) {
      return false;
    }
    if (!freeTileIds.value.has(first.id) || !freeTileIds.value.has(second.id)) {
      return false;
    }
    if (!canPair(first.code, second.code)) {
      return false;
    }

    first.removed = true;
    second.removed = true;
    recordRemovedPair(first.id, second.id);
    clearSelectionAndHintState();
    return true;
  }

  function undoMove(): boolean {
    const move = undoStack.value.pop();
    if (!move) {
      return false;
    }
    if (!applyMoveRestore(move)) {
      undoStack.value.push(move);
      return false;
    }
    redoStack.value.push(move);
    clearSelectionAndHintState();
    return true;
  }

  function redoMove(): boolean {
    const move = redoStack.value.pop();
    if (!move) {
      return false;
    }
    if (!applyMoveRemoval(move)) {
      redoStack.value.push(move);
      return false;
    }
    undoStack.value.push(move);
    clearSelectionAndHintState();
    return true;
  }

  function showHint(): boolean {
    const pairs = availablePairs.value;
    if (remainingTiles.value <= 0 || pairs.length === 0) {
      clearHintState();
      return false;
    }

    let sourcePairs = pairs;
    const selectedId = selectedTileId.value;
    if (selectedId !== null) {
      const preferredPairs = pairs.filter(
        ([left, right]) => left === selectedId || right === selectedId
      );
      if (preferredPairs.length === 0) {
        clearHintState();
        return false;
      }
      sourcePairs = preferredPairs;
    }

    const pair = sourcePairs[hintPairIndex.value % sourcePairs.length];
    if (!pair) {
      clearHintState();
      return false;
    }
    hintPairIndex.value = (hintPairIndex.value + 1) % sourcePairs.length;
    hintedTileIds.value = [pair[0], pair[1]];
    return true;
  }

  function resetGame(): void {
    tiles.value = createGameTiles();
    clearMoveHistory();
    clearSelectionAndHintState();
    restartTimer();
  }

  onMounted(startTimer);
  onBeforeUnmount(stopTimer);

  return {
    tiles,
    selectedTileId,
    totalTiles: turtleCells.length,
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
    clearHintState,
    clearSelectionAndHintState,
    removePair,
    undoMove,
    redoMove,
    showHint,
    resetGame,
  };
}
