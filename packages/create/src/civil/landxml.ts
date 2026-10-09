/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * LandXML 1.2 exchange for the civil module: a corridor's alignment
 * (CoordGeom of Line / Spiral / Curve), its profile (ProfAlign of PVI /
 * ParaCurve) and TIN surfaces out; alignments (back to PIs: each curve's PI
 * is where its tangents meet), profiles and surfaces in. Coordinates in
 * LandXML are written northing then easting — our y then x — in metres.
 * The reader is a small self-contained XML tokenizer, so it runs anywhere.
 */

import { buildAlignment, type AlignmentPI, type HorizontalAlignmentSpec } from './alignment.js';
import type { ProfilePVI, VerticalProfileSpec } from './profile.js';
import type { Tin, V3 } from './tin.js';

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

/** A minimal XML parser: elements, attributes, text; namespaces prefixes dropped. */
export function parseXml(text: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) stack[stack.length - 1].text += m[1];
    else if (m[2] !== undefined) { if (stack.length > 1) stack.pop(); }
    else if (m[3] !== undefined) {
      const attrs: Record<string, string> = {};
      const ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let am: RegExpExecArray | null;
      while ((am = ar.exec(m[4] ?? '')) !== null) attrs[am[1].replace(/^.*:/, '')] = decode(am[2] ?? am[3] ?? '');
      const node: XmlNode = { name: m[3].replace(/^.*:/, ''), attrs, children: [], text: '' };
      stack[stack.length - 1].children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) stack[stack.length - 1].text += decode(m[6]);
  }
  return root;
}

