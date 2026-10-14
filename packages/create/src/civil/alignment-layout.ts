/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A horizontal alignment laid out entity by entity, the Civil 3D way: lines
 * and curves, each by how it holds to its neighbours.
 *
 *  - fixed: placed on its own — a line through two points, a curve by its
 *    centre and radius (or through three points) — with no tangency lock;
 *  - floating: attached tangentially to the entity before it — a line
 *    tangent to the previous curve through a point, a curve tangent to the
 *    previous line or curve at its end, by radius and length;
 *  - free: sandwiched between two entities and tangent to both — a curve of
 *    a given radius (with entry / exit spirals between two lines), a line
 *    tangent to two curves.
 *
 * A floating entity hangs on a fixed or floating one; a free one sits
 * between two that are not free. Entities meet where they touch: a fixed
 * line keeps its points unless a curve trims it, a fixed curve runs between
 * where its neighbours touch it. The chain starts and ends on a line or a
 * floating curve. Entities that cannot touch are refused with the reason.
 */

import {
  add, assembleAlignment, dist, evalSegment, roundCorner, scale, wrap, type AlignmentPiece, type HorizontalAlignment, type V2,
} from './alignment-geometry.js';

export type LayoutConstraint = 'fixed' | 'floating' | 'free';

export type LayoutEntity =
  | { kind: 'line'; constraint: 'fixed'; a: V2; b: V2 }
  | { kind: 'line'; constraint: 'floating'; through: V2 }
  | { kind: 'line'; constraint: 'free' }
  | { kind: 'curve'; constraint: 'fixed'; center: V2; radius: number; turn: 1 | -1 }
  | { kind: 'curve'; constraint: 'floating'; radius: number; length: number; turn: 1 | -1 }
  | { kind: 'curve'; constraint: 'free'; radius: number; spiralIn?: number; spiralOut?: number };

/** A resolved entity's carrier: a directed line, or a circle run one way. */
type Carrier = { type: 'line'; p: V2; d: number } | { type: 'circle'; c: V2; r: number; turn: 1 | -1 };

/** Where one entity hands over to the next, and the curve pieces between them (a free curve's). */
interface Joint { at: V2; pieces?: AlignmentPiece[]; out?: V2 }

const unit = (d: number): V2 => [Math.cos(d), Math.sin(d)];
const left = (d: number): V2 => [-Math.sin(d), Math.cos(d)];
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const angleOf = (v: V2) => Math.atan2(v[1], v[0]);
const name = (i: number, e: LayoutEntity) => `Entity ${i + 1} (${e.constraint} ${e.kind})`;

/** The centre, radius and sense of the circle through three points (travelled a → b → c). */
export function curveThrough(a: V2, b: V2, c: V2): { center: V2; radius: number; turn: 1 | -1 } {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) throw new Error('The three points are in a line');
  const s = (p: V2) => p[0] * p[0] + p[1] * p[1];
  const center: V2 = [
    (s(a) * (b[1] - c[1]) + s(b) * (c[1] - a[1]) + s(c) * (a[1] - b[1])) / d,
    (s(a) * (c[0] - b[0]) + s(b) * (a[0] - c[0]) + s(c) * (b[0] - a[0])) / d,
  ];
  const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  return { center, radius: dist(center, a), turn: cross > 0 ? 1 : -1 };
}

/** The travel direction on a circle at the point `p` of it. */
const circleDir = (c: Carrier & { type: 'circle' }, p: V2) => angleOf(sub(p, c.c)) + (c.turn * Math.PI) / 2;

/** Where a circle run `turn`-wise touches the line of direction d it is tangent to: centre = T + turn·r·left(d). */
const touch = (c: V2, r: number, turn: number, d: number): V2 => add(c, scale(left(d), -turn * r));

/**
 * The line leaving circle 1 tangentially and arriving tangentially on
 * circle 2 (r2 = 0: through a point), in the direction of travel.
 */
