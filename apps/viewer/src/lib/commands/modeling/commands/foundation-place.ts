/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Foundations, of the current type (`foundation-element.ts`):
 *
 * - `foundation.strip.place`: chained two-click strip foundations, drawn on
 *   the core's axis like walls (typed length and angle lock a segment). Each
 *   commit is one undo step; at a chained corner the two foundation walls are
 *   joined like walls and the new footing runs on past the corner by half
 *   its width, so the footings close the corner. Closing the loop ends the
 *   chain.
 * - `foundation.pad.place`: a stepped pad footing centred on a click; R
 *   turns it by 15°, the turn kept for the next one.
 *
 * Their heights are the type's, from the storey (the footing's underside is
 * `bottom` below it), whatever the work plane's offset.
 */

import { dist } from '@/lib/snap/constraints';
import type { Vec2 } from '@/lib/snap/types';
import { useViewerStore } from '@/store';
import { stemSection, stripFootingRun, type StripFoundationType } from '@ifc-lite/create';
import { FoundationPlaceBar } from '@/components/viewer/tools/command/PlacementBars';
import { WallPlaceScene } from '@/components/viewer/tools/command/WallPlaceScene';
import { WallPlacePlan } from '@/components/viewer/tools/command/WallPlacePlan';
import {
  addPadFootingIn, addStripFoundationIn, currentPadFootingType, currentStripFoundationType, ensureFoundationType, joinStemsIn,
} from '@/project/foundation-element';
import { commandGhostId } from '../ghost.js';
import { centredRectOutline, mergeGhostMeshes, prismGhostMesh } from '../ghost-shapes.js';
import type { CommandContext, CommandField, ModelingCommand, Workplane } from '../types.js';
import { chainOn, planeZ } from './placement-shared.js';
import { COLUMN_ROTATION_STEP } from './column-place.js';
import { MIN_WALL_LENGTH, anchorOf, chainPartners, currentAngle, currentLength, endPoint, type WallPlaceGesture } from './wall-place-geometry.js';

const GHOST: [number, number, number, number] = [0.25, 0.6, 1, 0.45];

/** The foundation wall's and the footing's plan outlines for the axis a → b. */
export function stripOutlines(type: StripFoundationType, a: Vec2, b: Vec2, extendStart: boolean, extendEnd: boolean): { stem: Vec2[]; footing: Vec2[] } {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const n: Vec2 = [-u[1], u[0]];
  const at = (along: number, across: number): Vec2 => [a[0] + u[0] * along + n[0] * across, a[1] + u[1] * along + n[1] * across];
  const { thickness, bodyOffset } = stemSection(type.layers);
  const [lo, hi] = [bodyOffset - thickness / 2, bodyOffset + thickness / 2];
  const run = stripFootingRun({ ...type, start: [a[0], a[1], 0], end: [b[0], b[1], 0], extendStart, extendEnd });
  const w = type.footingWidth / 2;
  return {
    stem: [at(0, lo), at(len, lo), at(len, hi), at(0, hi)],
    footing: [at(-run.before, -w), at(run.length - run.before, -w), at(run.length - run.before, w), at(-run.before, w)],
  };
}

/** The strip foundation the next commit writes: the type, the segment, and how its ends meet the chain. */
function nextStrip(g: WallPlaceGesture) {
  const a = anchorOf(g);
  const b = endPoint(g);
  if (!a || !b) return null;
  const { partners, closes } = chainPartners(g);
  const previous = (g.walls ?? []).length === g.chain.length - 1 ? (g.walls ?? [])[g.chain.length - 2] : undefined;
  return { a, b, type: currentStripFoundationType(), extendStart: previous !== undefined, extendEnd: closes, partners, closes };
}

const STRIP_FIELDS: readonly CommandField<WallPlaceGesture>[] = [
  { id: 'length', labelKey: 'modelingCommand.wall.length', unit: 'm', group: 'segment', read: currentLength, write: (g, v) => ({ ...g, length: Math.abs(v) }) },
  { id: 'angle', labelKey: 'modelingCommand.wall.angle', unit: 'deg', group: 'segment', read: currentAngle, write: (g, v) => ({ ...g, angle: v }) },
];

const initStrip = (): WallPlaceGesture => ({ chain: [], cursor: null, length: null, angle: null, walls: [] });

function stripGhost(plane: Workplane, g: WallPlaceGesture, id: number) {
  const next = nextStrip(g);
  if (!next || dist(next.a, next.b) < MIN_WALL_LENGTH) return null;
  const { type } = next;
  const o = stripOutlines(type, next.a, next.b, next.extendStart, next.extendEnd);
  // Heights from the storey; the ghost's are from the work plane.
  const z0 = type.bottom - planeZ(plane);
  const meshes = [
    prismGhostMesh(plane, o.footing, z0, z0 + type.footingHeight, id),
    prismGhostMesh(plane, o.stem, z0 + type.footingHeight, z0 + type.footingHeight + type.stemHeight, id),
  ].filter((m) => m !== null);
  return mergeGhostMeshes(meshes, id, GHOST);
}

