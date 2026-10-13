/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Timber-frame wall panels: the pieces of a stud wall in the wall's own frame
 * (x along the wall from its start, y across it — the wall's axis at y = 0,
 * its right face at −thickness / 2 —, z up from its foot). Pure geometry;
 * `timber-frame-store.ts` writes the pieces under the wall.
 *
 *  - plates: one sole plate, one or two head plates, along the whole wall;
 *  - studs: one at each end and one every `spacing` (centres from the start),
 *    between the plates;
 *  - at every opening: a king stud and a jack (trimmer) stud each side, a
 *    header on the jacks, cripple studs above it on the stud grid and, under
 *    a window (an opening above the sole plate), a sill with cripples below;
 *  - noggings: rows of blocking between the vertical pieces, kept out of
 *    the openings;
 *  - boards: the sheathing on the right (outer) face and the lining on the
 *    left one, as rectangles around the openings.
 * The framing fills the thickness the boards leave.
 */

export interface TimberFrameSpec {
  /** Stud width along the wall, metres (the plates are as high). */
  studWidth: number;
  /** Stud centres, metres. */
  spacing: number;
  /** Head plates (1 or 2). */
  headPlates: 1 | 2;
  /** Nogging rows, evenly up the studs (0: none). */
  noggingRows: number;
  /** Header depth over openings, metres. */
  headerDepth: number;
  /** Boards: material name and thickness (metres); null: none. */
  sheathing: { material: string; thickness: number } | null;
  lining: { material: string; thickness: number } | null;
  /** Timber strength class of the framing. */
  grade: string;
}

export type FramePieceRole = 'plate' | 'stud' | 'king' | 'jack' | 'header' | 'sill' | 'cripple' | 'nogging' | 'sheathing' | 'lining';

/** An axis-aligned box in the wall's frame. */
export interface FrameBox {
  x: [number, number];
  y: [number, number];
  z: [number, number];
}

export interface FramePiece {
  /** Stable for the same layout (role and order): regeneration keeps a piece's GlobalId by it. */
  key: string;
  role: FramePieceRole;
  box: FrameBox;
}

export interface FrameWall {
  length: number;
  height: number;
  thickness: number;
}

/** An opening in the wall's frame: along the wall from x0 to x1, from z0 (sill) to z1 (head). */
export interface FrameOpening {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export function defaultTimberFrame(): TimberFrameSpec {
  return {
    studWidth: 0.06, spacing: 0.625, headPlates: 2, noggingRows: 1, headerDepth: 0.2,
    sheathing: { material: 'OSB', thickness: 0.015 }, lining: { material: 'Gypsum board', thickness: 0.0125 }, grade: 'C24',
  };
}

/** Why a frame cannot be built in a wall, or null. */
export function timberFrameProblem(s: TimberFrameSpec, wall: FrameWall): string | null {
  if (!(s.studWidth > 0.02) || s.studWidth > 0.3) return 'The stud width must be between 20 and 300 mm';
  if (!(s.spacing >= s.studWidth * 2) || s.spacing > 2) return 'The stud spacing must be at least twice the stud width and at most 2 m';
  const boards = (s.sheathing?.thickness ?? 0) + (s.lining?.thickness ?? 0);
  if (wall.thickness - boards < 0.04) return 'The wall is too thin for its boards and a stud';
  if (wall.height < s.studWidth * (1 + s.headPlates) + 0.3) return 'The wall is too low for its plates';
  if (wall.length < s.studWidth * 2) return 'The wall is too short for two studs';
  if (!Number.isInteger(s.noggingRows) || s.noggingRows < 0 || s.noggingRows > 4) return 'Nogging rows must be 0 to 4';
  return null;
}

const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] - 1e-9 && b[0] < a[1] - 1e-9;

