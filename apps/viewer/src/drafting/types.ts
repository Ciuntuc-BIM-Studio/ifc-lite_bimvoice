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

/**
 * Annotation shapes (phase 4d): drawn on a view like geometry, but read as
 * notation. Text heights are model metres (2.5 mm on paper at 1:100 is
 * 0.25). A dimension measures between its points; `at` places its line.
 */
export type AnnotationShape =
  | { type: 'text'; p: Pt; text: string; height: number; rotation: number }
  | { type: 'leader'; pts: Pt[]; text: string; height: number }
  | { type: 'dimension'; variant: 'aligned' | 'linear'; a: Pt; b: Pt; at: Pt; height: number; text?: string; textAt?: Pt }
  | { type: 'radial'; c: Pt; r: number; at: Pt; diameter: boolean; height: number }
  | { type: 'angular'; c: Pt; a: Pt; b: Pt; at: Pt; height: number }
  | { type: 'level'; p: Pt; value: number; height: number }
  | AxisShape
  | { type: 'hatch'; loops: Pt[][]; pattern: string; scale: number; angle: number; color?: string };

/** Which ends of an axis carry a bubble. */
export type AxisEnds = 'both' | 'start' | 'end' | 'none';

/**
 * A grid axis line from `a` to `b`, dash-dot by default, with its label in a
 * bubble (circle or square) past the chosen ends. `size` is the bubble's
 * smallest diameter / side (model metres); a longer label widens it so the
 * bubble always holds its text.
 */
export interface AxisShape {
  type: 'axis';
  a: Pt;
  b: Pt;
  label: string;
  bubble: 'circle' | 'square';
  ends: AxisEnds;
  size: number;
  height: number;
  lineType: 'continuous' | 'dashed' | 'dotted' | 'dashdot';
}

/** Anything an entity can be: geometry or an annotation. */
export type EntityShape = DraftShape | AnnotationShape;

export function isGeometry(shape: EntityShape): shape is DraftShape {
  return shape.type === 'line' || shape.type === 'polyline' || shape.type === 'circle' || shape.type === 'arc';
}

export type DraftParamValue = string | number | boolean;

export interface DraftEntity {
  id: string;
  /** The project view the entity is drawn on. */
  viewId: string;
  layerId: string;
  shape: EntityShape;
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
  /** Pen width, paper millimetres (absent: 0.25). */
  lineWeight?: number;
  /** Absent: continuous. */
  lineType?: 'continuous' | 'dashed' | 'dotted' | 'dashdot';
  /** The layer group it belongs to (`LayerGroup.id`). */
  group?: string;
}

export type SnapMode = 'endpoint' | 'midpoint' | 'center' | 'quadrant' | 'intersection' | 'perpendicular' | 'nearest';

export interface SnapHit {
  mode: SnapMode;
  point: Pt;
}
