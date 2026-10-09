/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Deleting one element: the robust delete (`element-delete.ts`) — its
 * dependants, its meshes in every view, its orphaned geometry and cuts,
 * linked contours — as one undo step. Kept for callers of the older name.
 */

import { deleteModelElements } from './element-delete';

export function removeElementWithOrphans(modelId: string, expressId: number): boolean {
  return deleteModelElements(modelId, [expressId]).deleted > 0;
}
