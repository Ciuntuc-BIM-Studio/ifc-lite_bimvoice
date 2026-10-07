/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Work-plane commands. SECTION draws a section line on a floor plan: two
 * points and the side to look at give a vertical plane through the line,
 * saved as a section view — a new drawing, and a work plane to draft on.
 *
 * The plane is a custom (face-pick style) section plane: normal horizontal
 * and perpendicular to the line, tangent along the line, bitangent world
 * up, so its drawing reads left-to-right along the line with up on top.
 * The kept half (what the section shows) is the side that was picked: an
 * unflipped cut keeps `dot(p, n) − d < 0`, so `n` points away from it.
 */

import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import type { CustomSectionPlane } from '@/store/section-types';
import { addProjectView } from '@/project/project-store';
import { drawingToWorld, type Vec3 } from '../frame';
import type { Pt } from '../types';
import type { DraftCommandDef } from './types';

const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const tuple = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];

/** The vertical section plane through a plan line, looking toward `side`. `null` for a degenerate line. */
export function sectionPlaneFromLine(plan: SectionPlaneConfig, a: Pt, b: Pt, side: Pt): CustomSectionPlane | null {
  const p = drawingToWorld(plan, a);
  const q = drawingToWorld(plan, b);
  const s = drawingToWorld(plan, side);
  // Horizontal direction along the line (viewer frame is Y-up).
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return null;
  let normal: Vec3 = { x: dz / len, y: 0, z: -dx / len };
  // Keep the picked side: the normal points away from it.
  if ((s.x - p.x) * normal.x + (s.z - p.z) * normal.z > 0) normal = { x: -normal.x, y: 0, z: -normal.z };
  const up: Vec3 = { x: 0, y: 1, z: 0 };
  // Looking along −normal with world up, screen right is (−normal) × up.
  const tangent = cross({ x: -normal.x, y: 0, z: -normal.z }, up);
  return {
    normal: tuple(normal),
    distance: dot(p, normal),
    pickedAt: tuple(p),
    tangent: tuple(tangent),
    bitangent: tuple(up),
  };
}

export const sectionLineCommand: DraftCommandDef = {
  id: 'sectionline',
  aliases: ['SECTION', 'SE', 'SECTIONLINE'],
  labelKey: 'drafting.cmd.section',
  create(ctx) {
    const pts: Pt[] = [];
    return {
      prompt: () => ({ key: ['drafting.prompt.sectionStart', 'drafting.prompt.sectionEnd', 'drafting.prompt.sectionSide'][Math.min(pts.length, 2)] as 'drafting.prompt.sectionStart' }),
      input: () => 'point',
      basePoint: () => pts.at(-1) ?? null,
      onPoint(p) {
        if (ctx.viewKind() !== 'plan') {
          ctx.say('drafting.msg.sectionOnPlan');
          return 'done';
        }
        if (pts.length < 2) {
          pts.push(p);
          return 'continue';
        }
        const plan = ctx.plane();
        const custom = plan ? sectionPlaneFromLine(plan, pts[0], pts[1], p) : null;
        if (!custom) {
          ctx.say('drafting.msg.sectionFailed');
          return 'done';
        }
        addProjectView({ kind: 'section', name: 'Section', plane: { axis: 'front', offset: custom.distance, flipped: false, custom } });
        ctx.say('drafting.msg.sectionCreated');
        return 'done';
      },
      preview(cursor) {
        if (pts.length === 1) return [{ type: 'line', a: pts[0], b: cursor }];
        if (pts.length === 2) {
          const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
          return [{ type: 'line', a: pts[0], b: pts[1] }, { type: 'line', a: mid, b: cursor }];
        }
        return [];
      },
    };
  },
};
