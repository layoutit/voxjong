import { ref } from "vue";
import select1Url from "../assets/sounds/select-1.wav";
import select2Url from "../assets/sounds/select-2.wav";
import combine1Url from "../assets/sounds/combine-1.wav";
import combine2Url from "../assets/sounds/combine-2.wav";
import landing1Url from "../assets/sounds/landing-1.wav";
import landing2Url from "../assets/sounds/landing-2.wav";
import clearUrl from "../assets/sounds/clear.wav";

// Each interaction randomizes across a small set of variants so repeated taps
// don't sound mechanically identical.
const selectUrls = [select1Url, select2Url];
const combineUrls = [combine1Url, combine2Url];
const landingUrls = [landing1Url, landing2Url];

// The click on a chip is deliberately quieter than the combine "drop".
// Landing ticks fire in quick succession during the intro, so they're quietest.
const selectGain = 0.35;
const combineGain = 0.7;
const landingGain = 0.3;
const clearGain = 0.6;

// Length of clear.wav (chips_in_sack_short), used to time the New Game sweep.
export const clearSoundDurationMs = 604;

const muteStorageKey = "voxjong-muted";

function readStoredMuted(): boolean {
  // Muted by default; only an explicit stored "false" unmutes.
  try {
    return window.localStorage.getItem(muteStorageKey) !== "false";
  } catch {
    return true;
  }
}

function persistMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(muteStorageKey, String(muted));
  } catch {
    // Ignore storage failures; muting stays in-memory for the session.
  }
}

// Shared across every useSound() caller so the toggle stays in sync app-wide.
const isMuted = ref(typeof window === "undefined" ? true : readStoredMuted());

// One shared AudioContext + decoded-buffer cache for the whole app.
let audioContext: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>();

function getContext(): AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (!audioContext) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) {
      return null;
    }
    audioContext = new Ctor();
  }
  return audioContext;
}

async function loadSound(url: string): Promise<void> {
  const ctx = getContext();
  if (!ctx || buffers.has(url)) {
    return;
  }
  try {
    const response = await fetch(url);
    const data = await response.arrayBuffer();
    buffers.set(url, await ctx.decodeAudioData(data));
  } catch {
    // Audio is a non-critical enhancement; a decode/fetch failure just
    // leaves the game silent rather than breaking play.
  }
}

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function useSound() {
  // Decoding works on a suspended context (no gesture needed); only playback
  // requires the resume() that unlock() performs on the first pointer event.
  function preload(): void {
    for (const url of [
      ...selectUrls,
      ...combineUrls,
      ...landingUrls,
      clearUrl,
    ]) {
      void loadSound(url);
    }
  }

  function unlock(): void {
    const ctx = getContext();
    if (ctx && ctx.state === "suspended") {
      void ctx.resume();
    }
  }

  function play(url: string, gain: number, rate = 1): void {
    if (isMuted.value) {
      return;
    }
    const ctx = getContext();
    if (!ctx) {
      return;
    }
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    const buffer = buffers.get(url);
    if (!buffer) {
      void loadSound(url);
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gainNode = ctx.createGain();
    gainNode.gain.value = gain;
    source.connect(gainNode).connect(ctx.destination);
    source.start();
  }

  function setMuted(muted: boolean): void {
    isMuted.value = muted;
    persistMuted(muted);
  }

  function toggleMuted(): void {
    setMuted(!isMuted.value);
  }

  return {
    muted: isMuted,
    preload,
    unlock,
    setMuted,
    toggleMuted,
    playSelect: () => play(pickRandom(selectUrls), selectGain),
    playMatch: () => play(pickRandom(combineUrls), combineGain),
    playLanding: () =>
      play(pickRandom(landingUrls), landingGain, 0.9 + Math.random() * 0.2),
    playClear: () => play(clearUrl, clearGain),
  };
}
