/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Annotation commands: TEXT, LEADER, DIMALIGNED, DIMLINEAR, DIMRADIUS,
 * DIMDIAMETER, DIMANGULAR, LEVEL and HATCH. Annotations are entities like
 * any drafted geometry, so selection, move / copy / rotate / mirror / erase
 * and undo work on them unchanged.
 */

import { editDrafts, newDraft } from '../draft-store';
import { dimensionLayout, entitySkeleton } from '../annotation';
import { findPattern } from '../hatch/library';
import { regionAt } from '../hatch/region';
import type { AnnotationShape, DraftShape, Pt } from '../types';
import type { DraftCommandDef, DraftContext, StepResult } from './types';

function add(ctx: DraftContext, shape: AnnotationShape): void {
  editDrafts({ add: [newDraft(ctx.viewId, ctx.layerId, shape)] });
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

export const leaderCommand: DraftCommandDef = {
  id: 'leader',
  aliases: ['LEADER', 'LE', 'MLEADER'],
  labelKey: 'drafting.cmd.leader',
  create(ctx) {
    const pts: Pt[] = [];
    let asking = false;
    return {
      prompt: () => ({ key: asking ? 'drafting.prompt.enterText' : pts.length === 0 ? 'drafting.prompt.leaderTip' : 'drafting.prompt.leaderNext' }),
      input: () => 'point',
      basePoint: () => pts.at(-1) ?? null,
      onPoint(p) {
        if (!asking) pts.push(p);
        return 'continue';
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
      preview: (cursor) => (pts.length && !asking ? [{ type: 'polyline', pts: [...pts, cursor], closed: false }] : []),
    };
  },
};

/** DIMALIGNED / DIMLINEAR: two points, then where the dimension line goes. */
function linearDim(variant: 'aligned' | 'linear'): DraftCommandDef {
  return {
    id: variant === 'aligned' ? 'dimaligned' : 'dimlinear',
    aliases: variant === 'aligned' ? ['DIMALIGNED', 'DAL', 'DIM'] : ['DIMLINEAR', 'DLI'],
    labelKey: variant === 'aligned' ? 'drafting.cmd.dimAligned' : 'drafting.cmd.dimLinear',
    create(ctx) {
      const pts: Pt[] = [];
      const shape = (at: Pt): AnnotationShape => ({ type: 'dimension', variant, a: pts[0], b: pts[1], at, height: ctx.settings.textHeight });
      return {
        prompt: () => ({ key: pts.length === 0 ? 'drafting.prompt.dimFirst' : pts.length === 1 ? 'drafting.prompt.dimSecond' : 'drafting.prompt.dimLine' }),
        input: () => 'point',
        basePoint: () => pts.at(-1) ?? null,
        onPoint(p) {
          if (pts.length < 2) {
            pts.push(p);
            return 'continue';
          }
          add(ctx, shape(p));
          return 'done';
        },
        preview(cursor) {
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

export const levelCommand: DraftCommandDef = {
  id: 'level',
  aliases: ['LEVEL', 'LV', 'SPOTELEVATION'],
  labelKey: 'drafting.cmd.level',
  create(ctx) {
    return {
      prompt: () => ({ key: 'drafting.prompt.levelPoint' }),
      input: () => 'point',
      basePoint: () => null,
      onPoint(p) {
        add(ctx, { type: 'level', p, value: ctx.levelAt(p), height: ctx.settings.textHeight });
        return 'continue';
      },
      onEnter: () => 'done',
      preview: (cursor) => skeleton({ type: 'level', p: cursor, value: 0, height: ctx.settings.textHeight }),
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
  dimAngularCommand, levelCommand, hatchCommand,
];
