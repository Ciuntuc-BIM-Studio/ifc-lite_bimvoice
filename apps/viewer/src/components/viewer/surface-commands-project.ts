/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Project-level File commands: New Project (a configured blank IFC model),
 * and the project package (`.bvproj`): Open, Save, Save as, and Link model
 * (a read-only coordination model). The package commands are handled by
 * `ProjectPackageHost`.
 */
import { LinkModel, NewProject, ProjectOpen, ProjectSave, ProjectVersion } from '@/icons';
import { requestNewProject } from '@/project/new-project';
import { requestPackageAction } from '@/project/package/actions';
import type { SurfaceCommandDefinition } from './surface-command-types';

export const RIBBON_PROJECT_SURFACE_COMMANDS = [
  {
    id: 'file:new-project', labelKey: 'newProject.command',
    keywords: 'new project blank ifc site building levels storeys start', category: 'File', icon: NewProject,
    surfaces: ['ribbon'] as const, enabled: () => true,
    run: () => { requestNewProject(); },
  },
  {
    id: 'file:open-project', labelKey: 'projectPackage.open',
    keywords: 'open project package bvproj zip load', category: 'File', icon: ProjectOpen,
    surfaces: ['ribbon', 'palette'] as const, enabled: () => true,
    run: () => { requestPackageAction('open'); },
  },
  {
    id: 'file:save-project', labelKey: 'projectPackage.save',
    keywords: 'save project package bvproj models views sheets drawings', category: 'File', icon: ProjectSave,
    surfaces: ['ribbon', 'palette'] as const, enabled: () => true,
    run: () => { requestPackageAction('save'); },
  },
  {
    id: 'file:save-project-as', labelKey: 'projectPackage.saveAs',
    keywords: 'save project as copy package bvproj', category: 'File', icon: ProjectSave,
    surfaces: ['ribbon', 'palette'] as const, enabled: () => true,
    run: () => { requestPackageAction('save-as'); },
  },
  {
    id: 'file:link-model', labelKey: 'projectPackage.link',
    keywords: 'link model reference coordination read only federate', category: 'File', icon: LinkModel,
    surfaces: ['ribbon', 'palette'] as const, enabled: () => true,
    run: () => { requestPackageAction('link'); },
  },
  {
    id: 'file:save-version', labelKey: 'projectVersions.save',
    keywords: 'version save milestone snapshot named history', category: 'File', icon: ProjectVersion,
    surfaces: ['ribbon', 'palette'] as const, enabled: () => true,
    run: () => { requestPackageAction('save-version'); },
  },
  {
    id: 'file:update-version', labelKey: 'projectVersions.update',
    keywords: 'version update overwrite current', category: 'File', icon: ProjectVersion,
    surfaces: ['ribbon', 'palette'] as const, enabled: () => true,
    run: () => { requestPackageAction('update-version'); },
  },
  {
    id: 'file:version-history', labelKey: 'projectVersions.history',
    keywords: 'version history list restore compare', category: 'File', icon: ProjectVersion,
    surfaces: ['ribbon', 'palette'] as const, enabled: () => true,
    run: () => { requestPackageAction('history'); },
  },
] as const satisfies readonly SurfaceCommandDefinition[];
