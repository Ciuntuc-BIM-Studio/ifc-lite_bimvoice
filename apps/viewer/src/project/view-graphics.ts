/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A view's own graphics, Revit's Visibility / Graphics: the view picks a
 * graphic override preset (`@ifc-lite/drawing-2d`'s built-in ones, the
 * Drawing panel's default unless it says otherwise) and overrides it per
 * element category — hide a category, give it a line colour, a cut fill, a
 * line weight, or a CAD cut hatch from the hatch library. Everything here is
 * pure: the drafting view turns it into an override engine, a filtered
 * drawing and hatch regions.
 */

import { BUILT_IN_PRESETS, ifcTypeCriterion, type Drawing2D, type GraphicOverrideRule } from '@ifc-lite/drawing-2d';
import type { Pt } from '@/drafting/types';
import type { CategoryGraphics, ViewGraphics } from './types';

/** The Drawing panel's default preset (IFC material colours). */
export const DEFAULT_VIEW_PRESET = 'preset-3d-colors';

export interface ViewCategory {
  id: string;
  labelKey: string;
  classes: readonly string[];
}

export const VIEW_CATEGORIES = [
  { id: 'walls', labelKey: 'viewGraphics.cat.walls', classes: ['IfcWall', 'IfcWallStandardCase', 'IfcCurtainWall'] },
  { id: 'slabs', labelKey: 'viewGraphics.cat.slabs', classes: ['IfcSlab'] },
  { id: 'roofs', labelKey: 'viewGraphics.cat.roofs', classes: ['IfcRoof'] },
  { id: 'columns', labelKey: 'viewGraphics.cat.columns', classes: ['IfcColumn'] },
  { id: 'beams', labelKey: 'viewGraphics.cat.beams', classes: ['IfcBeam', 'IfcMember'] },
  { id: 'doors', labelKey: 'viewGraphics.cat.doors', classes: ['IfcDoor'] },
  { id: 'windows', labelKey: 'viewGraphics.cat.windows', classes: ['IfcWindow'] },
  { id: 'stairs', labelKey: 'viewGraphics.cat.stairs', classes: ['IfcStair', 'IfcStairFlight', 'IfcRamp', 'IfcRampFlight'] },
  { id: 'railings', labelKey: 'viewGraphics.cat.railings', classes: ['IfcRailing'] },
  { id: 'spaces', labelKey: 'viewGraphics.cat.spaces', classes: ['IfcSpace'] },
  { id: 'furniture', labelKey: 'viewGraphics.cat.furniture', classes: ['IfcFurnishingElement', 'IfcFurniture'] },
  { id: 'other', labelKey: 'viewGraphics.cat.other', classes: ['IfcBuildingElementProxy', 'IfcCovering', 'IfcPlate', 'IfcFooting'] },
] as const satisfies readonly ViewCategory[];

/** Upper-case IFC class → category id. */
const CATEGORY_OF = new Map<string, string>(VIEW_CATEGORIES.flatMap((c) => c.classes.map((k) => [k.toUpperCase(), c.id] as const)));

export function categoryOf(ifcType: string): string | null {
  return CATEGORY_OF.get(ifcType.toUpperCase()) ?? null;
}

function presetRules(graphics: ViewGraphics | undefined): GraphicOverrideRule[] {
  const id = graphics?.presetId === undefined ? DEFAULT_VIEW_PRESET : graphics.presetId;
  return id ? BUILT_IN_PRESETS.find((p) => p.id === id)?.rules ?? [] : [];
}

/** The view's override rules: its preset's, then one rule per overridden category (winning). */
export function viewOverrideRules(graphics: ViewGraphics | undefined): GraphicOverrideRule[] {
  const rules = [...presetRules(graphics)];
  for (const category of VIEW_CATEGORIES) {
    const g: CategoryGraphics | undefined = graphics?.categories?.[category.id];
    if (!g || (!g.lineColor && !g.fillColor && !g.lineWeight)) continue;
    rules.push({
      id: `view-category-${category.id}`,
      name: category.id,
      enabled: true,
      priority: 100000,
      criteria: ifcTypeCriterion([...category.classes]),
      style: {
        ...(g.lineColor ? { strokeColor: g.lineColor } : {}),
        ...(g.fillColor ? { fillColor: g.fillColor } : {}),
        ...(g.lineWeight ? { lineWeight: g.lineWeight } : {}),
      },
    });
  }
  return rules;
}

/** Upper-case IFC classes of the categories the view hides. */
export function hiddenClasses(graphics: ViewGraphics | undefined): Set<string> {
  const hidden = new Set<string>();
  for (const category of VIEW_CATEGORIES) {
    if (graphics?.categories?.[category.id]?.visible === false) for (const k of category.classes) hidden.add(k.toUpperCase());
  }
  return hidden;
}

function rgba(hex: string): [number, number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

/**
 * The drawing as the view shows it: hidden categories' cut faces and lines
 * dropped, and the cut faces of categories with a fill colour stamped with
 * it (so it wins over IFC material colours too). The same object when the
 * view changes nothing.
 */
export function styledDrawing(
  drawing: Drawing2D,
  graphics: ViewGraphics | undefined,
  hostTypeOf: (entityId: number, ifcType: string | undefined) => string | null = () => null,
  /** Elements a symbol draws instead (a plan's configured doors and windows): their cut and lines are left out. */
  replaced?: (entityId: number, ifcType: string | undefined) => boolean,
): Drawing2D {
  if (replaced) {
    drawing = {
      ...drawing,
      cutPolygons: drawing.cutPolygons.filter((p) => !replaced(p.entityId, p.ifcType)),
      lines: drawing.lines.filter((l) => !replaced(l.entityId, l.ifcType)),
    };
  }
  const hidden = hiddenClasses(graphics);
  const fills = new Map<string, [number, number, number, number]>();
  for (const category of VIEW_CATEGORIES) {
    const fill = graphics?.categories?.[category.id]?.fillColor;
    const color = fill ? rgba(fill) : null;
    if (color) for (const k of category.classes) fills.set(k.toUpperCase(), color);
  }
  if (hidden.size === 0 && fills.size === 0 && !graphics?.categories) return drawing;
  const shown = (type: string | undefined) => !type || !hidden.has(type.toUpperCase());
  // A layer part takes its host's class here, so a category's graphics reach it.
  const relabel = <T extends { entityId: number; ifcType?: string }>(item: T): T => {
    const host = hostTypeOf(item.entityId, item.ifcType);
    return host ? { ...item, ifcType: host } : item;
  };
  return {
    ...drawing,
    cutPolygons: drawing.cutPolygons.map(relabel).filter((p) => shown(p.ifcType)).map((p) => {
      const color = fills.get((p.ifcType ?? '').toUpperCase());
      return color ? { ...p, color } : p;
    }),
    lines: drawing.lines.map(relabel).filter((l) => shown(l.ifcType)),
  };
}

export interface CutHatch {
  loops: Pt[][];
  pattern: string;
  scale: number;
  color: string;
}

/** The cut faces to hatch, by their category's `cutHatch`. */
export function cutHatches(drawing: Drawing2D, graphics: ViewGraphics | undefined): CutHatch[] {
  const categories = graphics?.categories;
  if (!categories) return [];
  const out: CutHatch[] = [];
  for (const polygon of drawing.cutPolygons) {
    const id = categoryOf(polygon.ifcType ?? '');
    const g = id ? categories[id] : undefined;
    if (!g?.cutHatch || g.visible === false) continue;
    out.push({
      loops: [polygon.polygon.outer, ...polygon.polygon.holes],
      pattern: g.cutHatch,
      scale: g.hatchScale ?? 1,
      color: g.lineColor ?? '#000000',
    });
  }
  return out;
}
