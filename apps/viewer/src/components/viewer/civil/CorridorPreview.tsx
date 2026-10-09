/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The corridor configurator's live previews, drawn from the built corridor:
 * the plan (centreline, edges, daylight lines, PIs), the profile (ground in
 * green, grade line in red, over station) and a cross-section at a chosen
 * station (courses in their colours, the ground line, the daylight links).
 */

import { useMemo } from 'react';
import { ZoomBox } from './ZoomBox';
import { formatStation, Terrain, type CorridorModel, type Tin } from '@ifc-lite/create';

type P = { x: number; y: number };

interface Fit { scale: number; ox: number; oy: number }

function fit(pts: readonly P[], w: number, h: number, margin = 14, keepAspect = true): Fit {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const sx = (w - 2 * margin) / Math.max(maxX - minX, 1e-6), sy = (h - 2 * margin) / Math.max(maxY - minY, 1e-6);
  const scale = keepAspect ? Math.min(sx, sy) : sx;
  return { scale, ox: (w - (maxX - minX) * scale) / 2 - minX * scale, oy: (h + (maxY - minY) * (keepAspect ? scale : sy)) / 2 + minY * (keepAspect ? scale : sy) };
}

const path = (pts: readonly P[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');

function Frame({ width, height, label, children }: { width: number; height: number; label: string; children: React.ReactNode }) {
  return (
    <figure className="rounded-md border border-zinc-200 bg-white p-1 text-zinc-900 dark:border-zinc-700">
      <ZoomBox width={width} height={height} label={label}>
        <svg width={width} height={height} aria-hidden="true">{children}</svg>
      </ZoomBox>
      <figcaption className="px-1 text-2xs text-zinc-500">{label}</figcaption>
    </figure>
  );
}

export function PlanPreview({ model, width, height, label, station }: { model: CorridorModel; width: number; height: number; label: string; station: number }) {
  const lines = useMemo(() => [model.centreline, model.edges.left, model.edges.right, model.edges.daylightLeft, model.edges.daylightRight].map((l) => l.map(([x, y]) => ({ x, y }))), [model]);
  const f = fit(lines.flat(), width, height);
  const S = (p: P) => ({ x: f.ox + p.x * f.scale, y: f.oy - p.y * f.scale });
  const at = model.stations.find((s) => s.station >= station) ?? model.stations[model.stations.length - 1];
  return (
    <Frame width={width} height={height} label={label}>
      <path d={path(lines[3].map(S))} fill="none" stroke="#a0783c" strokeWidth={0.8} strokeDasharray="3 2" />
      <path d={path(lines[4].map(S))} fill="none" stroke="#a0783c" strokeWidth={0.8} strokeDasharray="3 2" />
      <path d={path(lines[1].map(S))} fill="none" stroke="#3f3f46" strokeWidth={1.2} />
      <path d={path(lines[2].map(S))} fill="none" stroke="#3f3f46" strokeWidth={1.2} />
      <path d={path(lines[0].map(S))} fill="none" stroke="#b91c1c" strokeWidth={1} strokeDasharray="6 2 1 2" />
      {at ? (() => {
        const a = S({ x: at.top[0][0], y: at.top[0][1] }), b = S({ x: at.top[at.top.length - 1][0], y: at.top[at.top.length - 1][1] });
        return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2563eb" strokeWidth={1.5} />;
      })() : null}
    </Frame>
  );
}

export function ProfilePreview({ model, terrain, width, height, label, station }: { model: CorridorModel; terrain: Tin | null; width: number; height: number; label: string; station: number }) {
  const ground = useMemo(() => {
    if (!terrain) return [];
    const t = new Terrain(terrain);
    return model.stations.flatMap((s) => { const z = t.elevationAt(s.origin[0], s.origin[1]); return z === null ? [] : [{ x: s.station, y: z }]; });
  }, [model, terrain]);
  const grade = model.stations.map((s) => ({ x: s.station, y: s.origin[2] }));
  const f = fit([...grade, ...ground], width, height, 14, false);
  const sy = (height - 28) / Math.max(Math.max(...[...grade, ...ground].map((p) => p.y)) - Math.min(...[...grade, ...ground].map((p) => p.y)), 1e-6);
  const minY = Math.min(...[...grade, ...ground].map((p) => p.y));
  const S = (p: P) => ({ x: f.ox + p.x * f.scale, y: height - 14 - (p.y - minY) * sy });
  const x = f.ox + station * f.scale;
  return (
    <Frame width={width} height={height} label={label}>
      {ground.length ? <path d={path(ground.map(S))} fill="none" stroke="#15803d" strokeWidth={1} /> : null}
      <path d={path(grade.map(S))} fill="none" stroke="#b91c1c" strokeWidth={1.4} />
      <line x1={x} y1={10} x2={x} y2={height - 10} stroke="#2563eb" strokeWidth={1} strokeDasharray="3 2" />
      <text x={6} y={12} fontSize={9} fill="#71717a">{formatStation(model.alignment.startStation)}</text>
      <text x={width - 6} y={12} fontSize={9} fill="#71717a" textAnchor="end">{formatStation(model.alignment.endStation)}</text>
    </Frame>
  );
}

export function SectionPreview({ model, terrain, width, height, label, station, layers, caption }: {
  model: CorridorModel; terrain: Tin | null; width: number; height: number; label: string; station: number; layers: { color: string; thickness: number }[];
  /** The text written in the corner: the station and the two cross slopes. */
  caption: (station: string, left: string, right: string) => string;
}) {
  const st = model.stations.find((s) => s.station >= station) ?? model.stations[model.stations.length - 1];
  const section = useMemo(() => {
    if (!st) return null;
    const right = [Math.sin(st.direction), -Math.cos(st.direction)];
    const o = (p: readonly number[]) => (p[0] - st.origin[0]) * right[0] + (p[1] - st.origin[1]) * right[1];
    const top = st.top.map((p) => ({ x: o(p), y: p[2] }));
    const dl = st.daylightLeft ? { x: o(st.daylightLeft), y: st.daylightLeft[2] } : null;
    const dr = st.daylightRight ? { x: o(st.daylightRight), y: st.daylightRight[2] } : null;
    const span = Math.max(Math.abs(dl?.x ?? top[0].x), Math.abs(dr?.x ?? top[top.length - 1].x)) + 3;
    const ground: P[] = [];
    if (terrain) {
      const t = new Terrain(terrain);
      for (let x = -span; x <= span; x += span / 40) {
        const z = t.elevationAt(st.origin[0] + right[0] * x, st.origin[1] + right[1] * x);
        if (z !== null) ground.push({ x, y: z });
      }
    }
    return { top, dl, dr, ground };
  }, [st, terrain]);
  if (!st || !section) return null;
  const depth = layers.reduce((s, l) => s + l.thickness, 0);
  const parts = model.componentsAt(st.station).flatMap((c) => c.loops.flat().map(([x, y]) => ({ x, y })));
  const all = [...parts, ...section.top, ...section.ground, ...(section.dl ? [section.dl] : []), ...(section.dr ? [section.dr] : []), ...section.top.map((p) => ({ x: p.x, y: p.y - depth }))];
  const f = fit(all, width, height);
  const S = (p: P) => ({ x: f.ox + p.x * f.scale, y: f.oy - p.y * f.scale });
  let above = 0;
  return (
    <Frame width={width} height={height} label={label}>
      {layers.map((l, i) => {
        const below = above + l.thickness;
        const ring = [...section.top.map((p) => ({ x: p.x, y: p.y - above })), ...[...section.top].reverse().map((p) => ({ x: p.x, y: p.y - below }))];
        above = below;
        return <path key={i} d={path(ring.map(S)) + 'Z'} fill={l.color} stroke="#27272a" strokeWidth={0.5} />;
      })}
      {model.componentsAt(st.station).map((c) => (
        <path key={c.id} d={c.loops.map((l) => path(l.map(([x, y]) => S({ x, y }))) + 'Z').join('')} fillRule="evenodd" fill={c.color} fillOpacity={0.8} stroke="#27272a" strokeWidth={0.6} />
      ))}
      {section.ground.length ? <path d={path(section.ground.map(S))} fill="none" stroke="#15803d" strokeWidth={1.2} /> : null}
      {section.dl ? <line {...xy(S(section.top[0]), S(section.dl))} stroke="#a0783c" strokeWidth={1} /> : null}
      {section.dr ? <line {...xy(S(section.top[section.top.length - 1]), S(section.dr))} stroke="#a0783c" strokeWidth={1} /> : null}
      <text x={6} y={12} fontSize={9} fill="#71717a">{caption(formatStation(st.station), st.slopes.left.toFixed(1), st.slopes.right.toFixed(1))}</text>
    </Frame>
  );
}

const xy = (a: P, b: P) => ({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
