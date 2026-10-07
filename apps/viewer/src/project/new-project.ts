/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * New Project: the set-up of a fresh IFC model — project, site (with its
 * geographic reference), building, levels, units and schema — turned into
 * an IFC file that loads through the ordinary pipeline. Lengths in the spec
 * are metres; a millimetre file gets them converted.
 */

import { createBlankIfcFile } from '@/utils/createBlankIfc';

export interface NewProjectLevel {
  name: string;
  /** Floor elevation, metres. */
  elevation: number;
}

export interface NewProjectSpec {
  projectName: string;
  description: string;
  author: string;
  organization: string;
  siteName: string;
  siteAddress: string;
  latitude: number | null;
  longitude: number | null;
  /** Site reference elevation above sea level, metres. */
  siteElevation: number | null;
  buildingName: string;
  buildingLongName: string;
  levels: NewProjectLevel[];
  lengthUnit: 'METRE' | 'MILLIMETRE';
  schema: 'IFC2X3' | 'IFC4' | 'IFC4X3';
}

/** Levels for `above` storeys from ±0.00 up and `below` basements, `height` metres apart (top-down). */
export function generateLevels(above: number, below: number, height: number): NewProjectLevel[] {
  const levels: NewProjectLevel[] = [];
  for (let i = Math.max(0, above) - 1; i >= 0; i--) {
    levels.push({ name: i === 0 ? 'Ground Floor' : `Level ${i}`, elevation: Number((i * height).toFixed(3)) });
  }
  for (let i = 1; i <= Math.max(0, below); i++) {
    levels.push({ name: `Basement ${i}`, elevation: Number((-i * height).toFixed(3)) });
  }
  return levels;
}

export function defaultNewProjectSpec(): NewProjectSpec {
  return {
    projectName: 'New Project',
    description: '',
    author: '',
    organization: '',
    siteName: 'Site',
    siteAddress: '',
    latitude: null,
    longitude: null,
    siteElevation: null,
    buildingName: 'Building',
    buildingLongName: '',
    levels: generateLevels(2, 0, 3),
    lengthUnit: 'METRE',
    schema: 'IFC4',
  };
}

/** Problems that stop the project from being created (empty when it can be). */
export function validateNewProject(spec: NewProjectSpec): string[] {
  const problems: string[] = [];
  if (!spec.projectName.trim()) problems.push('projectName');
  if (!spec.siteName.trim()) problems.push('siteName');
  if (!spec.buildingName.trim()) problems.push('buildingName');
  if (spec.levels.length === 0) problems.push('levels');
  if (spec.levels.some((l) => !l.name.trim() || !Number.isFinite(l.elevation))) problems.push('levelRows');
  if (spec.latitude !== null && (spec.latitude < -90 || spec.latitude > 90)) problems.push('latitude');
  if (spec.longitude !== null && (spec.longitude < -180 || spec.longitude > 180)) problems.push('longitude');
  return problems;
}

/** The IFC file of a new project. */
export function newProjectFile(spec: NewProjectSpec): File {
  const unit = spec.lengthUnit === 'MILLIMETRE' ? 1000 : 1;
  return createBlankIfcFile({
    projectName: spec.projectName.trim(),
    description: spec.description.trim(),
    author: spec.author.trim(),
    organization: spec.organization.trim(),
    schema: spec.schema,
    lengthUnit: spec.lengthUnit,
    site: {
      Name: spec.siteName.trim(),
      Description: spec.siteAddress.trim() || undefined,
      Latitude: spec.latitude ?? undefined,
      Longitude: spec.longitude ?? undefined,
      Elevation: spec.siteElevation === null ? undefined : spec.siteElevation * unit,
    },
    building: { Name: spec.buildingName.trim(), LongName: spec.buildingLongName.trim() || undefined },
    storeys: [...spec.levels].sort((a, b) => a.elevation - b.elevation).map((l) => ({ name: l.name.trim(), elevation: l.elevation })),
  });
}

export const NEW_PROJECT_EVENT = 'ifc-lite:new-project';

/** Open the New Project dialog (it is mounted with the left navigator). */
export function requestNewProject(): void {
  window.dispatchEvent(new CustomEvent(NEW_PROJECT_EVENT));
}
