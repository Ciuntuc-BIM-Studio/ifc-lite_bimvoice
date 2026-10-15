/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Lifting Lapin's parametric systems (N3): a roof system, a truss, a curtain
 * wall, a corridor, a stair — each a root element carrying its family's spec,
 * and parts its builder made from it (planes and rafters, chords and webs,
 * panels and mullions, courses, the flight). The root becomes a
 * `NativeSystem` with that spec; the parts are not elements of their own
 * (`LiftContext.partOf`), so they are neither lifted again nor reported as
 * left to IFC. A timber frame and a roof trim are a wall's own parameters
 * (`liftWallExtras`); a timber frame's pieces are that wall's parts.
 */

import { readRoofSystem, roofSystemParts } from '../in-store/roof-system-store.js';
import { readTruss, trussParts } from '../in-store/truss-store.js';
import { curtainWallParts, readCurtainWallSystem } from '../in-store/curtain-wall-system.js';
import { corridorParts, readCorridor } from '../in-store/corridor-store.js';
import { readStairDimensions } from '../in-store/stair-edit.js';
import { readElementPlacement } from '../in-store/element-relocate.js';
import { readTimberFrame, timberFramePieces } from '../in-store/timber-frame-store.js';
import { readWallRoofTrim } from '../in-store/wall-roof-trim.js';
import { liftBase, type LiftContext } from './lift-base.js';
import type { NativeSystem, NativeSystemFamily, NativeWall } from './schema.js';

interface Family {
  family: NativeSystemFamily;
  classes: readonly string[];
  /** The spec on `id` (a plain record), or null when `id` is not one of this family. */
  read: (ctx: LiftContext, id: number) => Record<string, unknown> | null;
  parts: (ctx: LiftContext, id: number) => number[];
}

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' ? (JSON.parse(JSON.stringify(v)) as Record<string, unknown>) : null);

const FAMILIES: readonly Family[] = [
  { family: 'roof', classes: ['IFCROOF'], read: (c, id) => asRecord(readRoofSystem(c.store, id, c.view)), parts: (c, id) => roofSystemParts(c.store, id, c.view) },
  { family: 'truss', classes: ['IFCELEMENTASSEMBLY'], read: (c, id) => asRecord(readTruss(c.store, id, c.view)), parts: (c, id) => trussParts(c.store, id, c.view) },
  { family: 'corridor', classes: ['IFCELEMENTASSEMBLY'], read: (c, id) => asRecord(readCorridor(c.store, id, c.view)), parts: (c, id) => corridorParts(c.store, id, c.view) },
  { family: 'curtainWall', classes: ['IFCCURTAINWALL'], read: (c, id) => asRecord(readCurtainWallSystem(c.store, id, c.view)), parts: (c, id) => curtainWallParts(c.store, id, c.view) },
  {
    family: 'stair', classes: ['IFCSTAIR'],
    read: (c, id) => {
      const dims = readStairDimensions(c.store, id, c.view);
      if (!dims) return null;
      // Its dimensions and where it stands (the express ids it was read through are not part of it).
      const { stairId: _s, flightId: _f, ...rest } = dims;
      const at = readElementPlacement(c.store, c.editor, id);
      return { ...rest, ...(at ? { position: [at.x, at.y, at.z], direction: (at.rz * Math.PI) / 180 } : {}) };
    },
    parts: (c, id) => { const dims = readStairDimensions(c.store, id, c.view); return dims ? [dims.flightId] : []; },
  },
];

/** Every system root in the model as a `NativeSystem`; its parts marked as such. */
export function liftSystems(ctx: LiftContext): void {
  const seen = new Set<number>();
  for (const family of FAMILIES) {
    for (const type of family.classes) {
      for (const id of ctx.reader.ids(type)) {
        if (seen.has(id) || ctx.lifted.has(id)) continue;
        const spec = safely(() => family.read(ctx, id));
        if (!spec) continue;
        seen.add(id);
        const skipped = ctx.skipped.length;
        const base = liftBase(ctx, id, 'system');
        if (!base) continue;
        ctx.skipped.length = skipped;
        const system: NativeSystem = { ...base, kind: 'system', family: family.family, ifcClass: ctx.reader.entity(id)!.type, spec };
        ctx.lifted.set(id, system);
        for (const part of safely(() => family.parts(ctx, id)) ?? []) ctx.partOf.set(part, system.id);
      }
    }
  }
  forgetParts(ctx);
}

/** A wall's timber frame and roof trim, when it has them (its frame's pieces become its parts). */
export function liftWallExtras(ctx: LiftContext, expressId: number, wall: NativeWall): NativeWall {
  const frame = safely(() => readTimberFrame(ctx.store, expressId, ctx.view));
  const trim = safely(() => readWallRoofTrim(ctx.store, expressId, ctx.view));
  if (frame) for (const piece of safely(() => timberFramePieces(ctx.store, expressId, ctx.view)) ?? []) ctx.partOf.set(piece, wall.id);
  return { ...wall, ...(frame ? { timberFrame: frame } : {}), ...(trim ? { roofTrim: trim } : {}) };
}

/** Parts are not elements: out of the lifted set and the skipped list. */
export function forgetParts(ctx: LiftContext): void {
  for (const part of ctx.partOf.keys()) ctx.lifted.delete(part);
  ctx.skipped = ctx.skipped.filter((s) => !ctx.partOf.has(s.expressId));
}

/** A family reader that cannot follow a graph answers "not one of mine". */
function safely<T>(read: () => T): T | null {
  try { return read(); } catch { return null; }
}
