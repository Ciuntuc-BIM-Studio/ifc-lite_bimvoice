/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Faces: a closed contour promoted to a surface (the FACE command), drawn
 * filled like a light hatch. A face follows its outer contour
 * (`params.face`, the contour's id): its holes are the closed contours drawn
 * directly inside it, and stay in step as contours are added, moved or
 * removed. Nesting alternates as in a hatch — an island inside a hole is
 * a face of its own, its holes inside it, and so on down. EXTRUDE takes a
 * face as its contour with those holes. Faces are a modelling aid: they show
 * on their view, not on sheets or in exports.
 */

import { pointInPolygon } from './offset';
import { contourLoops, shapeLoop } from './commands/model';
import type { AnnotationShape, DraftEntity, Pt } from './types';

/** The hatch pattern a face is drawn with: no pattern of that name, so a light tint. */
export const FACE_PATTERN = 'FACE';

export const isFace = (e: Pick<DraftEntity, 'params' | 'shape'>): boolean => e.shape.type === 'hatch' && typeof e.params.face === 'string';

/** The outer contour a face follows. */
export const faceOuterId = (e: DraftEntity): string | null => (isFace(e) ? String(e.params.face) : null);

/** A closed drafted contour that can bound a face: a closed polyline or a circle, not already an element's base. */
function contourOf(e: DraftEntity): Pt[] | null {
  if (e.params.ifcGlobalId || isFace(e)) return null;
  return e.shape.type === 'polyline' || e.shape.type === 'circle' ? shapeLoop(e.shape) : null;
}

const inside = (inner: Pt[], outer: Pt[]) => inner.every((p) => pointInPolygon(p, outer));

/**
 * The outers of the faces a contour makes: itself, then every contour at an
 * odd depth below it (an island in one of its holes, an island in a hole of
 * that island…), outermost first.
 */
export function faceOutersUnder(outer: DraftEntity, drafts: readonly DraftEntity[]): DraftEntity[] {
  const loop = contourOf(outer);
  if (!loop) return [];
  const within = drafts
    .filter((e) => e.id !== outer.id && e.viewId === outer.viewId)
    .map((e) => ({ e, loop: contourOf(e) }))
    .filter((x): x is { e: DraftEntity; loop: Pt[] } => x.loop !== null && inside(x.loop, loop));
  const depth = (x: { loop: Pt[] }) => within.filter((o) => o.loop !== x.loop && inside(x.loop, o.loop)).length;
  return [outer, ...within.filter((x) => depth(x) % 2 === 1).sort((a, b) => depth(a) - depth(b)).map((x) => x.e)];
}

/** A face's shape for its outer contour now: the contour and its first-level holes. */
export function faceShape(outer: DraftEntity, drafts: readonly DraftEntity[]): AnnotationShape | null {
  const loops = contourLoops(outer, drafts.filter((e) => !isFace(e)));
  return loops ? { type: 'hatch', loops, pattern: FACE_PATTERN, scale: 1, angle: 0 } : null;
}

/** Whether a point lies on a face's surface (inside its outline, outside its holes). */
export function pointOnFace(p: Pt, face: DraftEntity): boolean {
  if (face.shape.type !== 'hatch') return false;
  const [outer, ...holes] = face.shape.loops;
  return !!outer && pointInPolygon(p, outer) && !holes.some((h) => pointInPolygon(p, h));
}

/** The faces whose outer contour changed (moved, its holes changed) as the drafts now are; removed outers keep their face as it was. */
export function refreshedFaces(drafts: readonly DraftEntity[]): Map<string, AnnotationShape> {
  const byId = new Map(drafts.map((d) => [d.id, d]));
  const out = new Map<string, AnnotationShape>();
  for (const face of drafts) {
    const outerId = faceOuterId(face);
    const outer = outerId ? byId.get(outerId) : undefined;
    if (!outer) continue;
    const shape = faceShape(outer, drafts);
    if (shape && JSON.stringify(shape) !== JSON.stringify(face.shape)) out.set(face.id, shape);
  }
  return out;
}
