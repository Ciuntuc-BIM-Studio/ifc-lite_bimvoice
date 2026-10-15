/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The model's elements selected from a drawing, while no command runs: an
 * idle click selects the element under it, and a window drag the elements
 * wholly inside it (dragged rightward) or touching it (leftward, crossing),
 * Shift adding to the selection. Both selection channels are written, as in
 * the plan view and in 3D.
 */

import { useEffect } from 'react';
import type { Drawing2D, SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { selectFromPlan } from '@/components/viewer/plan/PlanPointer';
import { selectGlobalIds } from '@/components/viewer/viewport-selection';
import { modelElementsInWindow, pickModelElement, type ReferenceSet } from '@/drafting/references';
import { setModelPicker } from '@/drafting/session';
import { roofAtPoint } from '@/project/roof-plan';
import type { ProjectView } from '@/project/types';

export function useModelPicking(drawing: Drawing2D | null | undefined, references: ReferenceSet | null | undefined, view: ProjectView, plane: SectionPlaneConfig | undefined): void {
  useEffect(() => {
    setModelPicker((p, tolerance, additive) => {
      // Nothing cut under the click: a roof whose outline holds it (roofs are drawn over the plan, not cut).
      const id = (drawing && references ? pickModelElement(drawing, references, p, tolerance) : null) ?? (view.kind === 'plan' && plane ? roofAtPoint(view, plane, p) : null);
      if (id !== null || !additive) selectFromPlan(id, additive);
    }, (min, max, crossing, additive) => {
      if (drawing) selectGlobalIds(modelElementsInWindow(drawing, min, max, crossing), additive);
    });
    return () => setModelPicker(null);
  }, [drawing, references, view, plane]);
}
