/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * TRUSS: a timber truss from two points, its bottom chord (the span), drawn
 * with the current truss settings (`project/timber-trusses.ts`). The shape
 * and pattern are typed as words (PITCHED / MONO / FLAT, FINK / PRATT / HOWE
 * / WARREN / KING / QUEEN); R the rise, N the panels, O the overhang, Z the
 * bottom chord's height above the level on a plan. One truss per two clicks.
 */

import type { TrussPattern, TrussShape } from '@ifc-lite/create';
import type { TranslationKey } from '@/i18n';
import { createTruss, trussDefaults } from '@/project/timber-trusses';
import type { Pt } from '../types';
import type { DraftCommandDef } from './types';

type Field = 'rise' | 'panels' | 'overhang' | 'base';

const SHAPES: Record<string, TrussShape> = { PITCHED: 'pitched', MONO: 'mono', FLAT: 'flat' };
const PATTERNS: Record<string, TrussPattern> = { FINK: 'fink', PRATT: 'pratt', HOWE: 'howe', WARREN: 'warren', KING: 'king', QUEEN: 'queen' };
const FIELDS: Record<string, Field> = { R: 'rise', N: 'panels', O: 'overhang', Z: 'base' };

export const trussCommand: DraftCommandDef = {
  id: 'truss',
  aliases: ['TRUSS', 'TR'],
  labelKey: 'drafting.cmd.truss',
  create(ctx) {
    const d = trussDefaults;
    let first: Pt | null = null;
    let pending: Field | null = null;
    return {
      prompt: () => {
        if (pending) return { key: `timber.field.${pending}` as TranslationKey };
        if (first) return { key: 'timber.prompt.trussEnd' };
        return { key: 'timber.prompt.truss', params: { shape: d.shape.toUpperCase(), pattern: d.pattern.toUpperCase(), rise: d.rise, panels: d.panels } };
      },
      input: () => 'point',
      basePoint: () => first,
      onPoint(p) {
        if (!first) { first = p; return 'continue'; }
        const view = ctx.view();
        const plane = ctx.plane();
        const a = first;
        first = null;
        if (!view || !plane) { ctx.say('drafting.msg.noWorkPlane'); return 'continue'; }
        const result = createTruss(view, plane, a, p);
        if (result.ok) ctx.say('timber.msg.truss');
        else ctx.say('timber.msg.failed', { detail: result.error });
        return 'continue';
      },
      wantsValue: () => pending !== null,
      onValue(v) {
        if (pending === 'panels') { if (v >= 2) d.panels = Math.round(v); }
        else if (pending === 'rise') { if (v > 0) d.rise = v; }
        else if (pending) d[pending] = v;
        pending = null;
        return 'continue';
      },
      onKeyword(word) {
        if (SHAPES[word]) { d.shape = SHAPES[word]; return 'continue'; }
        if (PATTERNS[word]) { d.pattern = PATTERNS[word]; return 'continue'; }
        if (FIELDS[word]) { pending = FIELDS[word]; return 'continue'; }
        return undefined;
      },
      onEnter() {
        if (pending) { pending = null; return 'continue'; }
        if (!first) return 'done';
        first = null;
        return 'continue';
      },
      preview: (cursor) => (first ? [{ type: 'line', a: first, b: cursor }] : []),
    };
  },
};
