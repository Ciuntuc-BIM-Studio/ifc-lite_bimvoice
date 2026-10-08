/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Drafted lines are drafting only: nothing drawn on a view reaches the
 * model until it is turned into an element. This is that step, from the
 * drafted entity's properties panel:
 *
 * - a line, arc or polyline on a floor plan becomes walls (joined at its
 *   corners, closed when it is), beams or a railing — through the same BIM
 *   commands the Design tab runs, so the wall / beam defaults and types
 *   apply, in one undo step;
 * - a closed contour on a floor plan becomes a slab, a roof system, or walls
 *   round it;
 * - a closed contour on any view becomes an extrusion of a chosen IFC class
 *   (the contour stays linked: editing it rebuilds the element).
 *
 * The drafted entity stays a drafting entity; it records what it became.
 */

import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { useViewerStore } from '@/store';
// The Design tab's BIM commands, registered (the viewer loads them with its tool HUDs).
import '@/lib/commands/modeling/builtin';
import { getModelingCommand } from '@/lib/commands/modeling/registry';
import { runTransaction } from '@/lib/commands/modeling/transaction';
import { buildStoreyWorkplane, isWorkplane } from '@/lib/commands/modeling/workplane';
import type { CommitResult, ModelingCommand } from '@/lib/commands/modeling/types';
import type { Vec2 } from '@/lib/snap/types';
import { drawingToWorld } from '@/drafting/frame';
import { setDraftParams } from '@/drafting/draft-store';
import { contourLoops, shapeLoop } from '@/drafting/commands/model';
import type { DraftEntity } from '@/drafting/types';
import { createContourElement, resolveTarget } from './contour-element';
import { createRoofSystem } from './roof-system-element';
import { currentRoofPreset } from '@/element-types/roof-preset';
import { pathPoints } from './swept-element';
import type { ProjectView } from './types';

export type DraftBimKind = 'wall' | 'beam' | 'railing' | 'slab' | 'roof' | 'extrude';

const closedLoop = (e: DraftEntity) => (e.shape.type === 'polyline' || e.shape.type === 'circle' ? shapeLoop(e.shape) : null);

/** What a drafted entity can become on `view`. */
export function bimKindsFor(entity: DraftEntity, view: ProjectView | null): DraftBimKind[] {
  if (!view || entity.params.ifcGlobalId || !pathPoints(entity)) return [];
  const closed = closedLoop(entity) !== null;
  if (view.kind !== 'plan') return closed ? ['extrude'] : [];
  return closed ? ['slab', 'wall', 'roof', 'extrude', 'beam'] : ['wall', 'beam', 'railing'];
}

export type DraftBimResult = { ok: true; ifcClass: string; count: number } | { ok: false; error: string };

export interface DraftBimOptions {
  /** Extrusion: the class and depth (metres, negative away from the viewer). */
  ifcClass?: string;
  depth?: number;
  /** Roof system defaults. */
  roof?: { shape: 'hip' | 'gable' | 'mono'; pitch: number; overhang: number; thickness: number };
}

/** Run a modeling command's commit for each gesture, as one transaction (one undo step, one re-mesh). */
function commitGestures(command: ModelingCommand, gestures: (created: number[]) => unknown[], view: ProjectView, local: Vec2[]): DraftBimResult & { created?: number[] } {
  const target = resolveTarget(view, view.kind === 'plan' ? view.level.elevation : 0);
  if (!target) return { ok: false, error: 'No loaded model has a storey for this plan.' };
  const state = useViewerStore.getState();
  const workplane = buildStoreyWorkplane(state, target.modelId, target.storeyId, 0);
  if (!isWorkplane(workplane)) return { ok: false, error: workplane.refused };
  if (local.length < 2) return { ok: false, error: 'Nothing to build along.' };
  const created: number[] = [];
  const batch: ModelingCommand = {
    ...command,
    commit(_g, tx) {
      const authored: number[] = [], deleted: number[] = [], remesh: number[] = [], select: number[] = [];
      for (const g of gestures(created)) {
        const r = command.commit(g, tx);
        created.push(...r.created);
        authored.push(...(r.authored ?? []));
        deleted.push(...r.deleted);
        remesh.push(...r.remesh);
        select.push(...(r.select ?? []));
      }
      const out: CommitResult = { created: [...created], authored, deleted, remesh, select };
      return out;
    },
  };
  const outcome = runTransaction(useViewerStore, batch, null, { get: useViewerStore.getState, modelId: target.modelId, storeyId: target.storeyId, workplane });
  return outcome.ok ? { ok: true, ifcClass: '', count: created.length, created } : { ok: false, error: outcome.reason };
}

