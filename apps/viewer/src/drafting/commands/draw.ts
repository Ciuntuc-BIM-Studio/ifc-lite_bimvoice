/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Draw commands: LINE, PLINE, RECTANGLE, CIRCLE, ARC (3 points).
 */

import { editDrafts, newDraft } from '../draft-store';
import { dist } from '../vec';
import type { DraftShape, Pt } from '../types';
import type { DraftCommandDef, DraftContext, StepResult } from './types';

function add(ctx: DraftContext, shapes: DraftShape[]): void {
  editDrafts({ add: shapes.map((s) => newDraft(ctx.viewId, ctx.layerId, s)) });
}

const isClose = (word: string) => word === 'C' || word === 'CLOSE';

export const lineCommand: DraftCommandDef = {
  id: 'line',
  aliases: ['LINE', 'L'],
  labelKey: 'drafting.cmd.line',
  create(ctx) {
    const pts: Pt[] = [];
    return {
      prompt: () => ({ key: pts.length === 0 ? 'drafting.prompt.firstPoint' : 'drafting.prompt.nextPointOrClose' }),
      input: () => 'point',
      basePoint: () => pts.at(-1) ?? null,
      onPoint(p) {
        const last = pts.at(-1);
        if (last && dist(last, p) > 1e-9) add(ctx, [{ type: 'line', a: last, b: p }]);
        pts.push(p);
        return 'continue';
      },
      onKeyword(word): StepResult | undefined {
        if (!isClose(word) || pts.length < 3) return undefined;
        add(ctx, [{ type: 'line', a: pts[pts.length - 1], b: pts[0] }]);
        return 'done';
      },
      onEnter: () => 'done',
      preview: (cursor) => (pts.length ? [{ type: 'line', a: pts[pts.length - 1], b: cursor }] : []),
    };
  },
};

export const polylineCommand: DraftCommandDef = {
  id: 'polyline',
  aliases: ['PLINE', 'PL'],
  labelKey: 'drafting.cmd.polyline',
  create(ctx) {
    const pts: Pt[] = [];
    const finish = (closed: boolean): StepResult => {
      if (pts.length >= 2) add(ctx, [{ type: 'polyline', pts: [...pts], closed: closed && pts.length >= 3 }]);
      return 'done';
    };
    return {
      prompt: () => ({ key: pts.length === 0 ? 'drafting.prompt.firstPoint' : 'drafting.prompt.nextPointOrClose' }),
      input: () => 'point',
      basePoint: () => pts.at(-1) ?? null,
      onPoint(p) {
        const last = pts.at(-1);
        if (!last || dist(last, p) > 1e-9) pts.push(p);
        return 'continue';
      },
      onKeyword(word) {
        if (isClose(word)) return finish(true);
        if (word === 'U' || word === 'UNDO') {
          pts.pop();
          return 'continue';
        }
        return undefined;
      },
      onEnter: () => finish(false),
      preview: (cursor) => (pts.length ? [{ type: 'polyline', pts: [...pts, cursor], closed: false }] : []),
    };
  },
};

function rectangle(a: Pt, b: Pt): DraftShape {
  return { type: 'polyline', pts: [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], closed: true };
}

export const rectangleCommand: DraftCommandDef = {
  id: 'rectangle',
  aliases: ['RECTANGLE', 'REC', 'RECT'],
  labelKey: 'drafting.cmd.rectangle',
  create(ctx) {
    let first: Pt | null = null;
    return {
      prompt: () => ({ key: first ? 'drafting.prompt.oppositeCorner' : 'drafting.prompt.firstCorner' }),
      input: () => 'point',
      basePoint: () => first,
      onPoint(p) {
        if (!first) {
          first = p;
          return 'continue';
        }
        if (Math.abs(p.x - first.x) > 1e-9 && Math.abs(p.y - first.y) > 1e-9) add(ctx, [rectangle(first, p)]);
        return 'done';
      },
      preview: (cursor) => (first ? [rectangle(first, cursor)] : []),
    };
  },
};

export const circleCommand: DraftCommandDef = {
  id: 'circle',
  aliases: ['CIRCLE', 'C'],
  labelKey: 'drafting.cmd.circle',
  create(ctx) {
    let center: Pt | null = null;
    const finish = (r: number): StepResult => {
      if (center && r > 1e-9) add(ctx, [{ type: 'circle', c: center, r }]);
      return 'done';
    };
    return {
      prompt: () => ({ key: center ? 'drafting.prompt.radius' : 'drafting.prompt.center' }),
      input: () => 'point',
      basePoint: () => center,
      onPoint(p) {
        if (!center) {
          center = p;
          return 'continue';
        }
        return finish(dist(center, p));
      },
      wantsValue: () => center !== null,
      onValue: (r) => finish(r),
      preview: (cursor) => (center ? [{ type: 'circle', c: center, r: Math.max(dist(center, cursor), 1e-9) }] : []),
    };
  },
};

/** The arc through three points, counter-clockwise in drawing space; `null` when collinear. */
export function arcThrough(p1: Pt, p2: Pt, p3: Pt): DraftShape | null {
  const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
  if (Math.abs(d) < 1e-12) return null;
  const s1 = p1.x * p1.x + p1.y * p1.y;
  const s2 = p2.x * p2.x + p2.y * p2.y;
  const s3 = p3.x * p3.x + p3.y * p3.y;
  const c = {
    x: (s1 * (p2.y - p3.y) + s2 * (p3.y - p1.y) + s3 * (p1.y - p2.y)) / d,
    y: (s1 * (p3.x - p2.x) + s2 * (p1.x - p3.x) + s3 * (p2.x - p1.x)) / d,
  };
  const r = dist(c, p1);
  const a1 = Math.atan2(p1.y - c.y, p1.x - c.x);
  const a3 = Math.atan2(p3.y - c.y, p3.x - c.x);
  // p1 → p2 → p3 counter-clockwise when the turn is left.
  const ccw = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x) > 0;
  return ccw ? { type: 'arc', c, r, start: a1, end: a3 } : { type: 'arc', c, r, start: a3, end: a1 };
}

export const arcCommand: DraftCommandDef = {
  id: 'arc',
  aliases: ['ARC', 'A'],
  labelKey: 'drafting.cmd.arc',
  create(ctx) {
    const pts: Pt[] = [];
    return {
      prompt: () => ({ key: pts.length === 0 ? 'drafting.prompt.arcStart' : pts.length === 1 ? 'drafting.prompt.arcSecond' : 'drafting.prompt.arcEnd' }),
      input: () => 'point',
      basePoint: () => pts.at(-1) ?? null,
      onPoint(p) {
        pts.push(p);
        if (pts.length < 3) return 'continue';
        const arc = arcThrough(pts[0], pts[1], pts[2]);
        if (arc) add(ctx, [arc]);
        return 'done';
      },
      preview(cursor) {
        if (pts.length === 1) return [{ type: 'line', a: pts[0], b: cursor }];
        if (pts.length === 2) return [arcThrough(pts[0], pts[1], cursor) ?? { type: 'line', a: pts[0], b: cursor }];
        return [];
      },
    };
  },
};

export const DRAW_COMMANDS: readonly DraftCommandDef[] = [lineCommand, polylineCommand, rectangleCommand, circleCommand, arcCommand];
