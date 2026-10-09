/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A plan view's door and window symbols (`drafting/opening-symbols.ts`),
 * drawn from their configured joinery type where they have one, with the
 * project's per-door flips (by GlobalId) and the view's hidden categories — shared by the drawing tab and the sheet viewports.
 */

import type { MeshData } from '@ifc-lite/geometry';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { openingSymbols, type OpeningSymbol } from '@/drafting/opening-symbols';
import { joineryOfRenderId } from '@/joinery/element-spec';
import { renderIdGlobalId } from './element-guid';

export function viewOpeningSymbols(
  meshes: readonly MeshData[], plane: SectionPlaneConfig, flips: Record<string, number> | undefined, hidden: ReadonlySet<string>,
): OpeningSymbol[] {
  const flipsOf = (id: number) => {
    const guid = flips && Object.keys(flips).length > 0 ? renderIdGlobalId(id) : null;
    return guid ? flips?.[guid] ?? 0 : 0;
  };
  return openingSymbols(meshes, plane, flipsOf, joineryOfRenderId).filter((s) => !hidden.has(s.kind === 'door' ? 'IFCDOOR' : 'IFCWINDOW'));
}

/**
 * Whether a plan draws element `id` from its symbol rather than its cut:
 * every door and window — a configured one from its type's symbol, any
 * other from the one read off its mesh (leaf open with its swing, frame and
 * glazing) — so the closed leaf the model holds never shows across the gap.
 */
export function drawnBySymbol(_id: number, ifcType: string | undefined): boolean {
  return /^IFC(DOOR|WINDOW)/i.test(ifcType ?? '');
}
