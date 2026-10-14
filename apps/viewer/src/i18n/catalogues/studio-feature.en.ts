/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { TranslationValue } from '../types';

/** A Studio solid's history card: the steps it was built from, editable. */
export const studioFeatureEn = {
  'studioFeature.title': 'Studio · {operation}',
  'studioFeature.op.extrude': 'Extrude',
  'studioFeature.op.sweep': 'Sweep',
  'studioFeature.op.revolve': 'Revolve',
  'studioFeature.sketch': 'Sketch',
  'studioFeature.sketchSummary': '{view} · outline, {holes} hole(s)',
  'studioFeature.face': 'Face',
  'studioFeature.faceSummary': '{area} m² net',
  'studioFeature.path': 'Path',
  'studioFeature.axis': 'Axis',
  'studioFeature.guideMissing': 'missing: redraw it to rebuild',
  'studioFeature.depth': 'Depth (m)',
  'studioFeature.angle': 'Angle (°)',
  'studioFeature.class': 'Class',
  'studioFeature.editSketch': 'Edit sketch',
  'studioFeature.hint': 'Every step stays editable: change the sketch, its holes or the path and the solid follows. Double-click the solid to open its sketch.',
} as const satisfies Record<string, TranslationValue>;
