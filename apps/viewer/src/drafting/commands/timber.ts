/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * TBEAM, TPOST, TBRACE: timber members on any view (`project/timber-members.ts`).
 *
 * - TBEAM: two points per beam; the next beam starts where the last ended
 *   (Enter starts afresh). On a plan its top is Z above the level.
 * - TPOST: on a plan one click per post, from B to H above the level; on a
 *   section or an elevation two clicks, its foot and its head.
 * - TBRACE: two points; on a plan its ends are Z and H above the level.
 *
 * W / D type the section (mm), a strength class (C24, GL24h…) is typed as
 * itself, Z / H / B the heights (m). The settings are shared by the three
 * tools and kept for the next run.
 */

import type { TimberMemberKind } from '@ifc-lite/create';
import { createTimberMember, timberSettings, type TimberSettings } from '@/project/timber-members';
import type { TranslationKey } from '@/i18n';
import type { Pt } from '../types';
import type { DraftCommandDef } from './types';
import { trussCommand } from './truss';

type Field = 'width' | 'depth' | 'beamTop' | 'postBase' | 'postTop' | 'braceFrom' | 'braceTo';

const GRADE = /^(C\d{2}|D\d{2}|GL\d{2}[HC])$/i;

/** The height a keyword sets, per tool. */
const HEIGHTS: Record<TimberMemberKind, Partial<Record<string, Field>>> = {
  beam: { Z: 'beamTop' },
  post: { B: 'postBase', H: 'postTop', Z: 'postTop' },
  brace: { Z: 'braceFrom', H: 'braceTo' },
};

const section = (s: TimberSettings) => `${Math.round(s.width * 1000)}×${Math.round(s.depth * 1000)}`;
/** A typed class as written: C24, D30, GL24h. */
const grade = (word: string) => (/^GL/i.test(word) ? `GL${word.slice(2, 4)}${word.slice(4).toLowerCase()}` : word.toUpperCase());

function timberCommand(kind: TimberMemberKind, id: string, aliases: string[], labelKey: TranslationKey): DraftCommandDef {
  return {
    id,
    aliases,
    labelKey,
    create(ctx) {
      const s = timberSettings;
      let first: Pt | null = null;
      let pending: Field | null = null;
      const onPlan = () => ctx.view()?.kind === 'plan';
      const make = (a: Pt, b: Pt | null) => {
        const view = ctx.view();
        const plane = ctx.plane();
        if (!view || !plane) { ctx.say('drafting.msg.noWorkPlane'); return; }
        const result = createTimberMember(view, plane, kind, a, b);
        if (result.ok) ctx.say('timber.msg.made', { ifcClass: result.ifcClass, name: result.name });
        else ctx.say('timber.msg.failed', { detail: result.error });
      };
      return {
        prompt: () => {
          const params = { section: section(s), grade: s.grade, base: s.postBase, top: s.postTop };
          if (pending) return { key: `timber.field.${pending}` as TranslationKey };
          if (kind === 'post') return { key: onPlan() ? 'timber.prompt.post' : first ? 'timber.prompt.second' : 'timber.prompt.postSection', params };
          return { key: first ? 'timber.prompt.second' : 'timber.prompt.first', params };
        },
        input: () => 'point',
        basePoint: () => first,
        onPoint(p) {
          if (kind === 'post' && onPlan()) { make(p, null); return 'continue'; }
          if (!first) { first = p; return 'continue'; }
          make(first, p);
          // Beams chain end to end; a post or a brace starts afresh.
          first = kind === 'beam' ? p : null;
          return 'continue';
        },
        wantsValue: () => pending !== null,
        onValue(v) {
          if (pending === 'width' || pending === 'depth') { if (v > 0) s[pending] = v / 1000; }
          else if (pending) s[pending] = v;
          pending = null;
          return 'continue';
        },
        onKeyword(word) {
          if (word === 'W') { pending = 'width'; return 'continue'; }
          if (word === 'D') { pending = 'depth'; return 'continue'; }
          const height = HEIGHTS[kind][word];
          if (height) { pending = height; return 'continue'; }
          if (GRADE.test(word)) { s.grade = grade(word); return 'continue'; }
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
}

export const timberBeamCommand = timberCommand('beam', 'tbeam', ['TBEAM', 'TB'], 'drafting.cmd.tbeam');
export const timberPostCommand = timberCommand('post', 'tpost', ['TPOST', 'TP'], 'drafting.cmd.tpost');
export const timberBraceCommand = timberCommand('brace', 'tbrace', ['TBRACE', 'BRACE'], 'drafting.cmd.tbrace');

export const TIMBER_COMMANDS: readonly DraftCommandDef[] = [timberBeamCommand, timberPostCommand, timberBraceCommand, trussCommand];
