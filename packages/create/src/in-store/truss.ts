/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Timber trusses: the bars of a truss in its own plane, from its pattern and
 * dimensions. Pure geometry; `truss-store.ts` writes them into a model.
 *
 * The truss plane: x along the span from 0 to `span`, z up from the bottom
 * chord's axis. Bars are axis lines (node to node); a bar's section is its
 * role's (chords or webs). Shapes:
 *  - 'pitched': top chords from both ends up to an apex at mid-span, `rise` high;
 *  - 'mono': one top chord from the low end (x = 0) up to `rise` at x = span,
 *    closed by an end post;
 *  - 'flat': parallel chords `rise` apart, closed by end posts.
 * Patterns place the webs between the chords at `panels` equal panels (an
 * even number for a pitched truss, so a node sits at the apex):
 *  - 'pratt': verticals, diagonals falling towards mid-span;
 *  - 'howe': verticals, diagonals rising towards mid-span;
 *  - 'warren': diagonals alternating, no verticals;
 *  - 'fink': the W of a pitched roof truss (fixed, `panels` ignored);
 *  - 'king': one post at mid-span; 'queen': posts at the thirds, braced to the apex.
 * A `overhang` carries the top chord past the supports, along its slope.
 */

export type TrussShape = 'pitched' | 'mono' | 'flat';
export type TrussPattern = 'pratt' | 'howe' | 'warren' | 'fink' | 'king' | 'queen';
export type TrussRole = 'top' | 'bottom' | 'web' | 'post';

export interface TrussSection {
  width: number;
  depth: number;
}

export interface TimberTrussSpec {
  shape: TrussShape;
  pattern: TrussPattern;
  /** Metres, between the supports (the bottom chord's length). */
  span: number;
  /** Metres: the apex (pitched), the high end (mono) or the chord spacing (flat), above the bottom chord's axis. */
  rise: number;
  /** Equal panels along the span (2 … 16; even for a pitched truss). */
  panels: number;
  /** Top chord past each support, horizontal metres (0: none). */
  overhang: number;
  chord: TrussSection;
  web: TrussSection;
  /** Strength class of the timber, e.g. 'C24'. */
  grade: string;
}

export interface TrussBar {
  /** Stable within a generation (role and order): regeneration keeps a part's GlobalId by it. */
  key: string;
  role: TrussRole;
  a: [number, number];
  b: [number, number];
  section: TrussSection;
}

export function defaultTimberTruss(): TimberTrussSpec {
  return {
    shape: 'pitched', pattern: 'fink', span: 8, rise: 2, panels: 4, overhang: 0.4,
    chord: { width: 0.06, depth: 0.2 }, web: { width: 0.06, depth: 0.12 }, grade: 'C24',
  };
}

/** Why a spec cannot make a truss, or null. */
export function trussProblem(s: TimberTrussSpec): string | null {
  if (!(s.span > 0.5) || s.span > 60) return 'The span must be between 0.5 and 60 m';
  if (!(s.rise > 0.05) || s.rise > s.span) return 'The rise must be positive and no more than the span';
  if (!Number.isInteger(s.panels) || s.panels < 2 || s.panels > 16) return 'The panels must be a whole number from 2 to 16';
  if (s.shape === 'pitched' && s.panels % 2 && s.pattern !== 'fink' && s.pattern !== 'king' && s.pattern !== 'queen') return 'A pitched truss needs an even number of panels';
  if (s.pattern === 'fink' && s.shape !== 'pitched') return 'A fink truss is pitched';
  for (const sec of [s.chord, s.web]) if (!(sec.width > 0) || !(sec.depth > 0)) return 'The sections must be positive';
  if (!(s.overhang >= 0) || s.overhang > 3) return 'The overhang must be between 0 and 3 m';
  return null;
}

/** The top chord's height above the bottom chord at `x`. */
export function topAt(s: Pick<TimberTrussSpec, 'shape' | 'span' | 'rise'>, x: number): number {
  if (s.shape === 'flat') return s.rise;
  if (s.shape === 'mono') return (s.rise * x) / s.span;
  return s.rise * (1 - Math.abs(x - s.span / 2) / (s.span / 2));
}

