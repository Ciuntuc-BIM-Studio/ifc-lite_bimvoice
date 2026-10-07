/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Design tab drafting commands (phase 4), on the ribbon (the command line
 * is their keyboard surface). Each runs the same drafting command the command line does, on
 * the drawing tab in front.
 */

import {
  DraftArc, DraftCircle, DraftCopy, DraftErase, DraftExtend, DraftFillet, DraftLine, DraftMirror, DraftMove,
  DraftOffset, DraftOrtho, DraftPolyline, DraftRectangle, DraftRotate, DraftSnap, DraftTrim,
} from '@/icons';
import { resolve } from '@/i18n/registry';
import { toast } from '@/components/ui/toast';
import { isDrawingTabActive } from '@/project/document-tabs';
import { startDraftCommand, toggleOrtho, toggleSnap } from '@/drafting/session';
import type { SurfaceCommandDefinition } from './surface-command-types';

const ribbonOnly = ['ribbon'] as const;
const always = (): boolean => true;

/** Start a drafting command on the drawing tab in front, or say why not. */
function draft(id: string): () => void {
  return () => {
    if (!isDrawingTabActive()) {
      toast.info(resolve('drafting.needsView'));
      return;
    }
    startDraftCommand(id);
  };
}

export const RIBBON_DESIGN_SURFACE_COMMANDS = [
  { id: 'design:line', labelKey: 'drafting.tool.line', keywords: 'draw line segment cad L', category: 'Tools', icon: DraftLine, surfaces: ribbonOnly, enabled: always, run: draft('line') },
  { id: 'design:polyline', labelKey: 'drafting.tool.polyline', keywords: 'draw polyline pline cad PL', category: 'Tools', icon: DraftPolyline, surfaces: ribbonOnly, enabled: always, run: draft('polyline') },
  { id: 'design:rectangle', labelKey: 'drafting.tool.rectangle', keywords: 'draw rectangle rect cad REC', category: 'Tools', icon: DraftRectangle, surfaces: ribbonOnly, enabled: always, run: draft('rectangle') },
  { id: 'design:circle', labelKey: 'drafting.tool.circle', keywords: 'draw circle radius cad C', category: 'Tools', icon: DraftCircle, surfaces: ribbonOnly, enabled: always, run: draft('circle') },
  { id: 'design:arc', labelKey: 'drafting.tool.arc', keywords: 'draw arc three points cad A', category: 'Tools', icon: DraftArc, surfaces: ribbonOnly, enabled: always, run: draft('arc') },
  { id: 'design:move', labelKey: 'drafting.tool.move', keywords: 'move displace drafting M', category: 'Tools', icon: DraftMove, surfaces: ribbonOnly, enabled: always, run: draft('move') },
  { id: 'design:copy', labelKey: 'drafting.tool.copy', keywords: 'copy duplicate drafting CO', category: 'Tools', icon: DraftCopy, surfaces: ribbonOnly, enabled: always, run: draft('copy') },
  { id: 'design:rotate', labelKey: 'drafting.tool.rotate', keywords: 'rotate angle drafting RO', category: 'Tools', icon: DraftRotate, surfaces: ribbonOnly, enabled: always, run: draft('rotate') },
  { id: 'design:mirror', labelKey: 'drafting.tool.mirror', keywords: 'mirror reflect drafting MI', category: 'Tools', icon: DraftMirror, surfaces: ribbonOnly, enabled: always, run: draft('mirror') },
  { id: 'design:erase', labelKey: 'drafting.tool.erase', keywords: 'erase delete drafting E', category: 'Tools', icon: DraftErase, surfaces: ribbonOnly, enabled: always, run: draft('erase') },
  { id: 'design:offset', labelKey: 'drafting.tool.offset', keywords: 'offset parallel drafting O', category: 'Tools', icon: DraftOffset, surfaces: ribbonOnly, enabled: always, run: draft('offset') },
  { id: 'design:trim', labelKey: 'drafting.tool.trim', keywords: 'trim cut drafting TR', category: 'Tools', icon: DraftTrim, surfaces: ribbonOnly, enabled: always, run: draft('trim') },
  { id: 'design:extend', labelKey: 'drafting.tool.extend', keywords: 'extend lengthen boundary drafting EX', category: 'Tools', icon: DraftExtend, surfaces: ribbonOnly, enabled: always, run: draft('extend') },
  { id: 'design:fillet', labelKey: 'drafting.tool.fillet', keywords: 'fillet round corner radius drafting F', category: 'Tools', icon: DraftFillet, surfaces: ribbonOnly, enabled: always, run: draft('fillet') },
  { id: 'design:snap', labelKey: 'drafting.snap', keywords: 'object snap osnap toggle F3', category: 'Tools', icon: DraftSnap, surfaces: ribbonOnly, enabled: always, run: () => toggleSnap() },
  { id: 'design:ortho', labelKey: 'drafting.ortho', keywords: 'ortho orthogonal toggle F8', category: 'Tools', icon: DraftOrtho, surfaces: ribbonOnly, enabled: always, run: () => toggleOrtho() },
] as const satisfies readonly SurfaceCommandDefinition[];
