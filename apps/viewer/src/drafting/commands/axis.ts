/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { paperUnitOf, styleBook } from '@/project/drafting-standards';
import { nextAxisLabel } from '../annotation';
import { resolveAxis, resolveText } from '../styles';
import type { AxisShape, Pt } from '../types';
import type { DraftCommandDef, DraftContext } from './types';
import { add, skeleton } from './annotation-add';

const AXIS_KEYWORDS: Record<string, (s: DraftContext['settings']) => void> = {
  C: (s) => { s.axisBubble = 'circle'; }, CIRCLE: (s) => { s.axisBubble = 'circle'; },
  S: (s) => { s.axisBubble = 'square'; }, SQUARE: (s) => { s.axisBubble = 'square'; },
  BOTH: (s) => { s.axisEnds = 'both'; }, START: (s) => { s.axisEnds = 'start'; }, END: (s) => { s.axisEnds = 'end'; }, NONE: (s) => { s.axisEnds = 'none'; },
  DASHDOT: (s) => { s.axisLineType = 'dashdot'; }, DASHED: (s) => { s.axisLineType = 'dashed'; },
  DOTTED: (s) => { s.axisLineType = 'dotted'; }, CONTINUOUS: (s) => { s.axisLineType = 'continuous'; },
};

/**
 * AXIS: grid axis lines — two points each, drawn as the current axis type
 * (Drafting standards › Axis types: bubble, ends, size, line type, label text
 * style). Labels count on from one axis to the next (1, 2, 3… or A, B, C…);
 * T picks another type by name (its labels restart at the type's first
 * label), L types the next label. SIZE, C / S, BOTH / START / END / NONE and
 * DASHDOT / DASHED / DOTTED / CONTINUOUS draw this run's axes otherwise than
 * the type — each axis keeps those as its own overrides.
 */
export const axisCommand: DraftCommandDef = {
  id: 'axis',
  aliases: ['AXIS', 'AX', 'GRIDLINE'],
  labelKey: 'drafting.cmd.axis',
  create(ctx) {
    const s = ctx.settings;
    // A run starts from the type; the options typed below hold for this run only.
    s.axisBubble = null;
    s.axisEnds = null;
    s.axisSize = null;
    s.axisLineType = null;
    let start: Pt | null = null;
    let pending: 'label' | 'size' | 'type' | null = null;
    const type = () => resolveAxis(styleBook(), { axisStyle: s.currentAxisStyle });
    const shape = (a: Pt, b: Pt): AxisShape => {
      const t = type();
      const unit = paperUnitOf(ctx.viewId);
      return {
        type: 'axis', a, b, label: s.axisLabel, bubble: s.axisBubble ?? t.bubble, ends: s.axisEnds ?? t.ends,
        size: s.axisSize ?? t.size * unit, height: resolveText(styleBook(), { axisStyle: s.currentAxisStyle }).height * unit,
        lineType: s.axisLineType ?? t.lineType,
      };
    };
    return {
      prompt: () => {
        const t = type();
        return {
          key: pending === 'label' ? 'drafting.prompt.axisLabel' : pending === 'size' ? 'drafting.prompt.axisSize' : pending === 'type' ? 'drafting.prompt.axisType'
            : start ? 'drafting.prompt.axisEnd' : 'drafting.prompt.axisStart',
          params: { type: t.name, label: s.axisLabel, bubble: (s.axisBubble ?? t.bubble).toUpperCase(), ends: (s.axisEnds ?? t.ends).toUpperCase() },
        };
      },
      input: () => 'point',
      basePoint: () => start,
      onPoint(p) {
        if (!start) {
          start = p;
          return 'continue';
        }
        if (Math.hypot(p.x - start.x, p.y - start.y) < 1e-6) return 'continue';
        add(ctx, shape(start, p));
        s.axisLabel = nextAxisLabel(s.axisLabel);
        start = null;
        return 'continue';
      },
      wantsText: () => pending === 'label' || pending === 'type',
      onText(text) {
        const typed = text.trim();
        if (pending === 'type') {
          const found = (styleBook().axisStyles ?? []).find((a) => a.name.toLowerCase() === typed.toLowerCase());
          if (found) {
            s.currentAxisStyle = found.id;
            s.axisLabel = found.firstLabel;
          } else if (typed) ctx.say('drafting.msg.noAxisType', { name: typed });
        } else if (typed) s.axisLabel = typed;
        pending = null;
        return 'continue';
      },
      wantsValue: () => pending === 'size',
      onValue(v) {
        if (v > 0) s.axisSize = v;
        pending = null;
        return 'continue';
      },
      onKeyword(word) {
        if (word === 'L' || word === 'LABEL') { pending = 'label'; return 'continue'; }
        if (word === 'T' || word === 'TYPE') { pending = 'type'; return 'continue'; }
        if (word === 'SIZE' || word === 'D') { pending = 'size'; return 'continue'; }
        const set = AXIS_KEYWORDS[word];
        if (!set) return undefined;
        set(s);
        return 'continue';
      },
      onEnter() {
        // Enter drops a started axis; a second Enter ends the command.
        if (!start) return 'done';
        start = null;
        return 'continue';
      },
      preview: (cursor) => (start ? skeleton(shape(start, cursor)) : []),
    };
  },
};
