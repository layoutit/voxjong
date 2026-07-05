import { onBeforeUnmount, onMounted, ref } from "vue";

export type ViewMode = "isometric" | "topdown";

const rotXMin = 0;
const rotXMax = 89;
const rotateSpeed = 0.2;
const isometricView = { rotX: 55, rotY: 35 };
const topDownView = { rotX: 0, rotY: 90 };
const zoomMaxDesktop = 2.8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function viewportShortSide(): number {
  if (typeof window === "undefined") {
    return 1024;
  }
  const viewport = window.visualViewport;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  return Math.min(viewportWidth, viewportHeight);
}

function touchDistance(touches: TouchList): number {
  const first = touches[0];
  const second = touches[1];
  if (!first || !second) {
    return 0;
  }
  return Math.hypot(
    first.clientX - second.clientX,
    first.clientY - second.clientY
  );
}

function preventNativeGestureZoom(event: Event): void {
  event.preventDefault();
}

export function useVoxjongView() {
  const rotX = ref(55);
  const rotY = ref(35);
  const pan = ref(0);
  const tilt = ref(0);
  const zoom = ref(1.5);
  const zoomMin = 0.65;
  const zoomMaxCurrent = ref(zoomMaxDesktop);
  const viewMode = ref<ViewMode>("isometric");
  const pinchDistance = ref<number | null>(null);
  let viewportRafId: number | null = null;

  function clampZoom(value: number): number {
    return Math.min(zoomMaxCurrent.value, Math.max(zoomMin, value));
  }

  function clampRotX(value: number): number {
    return clamp(value, rotXMin, rotXMax);
  }

  function clampRotY(value: number): number {
    return value;
  }

  function setZoom(value: number): void {
    zoom.value = Math.round(clampZoom(value) * 1000) / 1000;
  }

  function applyZoomDelta(delta: number): void {
    setZoom(zoom.value + delta);
  }

  function computeViewportZoomMax(): number {
    const shortSide = viewportShortSide();

    if (shortSide <= 420) {
      return 1.15;
    }
    if (shortSide <= 540) {
      return 1.3;
    }
    if (shortSide <= 768) {
      return 1.6;
    }
    return zoomMaxDesktop;
  }

  function computeViewportDefaultZoom(): number {
    const shortSide = viewportShortSide();
    if (shortSide <= 420) {
      return 0.84;
    }
    if (shortSide <= 540) {
      return 0.92;
    }
    if (shortSide <= 768) {
      return 1.15;
    }
    return 1.5;
  }

  function updateViewportZoomBounds(): void {
    zoomMaxCurrent.value = computeViewportZoomMax();
    const clampedZoom = clampZoom(zoom.value);
    if (clampedZoom !== zoom.value) {
      zoom.value = clampedZoom;
    }
  }

  function scheduleViewportZoomBoundsUpdate(): void {
    if (viewportRafId !== null) {
      return;
    }
    viewportRafId = requestAnimationFrame(() => {
      viewportRafId = null;
      updateViewportZoomBounds();
    });
  }

  function onZoomSliderInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (!target) {
      return;
    }
    const value = Number.parseFloat(target.value);
    if (!Number.isFinite(value)) {
      return;
    }
    setZoom(value);
  }

  function setView(mode: ViewMode): void {
    viewMode.value = mode;
    const preset = mode === "topdown" ? topDownView : isometricView;
    rotX.value = clampRotX(preset.rotX);
    rotY.value = clampRotY(preset.rotY);
  }

  function rotateByDragDelta(deltaX: number, deltaY: number): void {
    if (deltaX === 0 && deltaY === 0) {
      return;
    }
    rotY.value = clampRotY(rotY.value - deltaX * rotateSpeed);
    rotX.value = clampRotX(rotX.value - deltaY * rotateSpeed);
  }

  function onWheelZoom(event: WheelEvent): void {
    const deltaY = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    const speed = event.ctrlKey ? 0.01 : 0.0032;
    applyZoomDelta(-deltaY * speed);
  }

  function onTouchStart(event: TouchEvent): void {
    if (event.touches.length === 2) {
      pinchDistance.value = touchDistance(event.touches);
    }
  }

  function onTouchMove(event: TouchEvent): void {
    if (event.touches.length !== 2) {
      return;
    }
    const nextDistance = touchDistance(event.touches);
    if (pinchDistance.value === null) {
      pinchDistance.value = nextDistance;
      return;
    }
    const distanceDelta = nextDistance - pinchDistance.value;
    pinchDistance.value = nextDistance;
    applyZoomDelta(distanceDelta * 0.0042);
    event.preventDefault();
  }

  function onTouchEnd(event: TouchEvent): void {
    if (event.touches.length < 2) {
      pinchDistance.value = null;
    }
  }

  function resetGestureState(): void {
    pinchDistance.value = null;
  }

  function clampCurrentView(): void {
    rotX.value = clampRotX(rotX.value);
    rotY.value = clampRotY(rotY.value);
  }

  onMounted(() => {
    updateViewportZoomBounds();
    zoom.value = clampZoom(computeViewportDefaultZoom());
    window.addEventListener("resize", scheduleViewportZoomBoundsUpdate, {
      passive: true,
    });
    window.addEventListener(
      "orientationchange",
      scheduleViewportZoomBoundsUpdate,
      {
        passive: true,
      }
    );
    window.visualViewport?.addEventListener(
      "resize",
      scheduleViewportZoomBoundsUpdate
    );
    document.addEventListener("gesturestart", preventNativeGestureZoom, {
      passive: false,
    });
    document.addEventListener("gesturechange", preventNativeGestureZoom, {
      passive: false,
    });
    document.addEventListener("gestureend", preventNativeGestureZoom, {
      passive: false,
    });
  });

  onBeforeUnmount(() => {
    window.removeEventListener("resize", scheduleViewportZoomBoundsUpdate);
    window.removeEventListener(
      "orientationchange",
      scheduleViewportZoomBoundsUpdate
    );
    window.visualViewport?.removeEventListener(
      "resize",
      scheduleViewportZoomBoundsUpdate
    );
    document.removeEventListener("gesturestart", preventNativeGestureZoom);
    document.removeEventListener("gesturechange", preventNativeGestureZoom);
    document.removeEventListener("gestureend", preventNativeGestureZoom);
    if (viewportRafId !== null) {
      cancelAnimationFrame(viewportRafId);
      viewportRafId = null;
    }
  });

  return {
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
  };
}