const find = (n: XmlNode, name: string): XmlNode | undefined => n.children.find((c) => c.name === name);
const all = (n: XmlNode, name: string): XmlNode[] => n.children.filter((c) => c.name === name);
const nums = (s: string | undefined): number[] => (s ?? '').trim().split(/\s+/).filter(Boolean).map(Number);
/** A LandXML point: "northing easting [elevation]" → [x, y, z]. */
const pt = (s: string | undefined): V3 | null => {
  const v = nums(s);
  return v.length >= 2 && v.slice(0, 2).every(Number.isFinite) ? [v[1], v[0], Number.isFinite(v[2]) ? v[2] : 0] : null;
};
const f = (v: number) => (Math.abs(v) < 1e-12 ? '0' : Number(v.toFixed(6)).toString());
const ne = (x: number, y: number) => `${f(y)} ${f(x)}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export interface LandXmlAlignmentOut {
  name: string;
  spec: HorizontalAlignmentSpec;
  profile?: VerticalProfileSpec | null;
}

export interface LandXmlSurfaceOut {
  name: string;
  tin: Tin;
}

/** A LandXML 1.2 document with the given surfaces and alignments. */
export function writeLandXml(doc: { surfaces?: LandXmlSurfaceOut[]; alignments?: LandXmlAlignmentOut[]; application?: string }): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.landxml.org/schema/LandXML-1.2 http://www.landxml.org/schema/LandXML-1.2/LandXML-1.2.xsd" version="1.2" date="' + new Date().toISOString().slice(0, 10) + '" time="' + new Date().toISOString().slice(11, 19) + '">',
    '  <Units><Metric linearUnit="meter" areaUnit="squareMeter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="HPA" angularUnit="decimal degrees" directionUnit="decimal degrees"/></Units>',
    `  <Application name="${esc(doc.application ?? 'ifc-lite')}" version="1.0"/>`,
  ];
  if (doc.surfaces?.length) {
    lines.push('  <Surfaces>');
    for (const s of doc.surfaces) {
      lines.push(`    <Surface name="${esc(s.name)}"><Definition surfType="TIN">`, '      <Pnts>');
      s.tin.points.forEach((p, i) => lines.push(`        <P id="${i + 1}">${ne(p[0], p[1])} ${f(p[2])}</P>`));
      lines.push('      </Pnts>', '      <Faces>');
      for (const [a, b, c] of s.tin.triangles) lines.push(`        <F>${a + 1} ${b + 1} ${c + 1}</F>`);
      lines.push('      </Faces>', '    </Definition></Surface>');
    }
    lines.push('  </Surfaces>');
  }
  if (doc.alignments?.length) {
    lines.push('  <Alignments>');
    for (const a of doc.alignments) {
      const built = buildAlignment(a.spec);
      lines.push(`    <Alignment name="${esc(a.name)}" length="${f(built.length)}" staStart="${f(built.startStation)}">`, '      <CoordGeom>');
      for (const seg of built.segments) {
        const end = built.pointAt(seg.station + seg.length);
        const start = seg.start;
        const rot = seg.turn > 0 ? 'ccw' : 'cw';
        if (seg.kind === 'line') lines.push(`        <Line length="${f(seg.length)}"><Start>${ne(start[0], start[1])}</Start><End>${ne(end.x, end.y)}</End></Line>`);
        else if (seg.kind === 'arc') {
          const c = seg.turn / seg.radius;
          const centre: [number, number] = [start[0] - Math.sin(seg.direction) / c, start[1] + Math.cos(seg.direction) / c];
          lines.push(`        <Curve rot="${rot}" radius="${f(seg.radius)}" length="${f(seg.length)}"><Start>${ne(start[0], start[1])}</Start><Center>${ne(centre[0], centre[1])}</Center><End>${ne(end.x, end.y)}</End></Curve>`);
        } else {
          const rIn = seg.kind === 'spiralIn' ? 'INF' : f(seg.radius), rOut = seg.kind === 'spiralIn' ? f(seg.radius) : 'INF';
          const pi = built.pointAt(seg.station);
          const tIn = [Math.cos(pi.direction), Math.sin(pi.direction)], tOut = [Math.cos(end.direction), Math.sin(end.direction)];
          const det = tIn[0] * tOut[1] - tIn[1] * tOut[0];
          const t = Math.abs(det) > 1e-12 ? ((end.x - start[0]) * tOut[1] - (end.y - start[1]) * tOut[0]) / det : seg.length / 2;
          lines.push(`        <Spiral length="${f(seg.length)}" radiusStart="${rIn}" radiusEnd="${rOut}" rot="${rot}" spiType="clothoid"><Start>${ne(start[0], start[1])}</Start><PI>${ne(start[0] + tIn[0] * t, start[1] + tIn[1] * t)}</PI><End>${ne(end.x, end.y)}</End></Spiral>`);
        }
      }
      lines.push('      </CoordGeom>');
      if (a.profile?.pvis.length) {
        lines.push(`      <Profile name="${esc(a.name)}"><ProfAlign name="${esc(a.name)}">`);
        const pvis = [...a.profile.pvis].sort((x, y) => x.station - y.station);
        pvis.forEach((p, i) => {
          const L = i > 0 && i < pvis.length - 1 ? p.length ?? 0 : 0;
          lines.push(L > 0 ? `        <ParaCurve length="${f(L)}">${f(p.station)} ${f(p.elevation)}</ParaCurve>` : `        <PVI>${f(p.station)} ${f(p.elevation)}</PVI>`);
        });
        lines.push('      </ProfAlign></Profile>');
      }
      lines.push('    </Alignment>');
    }
    lines.push('  </Alignments>');
  }
  lines.push('</LandXML>', '');
  return lines.join('\n');
}

export interface LandXmlAlignmentIn {
  name: string;
  spec: HorizontalAlignmentSpec;
  profile: VerticalProfileSpec | null;
  warnings: string[];
}

export interface LandXmlDocument {
  surfaces: LandXmlSurfaceOut[];
  alignments: LandXmlAlignmentIn[];
}

interface Piece { kind: 'line' | 'curve' | 'spiral'; start: V3; end: V3; pi: V3 | null; radius: number; length: number; dirStart: number | null; dirEnd: number | null; rIn: number; rOut: number }

function intersect(p: V3, d: number, q: V3, e: number): V3 | null {
  const det = Math.cos(d) * Math.sin(e) - Math.sin(d) * Math.cos(e);
  if (Math.abs(det) < 1e-12) return null;
  const t = ((q[0] - p[0]) * Math.sin(e) - (q[1] - p[1]) * Math.cos(e)) / det;
  return [p[0] + Math.cos(d) * t, p[1] + Math.sin(d) * t, 0];
}

function readPieces(geom: XmlNode): Piece[] {
  const out: Piece[] = [];
  for (const el of geom.children) {
    const start = pt(find(el, 'Start')?.text), end = pt(find(el, 'End')?.text);
    if (!start || !end) continue;
    const length = Number(el.attrs.length) || Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (el.name === 'Line') out.push({ kind: 'line', start, end, pi: null, radius: Infinity, length, dirStart: Math.atan2(end[1] - start[1], end[0] - start[0]), dirEnd: Math.atan2(end[1] - start[1], end[0] - start[0]), rIn: Infinity, rOut: Infinity });
    else if (el.name === 'Curve') {
      const radius = Number(el.attrs.radius);
      const centre = pt(find(el, 'Center')?.text);
      const turn = el.attrs.rot === 'cw' ? -1 : 1;
      let dirStart: number | null = null, dirEnd: number | null = null;
      if (centre) {
        dirStart = Math.atan2(start[1] - centre[1], start[0] - centre[0]) + turn * Math.PI / 2;
        dirEnd = Math.atan2(end[1] - centre[1], end[0] - centre[0]) + turn * Math.PI / 2;
      }
      const pi = pt(find(el, 'PI')?.text) ?? (dirStart !== null && dirEnd !== null ? intersect(start, dirStart, end, dirEnd) : null);
      out.push({ kind: 'curve', start, end, pi, radius, length, dirStart, dirEnd, rIn: radius, rOut: radius });
    } else if (el.name === 'Spiral') {
      const rIn = el.attrs.radiusStart === 'INF' ? Infinity : Number(el.attrs.radiusStart), rOut = el.attrs.radiusEnd === 'INF' ? Infinity : Number(el.attrs.radiusEnd);
      const pi = pt(find(el, 'PI')?.text);
      const dirStart = pi ? Math.atan2(pi[1] - start[1], pi[0] - start[0]) : null, dirEnd = pi ? Math.atan2(end[1] - pi[1], end[0] - pi[0]) : null;
      out.push({ kind: 'spiral', start, end, pi, radius: Math.min(rIn, rOut), length, dirStart, dirEnd, rIn, rOut });
    }
  }
  return out;
}

/** PIs from a CoordGeom: each curve (with its spirals) contributes the point where its outer tangents meet. */
function pisFromPieces(pieces: Piece[], warnings: string[]): AlignmentPI[] {
  if (pieces.length === 0) return [];
  const pis: AlignmentPI[] = [{ x: pieces[0].start[0], y: pieces[0].start[1] }];
  let i = 0;
  while (i < pieces.length) {
    const p = pieces[i];
    if (p.kind === 'line') { i++; continue; }
    // Gather spiral-in, curve, spiral-out.
    let spiralIn = 0, spiralOut = 0, radius = p.radius;
    let first = p, last = p;
    if (p.kind === 'spiral' && p.rIn === Infinity) { spiralIn = p.length; i++; const c = pieces[i]; if (c?.kind === 'curve') { radius = c.radius; last = c; i++; } }
    else if (p.kind === 'curve') i++;
    else { warnings.push('A spiral without a leading tangent was read as a plain curve'); i++; }
    const next = pieces[i];
    if (next?.kind === 'spiral' && next.rOut === Infinity) { spiralOut = next.length; last = next; i++; }
    const dIn = first.dirStart, dOut = last.dirEnd;
    const pi = first.pi && last === first ? first.pi : dIn !== null && dOut !== null ? intersect(first.start, dIn, last.end, dOut) : null;
    if (!pi) { warnings.push('A curve without tangent directions was skipped'); continue; }
    if (pieces[i]?.kind === 'curve') warnings.push('Compound curves are approximated by separate PIs');
    pis.push({ x: pi[0], y: pi[1], radius, spiralIn: spiralIn || undefined, spiralOut: spiralOut || undefined });
  }
  const end = pieces[pieces.length - 1].end;
  pis.push({ x: end[0], y: end[1] });
  return pis;
}

export function readLandXml(text: string): LandXmlDocument {
  const root = find(parseXml(text), 'LandXML');
  if (!root) throw new Error('Not a LandXML document');
  const surfaces: LandXmlSurfaceOut[] = [];
  for (const s of all(find(root, 'Surfaces') ?? root, 'Surface')) {
    const def = find(s, 'Definition');
    if (!def) continue;
    const ids = new Map<string, number>();
    const points: V3[] = [];
    for (const p of all(find(def, 'Pnts') ?? def, 'P')) {
      const v = pt(p.text);
      if (!v) continue;
      ids.set(p.attrs.id ?? String(points.length + 1), points.length);
      points.push(v);
    }
    const triangles: [number, number, number][] = [];
    for (const fc of all(find(def, 'Faces') ?? def, 'F')) {
      if (fc.attrs.i === '1') continue;
      const [a, b, c] = fc.text.trim().split(/\s+/).map((id) => ids.get(id));
      if (a !== undefined && b !== undefined && c !== undefined) triangles.push([a, b, c]);
    }
    surfaces.push({ name: s.attrs.name ?? `Surface ${surfaces.length + 1}`, tin: { points, triangles } });
  }
  const alignments: LandXmlAlignmentIn[] = [];
  for (const a of all(find(root, 'Alignments') ?? root, 'Alignment')) {
    const warnings: string[] = [];
    const geom = find(a, 'CoordGeom');
    const pis = geom ? pisFromPieces(readPieces(geom), warnings) : [];
    if (pis.length < 2) continue;
    const startStation = Number(a.attrs.staStart) || 0;
    let profile: VerticalProfileSpec | null = null;
    const prof = find(find(a, 'Profile') ?? a, 'ProfAlign');
    if (prof) {
      const pvis: ProfilePVI[] = [];
      for (const c of prof.children) {
        const v = nums(c.text);
        if (v.length < 2) continue;
        if (c.name === 'PVI') pvis.push({ station: v[0], elevation: v[1] });
        else if (c.name === 'ParaCurve') pvis.push({ station: v[0], elevation: v[1], length: Number(c.attrs.length) || 0 });
        else if (c.name === 'CircCurve') { pvis.push({ station: v[0], elevation: v[1], length: Number(c.attrs.length) || 0 }); warnings.push('A circular vertical curve was read as a parabola of the same length'); }
      }
      if (pvis.length >= 2) profile = { pvis };
    }
    alignments.push({ name: a.attrs.name ?? `Alignment ${alignments.length + 1}`, spec: { pis, startStation }, profile, warnings });
  }
  return { surfaces, alignments };
}
