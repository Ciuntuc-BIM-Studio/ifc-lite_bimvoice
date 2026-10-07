/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ROOF: a closed contour on a floor plan becomes an IfcRoof — flat,
 * mono-pitch (rising from the contour's first edge), gable or hip (over a
 * rectangle). Click a closed drafted shape or inside a closed region; type
 * FLAT / MONO / GABLE / HIP, a pitch in degrees, or T and a thickness
 * (T0.3). The contour stays linked: editing it, or its roof parameters
 * (roofKind, slope, thickness, offset, eaveEdge), rebuilds the roof.
 */

import { createRoofElement } from '@/project/roof-element';
import { setDraftParams } from '../draft-store';
import { pickSource, shapeLoop } from './model';
import type { DraftCommandDef } from './types';

const KINDS = { FLAT: 'flat', MONO: 'mono', SHED: 'mono', GABLE: 'gable', HIP: 'hip' } as const;

export const roofCommand: DraftCommandDef = {
  id: 'roof',
  aliases: ['ROOF', 'RF'],
  labelKey: 'drafting.cmd.roof',
  create(ctx) {
    const s = ctx.settings;
    return {
      prompt: () => ({ key: 'drafting.prompt.roof', params: { kind: s.roofKind.toUpperCase(), slope: s.roofSlope, thickness: s.roofThickness } }),
      input: () => 'point',
      basePoint: () => null,
      wantsValue: () => true,
      onValue(v) {
        if (v >= 0 && v < 90) s.roofSlope = v;
        return 'continue';
      },
      onKeyword(word) {
        const upper = word.toUpperCase();
        const kind = KINDS[upper as keyof typeof KINDS];
        if (kind) {
          s.roofKind = kind;
          return 'continue';
        }
        const t = /^T(\d+(?:\.\d+)?)$/.exec(upper);
        if (t && Number(t[1]) > 0) {
          s.roofThickness = Number(t[1]);
          return 'continue';
        }
        return undefined;
      },
      onPoint(p) {
        const view = ctx.view();
        const plane = ctx.plane();
        if (!view || !plane) {
          ctx.say('drafting.msg.noWorkPlane');
          return 'continue';
        }
        const source = pickSource(ctx, p);
        const loop = source && (source.shape.type === 'polyline' || source.shape.type === 'circle') ? shapeLoop(source.shape) : null;
        if (!source || !loop) {
          ctx.say('drafting.msg.noRegion');
          return 'continue';
        }
        if (source.params.ifcGlobalId) {
          ctx.say('drafting.msg.alreadyLinked');
          return 'continue';
        }
        const spec = { kind: s.roofKind, slope: s.roofSlope, thickness: s.roofThickness, offset: 0, eaveEdge: 0 };
        const result = createRoofElement(view, plane, loop, spec, source.id);
        if (!result.ok) {
          ctx.say('drafting.msg.extrudeFailed', { detail: result.error });
          return 'continue';
        }
        setDraftParams(new Set([source.id]), {
          ifcGlobalId: result.globalId, ifcModelId: result.modelId, ifcClass: 'IfcRoof',
          roofKind: spec.kind, slope: spec.slope, thickness: spec.thickness, offset: 0, eaveEdge: 0,
        });
        ctx.say('drafting.msg.extruded', { ifcClass: 'IfcRoof', guid: result.globalId });
        return 'continue';
      },
      onEnter: () => 'done',
    };
  },
};
