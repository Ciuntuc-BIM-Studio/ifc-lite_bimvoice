/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Section marks on floor plans: every section view drawn with SECTION keeps
 * its line (world metres, `SectionProjectView.marker`), and each plan shows
 * it — a thin chain line, a heavy stroke at either end, an arrow at either
 * end looking the way the section looks, and the section's name beyond each
 * arrow. Sized from the plan's scale so it reads the same on paper. As plan
 * overlays they reach the screen, the sheets and the DXF alike.
 */

import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { worldToDrawing } from '@/drafting/frame';
import type { DraftShape, Pt } from '@/drafting/types';
import { PEN } from '@/components/viewer/sheets/viewport-pens';
import type { PlanOverlay } from './plan-overlays';
import type { ProjectView, SectionProjectView } from './types';

export interface SectionMark {
  viewId: string;
  name: string;
  a: Pt;
  b: Pt;
  /** Unit, drawing coordinates: the way the section looks. */
  look: Pt;
}

const v3 = (t: readonly number[]) => ({ x: t[0], y: t[1], z: t[2] });

/** The section marks a plan shows, in its drawing coordinates. */
export function sectionMarks(plan: ProjectView, plane: SectionPlaneConfig, views: readonly ProjectView[]): SectionMark[] {
  if (plan.kind !== 'plan') return [];
  return views.flatMap((v): SectionMark[] => {
    const s = v as SectionProjectView;
    const n = s.kind === 'section' ? s.plane.custom?.normal : undefined;
    if (s.kind !== 'section' || !s.marker || !n) return [];
    const wa = v3(s.marker.a), wb = v3(s.marker.b);
    const a = worldToDrawing(plane, wa), b = worldToDrawing(plane, wb);
    // The section looks along −normal.
    const tip = worldToDrawing(plane, { x: wa.x - n[0], y: wa.y - n[1], z: wa.z - n[2] });
    const lx = tip.x - a.x, ly = tip.y - a.y, l = Math.hypot(lx, ly);
    if (l < 1e-9 || Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) return [];
    return [{ viewId: s.id, name: s.name, a, b, look: { x: lx / l, y: ly / l } }];
  });
}

/** A plan's section marks as overlays (paper-sized from its scale). */
export function sectionMarkOverlays(plan: ProjectView, plane: SectionPlaneConfig, views: readonly ProjectView[]): PlanOverlay[] {
  const marks = sectionMarks(plan, plane, views);
  if (!marks.length) return [];
  const k = (plan.scale ?? 100) / 100;
  const chain: DraftShape[] = [], heavy: DraftShape[] = [], arrows: DraftShape[] = [];
  const texts: { at: Pt; text: string }[] = [];
  const at = (p: Pt, d: Pt, s: number): Pt => ({ x: p.x + d.x * s, y: p.y + d.y * s });
  for (const m of marks) {
    const len = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y);
    const u = { x: (m.b.x - m.a.x) / len, y: (m.b.y - m.a.y) / len };
    const stroke = Math.min(0.8 * k, len / 3), arrow = 0.7 * k, head = 0.25 * k;
    chain.push({ type: 'line', a: m.a, b: m.b });
    heavy.push({ type: 'line', a: m.a, b: at(m.a, u, stroke) }, { type: 'line', a: m.b, b: at(m.b, u, -stroke) });
    for (const end of [m.a, m.b]) {
      const tip = at(end, m.look, arrow);
      arrows.push(
        { type: 'line', a: end, b: tip },
        { type: 'line', a: tip, b: at(at(tip, m.look, -head), { x: -m.look.y, y: m.look.x }, head * 0.5) },
        { type: 'line', a: tip, b: at(at(tip, m.look, -head), { x: m.look.y, y: -m.look.x }, head * 0.5) },
      );
      texts.push({ at: at(tip, m.look, 0.35 * k), text: m.name });
    }
  }
  return [
    { layer: 'SECTION', width: PEN.hatch, dashed: true, shapes: chain },
    { layer: 'SECTION', width: PEN.cut, shapes: heavy },
    { layer: 'SECTION', width: PEN.seen, shapes: arrows, texts },
  ];
}
