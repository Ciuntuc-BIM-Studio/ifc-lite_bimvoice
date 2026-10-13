/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Annotation commands: TEXT, LEADER, DIMALIGNED, DIMLINEAR, DIMRADIUS,
 * DIMDIAMETER, DIMANGULAR, LEVEL, AXIS and HATCH. Annotations are entities like
 * any drafted geometry, so selection, move / copy / rotate / mirror / erase
 * and undo work on them unchanged.
 */

import { editDrafts, newDraft } from '../draft-store';
import { paperUnitOf, styleBook, styledParams } from '@/project/drafting-standards';
import { resolveAxis, resolveText } from '../styles';
import { dimensionLayout, entitySkeleton, nextAxisLabel } from '../annotation';
import { findPattern } from '../hatch/library';
import { regionAt } from '../hatch/region';
import { applyOrtho } from '../input';
import type { AnnotationShape, AxisShape, DraftShape, Pt } from '../types';
import type { DraftCommandDef, DraftContext, StepResult } from './types';

function add(ctx: DraftContext, shape: AnnotationShape): void {
  // The current style, and an override when the height was typed differently.
  const params = styledParams(ctx.viewId, shape, { textStyle: ctx.settings.currentTextStyle, dimStyle: ctx.settings.currentDimStyle, axisStyle: ctx.settings.currentAxisStyle });
  editDrafts({ add: [newDraft(ctx.viewId, ctx.layerId, shape, params)] });
}

const skeleton = (shape: AnnotationShape): DraftShape[] => entitySkeleton(shape);

export const textCommand: DraftCommandDef = {
  id: 'text',
  aliases: ['TEXT', 'T', 'DT', 'MTEXT'],
  labelKey: 'drafting.cmd.text',
  create(ctx) {
    let at: Pt | null = null;
    return {
      prompt: () => ({ key: at ? 'drafting.prompt.enterText' : 'drafting.prompt.textPoint', params: { height: ctx.settings.textHeight } }),
      input: () => 'point',
      basePoint: () => null,
      onPoint(p) {
        at = p;
        return 'continue';
      },
      wantsValue: () => !at,
      onValue(h) {
        if (h > 0) ctx.settings.textHeight = h;
        return 'continue';
      },
      wantsText: () => at !== null,
      onText(text): StepResult {
        if (at && text) add(ctx, { type: 'text', p: at, text, height: ctx.settings.textHeight, rotation: 0 });
        return 'done';
      },
      preview: (cursor) => (at ? [] : skeleton({ type: 'text', p: cursor, text: 'Text', height: ctx.settings.textHeight, rotation: 0 })),
    };
  },
};

/**
 * LEADER: the arrow point, then the elbow (the inclined segment, any
 * direction), then the landing — held horizontal or vertical from the elbow,
 * with both directions shown as guides — and the text. Enter after the elbow
 * writes the text there (a single segment); F (free) before the landing lets
 * it take any direction.
 */
export const leaderCommand: DraftCommandDef = {
  id: 'leader',
  aliases: ['LEADER', 'LE', 'MLEADER'],
  labelKey: 'drafting.cmd.leader',
  create(ctx) {
    const pts: Pt[] = [];
    let asking = false;
    let free = false;
    const landing = (p: Pt): Pt => (pts.length === 2 && !free ? applyOrtho(pts[1], p) : p);
    return {
      prompt: () => ({ key: asking ? 'drafting.prompt.enterText' : pts.length === 0 ? 'drafting.prompt.leaderTip' : pts.length === 1 ? 'drafting.prompt.leaderElbow' : 'drafting.prompt.leaderLanding' }),
      input: () => 'point',
      basePoint: () => pts.at(-1) ?? null,
      onPoint(p) {
        if (asking) return 'continue';
        pts.push(landing(p));
        if (pts.length === 3) asking = true;
        return 'continue';
      },
      onKeyword(word) {
        if (word === 'F' && pts.length === 2) { free = true; return 'continue'; }
        return undefined;
      },
      onEnter() {
        if (pts.length < 2) return 'done';
        asking = true;
        return 'continue';
      },
      wantsText: () => asking,
      onText(text) {
        if (pts.length >= 2) add(ctx, { type: 'leader', pts: [...pts], text, height: ctx.settings.textHeight });
        return 'done';
      },
      preview(cursor) {
        if (!pts.length || asking) return [];
        const shapes: DraftShape[] = [{ type: 'polyline', pts: [...pts, landing(cursor)], closed: false }];
        if (pts.length === 2 && !free) {
          // The landing's two directions through the elbow.
          const e = pts[1], r = ctx.settings.textHeight * 30;
          shapes.push({ type: 'line', a: { x: e.x - r, y: e.y }, b: { x: e.x + r, y: e.y } }, { type: 'line', a: { x: e.x, y: e.y - r }, b: { x: e.x, y: e.y + r } });
        }
        return shapes;
      },
    };
  },
};

