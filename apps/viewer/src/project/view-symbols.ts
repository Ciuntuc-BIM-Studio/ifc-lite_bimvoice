/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A plan view's door and window symbols (`drafting/opening-symbols.ts`),
 * with the project's per-door flips (by GlobalId) and the view's hidden
 * categories — shared by the drawing tab and the sheet viewports.
 */

import type { MeshData } from '@ifc-lite/geometry';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { openingSymbols, type OpeningSymbol } from '@/drafting/opening-symbols';
import { renderIdGlobalId } from './element-guid';

export function viewOpeningSymbols(
  meshes: readonly MeshData[], plane: SectionPlaneConfig, flips: Record<string, number> | undefined, hidden: ReadonlySet<string>,
): OpeningSymbol[] {
  const flipsOf = (id: number) => {
    const guid = flips && Object.keys(flips).length > 0 ? renderIdGlobalId(id) : null;
    return guid ? flips?.[guid] ?? 0 : 0;
  };
  return openingSymbols(meshes, plane, flipsOf).filter((s) => !hidden.has(s.kind === 'door' ? 'IFCDOOR' : 'IFCWINDOW'));
}
