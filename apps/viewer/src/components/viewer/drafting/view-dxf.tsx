/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A plan, section or elevation as DXF, in model millimetres (1:1): the view
 * as its Visibility / Graphics style it — cut lines, projection, hidden
 * lines, cut hatches — with the plan's door and window symbols, its roof
 * lines, and every
 * line and annotation drafted on the view. It is drawn once into an
 * off-screen SVG with the same pens a sheet uses (`viewport-pens.ts`) and
 * written by the sheet's SVG → DXF walker (`svgToDxf`), so what a view
 * exports is what a sheet shows of it.
 */

import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Drawing2D } from '@ifc-lite/drawing-2d';
import { downloadFile, sanitizeFilename } from '@/lib/export/download';
import type { SectionAxisName, ViewTransform } from '@/drafting/frame';
import { isGeometry, type DraftEntity, type DraftLayer } from '@/drafting/types';
import type { HatchPattern } from '@/drafting/hatch/pattern';
import type { ProjectView } from '@/project/types';
import { viewportPens } from '../sheets/viewport-pens';
import { OverlayPaths } from '../sheets/OverlayPaths';
import type { PlanOverlay } from '@/project/plan-overlays';
import { svgToDxf } from '../sheets/sheet-dxf';
import { layerTags, penTags } from '../sheets/dxf-tags';
import { shapePath } from './DraftOverlay';
import { AnnotationGraphics } from './AnnotationGraphics';
import { layerPen, layerShows, lookOf } from '@/drafting/styles';
import { useProjectStore } from '@/project/project-store';

/** Drawing metres → DXF millimetres. */
const MM: ViewTransform = { scale: 1000, x: 0, y: 0 };

interface ViewDxfInput {
  view: ProjectView;
  /** The view's drawing, already styled by its graphics (`styledDrawing`), or null. */
  drawing: Drawing2D | null;
  axis: SectionAxisName;
  drafts: readonly DraftEntity[];
  layers: readonly DraftLayer[];
  extraPatterns: readonly HatchPattern[];
  overlays: readonly PlanOverlay[];
}

function ViewSvg({ view, drawing, axis, drafts, layers, extraPatterns, overlays }: ViewDxfInput) {
  const pens = drawing ? viewportPens(drawing, view.graphics, MM, axis, extraPatterns) : [];
  const s = useProjectStore.getState();
  const book = { textStyles: s.textStyles ?? [], dimStyles: s.dimStyles ?? [] };
  const colour = new Map(layers.map((l) => [l.id, layerShows(l, s.layerGroups ?? [], { view: view.hiddenLayers }) ? l.color : null]));
  const layerById = new Map(layers.map((l) => [l.id, l]));
  const paperUnit = (view.scale ?? 100) / 1000;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={1} height={1} overflow="visible">
      {pens.map((p, i) => (
        <path key={i} {...penTags(p.layer, p.width, !!p.dash, p.stroke ?? '#000000')} d={p.d} fill="none" stroke={p.stroke ?? 'none'} strokeWidth={p.width} />
      ))}
      <OverlayPaths overlays={overlays} transform={MM} axis={axis} />
      {drafts.map((e) => {
        const color = colour.get(e.layerId);
        if (color === null) return null;
        return isGeometry(e.shape)
          ? <path key={e.id} {...layerTags(layerById.get(e.layerId))} d={shapePath(e.shape, MM, axis)} stroke={color ?? '#000'} strokeWidth={layerPen(layerById.get(e.layerId)).width} fill="none" />
          : <g key={e.id} {...layerTags(layerById.get(e.layerId))}><AnnotationGraphics shape={e.shape} color={color ?? '#000'} selected={false} transform={MM} axis={axis} extraPatterns={extraPatterns} look={lookOf(book, e.params)} paperUnit={paperUnit} /></g>;
      })}
    </svg>
  );
}

/** The view's DXF document (windows-1252 bytes). */
export function viewDxf(input: ViewDxfInput): Uint8Array {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<ViewSvg {...input} />));
    const svg = host.querySelector('svg');
    const scale = input.view.scale ?? 100;
    // Line-type dashes are paper millimetres: at 1:1 in model mm they scale with the view.
    return svgToDxf(svg as SVGSVGElement, 0, `units: millimetres (model, 1:1), view ${input.view.name}, drawn at 1:${scale}`, scale);
  } finally {
    root.unmount();
    host.remove();
  }
}

export function exportViewDxf(input: ViewDxfInput): void {
  const name = sanitizeFilename(input.view.name, { fallback: 'view' });
  downloadFile(viewDxf(input), `${name}.dxf`, 'application/dxf');
}