/**
 * DIMALIGNED / DIMLINEAR: two points, then where the dimension line goes —
 * and then, continued by default, each further point adds the next
 * dimension on the same line, measured the same way (Enter ends). S at the
 * start makes a single dimension.
 */
function linearDim(variant: 'aligned' | 'linear'): DraftCommandDef {
  return {
    id: variant === 'aligned' ? 'dimaligned' : 'dimlinear',
    aliases: variant === 'aligned' ? ['DIMALIGNED', 'DAL', 'DIM'] : ['DIMLINEAR', 'DLI'],
    labelKey: variant === 'aligned' ? 'drafting.cmd.dimAligned' : 'drafting.cmd.dimLinear',
    create(ctx) {
      const pts: Pt[] = [];
      let single = false;
      // Once the first dimension is placed: its line, its direction, the last point.
      let chain: { at: Pt; dir: Pt; last: Pt } | null = null;
      const shape = (at: Pt): AnnotationShape => ({ type: 'dimension', variant, a: pts[0], b: pts[1], at, height: ctx.settings.textHeight });
      const next = (p: Pt): AnnotationShape => ({ type: 'dimension', variant, a: chain!.last, b: p, at: chain!.at, dir: chain!.dir, height: ctx.settings.textHeight });
      return {
        prompt: () => ({ key: chain ? 'drafting.prompt.dimNext' : pts.length === 0 ? 'drafting.prompt.dimFirst' : pts.length === 1 ? 'drafting.prompt.dimSecond' : 'drafting.prompt.dimLine' }),
        input: () => 'point',
        basePoint: () => chain?.last ?? pts.at(-1) ?? null,
        onPoint(p) {
          if (chain) {
            if (Math.hypot(p.x - chain.last.x, p.y - chain.last.y) < 1e-9) return 'continue';
            add(ctx, next(p));
            chain.last = p;
            return 'continue';
          }
          if (pts.length < 2) {
            pts.push(p);
            return 'continue';
          }
          const first = shape(p);
          add(ctx, first);
          if (single) return 'done';
          // The next dimensions keep this one's line and direction.
          const line = dimensionLayout(first as Extract<AnnotationShape, { type: 'dimension' }>).lines[2];
          const d = { x: line.b.x - line.a.x, y: line.b.y - line.a.y };
          const len = Math.hypot(d.x, d.y);
          const dir = len > 1e-9 ? { x: d.x / len, y: d.y / len } : { x: 1, y: 0 };
          chain = { at: p, dir, last: pts[1] };
          return 'continue';
        },
        onKeyword(word) {
          if (word === 'S' && pts.length === 0 && !chain) { single = true; return 'continue'; }
          return undefined;
        },
        onEnter: () => 'done',
        preview(cursor) {
          if (chain) return skeleton(next(cursor));
          if (pts.length === 1) return [{ type: 'line', a: pts[0], b: cursor }];
          if (pts.length === 2) return skeleton(shape(cursor));
          return [];
        },
      };
    },
  };
}

export const dimAlignedCommand = linearDim('aligned');
export const dimLinearCommand = linearDim('linear');

/** DIMRADIUS / DIMDIAMETER: pick a circle or arc, then where the label goes. */
function radialDim(diameter: boolean): DraftCommandDef {
  return {
    id: diameter ? 'dimdiameter' : 'dimradius',
    aliases: diameter ? ['DIMDIAMETER', 'DDI'] : ['DIMRADIUS', 'DRA'],
    labelKey: diameter ? 'drafting.cmd.dimDiameter' : 'drafting.cmd.dimRadius',
    create(ctx) {
      let circle: { c: Pt; r: number } | null = null;
      const shape = (at: Pt): AnnotationShape => ({ type: 'radial', c: (circle as { c: Pt }).c, r: (circle as { r: number }).r, at, diameter, height: ctx.settings.textHeight });
      return {
        prompt: () => ({ key: circle ? 'drafting.prompt.dimLine' : 'drafting.prompt.pickCircle' }),
        input: () => (circle ? 'point' : 'pick'),
        basePoint: () => circle?.c ?? null,
        onPick(entity) {
          if (entity.shape.type === 'circle' || entity.shape.type === 'arc') circle = { c: entity.shape.c, r: entity.shape.r };
          else ctx.say('drafting.msg.pickCircle');
          return 'continue';
        },
        onPoint(p) {
          if (!circle) return 'continue';
          add(ctx, shape(p));
          return 'done';
        },
        preview: (cursor) => (circle ? skeleton(shape(cursor)) : []),
      };
    },
  };
}

