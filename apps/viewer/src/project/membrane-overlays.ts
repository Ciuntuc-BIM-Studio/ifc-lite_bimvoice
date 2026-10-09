/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** A view's membrane lines (vapour barriers, foils, layers under 2 mm) as a heavy dashed pen, for sheets and DXF. */

import { PEN } from '@/components/viewer/sheets/viewport-pens';
import type { PlanOverlay } from './plan-overlays';
import type { StyledDrawing } from './view-graphics';

/** Paper millimetres: heavier than a cut line, so a membrane reads at a glance. */
export const MEMBRANE_PEN_MM = PEN.cut * 1.4;

export function membraneOverlays(drawing: StyledDrawing | null | undefined): PlanOverlay[] {
  const shapes = drawing?.membranes ?? [];
  return shapes.length ? [{ layer: 'MEMBRANE', width: MEMBRANE_PEN_MM, dashed: true, shapes }] : [];
}
