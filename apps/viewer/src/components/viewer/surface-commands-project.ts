/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Project-level File commands: New Project (a configured blank IFC model). */
import { NewProject } from '@/icons';
import { requestNewProject } from '@/project/new-project';
import type { SurfaceCommandDefinition } from './surface-command-types';

export const RIBBON_PROJECT_SURFACE_COMMANDS = [
  {
    id: 'file:new-project', labelKey: 'newProject.command',
    keywords: 'new project blank ifc site building levels storeys start', category: 'File', icon: NewProject,
    surfaces: ['ribbon'] as const, enabled: () => true,
    run: () => { requestNewProject(); },
  },
] as const satisfies readonly SurfaceCommandDefinition[];
