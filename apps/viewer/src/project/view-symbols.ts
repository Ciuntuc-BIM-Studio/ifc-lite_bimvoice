/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A plan view's door and window symbols (`drafting/opening-symbols.ts`),
 * drawn from their configured joinery type where they have one (or the
 * catalogue entry the project's symbol mapping gives them), with the
 * project's per-door flips (by GlobalId) and the view's hidden categories — shared by the drawing tab and the sheet viewports.
 */

import type { MeshData } from '@ifc-lite/geometry';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { openingSymbols, type OpeningSymbol } from '@/drafting/opening-symbols';
import { drawnJoineryOfRenderId } from '@/joinery/mapped-joinery';
import { renderIdGlobalId } from './element-guid';
import type { Drawing2D } from '@ifc-lite/drawing-2d';
import { typedElevationSymbol } from '@/joinery/elevation-placement';
import { openingConvention } from '@/joinery/opening-convention';

export function viewOpeningSymbols(
  meshes: readonly MeshData[], plane: SectionPlaneConfig, flips: Record<string, number> | undefined, hidden: ReadonlySet<string>,
): OpeningSymbol[] {
  const flipsOf = (id: number) => {
    const guid = flips && Object.keys(flips).length > 0 ? renderIdGlobalId(id) : null;
    return guid ? flips?.[guid] ?? 0 : 0;
  };
  return openingSymbols(meshes, plane, flipsOf, drawnJoineryOfRenderId).filter((s) => !hidden.has(s.kind === 'door' ? 'IFCDOOR' : 'IFCWINDOW'));
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

/** Door and window classes, by the mesh's IFC type. */
const JOINERY_CLASS = /^IFC(DOOR|WINDOW)(STANDARDCASE)?$/i;

/** The elements a drawing shows at least partly (after hidden-line removal). */
export function visibleEntities(drawing: Pick<Drawing2D, 'lines'> | null | undefined): Set<number> {
  const out = new Set<number>();
  for (const l of drawing?.lines ?? []) if (l.visibility !== 'hidden') out.add(l.entityId);
  return out;
}

/**
 * An elevation's or section's door and window symbols: every door / window
 * the drawing shows (`visible`) whose face the view looks at and that has a
 * joinery type (configured, or mapped by the project) — frame, panels and
 * opening marks over the projected mesh.
 */
export function viewElevationSymbols(
  meshes: readonly MeshData[], plane: SectionPlaneConfig, visible: ReadonlySet<number>, hidden: ReadonlySet<string>,
): OpeningSymbol[] {
  if (plane.axis === 'y' || plane.customPlane) return [];
  const byId = new Map<number, { kind: 'door' | 'window'; world: number[]; l2w?: number[] }>();
  for (const mesh of meshes) {
    const cls = (mesh.ifcType ?? '').toUpperCase();
    if (!JOINERY_CLASS.test(cls) || !visible.has(mesh.expressId) || (mesh.geometryClass ?? 0) === 2) continue;
    const kind = cls.startsWith('IFCDOOR') ? 'door' : 'window';
    if (hidden.has(kind === 'door' ? 'IFCDOOR' : 'IFCWINDOW')) continue;
    const entry = byId.get(mesh.expressId) ?? { kind, world: [] };
    entry.l2w ??= mesh.localToWorld;
    const [ox, oy, oz] = mesh.origin ?? [0, 0, 0];
    const p = mesh.positions;
    for (let i = 0; i + 2 < p.length; i += 3) entry.world.push(ox + p[i], oy + p[i + 1], oz + p[i + 2]);
    byId.set(mesh.expressId, entry);
  }
  const out: OpeningSymbol[] = [];
  const convention = openingConvention();
  for (const [id, entry] of byId) {
    const drawn = entry.l2w ? drawnJoineryOfRenderId(id) : null;
    const placed = drawn && entry.l2w ? typedElevationSymbol(drawn.spec, entry.world, entry.l2w, plane, drawn.flips, { convention }) : null;
    if (placed) out.push({ id, kind: entry.kind, shapes: placed.thin, dashed: placed.dashed });
  }
  return out;
}
