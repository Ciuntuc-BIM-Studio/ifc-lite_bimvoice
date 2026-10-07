/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Modify commands on a selection: ERASE, MOVE, COPY, ROTATE, MIRROR.
 * (Pick-driven edits — OFFSET, TRIM, EXTEND, FILLET — are in `edit.ts`.)
 */

import { editDrafts, newDraft } from '../draft-store';
import { entitySkeleton, mirrorEntity, rotateEntity, translateEntity } from '../annotation';
import { sub } from '../vec';
import type { DraftEntity, DraftShape, Pt } from '../types';
import type { DraftCommandDef, DraftContext } from './types';

function selected(ctx: DraftContext): DraftEntity[] {
  const ids = ctx.selection();
  return ctx.entities().filter((e) => ids.has(e.id));
}

export const eraseCommand: DraftCommandDef = {
  id: 'erase',
  aliases: ['ERASE', 'E', 'DELETE'],
  labelKey: 'drafting.cmd.erase',
  needsSelection: true,
  create(ctx) {
    return {
      prompt: () => ({ key: 'drafting.prompt.selectObjects' }),
      input: () => 'pick',
      basePoint: () => null,
      onEnter() {
        const ids = new Set(selected(ctx).map((e) => e.id));
        if (ids.size) {
          editDrafts({ remove: ids });
          ctx.say('drafting.msg.erased', { count: ids.size });
        }
        ctx.setSelection(new Set());
        return 'done';
      },
    };
  },
};

/** MOVE and COPY: a base point, then a destination (COPY repeats until Enter). */
function displaceCommand(id: 'move' | 'copy'): DraftCommandDef {
  return {
    id,
    aliases: id === 'move' ? ['MOVE', 'M'] : ['COPY', 'CO', 'CP'],
    labelKey: id === 'move' ? 'drafting.cmd.move' : 'drafting.cmd.copy',
    needsSelection: true,
    create(ctx) {
      const items = selected(ctx);
      let base: Pt | null = null;
      return {
        prompt: () => ({ key: base ? 'drafting.prompt.secondPoint' : 'drafting.prompt.basePoint' }),
        input: () => 'point',
        basePoint: () => base,
        onPoint(p) {
          if (!base) {
            base = p;
            return 'continue';
          }
          const d = sub(p, base);
          if (id === 'move') {
            editDrafts({ update: new Map(items.map((e) => [e.id, translateEntity(e.shape, d)])) });
            return 'done';
          }
          editDrafts({ add: items.map((e) => newDraft(ctx.viewId, e.layerId, translateEntity(e.shape, d), { ...e.params })) });
          return 'continue';
        },
        onEnter: () => 'done',
        preview: (cursor) => (base ? items.flatMap((e) => entitySkeleton(translateEntity(e.shape, sub(cursor, base as Pt)))) : []),
      };
    },
  };
}

export const moveCommand = displaceCommand('move');
export const copyCommand = displaceCommand('copy');

export const rotateCommand: DraftCommandDef = {
  id: 'rotate',
  aliases: ['ROTATE', 'RO'],
  labelKey: 'drafting.cmd.rotate',
  needsSelection: true,
  create(ctx) {
    const items = selected(ctx);
    let base: Pt | null = null;
    const apply = (angle: number) => {
      if (base) editDrafts({ update: new Map(items.map((e) => [e.id, rotateEntity(e.shape, base as Pt, angle)])) });
      return 'done' as const;
    };
    const angleTo = (p: Pt) => (base ? Math.atan2(p.y - base.y, p.x - base.x) : 0);
    return {
      prompt: () => ({ key: base ? 'drafting.prompt.rotationAngle' : 'drafting.prompt.basePoint' }),
      input: () => 'point',
      basePoint: () => base,
      onPoint(p) {
        if (!base) {
          base = p;
          return 'continue';
        }
        return apply(angleTo(p));
      },
      wantsValue: () => base !== null,
      // Typed degrees are counter-clockwise ON SCREEN.
      onValue: (deg) => apply(((deg * Math.PI) / 180) * ctx.orientation),
      preview: (cursor) => (base ? items.flatMap((e) => entitySkeleton(rotateEntity(e.shape, base as Pt, angleTo(cursor)))) : []),
    };
  },
};

export const mirrorCommand: DraftCommandDef = {
  id: 'mirror',
  aliases: ['MIRROR', 'MI'],
  labelKey: 'drafting.cmd.mirror',
  needsSelection: true,
  create(ctx) {
    const items = selected(ctx);
    let first: Pt | null = null;
    let eraseSource = false;
    return {
      prompt: () => ({ key: first ? 'drafting.prompt.mirrorSecond' : 'drafting.prompt.mirrorFirst', params: { erase: eraseSource ? 'Y' : 'N' } }),
      input: () => 'point',
      basePoint: () => first,
      onPoint(p) {
        if (!first) {
          first = p;
          return 'continue';
        }
        const mirrored = items.map((e) => newDraft(ctx.viewId, e.layerId, mirrorEntity(e.shape, first as Pt, p), { ...e.params }));
        editDrafts({ add: mirrored, remove: eraseSource ? new Set(items.map((e) => e.id)) : undefined });
        return 'done';
      },
      onKeyword(word) {
        if (word !== 'E' && word !== 'ERASE') return undefined;
        eraseSource = !eraseSource;
        return 'continue';
      },
      preview: (cursor): DraftShape[] => (first ? items.flatMap((e) => entitySkeleton(mirrorEntity(e.shape, first as Pt, cursor))) : []),
    };
  },
};

export const MODIFY_COMMANDS: readonly DraftCommandDef[] = [eraseCommand, moveCommand, copyCommand, rotateCommand, mirrorCommand];
