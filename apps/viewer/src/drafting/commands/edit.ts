/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Pick-driven edits: OFFSET, TRIM, EXTEND, FILLET. Each repeats on new
 * picks until Enter / Escape, like the CAD commands they are named after.
 */

import { editDrafts, newDraft } from '../draft-store';
import { shapeBounds } from '../curves';
import { offsetShape } from '../offset';
import { extendShape, trimShape } from '../trim';
import { filletLines } from '../fillet';
import { isGeometry, type DraftEntity, type DraftShape, type Pt } from '../types';
import type { DraftCommandDef, DraftContext } from './types';

/** Every other drafted shape of the view plus the generated drawing lines around `shape`. */
function boundariesFor(ctx: DraftContext, entity: DraftEntity, margin: number): DraftShape[] {
  if (!isGeometry(entity.shape)) return [];
  const b = shapeBounds(entity.shape);
  const others: DraftShape[] = [];
  for (const e of ctx.entities()) if (e.id !== entity.id && isGeometry(e.shape)) others.push(e.shape);
  const min = { x: b.min.x - margin, y: b.min.y - margin };
  const max = { x: b.max.x + margin, y: b.max.y + margin };
  return [...others, ...ctx.referenceShapes(min, max)];
}

export const offsetCommand: DraftCommandDef = {
  id: 'offset',
  aliases: ['OFFSET', 'O'],
  labelKey: 'drafting.cmd.offset',
  create(ctx) {
    let distance = ctx.settings.offsetDistance;
    let source: DraftEntity | null = null;
    return {
      prompt: () => {
        if (distance === null) return { key: 'drafting.prompt.offsetDistance' };
        return source ? { key: 'drafting.prompt.offsetSide' } : { key: 'drafting.prompt.offsetPick', params: { distance } };
      },
      input: () => (distance !== null && !source ? 'pick' : 'point'),
      basePoint: () => null,
      wantsValue: () => !source,
      onValue(v) {
        if (v <= 0) return 'continue';
        distance = v;
        ctx.settings.offsetDistance = v;
        return 'continue';
      },
      onPick(entity) {
        if (isGeometry(entity.shape)) source = entity;
        return 'continue';
      },
      onPoint(p) {
        if (!source || distance === null || !isGeometry(source.shape)) return 'continue';
        const shape = offsetShape(source.shape, distance, p);
        if (shape) editDrafts({ add: [newDraft(ctx.viewId, source.layerId, shape, { ...source.params })] });
        source = null;
        return 'continue';
      },
      onEnter: () => 'done',
      preview: (cursor) => {
        if (!source || distance === null || !isGeometry(source.shape)) return [];
        const shape = offsetShape(source.shape, distance, cursor);
        return shape ? [shape] : [];
      },
    };
  },
};

/** TRIM / EXTEND: pick the piece to cut away / the end to lengthen. */
function cutCommand(id: 'trim' | 'extend'): DraftCommandDef {
  return {
    id,
    aliases: id === 'trim' ? ['TRIM', 'TR'] : ['EXTEND', 'EX'],
    labelKey: id === 'trim' ? 'drafting.cmd.trim' : 'drafting.cmd.extend',
    create(ctx) {
      return {
        prompt: () => ({ key: id === 'trim' ? 'drafting.prompt.trimPick' : 'drafting.prompt.extendPick' }),
        input: () => 'pick',
        basePoint: () => null,
        onPick(entity, at) {
          if (!isGeometry(entity.shape)) return 'continue';
          // Extend looks far beyond the entity for its boundary; trim only needs its own extent.
          const margin = id === 'trim' ? 0.01 : 1000;
          const boundaries = boundariesFor(ctx, entity, margin);
          if (id === 'trim') {
            const pieces = trimShape(entity.shape, boundaries, at);
            if (!pieces) {
              ctx.say('drafting.msg.nothingToTrim');
              return 'continue';
            }
            editDrafts({
              remove: new Set([entity.id]),
              add: pieces.map((shape) => newDraft(ctx.viewId, entity.layerId, shape, { ...entity.params })),
            });
            return 'continue';
          }
          const extended = extendShape(entity.shape, boundaries, at);
          if (!extended) ctx.say('drafting.msg.noBoundary');
          else editDrafts({ update: new Map([[entity.id, extended]]) });
          return 'continue';
        },
        onEnter: () => 'done',
      };
    },
  };
}

export const trimCommand = cutCommand('trim');
export const extendCommand = cutCommand('extend');

type LineShape = Extract<DraftShape, { type: 'line' }>;

export const filletCommand: DraftCommandDef = {
  id: 'fillet',
  aliases: ['FILLET', 'F'],
  labelKey: 'drafting.cmd.fillet',
  create(ctx) {
    let first: { entity: DraftEntity; at: Pt } | null = null;
    return {
      prompt: () => ({ key: first ? 'drafting.prompt.filletSecond' : 'drafting.prompt.filletFirst', params: { radius: ctx.settings.filletRadius } }),
      input: () => 'pick',
      basePoint: () => null,
      wantsValue: () => !first,
      onValue(r) {
        if (r >= 0) ctx.settings.filletRadius = r;
        return 'continue';
      },
      onPick(entity, at) {
        if (entity.shape.type !== 'line') {
          ctx.say('drafting.msg.filletLinesOnly');
          return 'continue';
        }
        if (!first) {
          first = { entity, at };
          return 'continue';
        }
        if (entity.id === first.entity.id) return 'continue';
        const result = filletLines(first.entity.shape as LineShape, first.at, entity.shape as LineShape, at, ctx.settings.filletRadius);
        if (!result) {
          ctx.say('drafting.msg.filletFailed');
          first = null;
          return 'continue';
        }
        editDrafts({
          update: new Map([[first.entity.id, result.first], [entity.id, result.second]]),
          add: result.arc ? [newDraft(ctx.viewId, first.entity.layerId, result.arc, { ...first.entity.params })] : [],
        });
        return 'done';
      },
    };
  },
};

export const EDIT_COMMANDS: readonly DraftCommandDef[] = [offsetCommand, trimCommand, extendCommand, filletCommand];