/** Storey-local plan points of a drafted path (workplane local metres). */
function localPath(view: ProjectView, plane: SectionPlaneConfig, pts: readonly { x: number; y: number }[]): Vec2[] | null {
  const target = resolveTarget(view, view.kind === 'plan' ? view.level.elevation : 0);
  if (!target) return null;
  const workplane = buildStoreyWorkplane(useViewerStore.getState(), target.modelId, target.storeyId, 0);
  if (!isWorkplane(workplane)) return null;
  return pts.map((p) => {
    const w = drawingToWorld(plane, p);
    const l = workplane.renderToLocal([w.x, w.y, w.z]);
    return [l[0], l[1]] as Vec2;
  });
}

const COMMANDS: Record<'wall' | 'beam' | 'railing' | 'slab', { id: Parameters<typeof getModelingCommand>[0]; ifcClass: string }> = {
  wall: { id: 'wall.place', ifcClass: 'IfcWall' },
  beam: { id: 'beam.place', ifcClass: 'IfcBeam' },
  railing: { id: 'railing.place', ifcClass: 'IfcRailing' },
  slab: { id: 'slab.place', ifcClass: 'IfcSlab' },
};

/** Turn `entity` (drawn on `view`) into model elements. */
export function convertDraftToBim(entity: DraftEntity, kind: DraftBimKind, view: ProjectView, plane: SectionPlaneConfig, entities: readonly DraftEntity[], options: DraftBimOptions = {}): DraftBimResult {
  if (entity.params.ifcGlobalId) return { ok: false, error: 'This contour already drives an element.' };
  if (kind === 'extrude') {
    const loops = contourLoops(entity, entities);
    if (!loops) return { ok: false, error: 'Only a closed contour can be extruded.' };
    const depth = options.depth ?? 1;
    const result = createContourElement(view, plane, loops, { ifcClass: options.ifcClass ?? 'IfcBuildingElementProxy', depth }, entity.id);
    if (!result.ok) return result;
    setDraftParams(new Set([entity.id]), { ifcGlobalId: result.globalId, ifcModelId: result.modelId, ifcClass: result.ifcClass, depth });
    return { ok: true, ifcClass: result.ifcClass, count: 1 };
  }
  if (kind === 'roof') {
    const loop = closedLoop(entity);
    if (!loop) return { ok: false, error: 'A roof needs a closed contour.' };
    // The current roof type when there is one, else the panel's pitch over the drafting defaults.
    const typed = currentRoofPreset();
    const r = typed ? { ...typed.defaults, ...(options.roof ? { pitch: options.roof.pitch } : {}) } : options.roof ?? { shape: 'gable' as const, pitch: 30, overhang: 0.5, thickness: 0.08 };
    const made = createRoofSystem(view, plane, loop, { ...r, eaveHeight: 0 }, typed?.name, typed?.preset);
    if (!made.ok) return made;
    setDraftParams(new Set([entity.id]), { ifcGlobalId: made.globalId, ifcModelId: made.modelId, ifcClass: 'IfcRoof', roofSystem: 1 });
    return { ok: true, ifcClass: 'IfcRoof', count: 1 };
  }
  if (view.kind !== 'plan') return { ok: false, error: 'Walls, beams, railings and slabs are drawn on a floor plan.' };
  const path = pathPoints(entity);
  if (!path) return { ok: false, error: 'Nothing to build along.' };
  const local = localPath(view, plane, path.pts);
  if (!local) return { ok: false, error: 'No loaded model has a storey for this plan.' };
  const spec = COMMANDS[kind];
  const command = getModelingCommand(spec.id);
  if (!command) return { ok: false, error: `The ${kind} tool is not available.` };
  // A closed path comes back to its start; its last point is not repeated.
  const pts = path.closed && local.length > 2 ? [...local, local[0]] : local;
  let gestures: (created: number[]) => unknown[];
  if (kind === 'slab') {
    gestures = () => [{ mode: 'polygon', points: local, cursor: null, width: null, depth: null, square: false }];
  } else if (kind === 'railing') {
    gestures = () => [{ chain: pts, cursor: null, length: null, angle: null, rise: pts.map(() => 0), cursorRise: null }];
  } else {
    // One segment per commit, chained as the tool chains them: wall i joins wall i−1, and the last closes on the first.
    gestures = (created) => pts.slice(1).map((end, i) => ({
      chain: pts.slice(0, i + 1), cursor: end, length: null, angle: null,
      get walls() { return kind === 'wall' ? created.slice(0, i) : undefined; },
    }));
  }
  const result = commitGestures(command, gestures, view, local);
  if (!result.ok) return result;
  const target = resolveTarget(view, view.level.elevation);
  const overlay = target ? useViewerStore.getState().mutationViews.get(target.modelId) : null;
  const guids = (result.created ?? []).map((id) => overlay?.getNewEntity(id)?.attributes[0]).filter((g): g is string => typeof g === 'string');
  setDraftParams(new Set([entity.id]), { bimFrom: kind, bimClass: spec.ifcClass, bimElements: guids.join(' ') });
  return { ok: true, ifcClass: spec.ifcClass, count: result.count };
}
