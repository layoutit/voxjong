import type { RandomSource } from "./mahjong";

const uint32Range = 0x1_0000_0000;

export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / uint32Range;
  };
}

export function createGameSeed(): number {
  const values = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
    return values[0] ?? 0;
  }
  return Math.floor(Math.random() * uint32Range) >>> 0;
}
