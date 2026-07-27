import { describe, expect, it } from 'vitest';
import { logitShares, lerpSplit } from '../src/sim/modechoice.ts';

describe('mode choice', () => {
  it('a far faster network takes the overwhelming majority', () => {
    const [car, p1] = logitShares(600, 100, Infinity);
    expect(p1).toBeGreaterThan(0.8);
    expect(car).toBeLessThan(0.2);
  });

  it('a far slower network is barely used', () => {
    const [, p1] = logitShares(100, 900, Infinity);
    expect(p1).toBeLessThan(0.05);
  });

  it('equal travel times split evenly', () => {
    const [car, p1] = logitShares(300, 300, Infinity);
    expect(p1).toBeCloseTo(0.5, 6);
    expect(car).toBeCloseTo(0.5, 6);
  });

  it('three-way: two equal networks split what they take from the car', () => {
    const [car, p1, p2] = logitShares(600, 200, 200);
    expect(p1).toBeCloseTo(p2, 9);
    expect(p1 + p2).toBeGreaterThan(car);
    expect(car + p1 + p2).toBeCloseTo(1, 9);
  });

  it('an unreachable network gets exactly zero', () => {
    const [, , p2] = logitShares(300, 300, Infinity);
    expect(p2).toBe(0);
  });

  it('nothing reachable at all leaves everyone in the car', () => {
    expect(logitShares(Infinity, Infinity, Infinity)).toEqual([1, 0, 0]);
  });

  it('smoothing moves toward the target without overshooting', () => {
    const cur: [number, number, number] = [1, 0, 0];
    for (let i = 0; i < 200; i++) lerpSplit(cur, [0.2, 0.8, 0], 0.15);
    expect(cur[0]).toBeCloseTo(0.2, 4);
    expect(cur[1]).toBeCloseTo(0.8, 4);
    expect(cur[0] + cur[1] + cur[2]).toBeCloseTo(1, 9);
  });
});
