/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * `element.copy`: copy the selection by a base point and as many target
 * points as wanted, as COPY does in a CAD (Revit's Copy with "Multiple").
 *
 * The first click (snapped) is the base; every later click writes one copy,
 * moved from the base to it, tracking and locking like `element.move` (the
 * Distance and Direction fields). The base stays, so the next click makes the
 * next copy; Escape drops the base, a second Escape ends. Each copy is one
 * transaction (one undo step) through the one copy path (`copy-elements.ts`:
 * fresh GlobalIds, hosted openings, doors and windows copied with their
 * host). The selection stays on the originals.
 */

import { ElementMovePlan, ElementMoveScene } from '@/components/viewer/tools/command/ElementMoveLayers';
import type { Vec2 } from '@/lib/snap/types';
import { useViewerStore } from '@/store';
import { copyElements, copySources, withHostedFillings } from '../copy-elements.js';
import { selectedElements } from '../copy-clipboard.js';
import { copyGhosts, sourceMeshes } from '../copy-ghost.js';
import { currentAngle, currentLength, endPoint } from './wall-place-geometry.js';
import { readTransformSelection, selectionExtent } from './element-transform-shared.js';
import { moveAsWallGesture, type ElementMoveGesture } from './element-move-geometry.js';
import { buildStoreyWorkplane, elementStoreyId, isWorkplane } from '../workplane.js';
import type { CopyTransform } from '../copy-elements.js';
import type { CommandContext, CommandField, ModelingCommand, Workplane } from '../types.js';

/** Below this a copy lands on its source (metres). */
const MIN_OFFSET = 1e-4;

export interface ElementCopyGesture extends ElementMoveGesture {
  readonly modelId: string | null;
  /** The elements to copy; empty when nothing (copyable) is selected. */
  readonly ids: readonly number[];
  /** What the preview shows: `ids` and the doors and windows in them. */
  readonly shown: readonly number[];
  /** Why the selection cannot be copied, shown on a click. */
  readonly refusal: string | null;
  /** The storey the elements are on: the copies' offsets are measured there. */
  readonly plane: Workplane | null;
}

function init(ctx: CommandContext): ElementCopyGesture {
  const base: ElementCopyGesture = {
    selection: null, base: null, cursor: null, distance: null, angle: null,
    modelId: null, ids: [], shown: [], refusal: null, plane: null,
  };
  const s = ctx.get();
  const picked = selectedElements(s);
  if (!picked) return base;
  const sources = copySources(s, picked.modelId, picked.ids);
  if ('refusal' in sources) return { ...base, modelId: picked.modelId, refusal: sources.refusal };
  const storeyId = elementStoreyId(s, picked.modelId, sources.ids[0]);
  const plane = storeyId === null ? null : buildStoreyWorkplane(s, picked.modelId, storeyId, 0);
  // The move's selection, for the centre a typed distance starts from (a copy needs no movable placement).
  const selection = readTransformSelection(s);
  return {
    ...base,
    selection: selection ? { ...selection, refusal: null } : null,
    modelId: picked.modelId,
    ids: sources.ids,
    shown: withHostedFillings(s, picked.modelId, sources.ids),
    plane: plane && isWorkplane(plane) ? plane : null,
  };
}

/** A value typed before any click copies from the selection's centre. */
function withBase(g: ElementCopyGesture, ctx: CommandContext): ElementCopyGesture {
  if (g.base || !g.selection || !ctx.workplane) return g;
  const base = selectionExtent(ctx.get(), g.selection, ctx.workplane)?.centre ?? g.cursor ?? [0, 0];
  return { ...g, base, cursor: g.cursor ?? base };
}

/** The copy's transform: base → target on the session plane, measured on the elements' storey. */
function copyTransform(g: ElementCopyGesture, session: Workplane | null): CopyTransform | null {
  const to = endPoint(moveAsWallGesture(g));
  if (!g.base || !to || !g.plane || !session) return null;
  const onStorey = (p: Vec2) => g.plane!.renderToLocal(session.localToRender([p[0], p[1], 0]));
  const a = onStorey(g.base), b = onStorey(to);
  return { offset: [b[0] - a[0], b[1] - a[1], 0] };
}

const FIELDS: readonly CommandField<ElementCopyGesture>[] = [
  {
    id: 'distance', labelKey: 'moveRotate.field.distance', unit: 'm', group: 'move',
    read: (g) => currentLength(moveAsWallGesture(g)),
    write: (g, v, ctx) => ({ ...withBase(g, ctx), distance: Math.abs(v) }),
  },
  {
    id: 'direction', labelKey: 'moveRotate.field.direction', unit: 'deg', group: 'move',
    read: (g) => currentAngle(moveAsWallGesture(g)),
    write: (g, v, ctx) => ({ ...withBase(g, ctx), angle: v }),
  },
];

function hint(g: ElementCopyGesture) {
  if (g.refusal) return 'elementCopy.refused' as const;
  if (g.ids.length === 0) return 'elementCopy.noSelection' as const;
  return g.base ? 'elementCopy.hintTarget' as const : 'elementCopy.hintBase' as const;
}

export const ELEMENT_COPY: ModelingCommand<ElementCopyGesture> = {
  id: 'element.copy',
  labelKey: 'elementCopy.label',
  hud: { Scene: ElementMoveScene, Plan: ElementMovePlan, hint },
  fields: FIELDS,
  snap: 'modeling',
  init,
  snapQuery: (g) => ({
    anchor: g.base,
    chain: g.base ? [g.base] : [],
    locks: { ...(g.distance !== null ? { length: g.distance } : {}), ...(g.angle !== null ? { angleDeg: g.angle } : {}) },
  }),
  pointerMove: (g, s) => ({ ...g, cursor: s.local }),
  pointerDown(g, s) {
    if (g.refusal) return { commit: true }; // says why, through `commit`
    if (g.ids.length === 0) return g;
    if (!g.base) return { ...g, base: s.local, cursor: s.local };
    return { commit: true };
  },
  doubleClick: (g) => g,
  undoPoint: (g) => ({ ...g, base: null, distance: null, angle: null }),
  validate(g, ctx) {
    if (g.refusal) return { ok: true };
    if (g.ids.length === 0) return { ok: false, reasonKey: 'elementCopy.noSelection' };
    if (!ctx.workplane || !g.plane) return { ok: false, reasonKey: 'modelingCommand.noPlane' };
    const length = currentLength(moveAsWallGesture(g));
    return g.base && length !== null && length >= MIN_OFFSET ? { ok: true } : { ok: false, reasonKey: 'elementCopy.hintTarget' };
  },
  commit(g, tx) {
    if (g.refusal) throw new Error(g.refusal);
    const transform = copyTransform(g, tx.workplane);
    if (!g.modelId || !transform) throw new Error('Nothing to copy');
    const { copies, meshed } = copyElements(useViewerStore, g.modelId, g.ids, [transform]);
    return { modelId: g.modelId, created: [...copies], deleted: [], remesh: [...meshed] };
  },
  // The base stays: the next click is the next copy.
  afterCommit: (g) => ({ ...g, distance: null, angle: null }),
  cancel: (g) => (g.base ? 'reset' : 'exit'),
  ghost(g, ctx) {
    const transform = copyTransform(g, ctx.workplane);
    if (!g.modelId || !g.plane || !transform) return [];
    const s = ctx.get();
    return copyGhosts(s, sourceMeshes(s, g.modelId, g.shown), g.plane, g.plane, [transform]);
  },
};
