/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Wood tab's timber components: members (TBEAM, TPOST, TBRACE —
 * `drafting/commands/timber.ts`) and trusses (TRUSS and its configurator),
 * drawn on the view in front.
 */

import { TimberBeam, TimberBrace, TimberPost, TimberTruss, TimberTrussSettings } from '@/icons';
import { openTrussDialog } from './timber/TrussDialog';
import { toast } from '@/components/ui/toast';
import { resolve } from '@/i18n/registry';
import { isDrawingTabActive } from '@/project/document-tabs';
import { startDraftCommand } from '@/drafting/session';
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

export const RIBBON_WOOD_SURFACE_COMMANDS = [
  { id: 'wood:tbeam', labelKey: 'timber.tool.beam', keywords: 'timber wood beam joist rafter lintel TBEAM', category: 'Tools', icon: TimberBeam, surfaces: ribbonOnly, enabled: always, run: draft('tbeam') },
  { id: 'wood:tpost', labelKey: 'timber.tool.post', keywords: 'timber wood post column stud TPOST', category: 'Tools', icon: TimberPost, surfaces: ribbonOnly, enabled: always, run: draft('tpost') },
  { id: 'wood:tbrace', labelKey: 'timber.tool.brace', keywords: 'timber wood brace strut diagonal knee TBRACE', category: 'Tools', icon: TimberBrace, surfaces: ribbonOnly, enabled: always, run: draft('tbrace') },
  { id: 'wood:truss', labelKey: 'timber.tool.truss', keywords: 'timber wood truss fink pratt howe warren king queen girder TRUSS', category: 'Tools', icon: TimberTruss, surfaces: ribbonOnly, enabled: always, run: draft('truss') },
  { id: 'wood:truss-settings', labelKey: 'timber.tool.trussSettings', keywords: 'timber truss configure settings pattern rise panels chords webs', category: 'Tools', icon: TimberTrussSettings, surfaces: ribbonOnly, enabled: always, run: openTrussDialog },
] as const satisfies readonly SurfaceCommandDefinition[];