function commonTangent(c1: V2, r1: number, t1: number, c2: V2, r2: number, t2: number): { d: number; from: V2; to: V2 } | null {
  const D = sub(c2, c1), L = Math.hypot(D[0], D[1]);
  // (c2 - c1)·left(d) = t2 r2 - t1 r1 for a line touching both on the travel sides.
  const k = t2 * r2 - t1 * r1;
  if (L < 1e-12 || Math.abs(k) > L) return null;
  const phi = angleOf(D), alpha = Math.asin(k / L);
  for (const d of [phi - alpha, phi - Math.PI + alpha]) {
    const from = touch(c1, r1, t1, d), to = touch(c2, r2, t2, d);
    if (dot(sub(to, from), unit(d)) > 1e-9) return { d, from, to };
  }
  return null;
}

/** Centres of the circles of radius R run `turn`-wise that join a carrier with continuous direction. */
function filletCentres(c: Carrier, R: number, turn: 1 | -1): { kind: 'line'; p: V2; d: number } | { kind: 'circle'; c: V2; r: number } {
  if (c.type === 'line') return { kind: 'line', p: add(c.p, scale(left(c.d), turn * R)), d: c.d };
  // Same sense: the circles touch inside; opposite senses: outside.
  return { kind: 'circle', c: c.c, r: c.turn === turn ? Math.abs(c.r - R) : c.r + R };
}

function intersect(a: ReturnType<typeof filletCentres>, b: ReturnType<typeof filletCentres>): V2[] {
  if (a.kind === 'line' && b.kind === 'line') {
    const u = unit(a.d), v = unit(b.d), det = u[0] * v[1] - u[1] * v[0];
    if (Math.abs(det) < 1e-12) return [];
    const w = sub(b.p, a.p), t = (w[0] * v[1] - w[1] * v[0]) / det;
    return [add(a.p, scale(u, t))];
  }
  if (a.kind === 'circle' && b.kind === 'line') return intersect(b, a);
  if (a.kind === 'line' && b.kind === 'circle') {
    const u = unit(a.d), w = sub(a.p, b.c);
    const B = dot(w, u), C = dot(w, w) - b.r * b.r, disc = B * B - C;
    if (disc < 0) return [];
    return [-B - Math.sqrt(disc), -B + Math.sqrt(disc)].map((t) => add(a.p, scale(u, t)));
  }
  const c1 = a as { c: V2; r: number }, c2 = b as { c: V2; r: number };
  const D = dist(c1.c, c2.c);
  if (D < 1e-12 || D > c1.r + c2.r || D < Math.abs(c1.r - c2.r)) return [];
  const x = (D * D + c1.r * c1.r - c2.r * c2.r) / (2 * D), h = Math.sqrt(Math.max(c1.r * c1.r - x * x, 0));
  const e = scale(sub(c2.c, c1.c), 1 / D), m = add(c1.c, scale(e, x));
  return [add(m, scale([-e[1], e[0]], h)), add(m, scale([e[1], -e[0]], h))];
}

/** Where a fillet circle (centre X, radius R) touches a carrier. */
function contact(c: Carrier, X: V2, R: number): V2 {
  if (c.type === 'line') { const u = unit(c.d); return add(c.p, scale(u, dot(sub(X, c.p), u))); }
  const toX = sub(X, c.c), l = Math.hypot(toX[0], toX[1]) || 1;
  // Touching outside, or inside with the fillet the smaller: on the carrier toward X; the fillet the larger: away.
  return add(c.c, scale(toX, (R > c.r && Math.abs(l - (R - c.r)) < 1e-6 ? -c.r : c.r) / l));
}

/** The arc of a circle run `turn`-wise from p to q, as one piece. */
function arcPiece(c: V2, r: number, turn: 1 | -1, p: V2, q: V2, pi: number): AlignmentPiece {
  const a0 = angleOf(sub(p, c)), a1 = angleOf(sub(q, c));
  let sweep = turn * (a1 - a0);
  sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return { kind: 'arc', start: p, direction: a0 + (turn * Math.PI) / 2, length: r * sweep, radius: r, turn, pi };
}

