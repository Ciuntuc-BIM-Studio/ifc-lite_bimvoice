/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** The current roof type, as the ROOF command and "Convert to BIM" build a roof system from it. */

import type { RoofDefaults, RoofPreset } from '@/project/roof-system-element';
import { currentType } from './catalog';
import { layersThickness } from './spec';

export function currentRoofPreset(): { defaults: Omit<RoofDefaults, 'eaveHeight'>; preset: RoofPreset; name: string } | null {
  const type = currentType('roof');
  if (!type) return null;
  return {
    name: type.name,
    defaults: { shape: type.shape, pitch: type.pitch, overhang: type.overhang, thickness: layersThickness(type.layers) },
    preset: {
      typeId: type.id, timberColor: type.timberColor, structure: structuredClone(type.structure),
      covering: { thickness: layersThickness(type.layers), color: type.color, layers: type.layers.map((l) => ({ ...l })) },
    },
  };
}
