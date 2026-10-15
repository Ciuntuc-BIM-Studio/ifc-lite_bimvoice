/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * "Edit sketch" for a solid: the drafted shapes that drive it, opened on
 * their view. A solid whose sketch this project still has opens it. One it
 * has not (an IFC opened in another project, a sketch deleted, a plate or a
 * member that never had one) has it drawn again from its history
 * (`Pset_LapinSolid`, or its plain extrusion body): an extrusion's contour
 * and holes, a sweep's path and profile, a revolve's profile and axis, on a
 * view whose work plane holds them and builds into the same storey (a new
 * section through them when no view does, `sketch-section.ts`), linked
 * to the element as the Studio commands link them. Editing them then
 * rebuilds it in place (`useLinkedElementSync`).
 */

import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { nativeSolidOf, type NativeSolidShape } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { mergedSectionBounds } from '@/lib/section/section-distance';
import { buildStoreyWorkplane } from '@/lib/commands/modeling/workplane';
import { drawingToWorld, userToDrawingVec, worldToDrawing, type SectionAxisName, type Vec3 } from '@/drafting/frame';
import { editDrafts, newDraft } from '@/drafting/draft-store';
import { currentLayerId } from '@/drafting/session';
import type { DraftEntity, DraftParamValue, EntityShape, Pt } from '@/drafting/types';
import { removeProjectItem, useProjectStore } from './project-store';
import { useViewDrawings } from './view-drawings';
import { viewPlaneConfig, viewWorkPlane } from './view-plane-config';
import { resolveTarget, towardViewer } from './contour-element';
import type { ProjectView } from './types';
import { addSketchSection } from './sketch-section';

type V3 = [number, number, number];
const EPS = 1e-4;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const tuple = (p: Vec3): V3 => [p.x, p.y, p.z];
const vec = (p: readonly number[]): Vec3 => ({ x: p[0], y: p[1], z: p[2] });
const AXIS: Record<string, SectionAxisName> = { y: 'down', z: 'front', x: 'side' };
/** Classes whose own tools edit them: a body read from their geometry is not a sketch to draw. */
const PARAMETRIC = new Set(['IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCSLAB', 'IFCBEAM', 'IFCCOLUMN', 'IFCDOOR', 'IFCWINDOW', 'IFCOPENINGELEMENT']);

export type SketchOutcome =
  | { ok: true; viewId: string; drawn: boolean }
  | { ok: false; error: string };

/** The element's GlobalId: created this session, or parsed. */
function globalIdOf(modelId: string, expressId: number): string | null {
  const s = useViewerStore.getState();
  const created = s.mutationViews.get(modelId)?.getNewEntity?.(expressId);
  const id = created ? created.attributes[0] : s.models.get(modelId)?.ifcDataStore?.entities.getGlobalId(expressId);
  return typeof id === 'string' && id ? id : null;
}

/** A view's work plane, as the link sync rebuilds with it. */
function workPlaneOf(view: ProjectView): SectionPlaneConfig | null {
  const project = useProjectStore.getState();
  const viewer = useViewerStore.getState();
  const drawn = useViewDrawings.getState().byView[view.id]?.drawing?.config.plane
    ?? viewPlaneConfig(view, project.levels, mergedSectionBounds(viewer.models, viewer.geometryResult));
  return viewWorkPlane(view, drawn, project.levels);
}

interface Placed { view: ProjectView; plane: SectionPlaneConfig; toDrawing: (local: readonly number[]) => Pt; distance: (local: readonly number[]) => number }

