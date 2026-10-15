/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Lifting beams, columns and hosted elements (N1, split from `lift.ts`).
 * Beams and columns are read as an extruded section on an axis
 * (`resolveLinearElementChain`); openings, doors and windows as their place
 * in a lifted host (`readHostedOpeningBatch`) and the size of their cut
 * (`placedBodyExtent`).
 */

import type { ProfileSection } from '../in-store/profile.js';
import { resolveLinearElementChain } from '../in-store/edit/linear-element-edit.js';
import { readElementPlacement } from '../in-store/element-relocate.js';
import { readHostedOpeningBatch } from '../in-store/hosted-fill-read.js';
import { placedBodyExtent } from '../in-store/resolve-host.js';
import { readJoineryFlips } from '../in-store/joinery-read.js';
import { resolveSlabEditChain } from '../in-store/edit/slab-edit.js';
import type { NativeElement } from './schema.js';
import { liftBase, type LiftContext } from './lift-base.js';

const EPS = 1e-6;
const round = (v: number) => Math.round(v * 1e9) / 1e9;

export function liftLinear(ctx: LiftContext, expressId: number, kind: 'beam' | 'column'): NativeElement | null {
  const base = liftBase(ctx, expressId, kind);
  if (!base) return null;
  const ifcType = kind === 'beam' ? 'IfcBeam' : 'IfcColumn';
  const chain = resolveLinearElementChain(ctx.store, ctx.view, ctx.editor, expressId, ctx.scale);
  if (!chain) {
    ctx.skipped.push({ expressId, ifcType, reason: 'the body is not a section extruded along an axis' });
    return null;
  }
  const section: ProfileSection = chain.profile ?? { Type: 'Rectangle', XDim: chain.profileWidth, YDim: chain.profileHeight };
  const [sx, sy, sz] = chain.startCoordinates;
  const [ax, ay, az] = chain.axisDirection;
  if (kind === 'beam') {
    const d = chain.depth;
    return { ...base, kind: 'beam', start: [round(sx), round(sy), round(sz)], end: [round(sx + ax * d), round(sy + ay * d), round(sz + az * d)], section };
  }
  if (Math.abs(ax) > EPS || Math.abs(ay) > EPS || az <= 0) {
    ctx.skipped.push({ expressId, ifcType, reason: 'a column that is not vertical' });
    return null;
  }
  const placement = readElementPlacement(ctx.store, ctx.editor, expressId);
  const rotation = placement ? round((placement.rz * Math.PI) / 180) : 0;
  return { ...base, kind: 'column', position: [round(sx), round(sy), round(sz)], height: chain.depth, section, ...(rotation ? { rotation } : {}) };
}

export function liftMembers(ctx: LiftContext): void {
  for (const id of ctx.reader.ids('IFCBEAM')) {
    const element = liftLinear(ctx, id, 'beam');
    if (element) ctx.lifted.set(id, element);
  }
  for (const id of ctx.reader.ids('IFCCOLUMN')) {
    const element = liftLinear(ctx, id, 'column');
    if (element) ctx.lifted.set(id, element);
  }
}

/**
 * Openings in lifted walls and slabs, and the doors and windows filling
 * them. A filled opening is not lifted on its own: the door or window brings
 * it (NativeJoinery). A bare opening is lifted with its cut's size.
 */
export function liftHosted(
  ctx: LiftContext, openings: Iterable<number> = ctx.reader.ids('IFCOPENINGELEMENT'),
  known?: Parameters<typeof readHostedOpeningBatch>[3],
): void {
  // One walk over the fill and void relations for every opening (`readHostedFill` walks them per call).
  const reads = readHostedOpeningBatch(ctx.store, new Set(openings), ctx.view, known);
  for (const [openingId, read] of reads) {
    const skip = (reason: string) => ctx.skipped.push({ expressId: openingId, ifcType: 'IfcOpeningElement', reason });
    if (!read) { skip('not placed in a host'); continue; }
    const host = ctx.lifted.get(read.hostId);
    if (!host || (host.kind !== 'wall' && host.kind !== 'slab')) { skip('its host was not lifted'); continue; }
    if (read.fillingId !== null) {
      const filling = ctx.reader.entity(read.fillingId);
      const fillType = filling?.type.toUpperCase();
      const kind = fillType === 'IFCDOOR' ? 'door' : fillType === 'IFCWINDOW' ? 'window' : null;
      if (!kind || host.kind !== 'wall') { ctx.skipped.push({ expressId: read.fillingId, ifcType: filling?.type ?? 'unknown', reason: 'a filling other than a door or window in a wall' }); continue; }
      // The filling sits in its opening's storey (it may not be contained itself).
      if (!ctx.storeyOf.has(read.fillingId)) ctx.storeyOf.set(read.fillingId, host.storeyId);
      const base = liftBase(ctx, read.fillingId, kind);
      if (!base) continue;
      if (!base.typeId) { ctx.skipped.push({ expressId: read.fillingId, ifcType: filling!.type, reason: 'no configured joinery type' }); continue; }
      const flips = readJoineryFlips(ctx.store, read.fillingId, ctx.view);
      ctx.lifted.set(read.fillingId, {
        ...base, kind, hostId: host.id, along: round(read.offset), sill: round(read.sill),
        ...(flips & 1 ? { flipHand: true } : {}), ...(flips & 2 ? { flipFacing: true } : {}),
      });
      continue;
    }
    if (!ctx.storeyOf.has(openingId)) ctx.storeyOf.set(openingId, host.storeyId);
    const base = liftBase(ctx, openingId, 'opening');
    if (!base) continue;
    // The cut's body bounds, in the host's placement frame.
    const bounds = placedBodyExtent(ctx.store, openingId, ctx.view);
    if (!bounds) { skip('its cut could not be read'); continue; }
    const size = (axis: 0 | 1 | 2) => round((bounds.max[axis] - bounds.min[axis]) * ctx.scale);
    if (host.kind === 'wall') {
      ctx.lifted.set(openingId, { ...base, kind: 'opening', host: 'wall', hostId: host.id, along: round(read.offset), sill: round(read.sill), width: size(0), height: size(2) });
    } else {
      // A slab opening's bounds are in the slab's placement frame: add its plan origin.
      const origin = resolveSlabEditChain(ctx.store, ctx.view, ctx.editor, read.hostId, ctx.scale)?.placementOrigin ?? [0, 0, 0];
      const mid = (axis: 0 | 1) => round(((bounds.max[axis] + bounds.min[axis]) / 2) * ctx.scale + origin[axis]);
      ctx.lifted.set(openingId, { ...base, kind: 'opening', host: 'slab', hostId: host.id, center: [mid(0), mid(1)], width: size(0), depth: size(1) });
    }
  }
}
