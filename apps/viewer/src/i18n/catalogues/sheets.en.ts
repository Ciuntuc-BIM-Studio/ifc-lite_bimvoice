/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { TranslationValue } from '../types';
export const sheetsEn = {
  'sheets.panel': 'Sheet settings',
  'sheets.paper': 'Paper',
  'sheets.size': 'Size',
  'sheets.orientation': 'Orientation',
  'sheets.landscape': 'Landscape',
  'sheets.portrait': 'Portrait',
  'sheets.titleBlock': 'Title block',
  'sheets.tb.number': 'Sheet no.',
  'sheets.tb.title': 'Title',
  'sheets.tb.project': 'Project',
  'sheets.tb.drawnBy': 'Drawn by',
  'sheets.tb.date': 'Date',
  'sheets.tb.scale': 'Scale',
  'sheets.asIndicated': 'As indicated',
  'sheets.viewport': 'Viewport · {name}',
  'sheets.viewportLabel': '{name}  1:{scale}',
  'sheets.scale': 'Scale',
  'sheets.width': 'Width (mm)',
  'sheets.height': 'Height (mm)',
  'sheets.removeViewport': 'Remove from sheet',
  'sheets.fitBox': 'Fit box to drawing',
  'sheets.dropHint': 'Drag a floor plan, section or elevation from the Project Navigator onto the paper to place it.',
  'sheets.export': 'Export',
  'sheets.svg': 'SVG',
  'sheets.dxf': 'DXF',
  'sheets.pdf': 'PDF / Print',
} as const satisfies Record<string, TranslationValue>;
