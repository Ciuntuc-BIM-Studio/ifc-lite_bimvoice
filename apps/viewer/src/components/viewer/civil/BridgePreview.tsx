/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A bridge in the corridor configurator, seen from the side and unrolled
 * along the alignment: the ground, the road's grade line, the deck between
 * its two abutments with their footings, the station the section preview
 * cuts at. Heights are exaggerated (shown in the corner) when the bridge is
 * long and low, so the abutments stay readable.
 */

import { useMemo } from 'react';
import { bridgeElevation, formatStation, Terrain, type CorridorBridge, type CorridorModel, type P2, type Tin } from '@ifc-lite/create';
import { ZoomBox } from './ZoomBox';

interface Props {
  model: CorridorModel;
  bridge: CorridorBridge;
  terrain: Tin | null;
  width: number;
  height: number;
  label: string;
  station: number;
  /** The text written in the corner: the bridge's name, its span, the abutments' heights and the exaggeration. */
  caption: (span: string, heights: string, exaggeration: string) => string;
  abutmentColor?: string;
}

const MAX_EXAGGERATION = 5;

export function BridgePreview({ model, bridge, terrain, width, height, label, station, caption, abutmentColor = '#a8a29e' }: Props) {
  const el = useMemo(() => {
    try {
      return bridgeElevation(bridge, model.alignment, model.profile, terrain ? new Terrain(terrain) : null);
    } catch {
      return null;
    }
  }, [bridge, model, terrain]);
  if (!el) return null;
  const all = [...el.deck, ...el.grade, ...el.ground, ...el.abutments.flatMap((a) => [...a.body, ...a.footing])];
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const m = 16;
  const sx = (width - 2 * m) / Math.max(maxX - minX, 1e-6);
  const fitY = (height - 2 * m - 10) / Math.max(maxY - minY, 1e-6);
  const sy = Math.min(fitY, sx * MAX_EXAGGERATION);
  const ve = Math.max(1, Math.round((sy / sx) * 10) / 10);
  const oy = height - m - ((height - 2 * m - 10) - (maxY - minY) * sy) / 2;
  const S = (p: P2) => `${(m + (p[0] - minX) * sx).toFixed(1)},${(oy - (p[1] - minY) * sy).toFixed(1)}`;
  const line = (pts: readonly P2[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${S(p)}`).join('');
  const x = m + (station - minX) * sx;
  const span = Math.abs(bridge.to - bridge.from);
  return (
    <figure className="rounded-md border border-zinc-200 bg-white p-1 text-zinc-900 dark:border-zinc-700">
      <ZoomBox width={width} height={height} label={label}>
        <svg width={width} height={height} aria-hidden="true">
          {el.ground.length ? <path d={`${line(el.ground)}L${S([el.ground[el.ground.length - 1][0], minY])}L${S([el.ground[0][0], minY])}Z`} fill="#dcfce7" stroke="#15803d" strokeWidth={1.2} /> : null}
          {el.abutments.map((a, i) => (
            <g key={i}>
              <path d={`${line(a.footing)}Z`} fill="#78716c" stroke="#27272a" strokeWidth={0.6} />
              <path d={`${line(a.body)}Z`} fill={abutmentColor} stroke="#27272a" strokeWidth={0.8} />
            </g>
          ))}
          <path d={`${line(el.deck)}Z`} fill={bridge.deck.profile.color} stroke="#27272a" strokeWidth={0.8} />
          <path d={line(el.grade)} fill="none" stroke="#b91c1c" strokeWidth={1} strokeDasharray="6 2 1 2" />
          {station >= minX && station <= maxX ? <line x1={x} y1={8} x2={x} y2={height - 8} stroke="#2563eb" strokeWidth={1} strokeDasharray="3 2" /> : null}
          <text x={6} y={12} fontSize={9} fill="#71717a">{caption(`${formatStation(Math.min(bridge.from, bridge.to))} – ${formatStation(Math.max(bridge.from, bridge.to))} (${span.toFixed(1)} m)`, el.abutments.map((a) => a.height.toFixed(1)).join(' / '), ve.toFixed(1))}</text>
        </svg>
      </ZoomBox>
      <figcaption className="px-1 text-2xs text-zinc-500">{label}</figcaption>
    </figure>
  );
}
