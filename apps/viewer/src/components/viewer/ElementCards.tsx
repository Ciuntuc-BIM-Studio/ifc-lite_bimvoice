/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** The editable cards at the top of the properties for one element: its type from the libraries, and its roof system when it has one. */

import { can } from '@/edition';
import { ElementTypeCard } from './ElementTypeCard';
import { RoofBlockCards } from './roof/RoofBlockCards';

export function ElementCards({ modelId, expressId }: { modelId: string; expressId: number }) {
  // Retyping and roof blocks change the model: the docs edition maps symbols instead (the Symbols library).
  if (modelId === 'legacy' || !can('modelling')) return null;
  return (
    <>
      <RoofBlockCards modelId={modelId} expressId={expressId} />
      <ElementTypeCard modelId={modelId} expressId={expressId} />
    </>
  );
}