/** A free curve of radius R between two carriers: the shortest fillet that runs forward from `after` (where the previous entity begins). */
function fillet(prev: Carrier, next: Carrier, R: number, after: V2, i: number, label: string): Joint {
  let best: Joint | null = null, bestLength = Infinity;
  for (const turn of [1, -1] as const) {
    for (const X of intersect(filletCentres(prev, R, turn), filletCentres(next, R, turn))) {
      const p = contact(prev, X, R), q = contact(next, X, R);
      // On a line the fillet must start ahead of where that line begins.
      if (prev.type === 'line' && dot(sub(p, after), unit(prev.d)) < -1e-6) continue;
      const piece = arcPiece(X, R, turn, p, q, i);
      if (Math.abs(wrap(piece.direction - (prev.type === 'line' ? prev.d : circleDir(prev, p)))) > 1e-6) continue;
      const endDir = piece.direction + (turn * piece.length) / R;
      if (Math.abs(wrap(endDir - (next.type === 'line' ? next.d : circleDir(next, q)))) > 1e-6) continue;
      if (piece.length < bestLength) { best = { at: p, pieces: [piece], out: q }; bestLength = piece.length; }
    }
  }
  if (!best) throw new Error(`${label}: no curve of radius ${R} m touches both its neighbours`);
  return best;
}

export function layoutProblem(layout: readonly LayoutEntity[]): string | null {
  try { buildLayout(layout, 0); return null; } catch (err) { return err instanceof Error ? err.message : String(err); }
}

export function buildLayout(layout: readonly LayoutEntity[], startStation: number): HorizontalAlignment {
  const n = layout.length;
  if (n === 0) throw new Error('The layout has no entities');
  const first = layout[0], last = layout[n - 1];
  if (!(first.kind === 'line' && first.constraint === 'fixed')) throw new Error('A layout starts with a fixed line');
  if (last.constraint === 'free' || (last.kind === 'curve' && last.constraint === 'fixed')) throw new Error('A layout ends on a fixed or floating line, or a floating curve');
  layout.forEach((e, i) => {
    if (e.constraint === 'floating' && layout[i - 1]?.constraint === 'free') throw new Error(`${name(i, e)} hangs on a free entity: attach it to a fixed or floating one`);
    if (e.constraint === 'free' && (layout[i + 1]?.constraint === 'free')) throw new Error(`${name(i, e)} sits next to another free entity`);
    if (e.kind === 'curve' && !(e.radius > 0)) throw new Error(`${name(i, e)} has no radius`);
  });

  // Carriers, left to right; a floating entity needs where the one before it ends (`ends[i]`).
  const carriers: (Carrier | null)[] = new Array(n).fill(null);
  const ends: ({ p: V2; d: number } | null)[] = new Array(n).fill(null);
  layout.forEach((e, i) => {
    const prev = carriers[i - 1] ?? null;
    if (e.kind === 'line' && e.constraint === 'fixed') {
      if (dist(e.a, e.b) < 1e-9) throw new Error(`${name(i, e)} has no length`);
      const d = angleOf(sub(e.b, e.a));
      carriers[i] = { type: 'line', p: e.a, d };
      ends[i] = { p: e.b, d };
    } else if (e.kind === 'curve' && e.constraint === 'fixed') {
      carriers[i] = { type: 'circle', c: e.center, r: e.radius, turn: e.turn };
    } else if (e.kind === 'line' && e.constraint === 'floating') {
      if (prev?.type !== 'circle') throw new Error(`${name(i, e)} must follow a curve`);
      const t = commonTangent(prev.c, prev.r, prev.turn, e.through, 0, 1);
      if (!t) throw new Error(`${name(i, e)}: its point lies inside the curve before it`);
      carriers[i] = { type: 'line', p: t.from, d: t.d };
      ends[i] = { p: e.through, d: t.d };
    } else if (e.kind === 'curve' && e.constraint === 'floating') {
      const from = ends[i - 1];
      if (!from) throw new Error(`${name(i, e)} must follow a line or a floating curve`);
      const c = add(from.p, scale(left(from.d), e.turn * e.radius));
      carriers[i] = { type: 'circle', c, r: e.radius, turn: e.turn };
      const end = evalSegment({ kind: 'arc', station: 0, start: from.p, direction: from.d, length: e.length, radius: e.radius, turn: e.turn, pi: i }, e.length);
      ends[i] = { p: [end.x, end.y], d: end.direction };
    }
  });

  // Free lines: tangent to the curves either side.
  layout.forEach((e, i) => {
    if (!(e.kind === 'line' && e.constraint === 'free')) return;
    const a = carriers[i - 1], b = carriers[i + 1];
    if (a?.type !== 'circle' || b?.type !== 'circle') throw new Error(`${name(i, e)} must sit between two curves`);
    const t = commonTangent(a.c, a.r, a.turn, b.c, b.r, b.turn);
    if (!t) throw new Error(`${name(i, e)}: no line touches both curves in the direction of travel`);
    carriers[i] = { type: 'line', p: t.from, d: t.d };
  });

  // Joints between neighbours: where entity i ends and i + 1 begins (a free curve's own pieces between).
  const starts: V2[] = new Array(n);
  const pieces: AlignmentPiece[] = [];
  starts[0] = (first as { a: V2 }).a;
  let i = 0;
  while (i < n) {
    const e = layout[i], c = carriers[i]!;
    const next = layout[i + 1];
    let joint: Joint | null = null, skip = 1;
    if (!next) joint = { at: ends[i]!.p };
    else if (next.kind === 'curve' && next.constraint === 'free') {
      const after = layout[i + 2], cn = carriers[i + 2];
      if (!after || !cn) throw new Error(`${name(i + 1, next)} must sit between two entities`);
      if (c.type === 'line' && cn.type === 'line') {
        const at = intersect({ kind: 'line', p: c.p, d: c.d }, { kind: 'line', p: cn.p, d: cn.d })[0];
        if (!at) throw new Error(`${name(i + 1, next)}: its two lines are parallel`);
        const corner = roundCorner(c.d, at, cn.d, next.radius, Math.max(0, next.spiralIn ?? 0), Math.max(0, next.spiralOut ?? 0), i + 1, name(i + 1, next));
        joint = corner ? { at: corner.ts, pieces: corner.pieces, out: corner.st } : { at };
      } else {
        if ((next.spiralIn ?? 0) > 0 || (next.spiralOut ?? 0) > 0) throw new Error(`${name(i + 1, next)}: spirals only between two lines`);
        joint = fillet(c, cn, next.radius, starts[i], i + 1, name(i + 1, next));
      }
      skip = 2;
    } else if (next.kind === 'line' && next.constraint === 'free') {
      joint = { at: carriers[i + 1]!.type === 'line' ? (carriers[i + 1] as { p: V2 }).p : starts[i] };
    } else if (layout[i]?.kind === 'line' && layout[i].constraint === 'free') {
      const b = carriers[i + 1] as Carrier & { type: 'circle' };
      joint = { at: touch(b.c, b.r, b.turn, (c as { d: number }).d) };
    } else if (next.constraint === 'floating') {
      joint = next.kind === 'line' ? { at: (carriers[i + 1] as { p: V2 }).p } : { at: ends[i]!.p };
    } else {
      throw new Error(`${name(i, e)} and ${name(i + 1, next)} do not join: put a free curve or line between them`);
    }
    pieces.push(piece(e, c, starts[i], joint.at, i));
    if (joint.pieces) pieces.push(...joint.pieces);
    if (i + skip < n) starts[i + skip] = joint.out ?? joint.at;
    i += skip;
  }
  return assembleAlignment(pieces, startStation);
}

