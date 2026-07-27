import type { Id, Vec2 } from '../sim/types.ts';

/** Uniform-scale camera: screen = world * s + offset. */
export interface Camera {
  s: number;
  ox: number;
  oy: number;
}

export interface Overlays {
  flow: boolean;
  desire: boolean;
  districts: boolean;
}

/** The line currently being drawn by the player, straight from the input layer. */
export interface Draft {
  stations: Id[];
  cursor: Vec2 | null;
  /** Station the cursor is snapped to, if any. */
  candidate: Id | null;
  candidateValid: boolean;
  cost: number;
  reason: string | null;
  /** Cost / round-trip / districts touched, shown live next to the cursor. */
  info: string[];
  /** Set when extending an existing line rather than creating one. */
  extending: Id | null;
  end: 'head' | 'tail';
}

export interface ViewState {
  cam: Camera;
  overlays: Overlays;
  hoverStation: Id | null;
  draft: Draft | null;
  /** Wall-clock seconds since page load — animation only, never fed to the sim. */
  time: number;
  /** 0..1 progress between the last two sim ticks. */
  alpha: number;
  paused: boolean;
}

export function fitCamera(
  viewW: number,
  viewH: number,
  worldW: number,
  worldH: number,
  pad = 26,
): Camera {
  const s = Math.min((viewW - pad * 2) / worldW, (viewH - pad * 2) / worldH);
  return {
    s,
    ox: (viewW - worldW * s) / 2,
    oy: (viewH - worldH * s) / 2,
  };
}

export function toScreen(cam: Camera, p: Vec2): Vec2 {
  return { x: p.x * cam.s + cam.ox, y: p.y * cam.s + cam.oy };
}

export function toWorld(cam: Camera, x: number, y: number): Vec2 {
  return { x: (x - cam.ox) / cam.s, y: (y - cam.oy) / cam.s };
}

// --------------------------------------------------------------- colour utils

export const COLORS = {
  ink: '#101A22',
  ink2: '#17242E',
  ink3: '#1F303C',
  car: '#56616B',
  p1: '#FFC53D',
  p2: '#3BC4A7',
  rush: '#FF4D6D',
  paper: '#E8EDF0',
  mute: '#7D8B95',
};

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgb(c: [number, number, number], a = 1): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
}

export function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export const RGB = {
  ink: hexToRgb(COLORS.ink),
  ink2: hexToRgb(COLORS.ink2),
  ink3: hexToRgb(COLORS.ink3),
  car: hexToRgb(COLORS.car),
  p1: hexToRgb(COLORS.p1),
  p2: hexToRgb(COLORS.p2),
  rush: hexToRgb(COLORS.rush),
  paper: hexToRgb(COLORS.paper),
};
