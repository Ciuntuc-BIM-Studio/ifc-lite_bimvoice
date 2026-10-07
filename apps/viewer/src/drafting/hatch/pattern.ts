/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hatch pattern model + reader/writer for the public `.pat` text format.
 *
 *   *NAME, optional description
 *   angle, x-origin, y-origin, delta-x, delta-y [, dash1, dash2, ...]
 *
 * `;` starts a comment. Angles are degrees; delta-x is the shift along the
 * line direction between successive parallel lines, delta-y the spacing
 * perpendicular to them. Dashes: positive = drawn, negative = gap, 0 = dot,
 * none = continuous. Units are abstract (the caller scales them).
 *
 * A pattern without any line family is read back as a SOLID fill
 * (`solid: true`), which is also how solid patterns are serialized.
 */

import type { Pt } from '../types';

export interface HatchLineFamily {
  angleDeg: number;
  origin: Pt;
  deltaX: number;
  deltaY: number;
  dashes: number[];
}

export interface HatchPattern {
  name: string;
  description: string;
  families: HatchLineFamily[];
  solid?: boolean;
}

function parseNumber(token: string): number | null {
  const t = token.replace(/\s+/g, '');
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function stripComment(line: string): string {
  const i = line.indexOf(';');
  return (i >= 0 ? line.slice(0, i) : line).trim();
}

function finishPattern(p: HatchPattern): HatchPattern {
  if (p.families.length === 0) p.solid = true;
  return p;
}

/** Parse `.pat` text. Bad lines are skipped and reported with their line number. */
export function parsePat(text: string): { patterns: HatchPattern[]; errors: string[] } {
  const patterns: HatchPattern[] = [];
  const errors: string[] = [];
  let current: HatchPattern | null = null;
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = stripComment(lines[i].replace(/^﻿/, ''));
    if (line === '') continue;
    if (line.startsWith('*')) {
      if (current) patterns.push(finishPattern(current));
      const body = line.slice(1);
      const comma = body.indexOf(',');
      const name = (comma >= 0 ? body.slice(0, comma) : body).trim().toUpperCase();
      const description = comma >= 0 ? body.slice(comma + 1).trim() : '';
      if (name === '') {
        errors.push(`line ${lineNo}: pattern header without a name`);
        current = null;
        continue;
      }
      current = { name, description, families: [] };
      continue;
    }
    if (!current) {
      errors.push(`line ${lineNo}: line family outside of a pattern (missing *NAME header)`);
      continue;
    }
    const tokens = line.split(',');
    if (tokens.length > 0 && tokens[tokens.length - 1].trim() === '') tokens.pop();
    const nums: number[] = [];
    let bad: string | null = null;
    for (const tok of tokens) {
      const v = parseNumber(tok);
      if (v === null) {
        bad = tok.trim();
        break;
      }
      nums.push(v);
    }
    if (bad !== null) {
      errors.push(`line ${lineNo}: invalid number "${bad}"`);
      continue;
    }
    if (nums.length < 5) {
      errors.push(`line ${lineNo}: expected at least 5 values (angle, x, y, delta-x, delta-y), got ${nums.length}`);
      continue;
    }
    current.families.push({
      angleDeg: nums[0],
      origin: { x: nums[1], y: nums[2] },
      deltaX: nums[3],
      deltaY: nums[4],
      dashes: nums.slice(5),
    });
  }
  if (current) patterns.push(finishPattern(current));
  return { patterns, errors };
}

function fmt(v: number): string {
  return Object.is(v, -0) ? '0' : String(v);
}

/** Serialize patterns to `.pat` text (round-trips through {@link parsePat}). */
export function serializePat(patterns: readonly HatchPattern[]): string {
  const out: string[] = [];
  for (const p of patterns) {
    const desc = p.description.replace(/[\r\n;]+/g, ' ').trim();
    out.push(desc ? `*${p.name.toUpperCase()}, ${desc}` : `*${p.name.toUpperCase()}`);
    if (p.solid) continue;
    for (const f of p.families) {
      const vals = [f.angleDeg, f.origin.x, f.origin.y, f.deltaX, f.deltaY, ...f.dashes];
      out.push(vals.map(fmt).join(', '));
    }
  }
  return out.join('\n') + '\n';
}
