/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What a floor plan draws for the corridors on it: the alignment's
 * centreline (dashed), the pavement edges, a tick every 20 m with the
 * station written every 100 m (0+100), and a mark with the radius at
 * every PI — all in the plan's drawing coordinates, grouped by pen as the
 * roof lines are, so sheets and the DXF export carry them too.
 */

import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { assemblyWidth, buildAlignment, buildProfile, formatStation, sampleAlignment, type AlignmentPoint } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { buildStoreyWorkplane } from '@/lib/commands/modeling/workplane';
import { worldToDrawing } from '@/drafting/frame';
import type { DraftShape, Pt } from '@/drafting/types';
import { PEN } from '@/components/viewer/sheets/viewport-pens';
import type { PlanOverlay } from '@/project/plan-overlays';
import type { ProjectView } from '@/project/types';
import { corridorsOnView } from './corridor-element';

const TICK_EVERY = 20;
const LABEL_EVERY = 100;

/** The corridors of a plan as overlays (none when the view hides them). */
export function corridorOverlays(view: ProjectView, plane: SectionPlaneConfig, hidden: ReadonlySet<string>): PlanOverlay[] {
  if (view.kind !== 'plan' || hidden.has('IFCELEMENTASSEMBLY')) return [];
  const s = useViewerStore.getState();
  const axis: DraftShape[] = [], edges: DraftShape[] = [], marks: DraftShape[] = [];
  const texts: { at: Pt; text: string }[] = [];
  for (const { modelId, storeyId, spec } of corridorsOnView(view)) {
    const workplane = buildStoreyWorkplane(s, modelId, storeyId, 0);
    if ('refused' in workplane) continue;
    let alignment, profile;
    try {
      alignment = buildAlignment(spec.alignment);
      profile = buildProfile(spec.profile);
    } catch {
      continue;
    }
    const at = (x: number, y: number, z: number): Pt => {
      const r = workplane.localToRender([x, y, z]);
      return worldToDrawing(plane, { x: r[0], y: r[1], z: r[2] });
    };
    const half = assemblyWidth(spec.assembly);
    const samples = sampleAlignment(alignment, 2);
    const centre = samples.map(({ station, point }) => at(point.x, point.y, profile.elevationAt(station)));
    axis.push({ type: 'polyline', pts: centre, closed: false });
    for (const side of [-1, 1]) {
      edges.push({ type: 'polyline', pts: samples.map(({ station, point }) => offset(point, side * half, profile.elevationAt(station), at)), closed: false });
    }
    const first = Math.ceil(alignment.startStation / TICK_EVERY) * TICK_EVERY;
    for (let station = first; station <= alignment.endStation + 1e-9; station += TICK_EVERY) {
      const p = alignment.pointAt(station);
      const z = profile.elevationAt(station);
      const a = offset(p, -half - 0.5, z, at), b = offset(p, -half - 2, z, at);
      marks.push({ type: 'line', a, b });
      if (Math.abs(station / LABEL_EVERY - Math.round(station / LABEL_EVERY)) < 1e-9) texts.push({ at: offset(p, -half - 2.5, z, at), text: formatStation(station) });
    }
    spec.alignment.pis.forEach((pi, i) => {
      if (i === 0 || i === spec.alignment.pis.length - 1 || !pi.radius) return;
      const c = at(pi.x, pi.y, profile.elevationAt(alignment.startStation));
      marks.push({ type: 'line', a: { x: c.x - 0.6, y: c.y - 0.6 }, b: { x: c.x + 0.6, y: c.y + 0.6 } }, { type: 'line', a: { x: c.x - 0.6, y: c.y + 0.6 }, b: { x: c.x + 0.6, y: c.y - 0.6 } });
      texts.push({ at: { x: c.x + 0.8, y: c.y + 0.8 }, text: `PI${i} R=${pi.radius}${pi.spiralIn || pi.spiralOut ? ` Ls=${pi.spiralIn ?? 0}/${pi.spiralOut ?? 0}` : ''}` });
    });
  }
  return [
    { layer: 'ROAD', width: PEN.seen, dashed: true, shapes: axis },
    { layer: 'ROAD', width: PEN.cut, shapes: edges },
    { layer: 'ROAD', width: PEN.hatch, shapes: marks, texts },
  ].filter((o) => o.shapes.length);
}

function offset(point: AlignmentPoint, d: number, z: number, at: (x: number, y: number, z: number) => Pt): Pt {
  // Positive d is the right side of the direction of travel.
  return at(point.x + Math.sin(point.direction) * d, point.y - Math.cos(point.direction) * d, z);
}
