/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A new bridge's defaults: the library's first deck and wall abutments
 * (seeded when the library has none), bearings, and piers so no span is
 * longer than 35 m.
 */

import { assemblyWidth, buildAlignment, defaultAbutment, defaultBearings, distributePiers, type CorridorBridge, type CorridorSpec } from '@ifc-lite/create';
import { freshProjectId } from '@/project/view-defaults';
import { ensureProfilesOfKind } from './profile-library';

export const MAX_SPAN = 35;

/** A new bridge over the middle third of the alignment (or `range`), on the library's first deck and wall abutments. */
export function newBridge(spec: CorridorSpec, name: string, range?: [number, number]): CorridorBridge {
  let [from, to] = range ?? [0, 50];
  if (!range) {
    try {
      const a = buildAlignment(spec.alignment);
      from = Math.round(a.startStation + a.length / 3);
      to = Math.round(a.startStation + (2 * a.length) / 3);
    } catch { /* an invalid alignment is reported by the preview */ }
  }
  const half = Math.ceil(assemblyWidth(spec.assembly) + 0.5);
  const deck = structuredClone(ensureProfilesOfKind('bridge-deck')[0]);
  const abutments = ensureProfilesOfKind('abutment');
  const wall = abutments.find((p) => p.preset?.id === 'wall-abutment') ?? abutments[0];
  const depth = spec.assembly.layers.reduce((s, l) => s + l.thickness, 0);
  const bridge: CorridorBridge = {
    id: freshProjectId('bridge'), name, from, to,
    deck: { profileId: deck.id, profile: deck, offset: [0, -Math.round(depth * 100) / 100] },
    start: defaultAbutment('wall', half, structuredClone(wall)), end: defaultAbutment('wall', half, structuredClone(wall)),
    bearings: defaultBearings(),
  };
  bridge.piers = distributePiers(bridge, Math.ceil(Math.abs(to - from) / MAX_SPAN), half, () => freshProjectId('pier'));
  return bridge;
}