/** The bars of a truss, in its plane. */
export function trussBars(s: TimberTrussSpec): TrussBar[] {
  const problem = trussProblem(s);
  if (problem) throw new Error(`truss: ${problem}`);
  const bars: TrussBar[] = [];
  const P = (x: number, z: number): [number, number] => [x, z];
  const onBottom = (p: [number, number]) => Math.abs(p[1]) < 1e-9;
  const onTop = (p: [number, number]) => Math.abs(p[1] - topAt(s, p[0])) < 1e-9;
  const bar = (key: string, role: TrussRole, a: [number, number], b: [number, number]) => {
    // A web or post with both ends on one chord would lie along it (at a pitched truss's supports): no bar.
    if ((role === 'web' || role === 'post') && ((onBottom(a) && onBottom(b)) || (onTop(a) && onTop(b)))) return;
    bars.push({ key, role, a, b, section: role === 'top' || role === 'bottom' ? s.chord : s.web });
  };
  const { span, rise } = s;
  const top = (x: number) => P(x, topAt(s, x));
  const bottom = (x: number) => P(x, 0);
  // Top chord ends, carried past the supports along their slope.
  const slopeAt = (x: number) => (s.shape === 'flat' ? 0 : s.shape === 'mono' ? rise / span : (x < span / 2 ? 1 : -1) * (rise / (span / 2)));
  const leftEnd = P(-s.overhang, topAt(s, 0) - s.overhang * slopeAt(0));
  const rightEnd = P(span + s.overhang, topAt(s, span) + s.overhang * slopeAt(span));

  // Chords.
  bar('bottom', 'bottom', bottom(0), bottom(span));
  if (s.shape === 'pitched') {
    bar('top:0', 'top', leftEnd, top(span / 2));
    bar('top:1', 'top', top(span / 2), rightEnd);
  } else {
    bar('top:0', 'top', leftEnd, rightEnd);
  }
  // End posts close a mono's high end and both ends of a flat truss.
  if (s.shape === 'mono' || s.shape === 'flat') bar('post:end', 'post', bottom(span), top(span));
  if (s.shape === 'flat') bar('post:start', 'post', bottom(0), top(0));

  const n = s.panels;
  const xs = Array.from({ length: n + 1 }, (_, i) => (span * i) / n);
  const mid = span / 2;
  switch (s.pattern) {
    case 'king':
      if (s.shape !== 'mono') bar('post:king', 'post', bottom(mid), top(mid));
      break;
    case 'queen': {
      const [t1, t2] = [span / 3, (2 * span) / 3];
      bar('post:q1', 'post', bottom(t1), top(t1));
      bar('post:q2', 'post', bottom(t2), top(t2));
      if (s.shape === 'pitched') {
        bar('web:q1', 'web', bottom(t1), top(mid));
        bar('web:q2', 'web', bottom(t2), top(mid));
      } else {
        bar('web:q', 'web', top(t1), top(t2));
      }
      break;
    }
    case 'fink': {
      // The W: from the bottom third points to the apex and to the top chords' quarter points.
      const [b1, b2] = [span / 3, (2 * span) / 3];
      const [q1, q3] = [span / 4, (3 * span) / 4];
      bar('web:f1', 'web', bottom(b1), top(q1));
      bar('web:f2', 'web', bottom(b1), top(mid));
      bar('web:f3', 'web', bottom(b2), top(mid));
      bar('web:f4', 'web', bottom(b2), top(q3));
      break;
    }
    case 'warren': {
      // Alternating diagonals between the chords, node to node along the panels.
      for (let i = 0; i < n; i++) {
        const [x0, x1] = [xs[i], xs[i + 1]];
        if (i % 2 === 0) bar(`web:${i}`, 'web', bottom(x0), top(x1));
        else bar(`web:${i}`, 'web', top(x0), bottom(x1));
      }
      break;
    }
    case 'pratt':
    case 'howe': {
      // Verticals at the inner nodes (a pitched truss's apex post included; the end posts are above).
      for (let i = 1; i < n; i++) bar(`post:${i}`, 'post', bottom(xs[i]), top(xs[i]));
      for (let i = 0; i < n; i++) {
        const [x0, x1] = [xs[i], xs[i + 1]];
        // A mono rises the whole way; the others towards mid-span.
        const inner = s.shape === 'mono' || (x0 + x1) / 2 < mid ? x1 : x0;
        const outer = inner === x1 ? x0 : x1;
        // Pratt: top at the outer node, foot at the inner one; Howe: the other way.
        const [a, b] = s.pattern === 'pratt' ? [top(outer), bottom(inner)] : [bottom(outer), top(inner)];
        bar(`web:${i}`, 'web', a, b);
      }
      break;
    }
  }
  return bars;
}
