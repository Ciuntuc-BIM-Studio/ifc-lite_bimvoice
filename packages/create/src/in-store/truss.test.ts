/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { defaultTimberTruss, topAt, trussBars, trussProblem, type TrussBar, type TimberTrussSpec } from './truss.js';

const spec = (patch: Partial<TimberTrussSpec>): TimberTrussSpec => ({ ...defaultTimberTruss(), overhang: 0, ...patch });
const roles = (bars: TrussBar[]) => bars.reduce<Record<string, number>>((m, b) => ({ ...m, [b.role]: (m[b.role] ?? 0) + 1 }), {});
/** Every web and post end lies on a chord. */
function onChords(s: TimberTrussSpec, bars: TrussBar[]): void {
  for (const b of bars.filter((x) => x.role === 'web' || x.role === 'post')) {
    for (const [x, z] of [b.a, b.b]) {
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(s.span + 1e-9);
      expect(Math.abs(z) < 1e-9 || Math.abs(z - topAt(s, x)) < 1e-9).toBe(true);
    }
  }
}

describe('truss bars', () => {
  it('fink: two top chords, a bottom chord and the four webs of the W', () => {
    const s = spec({ pattern: 'fink' });
    const bars = trussBars(s);
    expect(roles(bars)).toEqual({ bottom: 1, top: 2, web: 4 });
    onChords(s, bars);
    // The W meets the apex.
    expect(bars.filter((b) => b.b[0] === s.span / 2 && Math.abs(b.b[1] - s.rise) < 1e-9).length).toBeGreaterThanOrEqual(2);
  });

  it('pratt and howe: verticals at every inner node; diagonals the other way round', () => {
    const s = spec({ pattern: 'pratt', panels: 6 });
    const pratt = trussBars(s);
    expect(roles(pratt).post).toBe(5);
    onChords(s, pratt);
    const howe = trussBars({ ...s, pattern: 'howe' });
    onChords(s, howe);
    // On the left half a Pratt diagonal falls towards mid-span (its top end is outward), a Howe one rises.
    const leftDiag = (bars: TrussBar[]) => bars.find((b) => b.role === 'web' && b.a[0] < s.span / 2 && b.a[0] > 0)!;
    expect(leftDiag(pratt).a[1]).toBeGreaterThan(0);
    expect(leftDiag(howe).a[1]).toBe(0);
  });

  it('flat (parallel chords) warren: end posts, alternating diagonals, no verticals between', () => {
    const s = spec({ shape: 'flat', pattern: 'warren', panels: 6, rise: 1 });
    const bars = trussBars(s);
    expect(roles(bars)).toEqual({ bottom: 1, top: 1, post: 2, web: 6 });
    onChords(s, bars);
  });

  it('mono: one top chord rising to an end post', () => {
    const s = spec({ shape: 'mono', pattern: 'pratt', panels: 4, rise: 1.5 });
    const bars = trussBars(s);
    expect(bars.filter((b) => b.role === 'top')).toHaveLength(1);
    expect(bars.some((b) => b.key === 'post:end' && b.b[1] === 1.5)).toBe(true);
    onChords(s, bars);
  });

  it('carries the top chord past the supports by the overhang, along its slope', () => {
    const s = spec({ pattern: 'king', overhang: 0.5 });
    const left = trussBars(s).find((b) => b.key === 'top:0')!;
    expect(left.a[0]).toBeCloseTo(-0.5);
    expect(left.a[1]).toBeCloseTo(-0.5 * (s.rise / (s.span / 2)));
  });

  it('keys stay the same for the same layout (regeneration keeps GlobalIds by them)', () => {
    const a = trussBars(spec({ pattern: 'howe', panels: 4 })).map((b) => b.key);
    const b = trussBars(spec({ pattern: 'howe', panels: 4, span: 10, rise: 2.5 })).map((x) => x.key);
    expect(b).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
  });

  it('no web or post lies along a chord, whatever the shape and pattern', () => {
    for (const shape of ['pitched', 'mono', 'flat'] as const) {
      for (const pattern of ['pratt', 'howe', 'warren', 'fink', 'king', 'queen'] as const) {
        const s = spec({ shape, pattern, panels: 4 });
        if (trussProblem(s)) continue;
        for (const b of trussBars(s).filter((x) => x.role === 'web' || x.role === 'post')) {
          const both = (f: (p: [number, number]) => boolean) => f(b.a) && f(b.b);
          expect(both((p) => Math.abs(p[1]) < 1e-9), `${shape} ${pattern} ${b.key} along the bottom chord`).toBe(false);
          expect(both((p) => Math.abs(p[1] - topAt(s, p[0])) < 1e-9), `${shape} ${pattern} ${b.key} along the top chord`).toBe(false);
        }
      }
    }
  });

  it('refuses what cannot be built', () => {
    expect(trussProblem(spec({ pattern: 'pratt', panels: 5 }))).toMatch(/even/);
    expect(trussProblem(spec({ shape: 'flat', pattern: 'fink' }))).toMatch(/pitched/);
    expect(trussProblem(spec({ rise: 0 }))).toMatch(/rise/);
    expect(() => trussBars(spec({ span: 0 }))).toThrow(/span/);
  });
});
