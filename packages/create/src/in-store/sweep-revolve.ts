/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Swept and revolved solids as closed shells of planar faces (for
 * `addFacetedElementToStore`), pure and unit-agnostic.
 *
 *  - `sweepFaces`: a 2D profile carried along a 3D path. The profile's x runs
 *    to the left of the path, its y up (`up`, default +Z); at every inner
 *    path corner the section is mitred onto the corner's bisector plane, so
 *    neighbouring segments meet with no gap or overlap. An open path is
 *    capped at both ends; a closed one wraps around.
 *  - `revolveFaces`: a 3D profile (a planar loop) turned about an axis by an
 *    angle; a full turn closes on itself, anything less is capped.
 *
 * Faces come out wound counter-clockwise seen from outside: the shell's
 * signed volume decides, and a negative one flips every face.
 */

type Vec2 = [number, number];
type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 1e-12 ? mul(a, 1 / l) : [0, 0, 0];
};

const EPS = 1e-9;

function signedVolume(faces: readonly Vec3[][]): number {
  let v = 0;
  for (const f of faces) {
    for (let i = 1; i + 1 < f.length; i++) v += dot(f[0], cross(f[i], f[i + 1])) / 6;
  }
  return v;
}

/** Drop consecutive repeats (a profile point on the axis collapses its quads to triangles). */
function dedupe(loop: Vec3[]): Vec3[] {
  return loop.filter((p, i) => len(sub(p, loop[(i + loop.length - 1) % loop.length])) > EPS);
}

function outward(faces: Vec3[][]): Vec3[][] {
  const clean = faces.map(dedupe).filter((f) => f.length >= 3);
  return signedVolume(clean) < 0 ? clean.map((f) => [...f].reverse()) : clean;
}

function openProfile(profile: readonly Vec2[]): Vec2[] {
  const pts = profile.map((p) => [p[0], p[1]] as Vec2);
  const a = pts[0], b = pts[pts.length - 1];
  if (pts.length > 1 && Math.hypot(a[0] - b[0], a[1] - b[1]) < EPS) pts.pop();
  if (pts.length < 3) throw new Error('sweep: the profile needs at least 3 points');
  return pts;
}

/** The sections of `profile` along `path`, one per path vertex (mitred at inner corners). */
function sections(profile: Vec2[], path: Vec3[], closed: boolean, up: Vec3): Vec3[][] {
  const n = path.length;
  const segs = closed ? n : n - 1;
  const dirs = Array.from({ length: segs }, (_, i) => unit(sub(path[(i + 1) % n], path[i])));
  if (dirs.some((d) => len(d) === 0)) throw new Error('sweep: the path has a zero-length segment');
  const frame = (d: Vec3): [Vec3, Vec3] => {
    // The profile's x to the left of the path, y as close to `up` as the path allows.
    let x = cross(up, d);
    if (len(x) < 1e-9) x = cross([1, 0, 0], d);
    if (len(x) < 1e-9) x = cross([0, 1, 0], d);
    x = unit(x);
    return [x, cross(d, x)];
  };
  return path.map((v, i) => {
    const before = closed || i > 0 ? dirs[(i - 1 + segs) % segs] : null;
    const after = closed || i < segs ? dirs[i % segs] : null;
    const d = before ?? after!;
    const [x, y] = frame(d);
    const flat = profile.map((p) => add(v, add(mul(x, p[0]), mul(y, p[1]))));
    if (!before || !after) return flat;
    // Mitre: carry each point along the incoming direction onto the bisector plane.
    const m = unit(add(before, after));
    const k = dot(before, m);
    if (Math.abs(k) < 1e-6) throw new Error('sweep: the path folds back on itself');
    return flat.map((p) => add(p, mul(before, -dot(sub(p, v), m) / k)));
  });
}

export function sweepFaces(profile: readonly Vec2[], path: readonly Vec3[], options: { closed?: boolean; up?: Vec3 } = {}): Vec3[][] {
  const prof = openProfile(profile);
  const pts = path.map((p) => [p[0], p[1], p[2]] as Vec3).filter((p, i, all) => i === 0 || len(sub(p, all[i - 1])) > EPS);
  const closed = options.closed === true && pts.length >= 3;
  if (closed && len(sub(pts[0], pts[pts.length - 1])) < EPS) pts.pop();
  if (pts.length < 2) throw new Error('sweep: the path needs at least 2 points');
  const rings = sections(prof, pts, closed, options.up ?? [0, 0, 1]);
  const faces: Vec3[][] = [];
  const spans = closed ? rings.length : rings.length - 1;
  for (let s = 0; s < spans; s++) {
    const a = rings[s], b = rings[(s + 1) % rings.length];
    for (let i = 0; i < prof.length; i++) {
      const j = (i + 1) % prof.length;
      faces.push([a[i], a[j], b[j], b[i]]);
    }
  }
  if (!closed) {
    // Caps run against the side faces' edges: the start ring backwards, the end ring forwards.
    faces.push([...rings[0]].reverse());
    faces.push([...rings[rings.length - 1]]);
  }
  return outward(faces);
}

/** Rotate `p` about the axis through `o` along unit `k` by `angle` (Rodrigues). */
function rotate(p: Vec3, o: Vec3, k: Vec3, angle: number): Vec3 {
  const v = sub(p, o);
  const c = Math.cos(angle), s = Math.sin(angle);
  return add(o, add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c))));
}

export function revolveFaces(
  profile: readonly Vec3[], axisPoint: Vec3, axisDirection: Vec3, angle: number, steps?: number,
): Vec3[][] {
  const prof = profile.map((p) => [p[0], p[1], p[2]] as Vec3);
  if (prof.length > 1 && len(sub(prof[0], prof[prof.length - 1])) < EPS) prof.pop();
  if (prof.length < 3) throw new Error('revolve: the profile needs at least 3 points');
  const k = unit(axisDirection);
  if (len(k) === 0) throw new Error('revolve: the axis has no direction');
  if (!(Math.abs(angle) > 1e-6)) throw new Error('revolve: the angle must not be zero');
  const full = Math.abs(angle) >= Math.PI * 2 - 1e-6;
  const turn = full ? Math.PI * 2 : angle;
  const n = Math.max(2, steps ?? Math.ceil((Math.abs(turn) / (Math.PI * 2)) * 48));
  const rings = Array.from({ length: full ? n : n + 1 }, (_, s) => prof.map((p) => rotate(p, axisPoint, k, (turn * s) / n)));
  const faces: Vec3[][] = [];
  const spans = full ? n : n;
  for (let s = 0; s < spans; s++) {
    const a = rings[s], b = rings[(s + 1) % rings.length];
    for (let i = 0; i < prof.length; i++) {
      const j = (i + 1) % prof.length;
      faces.push([a[i], a[j], b[j], b[i]]);
    }
  }
  if (!full) {
    // Caps run against the side faces' edges: the start ring backwards, the end ring forwards.
    faces.push([...rings[0]].reverse());
    faces.push([...rings[rings.length - 1]]);
  }
  return outward(faces);
}
