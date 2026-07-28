import { describe, expect, it } from 'vitest';
import { clampCamera, fitCamera, panCamera, toScreen, toWorld, zoomCameraAt } from '../src/render/view.ts';

describe('camera transforms', () => {
  it('round-trips world and screen coordinates', () => {
    const cam = fitCamera(1200, 800, 2400, 1600);
    const world = { x: 713.5, y: 1188.25 };
    const screen = toScreen(cam, world);
    expect(toWorld(cam, screen.x, screen.y)).toEqual(world);
  });

  it('zooms around the cursor and clamps to map bounds', () => {
    const cam = fitCamera(1200, 800, 2400, 1600);
    const cursor = { x: 400, y: 300 };
    const before = toWorld(cam, cursor.x, cursor.y);
    const zoomed = zoomCameraAt(cam, cursor, 2, 1200, 800, 2400, 1600);
    const after = toWorld(zoomed, cursor.x, cursor.y);
    expect(after.x).toBeCloseTo(before.x, 8);
    expect(after.y).toBeCloseTo(before.y, 8);
    expect(zoomed.s).toBeCloseTo(cam.s * 2);
    const panned = panCamera(zoomed, 100000, -100000, 1200, 800, 2400, 1600);
    expect(panned.ox).toBeLessThanOrEqual(50);
    expect(panned.oy).toBeGreaterThanOrEqual(800 - 50 - 1600 * panned.s);
    expect(clampCamera(panned, 1200, 800, 2400, 1600)).toEqual(panned);
  });
});
