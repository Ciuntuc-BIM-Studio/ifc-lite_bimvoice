/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What the view in front installs for the drafting session (`session.ts`):
 * the drawing's reference shapes, hatch boundaries and level values, its
 * work plane and kind, and the pickers for model elements under a point.
 */

import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import type { ProjectView } from '@/project/types';
import type { DraftShape, Pt } from './types';

export const providers = {
  references: (_min: Pt, _max: Pt): DraftShape[] => [],
  /** Picks a model element under an idle click that hit no drafted entity. */
  modelPicker: null as ((p: Pt, tolerance: number, additive: boolean) => void) | null,
  loops: (): Pt[][] => [],
  levelAt: (_p: Pt): number => 0,
  plane: (): SectionPlaneConfig | null => null,
  viewKind: (): 'plan' | 'section' | 'elevation' | null => null,
  view: (): ProjectView | null => null,
  /** The model element (renderer id) drawn under a drawing point. */
  elementAt: (_p: Pt): number | null => null,
};

/** The view installs where hatch boundaries and level values come from. */
export function setAnnotationProviders(loops: () => Pt[][], levelAt: (p: Pt) => number): void {
  providers.loops = loops;
  providers.levelAt = levelAt;
}

/** The view installs its work plane and kind (work-plane commands need them). */
export function setWorkPlaneProvider(plane: () => SectionPlaneConfig | null, view: () => ProjectView | null): void {
  providers.plane = plane;
  providers.view = view;
  providers.viewKind = () => {
    const kind = view()?.kind;
    return kind === 'plan' || kind === 'section' || kind === 'elevation' ? kind : null;
  };
}

/** The view in front and its work plane, as the commands see them. */
export const activeWorkPlane = (): { plane: SectionPlaneConfig | null; view: ProjectView | null } => ({ plane: providers.plane(), view: providers.view() });

export function setModelPicker(picker: typeof providers.modelPicker): void {
  providers.modelPicker = picker;
}

export function setElementPicker(picker: ((p: Pt) => number | null) | null): void {
  providers.elementAt = picker ?? (() => null);
}
