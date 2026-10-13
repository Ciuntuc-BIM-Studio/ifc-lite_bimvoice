/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Timber members drawn on a view (`@ifc-lite/create`'s timber-member): the
 * settings the Wood tools share (section, strength class, heights) and the
 * one write that turns clicked points into a member.
 *
 * On a floor plan the points give the plan position and the settings the
 * heights (a beam's top, a post's foot and head, a brace's two ends above
 * the level). On a section or an elevation the points are already in 3D, on
 * the view's plane: a beam or a brace runs between them, a post stands from
 * the lower one up to the higher one.
 */

import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { addTimberMemberToStore, resolveSpatialAnchor, type TimberMemberKind } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { ensureStoreyPlacement } from '@/store/slices/storeyPlacement';
import { requestRemesh } from '@/lib/remesh/remesh-service';
import { registerAuthoredElement } from '@/utils/spatialHierarchy';
import { drawingToWorld } from '@/drafting/frame';
import type { Pt } from '@/drafting/types';
import { prepareTarget } from './contour-element';
import type { ProjectView } from './types';

export interface TimberSettings {
  /** Section, metres. */
  width: number;
  depth: number;
  grade: string;
  /** Plans: a beam's top above the level. */
  beamTop: number;
  /** Plans: a post's foot and head above the level. */
  postBase: number;
  postTop: number;
  /** Plans: a brace's start and end heights above the level. */
  braceFrom: number;
  braceTo: number;
}

/** What the Wood tools draw with until changed (on the command line or the Wood tab). */
export const timberSettings: TimberSettings = {
  width: 0.12, depth: 0.24, grade: 'C24', beamTop: 2.6, postBase: 0, postTop: 2.6, braceFrom: 1.6, braceTo: 2.4,
};

export type TimberResult = { ok: true; ifcClass: string; name: string } | { ok: false; error: string };

type Vec3 = [number, number, number];

/** The member's two ends, storey-local, from the clicked points (`b` absent: a post on a plan). */
function ends(kind: TimberMemberKind, plan: boolean, a: Vec3, b: Vec3 | null, s: TimberSettings): [Vec3, Vec3] | null {
  if (plan) {
    const at = (p: Vec3, z: number): Vec3 => [p[0], p[1], a[2] + z];
    if (kind === 'post') return [at(a, s.postBase), at(a, s.postTop)];
    if (!b) return null;
    // A beam's axis is half its depth under its top.
    if (kind === 'beam') return [at(a, s.beamTop - s.depth / 2), at(b, s.beamTop - s.depth / 2)];
    return [at(a, s.braceFrom), at(b, s.braceTo)];
  }
  if (!b) return null;
  if (kind === 'post') {
    const [lo, hi] = a[2] <= b[2] ? [a, b] : [b, a];
    return [lo, [lo[0], lo[1], hi[2]]];
  }
  return [a, b];
}

/** Draw one timber member from points on `view` (drawing coordinates). One undo step. */
export function createTimberMember(view: ProjectView, plane: SectionPlaneConfig, kind: TimberMemberKind, a: Pt, b: Pt | null, s: TimberSettings = timberSettings): TimberResult {
  const wa = drawingToWorld(plane, a), wb = b ? drawingToWorld(plane, b) : null;
  const ready = prepareTarget(view, Math.min(wa.y, wb?.y ?? wa.y));
  if (!ready.ok) return { ok: false, error: ready.error };
  const local = (w: { x: number; y: number; z: number }): Vec3 => { const l = ready.toLocal(w); return [l.x, l.y, l.z]; };
  const pts = ends(kind, view.kind === 'plan', local(wa), wb ? local(wb) : null, s);
  if (!pts) return { ok: false, error: 'Two points are needed.' };
  if (Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]) < 0.01) return { ok: false, error: 'The two points are the same.' };
  try {
    const made = recordModellingCommit(useViewerStore, ready.modelId, (editor, ds) => {
      ensureStoreyPlacement(ds, editor, ready.storeyId);
      const anchor = resolveSpatialAnchor(ds, ready.storeyId, editor.getMutationView());
      return addTimberMemberToStore(ds, editor, anchor, { kind, start: pts[0], end: pts[1], width: s.width, depth: s.depth, grade: s.grade });
    });
    const hierarchy = ready.edit.dataStore.spatialHierarchy;
    if (hierarchy) registerAuthoredElement(hierarchy, ready.storeyId, made.id, made.ifcClass.toUpperCase(), made.ifcClass);
    void requestRemesh(useViewerStore.getState, ready.modelId, [made.id], 'created');
    return { ok: true, ifcClass: made.ifcClass, name: `${Math.round(s.width * 1000)}×${Math.round(s.depth * 1000)} ${s.grade}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