export const dimRadiusCommand = radialDim(false);
export const dimDiameterCommand = radialDim(true);

export const dimAngularCommand: DraftCommandDef = {
  id: 'dimangular',
  aliases: ['DIMANGULAR', 'DAN'],
  labelKey: 'drafting.cmd.dimAngular',
  create(ctx) {
    const pts: Pt[] = [];
    const shape = (at: Pt): AnnotationShape => ({ type: 'angular', c: pts[0], a: pts[1], b: pts[2], at, height: ctx.settings.textHeight });
    return {
      prompt: () => ({ key: ['drafting.prompt.angleVertex', 'drafting.prompt.angleFirst', 'drafting.prompt.angleSecond', 'drafting.prompt.dimLine'][pts.length] as 'drafting.prompt.dimLine' }),
      input: () => 'point',
      basePoint: () => pts[0] ?? null,
      onPoint(p) {
        if (pts.length < 3) {
          pts.push(p);
          return 'continue';
        }
        add(ctx, shape(p));
        return 'done';
      },
      preview(cursor) {
        if (pts.length === 1 || pts.length === 2) return [{ type: 'polyline', pts: [...pts.slice(1), pts[0], cursor].slice(-3), closed: false }];
        if (pts.length === 3) return dimensionLayout(shape(cursor) as Extract<AnnotationShape, { type: 'angular' }>).lines.map((l) => ({ type: 'line' as const, a: l.a, b: l.b }));
        return [];
      },
    };
  },
};

/**
 * LEVEL: the reference point (what is measured — snap to the floor line),
 * then where the symbol sits: anywhere, on any horizontal line, linked to
 * its reference; Enter puts it on the reference. The mark is parametric:
 * moving its reference, the storey or the section re-measures it.
 */
export const levelCommand: DraftCommandDef = {
  id: 'level',
  aliases: ['LEVEL', 'LV', 'SPOTELEVATION'],
  labelKey: 'drafting.cmd.level',
  create(ctx) {
    let ref: Pt | null = null;
    const mark = (p: Pt, r: Pt): AnnotationShape => ({ type: 'level', p, ref: r, value: ctx.levelAt(r), height: ctx.settings.textHeight });
    return {
      prompt: () => ({ key: ref ? 'drafting.prompt.levelSymbol' : 'drafting.prompt.levelPoint' }),
      input: () => 'point',
      basePoint: () => ref,
      onPoint(p) {
        if (!ref) { ref = p; return 'continue'; }
        add(ctx, mark(p, ref));
        ref = null;
        return 'continue';
      },
      onEnter() {
        if (!ref) return 'done';
        add(ctx, mark(ref, ref));
        ref = null;
        return 'continue';
      },
      preview: (cursor) => skeleton(ref ? mark(cursor, ref) : { type: 'level', p: cursor, value: 0, height: ctx.settings.textHeight }),
    };
  },
};

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

export const hatchCommand: DraftCommandDef = {
  id: 'hatch',
  aliases: ['HATCH', 'H', 'BHATCH'],
  labelKey: 'drafting.cmd.hatch',
  create(ctx) {
    let pending: 'scale' | 'angle' = 'scale';
    const s = ctx.settings;
    return {
      prompt: () => ({ key: 'drafting.prompt.hatchPoint', params: { pattern: s.hatchPattern, scale: s.hatchScale, angle: s.hatchAngle } }),
      input: () => 'point',
      basePoint: () => null,
      onPoint(p) {
        const loops = regionAt(p, ctx.closedLoops());
        if (!loops) {
          ctx.say('drafting.msg.noRegion');
          return 'continue';
        }
        add(ctx, { type: 'hatch', loops, pattern: s.hatchPattern, scale: s.hatchScale, angle: s.hatchAngle });
        return 'continue';
      },
      wantsValue: () => true,
      onValue(v) {
        if (pending === 'angle') s.hatchAngle = v;
        else if (v > 0) s.hatchScale = v;
        pending = 'scale';
        return 'continue';
      },
      onKeyword(word) {
        if (word === 'A' || word === 'ANGLE') {
          pending = 'angle';
          return 'continue';
        }
        if (word === 'S' || word === 'SCALE') {
          pending = 'scale';
          return 'continue';
        }
        const pattern = findPattern(word);
        if (!pattern) return undefined;
        s.hatchPattern = pattern.name;
        return 'continue';
      },
      onEnter: () => 'done',
    };
  },
};

export const ANNOTATE_COMMANDS: readonly DraftCommandDef[] = [
  textCommand, leaderCommand, dimAlignedCommand, dimLinearCommand, dimRadiusCommand, dimDiameterCommand,
  dimAngularCommand, levelCommand, axisCommand, hatchCommand,
];
