/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Annotations tab commands (phase 4d): text, leaders, dimensions, level
 * marks, hatches, and loading `.pat` hatch patterns into the project. Each
 * runs the drafting command the command line does, on the drawing tab in
 * front.
 */

import {
  AnnoDimAligned, AnnoDimAngular, AnnoDimLinear, AnnoDimRadius, AnnoHatch, AnnoLeader, AnnoLevel, AnnoLoadPattern, AnnoTag, AnnoText, DraftingStandards,
} from '@/icons';
import { resolve } from '@/i18n/registry';
import { toast } from '@/components/ui/toast';
import { isDrawingTabActive } from '@/project/document-tabs';
import { startDraftCommand } from '@/drafting/session';
import { importHatchPatternFile } from '@/drafting/hatch-import';
import { openStandards } from '@/project/standards-dialog-store';
import type { SurfaceCommandDefinition } from './surface-command-types';

const ribbonOnly = ['ribbon'] as const;
const always = (): boolean => true;

function draft(id: string): () => void {
  return () => {
    if (!isDrawingTabActive()) {
      toast.info(resolve('drafting.needsView'));
      return;
    }
    startDraftCommand(id);
  };
}

export const RIBBON_ANNOTATE_SURFACE_COMMANDS = [
  { id: 'annotate:text', labelKey: 'drafting.tool.text', keywords: 'text note label', category: 'Tools', icon: AnnoText, surfaces: ribbonOnly, enabled: always, run: draft('text') },
  { id: 'annotate:standards', labelKey: 'standards.open', keywords: 'layers layer groups text style dimension style standards manager', category: 'Tools', icon: DraftingStandards, surfaces: ribbonOnly, enabled: always, run: () => openStandards('layers') },
  { id: 'annotate:tag', labelKey: 'drafting.tool.tag', keywords: 'tag label element mark door window number', category: 'Tools', icon: AnnoTag, surfaces: ribbonOnly, enabled: always, run: draft('tag') },
  { id: 'annotate:leader', labelKey: 'drafting.tool.leader', keywords: 'leader arrow callout note', category: 'Tools', icon: AnnoLeader, surfaces: ribbonOnly, enabled: always, run: draft('leader') },
  { id: 'annotate:dim-aligned', labelKey: 'drafting.tool.dimAligned', keywords: 'dimension aligned measure', category: 'Tools', icon: AnnoDimAligned, surfaces: ribbonOnly, enabled: always, run: draft('dimaligned') },
  { id: 'annotate:dim-linear', labelKey: 'drafting.tool.dimLinear', keywords: 'dimension linear horizontal vertical', category: 'Tools', icon: AnnoDimLinear, surfaces: ribbonOnly, enabled: always, run: draft('dimlinear') },
  { id: 'annotate:dim-radius', labelKey: 'drafting.tool.dimRadius', keywords: 'dimension radius', category: 'Tools', icon: AnnoDimRadius, surfaces: ribbonOnly, enabled: always, run: draft('dimradius') },
  { id: 'annotate:dim-diameter', labelKey: 'drafting.tool.dimDiameter', keywords: 'dimension diameter', category: 'Tools', icon: AnnoDimRadius, surfaces: ribbonOnly, enabled: always, run: draft('dimdiameter') },
  { id: 'annotate:dim-angular', labelKey: 'drafting.tool.dimAngular', keywords: 'dimension angle angular', category: 'Tools', icon: AnnoDimAngular, surfaces: ribbonOnly, enabled: always, run: draft('dimangular') },
  { id: 'annotate:level', labelKey: 'drafting.tool.level', keywords: 'level mark spot elevation cota', category: 'Tools', icon: AnnoLevel, surfaces: ribbonOnly, enabled: always, run: draft('level') },
  { id: 'annotate:hatch', labelKey: 'drafting.tool.hatch', keywords: 'hatch fill pattern pat', category: 'Tools', icon: AnnoHatch, surfaces: ribbonOnly, enabled: always, run: draft('hatch') },
  { id: 'annotate:load-pattern', labelKey: 'drafting.tool.loadPattern', keywords: 'load import hatch pattern pat file', category: 'Tools', icon: AnnoLoadPattern, surfaces: ribbonOnly, enabled: always, run: () => { void importHatchPatternFile(); } },
] as const satisfies readonly SurfaceCommandDefinition[];
