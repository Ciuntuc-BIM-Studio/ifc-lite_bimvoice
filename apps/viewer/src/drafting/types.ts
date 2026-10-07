/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Drafting entities: the 2D geometry a user draws on a view (phase 4).
 *
 * Coordinates are the view's DRAWING coordinates in metres — the same
 * (x, y) space `@ifc-lite/drawing-2d` emits its lines in — so drafting
 * snaps to the generated drawing directly, and `frame.ts` lifts any point
 * to its true 3D position on the view's plane. There is one entity kind
 * (no detail-line / model-line split); `params` carries custom parameters
 * for later uses (extrusion depth, IFC class, joint type…).
 *
 * Angles are radians, counter-clockwise in drawing space (x right, y up).
 * An arc runs counter-clockwise from `start` to `end`.
 */

export interface Pt {
  x: number;
  y: number;
}

export type DraftShape =
  | { type: 'line'; a: Pt; b: Pt }
  | { type: 'polyline'; pts: Pt[]; closed: boolean }
  | { type: 'circle'; c: Pt; r: number }
  | { type: 'arc'; c: Pt; r: number; start: number; end: number };

export type DraftParamValue = string | number | boolean;

export interface DraftEntity {
  id: string;
  /** The project view the entity is drawn on. */
  viewId: string;
  layerId: string;
  shape: DraftShape;
  /** Custom parameters (free-form key → value). */
  params: Record<string, DraftParamValue>;
}

export interface DraftLayer {
  id: string;
  name: string;
  /** CSS colour. */
  color: string;
  visible: boolean;
  locked: boolean;
}

export type SnapMode = 'endpoint' | 'midpoint' | 'center' | 'quadrant' | 'intersection' | 'perpendicular' | 'nearest';

export interface SnapHit {
  mode: SnapMode;
  point: Pt;
}