/** Every view of the project whose work plane, mapped from `storeyId`'s frame, builds back into that storey. */
function candidateViews(modelId: string, storeyId: number): Placed[] {
  const workplane = buildStoreyWorkplane(useViewerStore.getState(), modelId, storeyId, 0);
  if ('refused' in workplane) return [];
  const out: Placed[] = [];
  for (const view of useProjectStore.getState().views) {
    if (view.kind === '3d') continue;
    const plane = workPlaneOf(view);
    if (!plane) continue;
    const world = (local: readonly number[]) => vec(workplane.localToRender([local[0], local[1], local[2]]));
    const toward = towardViewer(plane);
    const onPlane = tuple(drawingToWorld(plane, { x: 0, y: 0 }));
    out.push({
      view, plane,
      toDrawing: (local) => worldToDrawing(plane, world(local)),
      distance: (local) => dot(sub(tuple(world(local)), onPlane), toward),
    });
  }
  return out;
}

/** The drawn shapes' points. */
function pointsOf(shape: EntityShape): Pt[] {
  return shape.type === 'polyline' ? shape.pts : shape.type === 'line' ? [shape.a, shape.b] : [];
}

/** Whether `drawn` on `c` is built back into `storeyId` (as `prepare` picks the storey: a plan's level, else the lowest point's). */
function buildsInto(c: Placed, drawn: Drawn, modelId: string, storeyId: number): boolean {
  const minY = Math.min(...drawn.shapes.flatMap((d) => pointsOf(d.shape)).map((p) => drawingToWorld(c.plane, p).y));
  const target = resolveTarget(c.view, minY);
  return target?.modelId === modelId && target.storeyId === storeyId;
}

/** The world direction of a storey-frame vector on `c`'s view: its component toward the viewer. */
function towardness(c: Placed, local: readonly number[], dir: readonly number[]): number {
  const tip = [local[0] + dir[0], local[1] + dir[1], local[2] + dir[2]];
  return c.distance(tip) - c.distance(local);
}

type Drawn = { shapes: Array<{ shape: EntityShape; params?: Record<string, DraftParamValue>; key?: string }>; score: number };

function drawExtrusion(c: Placed, s: Extract<NativeSolidShape, { operation: 'extrude' }>): Drawn | null {
  const along = towardness(c, s.location, s.axis);
  if (Math.abs(Math.abs(along) - Math.hypot(...s.axis)) > EPS) return null;
  const ey = cross(s.axis, s.refDirection);
  const point = ([x, y]: readonly number[]) => [0, 1, 2].map((i) => s.location[i] + x * s.refDirection[i] + y * ey[i]);
  const ring = (r: readonly (readonly number[])[]): EntityShape => ({ type: 'polyline', pts: r.map((p) => c.toDrawing(point(p))), closed: true });
  const offset = c.distance(s.location) * Math.sign(along);
  const depth = s.depth * Math.sign(along);
  return {
    score: Math.abs(offset),
    shapes: [
      { shape: ring(s.outer), key: 'outer', params: { depth, ...(Math.abs(offset) > 1e-6 ? { offset } : {}) } },
      ...(s.holes ?? []).map((h) => ({ shape: ring(h) })),
    ],
  };
}

function drawSweep(c: Placed, s: Extract<NativeSolidShape, { operation: 'sweep' }>): Drawn | null {
  if (s.path.some((p) => Math.abs(c.distance(p)) > EPS)) return null;
  const pts = s.path.map((p) => c.toDrawing(p));
  // The profile as it looks on screen, beside the path's start (its position does not matter).
  const axis = AXIS[c.plane.axis] ?? 'front';
  const width = Math.max(...s.profile.map((p) => p[0])) - Math.min(...s.profile.map((p) => p[0]));
  const at = { x: pts[0].x - 1.5 * width - 0.5, y: pts[0].y };
  const profile = s.profile.map(([x, y]) => { const d = userToDrawingVec({ x, y }, axis); return { x: at.x + d.x, y: at.y + d.y }; });
  const path: EntityShape = pts.length === 2 && !s.closed ? { type: 'line', a: pts[0], b: pts[1] } : { type: 'polyline', pts, closed: !!s.closed };
  return { score: 0, shapes: [{ shape: path, key: 'path' }, { shape: { type: 'polyline', pts: profile, closed: true }, key: 'outer', params: { solid: 'sweep' } }] };
}

