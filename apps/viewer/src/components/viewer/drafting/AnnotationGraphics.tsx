/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * One annotation, drawn in screen space over the drawing: text, leader,
 * dimensions (architectural ticks), level marks and hatches (pattern lines
 * clipped to the boundary, even-odd, so islands stay open). Text always
 * reads upright, whatever way the view is mirrored.
 */

import { memo, useId, useMemo } from 'react';
import { dimensionLayout, formatLevel, HATCH_UNIT_M } from '@/drafting/annotation';
import { drawingToScreen, screenSigns, type SectionAxisName, type ViewTransform } from '@/drafting/frame';
import { findPattern } from '@/drafting/hatch/library';
import { hatchSegments } from '@/drafting/hatch/fill';
import type { AnnotationShape, Pt } from '@/drafting/types';
import type { HatchPattern } from '@/drafting/hatch/pattern';

interface Props {
  shape: AnnotationShape;
  color: string;
  selected: boolean;
  transform: ViewTransform;
  axis: SectionAxisName;
  extraPatterns: readonly HatchPattern[];
}

const FONT = 'ui-sans-serif, system-ui, sans-serif';

/** A drawing-space direction as a screen angle in degrees, flipped to read upright. */
function uprightDeg(angle: number, axis: SectionAxisName): number {
  const { kx, ky } = screenSigns(axis);
  let deg = (Math.atan2(Math.sin(angle) * ky, Math.cos(angle) * kx) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg <= -90) deg += 180;
  return deg;
}

function polyline(pts: Pt[], t: ViewTransform, axis: SectionAxisName, close = false): string {
  const s = pts.map((p) => drawingToScreen(p, t, axis));
  return s.length ? `M${s.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L')}${close ? 'Z' : ''}` : '';
}

function Label({ at, text, px, deg, color, anchor = 'middle', lift = 0.35 }: { at: Pt; text: string; px: number; deg: number; color: string; anchor?: 'start' | 'middle'; lift?: number }) {
  return (
    <text
      x={at.x}
      y={at.y}
      fill={color}
      fontSize={Math.max(px, 1)}
      fontFamily={FONT}
      textAnchor={anchor}
      transform={`rotate(${deg.toFixed(2)} ${at.x} ${at.y}) translate(0 ${(-px * lift).toFixed(2)})`}
    >
      {text}
    </text>
  );
}

function Hatch({ shape, color, t, axis, extraPatterns }: { shape: Extract<AnnotationShape, { type: 'hatch' }>; color: string; t: ViewTransform; axis: SectionAxisName; extraPatterns: readonly HatchPattern[] }) {
  const clipId = useId();
  const pattern = findPattern(shape.pattern, extraPatterns);
  const outline = shape.loops.map((l) => polyline(l, t, axis, true)).join('');
  // Pattern lines are computed in drawing space once per shape, then mapped to the screen.
  const segments = useMemo(
    () => (pattern && !pattern.solid ? hatchSegments(shape.loops, pattern, { scale: shape.scale * HATCH_UNIT_M, angleDeg: shape.angle }).segments : []),
    [shape.loops, shape.scale, shape.angle, pattern],
  );
  if (!pattern || pattern.solid) return <path d={outline} fill={color} fillOpacity={pattern ? 0.85 : 0.15} fillRule="evenodd" stroke={color} strokeWidth={0.75} />;
  const d = segments.map((s) => {
    const a = drawingToScreen(s.a, t, axis);
    const b = drawingToScreen(s.b, t, axis);
    return a.x === b.x && a.y === b.y ? `M${a.x.toFixed(1)} ${a.y.toFixed(1)}h0.01` : `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }).join('');
  return (
    <g>
      <clipPath id={clipId}><path d={outline} clipRule="evenodd" /></clipPath>
      <path d={d} stroke={color} strokeWidth={0.6} strokeLinecap="round" fill="none" clipPath={`url(#${clipId})`} />
      <path d={outline} fill="none" stroke={color} strokeWidth={0.4} strokeOpacity={0.6} />
    </g>
  );
}

export const AnnotationGraphics = memo(function AnnotationGraphics({ shape, color: base, selected, transform: t, axis, extraPatterns }: Props) {
  const color = selected ? '#2563eb' : base;
  const s = (p: Pt) => drawingToScreen(p, t, axis);
  if (shape.type === 'hatch') return <Hatch shape={shape} color={color} t={t} axis={axis} extraPatterns={extraPatterns} />;
  const px = shape.height * t.scale;
  switch (shape.type) {
    case 'text':
      return <Label at={s(shape.p)} text={shape.text} px={px} deg={uprightDeg(shape.rotation, axis)} color={color} anchor="start" lift={0} />;
    case 'leader': {
      const [tip, next] = [shape.pts[0], shape.pts[1] ?? shape.pts[0]];
      const a = s(tip);
      const b = s(next);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const size = Math.max(px * 0.8, 4);
      const head = `M${a.x} ${a.y}L${a.x + size * Math.cos(ang + 0.35)} ${a.y + size * Math.sin(ang + 0.35)}L${a.x + size * Math.cos(ang - 0.35)} ${a.y + size * Math.sin(ang - 0.35)}Z`;
      const end = s(shape.pts[shape.pts.length - 1]);
      return (
        <g>
          <path d={polyline(shape.pts, t, axis)} stroke={color} strokeWidth={1} fill="none" />
          <path d={head} fill={color} />
          <Label at={{ x: end.x + 3, y: end.y }} text={shape.text} px={px} deg={0} color={color} anchor="start" lift={-0.35} />
        </g>
      );
    }
    case 'level': {
      const p = s(shape.p);
      const h = Math.max(px, 4);
      return (
        <g stroke={color} fill="none" strokeWidth={1}>
          <path d={`M${p.x} ${p.y}L${p.x - h} ${p.y - h}L${p.x + h} ${p.y - h}Z`} fill={color} fillOpacity={0.25} />
          <path d={`M${p.x - h} ${p.y}L${p.x + h * 5} ${p.y}`} />
          <g stroke="none"><Label at={{ x: p.x + h * 1.3, y: p.y - h * 1.15 }} text={formatLevel(shape.value)} px={px} deg={0} color={color} anchor="start" lift={0} /></g>
        </g>
      );
    }
    default: {
      const layout = dimensionLayout(shape);
      const lines = layout.lines.map((l) => polyline([l.a, l.b], t, axis)).join('');
      const tick = Math.max(px * 0.5, 3);
      const ticks = layout.ticks.map((k) => {
        const p = s(k.at);
        return `M${p.x - tick} ${p.y + tick}L${p.x + tick} ${p.y - tick}`;
      }).join('');
      return (
        <g>
          <path d={lines} stroke={color} strokeWidth={0.75} fill="none" />
          <path d={ticks} stroke={color} strokeWidth={1.5} fill="none" />
          <Label at={s(layout.textAt)} text={layout.label} px={px} deg={uprightDeg(layout.textAngle, axis)} color={color} />
        </g>
      );
    }
  }
});