/** Entity i between its start and end points. */
function piece(e: LayoutEntity, c: Carrier, from: V2, to: V2, i: number): AlignmentPiece {
  if (c.type === 'line') {
    const length = dot(sub(to, from), unit(c.d));
    if (length < -1e-6) throw new Error(`${name(i, e)}: its neighbours overlap on it; shorten their curves`);
    return { kind: 'line', start: from, direction: c.d, length: Math.max(length, 0), radius: Infinity, turn: 1, pi: i };
  }
  return arcPiece(c.c, c.r, c.turn, from, to, i);
}

/** The layout of a PI chain: fixed lines between the PIs, a free curve (with its spirals) at each turning one. */
export function layoutFromPis(pis: readonly { x: number; y: number; radius?: number; spiralIn?: number; spiralOut?: number }[]): LayoutEntity[] {
  const out: LayoutEntity[] = [];
  for (let i = 1; i < pis.length; i++) {
    out.push({ kind: 'line', constraint: 'fixed', a: [pis[i - 1].x, pis[i - 1].y], b: [pis[i].x, pis[i].y] });
    const pi = pis[i];
    if (i < pis.length - 1 && (pi.radius ?? 0) > 0) out.push({ kind: 'curve', constraint: 'free', radius: pi.radius!, spiralIn: pi.spiralIn, spiralOut: pi.spiralOut });
  }
  return out;
}
