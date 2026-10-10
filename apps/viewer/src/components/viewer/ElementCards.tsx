/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The editable cards at the top of the properties for one element: its type
 * from the libraries and its roof system when it has one (full edition), and
 * the symbol a door or window is drawn with (both editions).
 */

import { can } from '@/edition';
import { ElementTypeCard } from './ElementTypeCard';
import { RoofBlockCards } from './roof/RoofBlockCards';
import { JoinerySymbolCard } from './JoinerySymbolCard';

export function ElementCards({ modelId, expressId }: { modelId: string; expressId: number }) {
  if (modelId === 'legacy') return null;
  // Retyping and roof blocks change the model: the docs edition maps symbols only.
  return (
    <>
      {can('modelling') && <RoofBlockCards modelId={modelId} expressId={expressId} />}
      {can('modelling') && <ElementTypeCard modelId={modelId} expressId={expressId} />}
      <JoinerySymbolCard modelId={modelId} expressId={expressId} />
    </>
  );
}
