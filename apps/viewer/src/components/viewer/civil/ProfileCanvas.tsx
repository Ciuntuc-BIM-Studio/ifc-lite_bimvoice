/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A structure profile drawn to scale on a 0.1 m grid: the outline and its
 * holes, the origin (insertion point) cross, the named anchors, the overall
 * width and height. On a custom profile the vertices are dragged with the
 * mouse (snapped to the centimetre) and a double click on an edge inserts a
 * vertex there.
 */

import { useRef, useState } from 'react';
import { profileBounds, type P2, type StructureProfile } from '@ifc-lite/create';

interface Props {
  profile: StructureProfile;
  width: number;
  height: number;
  /** Absent: read only. */
  onChange?: (p: StructureProfile) => void;
  /** The vertex highlighted (outline index). */
  active?: number | null;
  onActive?: (i: number | null) => void;
  /** Written in the corner (the overall size). */
  caption?: string;
}

type Hit = { loop: number; index: number };

export function ProfileCanvas({ profile, width, height, onChange, active, onActive, caption }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Hit | null>(null);
  const b = profileBounds(profile);
  const minX = Math.min(b.minX, 0), maxX = Math.max(b.maxX, 0), minY = Math.min(b.minY, 0), maxY = Math.max(b.maxY, 0);
  const pad = 28;
  const scale = Math.min((width - 2 * pad) / Math.max(maxX - minX, 0.1), (height - 2 * pad) / Math.max(maxY - minY, 0.1));
  const ox = (width - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (height + (maxY - minY) * scale) / 2 + minY * scale;
  const S = (p: P2) => ({ x: ox + p[0] * scale, y: oy - p[1] * scale });
  const toModel = (e: React.PointerEvent | React.MouseEvent): P2 => {
    const r = svg.current!.getBoundingClientRect();
    const snap = (v: number) => Math.round(v * 100) / 100;
    return [snap((e.clientX - r.left - ox) / scale), snap((oy - (e.clientY - r.top)) / scale)];
  };
  const loops = [profile.outer, ...profile.holes];
  const path = (l: readonly P2[]) => l.map((p, i) => `${i ? 'L' : 'M'}${S(p).x.toFixed(1)},${S(p).y.toFixed(1)}`).join('') + 'Z';
  const grid: number[] = [];
  const step = scale * 0.1 >= 6 ? 0.1 : scale >= 6 ? 1 : 5;
  for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) grid.push(x);
  const gridY: number[] = [];
  for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) gridY.push(y);
  const editable = !!onChange && !profile.preset;
  const setPoint = (h: Hit, p: P2) => {
    const next = loops.map((l, k) => (k === h.loop ? l.map((q, i) => (i === h.index ? p : q)) : l));
    onChange!({ ...profile, outer: next[0], holes: next.slice(1) });
  };
  const insertOnEdge = (e: React.MouseEvent, loop: number, edge: number) => {
    if (!editable) return;
    const at = toModel(e);
    const next = loops.map((l, k) => (k === loop ? [...l.slice(0, edge + 1), at, ...l.slice(edge + 1)] : l));
    onChange!({ ...profile, outer: next[0], holes: next.slice(1) });
  };
  return (
    <svg ref={svg} width={width} height={height} aria-hidden="true" className="rounded-md border border-zinc-200 bg-white text-zinc-900 dark:border-zinc-700"
      onPointerMove={(e) => { if (drag && editable) setPoint(drag, toModel(e)); }}
      onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
      {grid.map((x) => <line key={`x${x}`} x1={S([x, 0]).x} x2={S([x, 0]).x} y1={0} y2={height} stroke="#f1f5f9" />)}
      {gridY.map((y) => <line key={`y${y}`} y1={S([0, y]).y} y2={S([0, y]).y} x1={0} x2={width} stroke="#f1f5f9" />)}
      <path d={loops.map(path).join('')} fillRule="evenodd" fill={profile.color} fillOpacity={0.55} stroke="#27272a" strokeWidth={1.2} />
      {loops.map((l, k) => l.map((p, i) => {
        const q = l[(i + 1) % l.length], a = S(p), c = S(q);
        return <line key={`e${k}:${i}`} x1={a.x} y1={a.y} x2={c.x} y2={c.y} stroke="transparent" strokeWidth={8} onDoubleClick={(e) => insertOnEdge(e, k, i)} />;
      }))}
      <g stroke="#dc2626" strokeWidth={1.2}>
        <line x1={S([0, 0]).x - 8} x2={S([0, 0]).x + 8} y1={S([0, 0]).y} y2={S([0, 0]).y} />
        <line y1={S([0, 0]).y - 8} y2={S([0, 0]).y + 8} x1={S([0, 0]).x} x2={S([0, 0]).x} />
      </g>
      {profile.anchors.map((a) => (
        <g key={a.name}>
          <circle cx={S(a.at).x} cy={S(a.at).y} r={3.5} fill="#2563eb" />
          <text x={S(a.at).x + 5} y={S(a.at).y - 5} fontSize={9} fill="#1d4ed8">{a.name}</text>
        </g>
      ))}
      {editable ? loops.map((l, k) => l.map((p, i) => (
        <rect key={`v${k}:${i}`} x={S(p).x - 4} y={S(p).y - 4} width={8} height={8}
          fill={k === 0 && i === active ? '#2563eb' : '#fff'} stroke="#2563eb" strokeWidth={1.2} style={{ cursor: 'move' }}
          onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag({ loop: k, index: i }); onActive?.(k === 0 ? i : null); }} />
      ))) : null}
      {caption ? <text x={6} y={height - 6} fontSize={9} fill="#71717a">{caption}</text> : null}
    </svg>
  );
}
