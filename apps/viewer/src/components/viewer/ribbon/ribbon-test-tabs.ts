/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Tests: show a ribbon tab. One the strip offers is clicked; one Lapin leaves
 * out of the strip (ifc-lite's Home, Elements, Analyze, Author) is opened
 * through the store, as a tour or a command would, so its band is still
 * covered.
 */

import { act } from 'react';
import { mouseDown } from '@/test/render.js';
import { useViewerStore, type RibbonTabId } from '@/store';
import { DEFAULT_RIBBON_TABS } from './ribbon-layout.js';

export function showRibbonTab(container: HTMLElement, tab: RibbonTabId): void {
  const at = DEFAULT_RIBBON_TABS.findIndex((t) => t.id === tab);
  if (at < 0) {
    act(() => useViewerStore.setState({ ribbonTab: tab }));
    return;
  }
  const trigger = container.querySelectorAll('[role="tab"]')[at];
  if (!trigger) throw new Error(`tab ${tab} is not rendered`);
  mouseDown(trigger, { button: 0 });
}