function drawRevolve(c: Placed, s: Extract<NativeSolidShape, { operation: 'revolve' }>): Drawn | null {
  const tip = [0, 1, 2].map((i) => s.origin[i] + s.direction[i]);
  if ([...s.profile, s.origin, tip].some((p) => Math.abs(c.distance(p)) > EPS)) return null;
  return {
    score: 0,
    shapes: [
      { shape: { type: 'line', a: c.toDrawing(s.origin), b: c.toDrawing(tip) }, key: 'axis' },
      { shape: { type: 'polyline', pts: s.profile.map((p) => c.toDrawing(p)), closed: true }, key: 'outer', params: { solid: 'revolve', angle: (s.angle * 180) / Math.PI } },
    ],
  };
}

function draw(c: Placed, shape: NativeSolidShape): Drawn | null {
  return shape.operation === 'extrude' ? drawExtrusion(c, shape) : shape.operation === 'sweep' ? drawSweep(c, shape) : drawRevolve(c, shape);
}

/** Open `expressId`'s sketch, drawing it again from its history when the project has none. */
export function openSolidSketch(modelId: string, expressId: number): SketchOutcome {
  const globalId = globalIdOf(modelId, expressId);
  if (!globalId) return { ok: false, error: 'The element has no GlobalId.' };
  const linked = useProjectStore.getState().drafts.find((d) => d.params.ifcGlobalId === globalId && d.params.ifcModelId === modelId);
  if (linked) return { ok: true, viewId: linked.viewId, drawn: false };

  const s = useViewerStore.getState();
  const ds = s.models.get(modelId)?.ifcDataStore;
  const mview = s.mutationViews.get(modelId);
  const read = ds && mview ? nativeSolidOf(ds, mview, expressId) : null;
  if (!read) return { ok: false, error: 'The element is not a solid with a history (an extrusion, a sweep or a revolve on its storey).' };
  if (!read.recorded && PARAMETRIC.has(read.solid.ifcClass.toUpperCase())) {
    return { ok: false, error: `A ${read.solid.ifcClass} is edited with its own tool, not a sketch.` };
  }
  const pick = (): { c: Placed; drawn: Drawn } | undefined => candidateViews(modelId, read.storey)
    .map((c) => ({ c, drawn: draw(c, read.solid.shape) }))
    .filter((x): x is { c: Placed; drawn: Drawn } => x.drawn !== null && buildsInto(x.c, x.drawn, modelId, read.storey))
    .sort((a, b) => a.drawn.score - b.drawn.score)[0];
  let best = pick();
  if (!best) {
    // No view holds it: a section through its sketch plane does.
    const section = addSketchSection(modelId, read.storey, read.solid.shape, `Sketch ${read.solid.name ?? read.solid.ifcClass}`);
    best = section ? pick() : undefined;
    if (!best || best.c.view.id !== section) {
      if (section) removeProjectItem(section);
      return { ok: false, error: 'No view of the project lies in the plane of its sketch, and a section through it would not build into its storey.' };
    }
  }

  const layer = currentLayerId();
  const ids = new Map<string, string>();
  const drafts: DraftEntity[] = best.drawn.shapes.map(({ shape, key, params }) => {
    const d = newDraft(best.c.view.id, layer, shape, params ?? {});
    if (key) ids.set(key, d.id);
    return d;
  });
  const outer = drafts.find((d) => d.id === ids.get('outer'))!;
  outer.params = {
    ...outer.params, ifcGlobalId: globalId, ifcModelId: modelId, ifcClass: read.solid.ifcClass,
    ...(ids.has('path') ? { path: ids.get('path')! } : {}), ...(ids.has('axis') ? { axis: ids.get('axis')! } : {}),
  };
  editDrafts({ add: drafts });
  return { ok: true, viewId: best.c.view.id, drawn: true };
}
