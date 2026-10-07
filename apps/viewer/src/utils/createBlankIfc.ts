/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Generate a minimal blank IFC4 model as a synthetic `File`, so the
 * welcome card's "Start blank" action can feed it through the regular
 * `loadFile()` pipeline (format detection → WASM → store federation)
 * without diverging code paths.
 *
 * The result has the smallest spatial hierarchy that satisfies the
 * Model workspace's gating (it needs a storey): one IfcProject,
 * IfcSite, IfcBuilding and a single IfcBuildingStorey at elevation 0.
 */

import { IfcCreator, type BuildingParams, type SiteParams } from '@ifc-lite/create';

export interface BlankIfcOptions {
  projectName?: string;
  storeyName?: string;
  storeyElevation?: number;
  /** New Project: the full set-up. `storeys` replaces the single storey above. */
  description?: string;
  author?: string;
  organization?: string;
  schema?: 'IFC2X3' | 'IFC4' | 'IFC4X3';
  lengthUnit?: 'METRE' | 'MILLIMETRE';
  site?: SiteParams;
  building?: BuildingParams;
  storeys?: { name: string; elevation: number }[];
}

export function createBlankIfcFile(options: BlankIfcOptions = {}): File {
  const {
    projectName = 'Untitled Project',
    storeyName = 'Level 1',
    storeyElevation = 0,
  } = options;

  const creator = new IfcCreator({
    Name: projectName,
    Description: options.description || undefined,
    Author: options.author || undefined,
    Organization: options.organization || undefined,
    Schema: options.schema,
    LengthUnit: options.lengthUnit,
    Site: options.site,
    Building: options.building,
  });
  const storeys = options.storeys?.length ? options.storeys : [{ name: storeyName, elevation: storeyElevation }];
  // Storey elevations are given in metres; a millimetre file states them in millimetres.
  const unit = options.lengthUnit === 'MILLIMETRE' ? 1000 : 1;
  for (const storey of storeys) creator.addIfcBuildingStorey({ Name: storey.name, Elevation: storey.elevation * unit });
  const { content } = creator.toIfc();

  const safeName = projectName.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'untitled';
  return new File([content], `${safeName}.ifc`, { type: 'application/ifc' });
}