export const STRIP_FOUNDATION_PLACE: ModelingCommand<WallPlaceGesture> = {
  id: 'foundation.strip.place',
  labelKey: 'foundation.strip.label',
  hud: {
    Bar: FoundationPlaceBar,
    Scene: WallPlaceScene,
    Plan: WallPlacePlan,
    hint: (g) => (g.chain.length === 0 ? 'foundation.strip.hintStart' : 'foundation.strip.hintNext'),
  },
  fields: STRIP_FIELDS,
  snap: 'modeling',
  init: () => { ensureFoundationType('stripFoundation'); return initStrip(); },
  snapQuery: (g) => ({
    anchor: anchorOf(g),
    chain: g.chain,
    locks: { ...(g.length !== null ? { length: g.length } : {}), ...(g.angle !== null ? { angleDeg: g.angle } : {}) },
  }),
  pointerMove: (g, s) => ({ ...g, cursor: s.local }),
  pointerDown: (g, s) => (g.chain.length === 0 ? { ...g, chain: [s.local], cursor: s.local } : { commit: true }),
  doubleClick: () => initStrip(),
  undoPoint: (g) => {
    const chain = g.chain.slice(0, -1);
    return { ...g, chain, walls: (g.walls ?? []).slice(0, Math.max(0, chain.length - 1)), length: null, angle: null };
  },
  validate(g, ctx) {
    if (!ctx.workplane || ctx.storeyId === null) return { ok: false, reasonKey: 'modelingCommand.noPlane' };
    const a = anchorOf(g);
    const b = endPoint(g);
    if (!a) return { ok: false, reasonKey: 'foundation.strip.hintStart' };
    return b && dist(a, b) >= MIN_WALL_LENGTH ? { ok: true } : { ok: false, reasonKey: 'modelingCommand.wall.tooShort' };
  },
  commit(g, tx) {
    const next = nextStrip(g);
    if (!next || tx.storeyId === null) throw new Error('No strip foundation to place');
    const made = addStripFoundationIn(useViewerStore, tx.modelId, tx.storeyId, {
      ...next.type, start: [next.a[0], next.a[1], 0], end: [next.b[0], next.b[1], 0], extendStart: next.extendStart, extendEnd: next.extendEnd,
    });
    if ('error' in made) throw new Error(`Couldn't add the strip foundation: ${made.error}`);
    // The foundation walls meet at the chain's corners as walls do (`walls` holds the stems).
    const joined = next.partners.flatMap((stem) => joinStemsIn(useViewerStore, tx.modelId, stem, made.stemId));
    // Not `authored`: the current wall type must not retype the foundation wall.
    return {
      created: [made.foundationId, made.stemId, made.footingId], deleted: [],
      remesh: [...new Set([made.stemId, made.footingId, ...joined])], select: [made.foundationId],
    };
  },
  afterCommit: (g, result, ctx: CommandContext) => {
    if (!chainOn(ctx) || chainPartners(g).closes) return initStrip();
    const end = endPoint(g);
    return { ...g, chain: end ? [...g.chain, end] : g.chain, walls: [...(g.walls ?? []), result.created[1]], length: null, angle: null };
  },
  ghost(g, ctx) {
    if (!ctx.workplane) return [];
    const mesh = stripGhost(ctx.workplane, g, commandGhostId(ctx.get()));
    return mesh ? [mesh] : [];
  },
};

export interface PadFootingGesture {
  readonly cursor: Vec2 | null;
  /** Degrees, counter-clockwise from storey-local +x; kept from one footing to the next. */
  readonly rotation: number;
}

const normalise = (deg: number) => ((deg % 360) + 360) % 360;

export const PAD_FOOTING_PLACE: ModelingCommand<PadFootingGesture> = {
  id: 'foundation.pad.place',
  labelKey: 'foundation.pad.label',
  hud: { hint: () => 'foundation.pad.hint' },
  fields: [{
    id: 'rotation', labelKey: 'modelingCommand.field.rotation', unit: 'deg', group: 'rotation',
    read: (g) => g.rotation, write: (g, v) => ({ ...g, rotation: normalise(v) }),
  }],
  snap: 'modeling',
  keys: [{ commandKey: 'command.column.rotate', run: (g) => ({ ...g, rotation: normalise(g.rotation + COLUMN_ROTATION_STEP) }) }],
  init: () => { ensureFoundationType('padFooting'); return { cursor: null, rotation: 0 }; },
  snapQuery: () => ({ anchor: null, chain: [], locks: {} }),
  pointerMove: (g, s) => ({ ...g, cursor: s.local }),
  pointerDown: () => ({ commit: true }),
  doubleClick: (g) => g,
  validate(g, ctx) {
    if (!ctx.workplane || ctx.storeyId === null) return { ok: false, reasonKey: 'modelingCommand.noPlane' };
    return g.cursor ? { ok: true } : { ok: false, reasonKey: 'foundation.pad.hint' };
  },
  commit(g, tx) {
    if (!g.cursor || tx.storeyId === null) throw new Error('No pad footing to place');
    const made = addPadFootingIn(useViewerStore, tx.modelId, tx.storeyId, {
      ...currentPadFootingType(), position: [g.cursor[0], g.cursor[1], 0], rotation: (g.rotation * Math.PI) / 180,
    });
    if ('error' in made) throw new Error(`Couldn't add the pad footing: ${made.error}`);
    return { created: [made.footingId], deleted: [], remesh: [made.footingId], select: [made.footingId] };
  },
  afterCommit: (g) => ({ cursor: g.cursor, rotation: g.rotation }),
  cancel: (g) => (g.rotation !== 0 ? 'reset' : 'exit'),
  ghost(g, ctx) {
    if (!ctx.workplane || !g.cursor) return [];
    const type = currentPadFootingType();
    const id = commandGhostId(ctx.get());
    let z = type.bottom - planeZ(ctx.workplane);
    const meshes = type.steps.map((s) => {
      const m = prismGhostMesh(ctx.workplane!, centredRectOutline(g.cursor!, s.length, s.width, g.rotation), z, z + s.height, id);
      z += s.height;
      return m;
    }).filter((m) => m !== null);
    const mesh = mergeGhostMeshes(meshes, id, GHOST);
    return mesh ? [mesh] : [];
  },
};
