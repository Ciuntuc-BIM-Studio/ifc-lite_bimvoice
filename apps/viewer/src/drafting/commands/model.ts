/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * EXTRUDE: a closed contour on the view's work plane becomes an IFC element.
 * Click a closed drafted shape, or inside any closed region (drafted shapes
 * and the drawing's cut outlines) — a region becomes a drafted contour so
 * the element always has an editable base. Closed shapes drafted inside the
 * contour are its voids. Type an IFC class (WALL, SLAB, COLUMN… or any
 * IfcXxx) and a depth (negative extrudes away from the viewer).
 */

import { createContourElement } from '@/project/contour-element';
import { editDrafts, newDraft, setDraftParams } from '../draft-store';
import { regionAt } from '../hatch/region';
import { pointInPolygon } from '../offset';
import type { DraftEntity, DraftShape, Pt } from '../types';
import type { DraftCommandDef, DraftContext } from './types';

const CLASS_WORDS: Record<string, string> = {
  WALL: 'IfcWall', SLAB: 'IfcSlab', FLOOR: 'IfcSlab', COLUMN: 'IfcColumn', BEAM: 'IfcBeam', MEMBER: 'IfcMember',
  PLATE: 'IfcPlate', COVERING: 'IfcCovering', ROOF: 'IfcRoof', FOOTING: 'IfcFooting', PROXY: 'IfcBuildingElementProxy',
  FURNITURE: 'IfcFurnishingElement', STAIR: 'IfcStair', RAILING: 'IfcRailing', RAMP: 'IfcRamp', CHIMNEY: 'IfcChimney',
};

/** The IFC class a typed word names, if any. */
export function ifcClassFromWord(word: string): string | null {
  const upper = word.toUpperCase();
  if (CLASS_WORDS[upper]) return CLASS_WORDS[upper];
  if (/^IFC[A-Z]+$/.test(upper)) return `Ifc${upper.slice(3, 4)}${upper.slice(4).toLowerCase()}`;
  return null;
}

const CIRCLE_STEPS = 64;

/** A closed drafted shape as a point loop, or null. */
export function shapeLoop(shape: DraftShape): Pt[] | null {
  if (shape.type === 'polyline' && shape.closed && shape.pts.length >= 3) return shape.pts;
  if (shape.type === 'circle') {
    return Array.from({ length: CIRCLE_STEPS }, (_, i) => ({
      x: shape.c.x + shape.r * Math.cos((i / CIRCLE_STEPS) * Math.PI * 2),
      y: shape.c.y + shape.r * Math.sin((i / CIRCLE_STEPS) * Math.PI * 2),
    }));
  }
  return null;
}

/** The element loops of a source contour: its own loop, then the closed drafted shapes inside it (first level). */
export function contourLoops(source: DraftEntity, entities: readonly DraftEntity[]): Pt[][] | null {
  const outer = source.shape.type === 'polyline' || source.shape.type === 'circle' ? shapeLoop(source.shape) : null;
  if (!outer) return null;
  const inside = entities
    .filter((e) => e.id !== source.id && e.viewId === source.viewId && !e.params.ifcGlobalId)
    .map((e) => (e.shape.type === 'polyline' || e.shape.type === 'circle' ? shapeLoop(e.shape) : null))
    .filter((l): l is Pt[] => !!l && l.every((p) => pointInPolygon(p, outer)));
  // Only first-level islands: drop loops lying inside another island.
  const holes = inside.filter((l, i) => !inside.some((o, j) => j !== i && l.every((p) => pointInPolygon(p, o))));
  return [outer, ...holes];
}

/** Two loops trace the same area (same size, same centre). */
function sameLoop(a: Pt[], b: Pt[]): boolean {
  const area = (l: Pt[]) => Math.abs(l.reduce((s, p, i) => s + p.x * l[(i + 1) % l.length].y - l[(i + 1) % l.length].x * p.y, 0) / 2);
  const centre = (l: Pt[]) => ({ x: l.reduce((s, p) => s + p.x, 0) / l.length, y: l.reduce((s, p) => s + p.y, 0) / l.length });
  const [aa, ab] = [area(a), area(b)];
  const [ca, cb] = [centre(a), centre(b)];
  return Math.abs(aa - ab) <= 1e-6 * Math.max(aa, ab, 1) && Math.hypot(ca.x - cb.x, ca.y - cb.y) < 1e-3;
}

export function pickSource(ctx: DraftContext, p: Pt): DraftEntity | null {
  const entities = ctx.entities();
  // The smallest closed drafted shape around the point.
  const around = entities
    .map((e) => ({ e, loop: e.shape.type === 'polyline' || e.shape.type === 'circle' ? shapeLoop(e.shape) : null }))
    .filter((x): x is { e: DraftEntity; loop: Pt[] } => !!x.loop && pointInPolygon(p, x.loop));
  if (around.length > 0) {
    const area = (l: Pt[]) => Math.abs(l.reduce((s, a, i) => s + a.x * l[(i + 1) % l.length].y - l[(i + 1) % l.length].x * a.y, 0) / 2);
    return around.sort((a, b) => area(a.loop) - area(b.loop))[0].e;
  }
  // Else the region the point is in (drafted shapes + the drawing's cut outlines): draft its outline.
  const region = regionAt(p, ctx.closedLoops());
  if (!region) return null;
  // The outline, and the region's holes no drafted shape draws yet — all editable from now on.
  const drafted = entities.flatMap((e) => (e.shape.type === 'polyline' || e.shape.type === 'circle' ? [shapeLoop(e.shape)] : [])).filter((l): l is Pt[] => !!l);
  const holes = region.slice(1).filter((h) => !drafted.some((d) => sameLoop(d, h)));
  const [id] = editDrafts({
    add: [region[0], ...holes].map((pts) => newDraft(ctx.viewId, ctx.layerId, { type: 'polyline', pts, closed: true })),
  });
  return ctx.entities().find((e) => e.id === id) ?? null;
}

export const extrudeCommand: DraftCommandDef = {
  id: 'extrude',
  aliases: ['EXTRUDE', 'EXT', 'EXTRUSION'],
  labelKey: 'drafting.cmd.extrude',
  create(ctx) {
    const s = ctx.settings;
    return {
      prompt: () => ({ key: 'drafting.prompt.extrude', params: { ifcClass: s.extrudeClass, depth: s.extrudeDepth } }),
      input: () => 'point',
      basePoint: () => null,
      wantsValue: () => true,
      onValue(v) {
        if (v !== 0) s.extrudeDepth = v;
        return 'continue';
      },
      onKeyword(word) {
        const ifcClass = ifcClassFromWord(word);
        if (!ifcClass) return undefined;
        s.extrudeClass = ifcClass;
        return 'continue';
      },
      onPoint(p) {
        const view = ctx.view();
        const plane = ctx.plane();
        if (!view || !plane) {
          ctx.say('drafting.msg.noWorkPlane');
          return 'continue';
        }
        const source = pickSource(ctx, p);
        const loops = source ? contourLoops(source, ctx.entities()) : null;
        if (!source || !loops) {
          ctx.say('drafting.msg.noRegion');
          return 'continue';
        }
        if (source.params.ifcGlobalId) {
          ctx.say('drafting.msg.alreadyLinked');
          return 'continue';
        }
        const result = createContourElement(view, plane, loops, { ifcClass: s.extrudeClass, depth: s.extrudeDepth }, source.id);
        if (!result.ok) {
          ctx.say('drafting.msg.extrudeFailed', { detail: result.error });
          return 'continue';
        }
        setDraftParams(new Set([source.id]), {
          ifcGlobalId: result.globalId, ifcModelId: result.modelId, ifcClass: result.ifcClass, depth: s.extrudeDepth,
        });
        ctx.say('drafting.msg.extruded', { ifcClass: result.ifcClass, guid: result.globalId });
        return 'continue';
      },
      onEnter: () => 'done',
    };
  },
};
