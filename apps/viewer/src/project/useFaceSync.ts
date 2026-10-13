/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Faces follow their contours (`drafting/faces.ts`): whenever the drafts
 * change, a face whose outer contour moved, or whose holes changed, takes
 * its new shape. Derived data, like an element tag's text: no undo step of
 * its own — undoing the contour edit brings the face back with it.
 */

import { useEffect } from 'react';
import { refreshedFaces } from '@/drafting/faces';
import { useProjectStore } from './project-store';

export function refreshFaces(): void {
  const { drafts } = useProjectStore.getState();
  if (!drafts.some((d) => d.shape.type === 'hatch' && typeof d.params.face === 'string')) return;
  const changed = refreshedFaces(drafts);
  if (changed.size === 0) return;
  useProjectStore.setState({ drafts: drafts.map((d) => (changed.has(d.id) ? { ...d, shape: changed.get(d.id)! } : d)), dirty: true });
}

export function useFaceSync(): void {
  useEffect(() => useProjectStore.subscribe((s, prev) => { if (s.drafts !== prev.drafts) refreshFaces(); }), []);
}
