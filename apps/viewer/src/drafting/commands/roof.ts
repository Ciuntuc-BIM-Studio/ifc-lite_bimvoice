/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ROOF: a closed contour on a floor plan becomes a roof. By default a roof
 * SYSTEM (`roof-system-element.ts`): an IfcRoof of covering planes and
 * timber structure, its rules per edge — GABLE puts gables on a rectangle's
 * short edges, HIP makes every edge an eave, MONO only the first — to refine
 * in the roof configurator. SIMPLE makes the older single solid instead
 * (FLAT is always simple). Type a pitch in degrees, T and a thickness (T0.3)
 * or O and an overhang (O0.5). The contour stays linked: editing it rebuilds
 * the roof.
 */

import { createRoofElement } from '@/project/roof-element';
import { createRoofSystem } from '@/project/roof-system-element';
import { currentRoofPreset } from '@/element-types/roof-preset';
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
      prompt: () => ({ key: 'drafting.prompt.roof', params: { kind: `${s.roofKind.toUpperCase()}${s.roofSystem && s.roofKind !== 'flat' ? ' SYSTEM' : ''}`, slope: s.roofSlope, thickness: s.roofThickness, overhang: s.roofOverhang } }),
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
        if (upper === 'SYSTEM' || upper === 'SIMPLE') {
          s.roofSystem = upper === 'SYSTEM';
          return 'continue';
        }
        const t = /^T(\d+(?:\.\d+)?)$/.exec(upper);
        if (t && Number(t[1]) > 0) {
          s.roofThickness = Number(t[1]);
          return 'continue';
        }
        const o = /^O(\d+(?:\.\d+)?)$/.exec(upper);
        if (o) {
          s.roofOverhang = Number(o[1]);
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
        if (s.roofSystem && s.roofKind !== 'flat') {
          // The current roof type's build-up, when there is one; the typed shape and pitch still decide the form.
          const typed = currentRoofPreset();
          // The covering only: the structure is its own parts (a typed T is the covering's thickness when it is thin).
          const covering = typed?.defaults.thickness ?? (s.roofThickness <= 0.15 ? s.roofThickness : 0.08);
          const made = createRoofSystem(view, plane, loop, { shape: s.roofKind, pitch: s.roofSlope, overhang: s.roofOverhang, thickness: covering, eaveHeight: 0 }, typed?.name, typed?.preset);
          if (!made.ok) {
            ctx.say('drafting.msg.extrudeFailed', { detail: made.error });
            return 'continue';
          }
          setDraftParams(new Set([source.id]), { ifcGlobalId: made.globalId, ifcModelId: made.modelId, ifcClass: 'IfcRoof', roofSystem: 1 });
          ctx.say('drafting.msg.roofSystem', { guid: made.globalId });
          return 'continue';
        }
        const spec = { kind: s.roofKind, slope: s.roofSlope, thickness: s.roofThickness, offset: 0, eaveEdge: 0, overhang: s.roofOverhang };
        const result = createRoofElement(view, plane, loop, spec, source.id);
        if (!result.ok) {
          ctx.say('drafting.msg.extrudeFailed', { detail: result.error });
          return 'continue';
        }
        setDraftParams(new Set([source.id]), {
          ifcGlobalId: result.globalId, ifcModelId: result.modelId, ifcClass: 'IfcRoof',
          roofKind: spec.kind, slope: spec.slope, thickness: spec.thickness, offset: 0, eaveEdge: 0, overhang: spec.overhang,
        });
        ctx.say('drafting.msg.extruded', { ifcClass: 'IfcRoof', guid: result.globalId });
        return 'continue';
      },
      onEnter: () => 'done',
    };
  },
};
