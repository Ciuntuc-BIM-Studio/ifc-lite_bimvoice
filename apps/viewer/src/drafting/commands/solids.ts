/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * SWEEP and REVOLVE: solids from drafted shapes (`project/swept-element.ts`).
 *
 * SWEEP — pick the path (line, polyline, arc or circle), then the closed
 * profile; the profile stands on the path as it looks on screen.
 * REVOLVE — pick the closed profile, then the axis (a line); a number sets
 * the angle in degrees (360 by default) before the axis is picked.
 * Either takes a class word (BEAM, RAILING, COLUMN… or IfcXxx) at any step.
 */

import { createSweptElement, pathPoints, revolveBuild, sweepBuild } from '@/project/swept-element';
import { setDraftParams } from '../draft-store';
import type { DraftEntity } from '../types';
import { ifcClassFromWord, shapeLoop } from './model';
import type { DraftCommandDef, DraftContext } from './types';

const loopOf = (e: DraftEntity) => (e.shape.type === 'polyline' || e.shape.type === 'circle' ? shapeLoop(e.shape) : null);

function finishLink(ctx: DraftContext, profile: DraftEntity, params: Record<string, string | number>, result: ReturnType<typeof createSweptElement>) {
  if (!result.ok) {
    ctx.say('drafting.msg.extrudeFailed', { detail: result.error });
    return;
  }
  setDraftParams(new Set([profile.id]), { ifcGlobalId: result.globalId, ifcModelId: result.modelId, ifcClass: result.ifcClass, ...params });
  ctx.say('drafting.msg.extruded', { ifcClass: result.ifcClass, guid: result.globalId });
}

export const sweepCommand: DraftCommandDef = {
  id: 'sweep',
  aliases: ['SWEEP', 'SW'],
  labelKey: 'drafting.cmd.sweep',
  create(ctx) {
    const s = ctx.settings;
    let path: DraftEntity | null = null;
    return {
      prompt: () => ({ key: path ? 'drafting.prompt.sweepProfile' : 'drafting.prompt.sweepPath', params: { ifcClass: s.extrudeClass } }),
      input: () => 'pick',
      basePoint: () => null,
      onKeyword(word) {
        const ifcClass = ifcClassFromWord(word);
        if (!ifcClass) return undefined;
        s.extrudeClass = ifcClass;
        return 'continue';
      },
      onPick(entity) {
        if (!path) {
          if (!pathPoints(entity) || entity.shape.type === 'text') {
            ctx.say('drafting.msg.notAPath');
            return 'continue';
          }
          path = entity;
          return 'continue';
        }
        const loop = loopOf(entity);
        const view = ctx.view(), plane = ctx.plane();
        if (!loop || entity.id === path.id) {
          ctx.say('drafting.msg.noRegion');
          return 'continue';
        }
        if (!view || !plane) {
          ctx.say('drafting.msg.noWorkPlane');
          return 'done';
        }
        if (entity.params.ifcGlobalId) {
          ctx.say('drafting.msg.alreadyLinked');
          return 'continue';
        }
        const build = sweepBuild(loop, pathPoints(path)!, plane);
        finishLink(ctx, entity, { solid: 'sweep', path: path.id }, createSweptElement(view, plane, loop, build, 'sweep', { ifcClass: s.extrudeClass }, entity.id));
        path = null;
        return 'continue';
      },
      onEnter: () => 'done',
    };
  },
};

export const revolveCommand: DraftCommandDef = {
  id: 'revolve',
  aliases: ['REVOLVE', 'REV'],
  labelKey: 'drafting.cmd.revolve',
  create(ctx) {
    const s = ctx.settings;
    let profile: DraftEntity | null = null;
    let angle = 360;
    return {
      prompt: () => ({ key: profile ? 'drafting.prompt.revolveAxis' : 'drafting.prompt.revolveProfile', params: { ifcClass: s.extrudeClass, angle } }),
      input: () => 'pick',
      basePoint: () => null,
      wantsValue: () => true,
      onValue(v) {
        if (v !== 0 && Math.abs(v) <= 360) angle = v;
        return 'continue';
      },
      onKeyword(word) {
        const ifcClass = ifcClassFromWord(word);
        if (!ifcClass) return undefined;
        s.extrudeClass = ifcClass;
        return 'continue';
      },
      onPick(entity) {
        if (!profile) {
          if (!loopOf(entity)) {
            ctx.say('drafting.msg.noRegion');
            return 'continue';
          }
          if (entity.params.ifcGlobalId) {
            ctx.say('drafting.msg.alreadyLinked');
            return 'continue';
          }
          profile = entity;
          return 'continue';
        }
        if (entity.shape.type !== 'line') {
          ctx.say('drafting.msg.notAnAxis');
          return 'continue';
        }
        const view = ctx.view(), plane = ctx.plane();
        if (!view || !plane) {
          ctx.say('drafting.msg.noWorkPlane');
          return 'done';
        }
        const loop = loopOf(profile)!;
        const build = revolveBuild(loop, [entity.shape.a, entity.shape.b], angle, plane);
        finishLink(ctx, profile, { solid: 'revolve', axis: entity.id, angle }, createSweptElement(view, plane, loop, build, 'revolve', { ifcClass: s.extrudeClass }, profile.id));
        profile = null;
        return 'continue';
      },
      onEnter: () => 'done',
    };
  },
};