/** The pieces of a timber frame in a wall with `openings`. */
export function timberFrameParts(s: TimberFrameSpec, wall: FrameWall, openings: readonly FrameOpening[]): FramePiece[] {
  const problem = timberFrameProblem(s, wall);
  if (problem) throw new Error(`timber frame: ${problem}`);
  const { length: L, height: H, thickness: t } = wall;
  const w = s.studWidth;
  const right = -t / 2, left = t / 2;
  const sheathing = s.sheathing?.thickness ?? 0, lining = s.lining?.thickness ?? 0;
  const y: [number, number] = [right + sheathing, left - lining];
  const studFoot = w, studHead = H - w * s.headPlates;
  const pieces: FramePiece[] = [];
  const add = (key: string, role: FramePieceRole, x: [number, number], z: [number, number], yy = y) => {
    if (x[1] - x[0] > 1e-4 && z[1] - z[0] > 1e-4) pieces.push({ key, role, box: { x, y: yy, z } });
  };
  // Openings inside the wall, clipped to the framing, left to right.
  const holes = openings
    .map((o) => ({ x0: Math.max(o.x0, 2 * w), x1: Math.min(o.x1, L - 2 * w), z0: Math.max(o.z0, studFoot), z1: Math.min(o.z1, studHead) }))
    .filter((o) => o.x1 - o.x0 > 0.05 && o.z1 - o.z0 > 0.05)
    .sort((a, b) => a.x0 - b.x0);

  add('plate:sole', 'plate', [0, L], [0, w]);
  add('plate:head:0', 'plate', [0, L], [H - w, H]);
  if (s.headPlates === 2) add('plate:head:1', 'plate', [0, L], [H - 2 * w, H - w]);

  // Vertical pieces, for the noggings between them: x ranges and the heights they cover.
  const verticals: { x: [number, number]; z: [number, number] }[] = [];
  const vertical = (key: string, role: FramePieceRole, x: [number, number], z: [number, number]) => {
    add(key, role, x, z);
    verticals.push({ x, z });
  };
  // Where an opening's own pieces stand: no grid stud there.
  const busy = holes.map((o) => [o.x0 - 2 * w, o.x1 + 2 * w] as [number, number]);
  const grid: number[] = [w / 2];
  for (let c = s.spacing; c < L - w / 2 - 1e-9; c += s.spacing) grid.push(c);
  grid.push(L - w / 2);
  grid.forEach((c, i) => {
    const x: [number, number] = [Math.max(0, c - w / 2), Math.min(L, c + w / 2)];
    if (busy.some((b) => overlaps(x, b))) return;
    vertical(`stud:${i}`, 'stud', x, [studFoot, studHead]);
  });

  holes.forEach((o, k) => {
    const header: [number, number] = [o.z1, Math.min(o.z1 + s.headerDepth, studHead)];
    vertical(`king:${k}:a`, 'king', [o.x0 - 2 * w, o.x0 - w], [studFoot, studHead]);
    vertical(`king:${k}:b`, 'king', [o.x1 + w, o.x1 + 2 * w], [studFoot, studHead]);
    vertical(`jack:${k}:a`, 'jack', [o.x0 - w, o.x0], [studFoot, o.z1]);
    vertical(`jack:${k}:b`, 'jack', [o.x1, o.x1 + w], [studFoot, o.z1]);
    add(`header:${k}`, 'header', [o.x0 - w, o.x1 + w], header);
    const window = o.z0 > studFoot + w + 0.05;
    if (window) add(`sill:${k}`, 'sill', [o.x0, o.x1], [o.z0 - w, o.z0]);
    // Cripples on the stud grid: above the header, and under a window's sill.
    grid.forEach((c, i) => {
      const x: [number, number] = [c - w / 2, c + w / 2];
      if (x[0] < o.x0 + 1e-9 || x[1] > o.x1 - 1e-9) return;
      if (studHead - header[1] > 0.05) vertical(`cripple:${k}:top:${i}`, 'cripple', x, [header[1], studHead]);
      if (window && o.z0 - w - studFoot > 0.05) vertical(`cripple:${k}:bottom:${i}`, 'cripple', x, [studFoot, o.z0 - w]);
    });
  });

  // Noggings: between neighbouring verticals that both reach the row, outside the openings.
  for (let r = 1; r <= s.noggingRows; r++) {
    const z = studFoot + ((studHead - studFoot) * r) / (s.noggingRows + 1);
    const zs: [number, number] = [z - w / 2, z + w / 2];
    const posts = verticals.filter((v) => v.z[0] <= zs[0] + 1e-9 && v.z[1] >= zs[1] - 1e-9).sort((a, b) => a.x[0] - b.x[0]);
    for (let i = 0; i + 1 < posts.length; i++) {
      const x: [number, number] = [posts[i].x[1], posts[i + 1].x[0]];
      if (x[1] - x[0] < 0.02) continue;
      if (holes.some((o) => overlaps(x, [o.x0, o.x1]) && overlaps(zs, [o.z0 - w, o.z1 + s.headerDepth]))) continue;
      add(`nogging:${r}:${i}`, 'nogging', x, zs);
    }
  }

  // Boards: rectangles around the openings (full-height strips between them, pieces above and below).
  const board = (role: 'sheathing' | 'lining', yy: [number, number]) => {
    let x = 0;
    const cuts = openings.map((o) => ({ x0: Math.max(0, o.x0), x1: Math.min(L, o.x1), z0: Math.max(0, o.z0), z1: Math.min(H, o.z1) }))
      .filter((o) => o.x1 > o.x0 && o.z1 > o.z0).sort((a, b) => a.x0 - b.x0);
    cuts.forEach((o, k) => {
      add(`${role}:${k}:strip`, role, [x, Math.max(x, o.x0)], [0, H], yy);
      add(`${role}:${k}:below`, role, [o.x0, o.x1], [0, o.z0], yy);
      add(`${role}:${k}:above`, role, [o.x0, o.x1], [o.z1, H], yy);
      x = Math.max(x, o.x1);
    });
    add(`${role}:end`, role, [x, L], [0, H], yy);
  };
  if (s.sheathing) board('sheathing', [right, right + sheathing]);
  if (s.lining) board('lining', [left - lining, left]);
  return pieces;
}

/** A box's six faces, counter-clockwise seen from outside. */
export function boxFaces(b: FrameBox): [number, number, number][][] {
  const [x0, x1] = b.x, [y0, y1] = b.y, [z0, z1] = b.z;
  return [
    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]],
    [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]],
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
  ];
}
