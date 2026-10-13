/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The user's ribbon: which tabs show and in what order. It is a preference
 * of the person, not of the project, so it lives in this browser.
 *
 * - Design always shows (it is where the ribbon falls back to);
 * - ifc-lite's Home, Elements, Analyze and Author are not offered at all
 *   (`RIBBON_REMOVED_TABS`);
 * - a hidden tab still shows while it is the active one (a tool or a
 *   contextual switch opened it), so nothing is ever unreachable;
 * - tabs added in a later version, missing from a saved order, go after
 *   the ones the user placed, in their default order.
 */

import { create } from 'zustand';
import { RIBBON_REMOVED_TABS, type RibbonTabId } from '@/store/constants';
import type { TranslationKey } from '@/i18n';

const ALL_RIBBON_TABS: { id: RibbonTabId; labelKey: TranslationKey }[] = [
  { id: 'file', labelKey: 'ribbon.tab.file' },
  { id: 'home', labelKey: 'ribbon.tab.home' },
  // Drawing and annotating come first, right after Home.
  { id: 'design', labelKey: 'ribbon.tab.design' },
  // Free modelling: solids from contours and boolean operations.
  { id: 'studio', labelKey: 'ribbon.tab.studio' },
  { id: 'annotations', labelKey: 'ribbon.tab.annotations' },
  { id: 'view', labelKey: 'ribbon.tab.view' },
  { id: 'elements', labelKey: 'ribbon.tab.elements' },
  { id: 'analyze', labelKey: 'ribbon.tab.analyze' },
  { id: 'author', labelKey: 'ribbon.tab.author' },
  { id: 'infrastructure', labelKey: 'ribbon.tab.infrastructure' },
];

/** The tabs Lapin's ribbon offers, in their default order. */
export const DEFAULT_RIBBON_TABS = ALL_RIBBON_TABS.filter((t) => !RIBBON_REMOVED_TABS.has(t.id));

/** The tab that cannot be hidden. */
export const PINNED_TAB: RibbonTabId = 'design';

export interface RibbonLayout {
  order: RibbonTabId[];
  hidden: RibbonTabId[];
}

const KEY = 'lapin.ribbon-layout';
const KNOWN = new Set(DEFAULT_RIBBON_TABS.map((t) => t.id));

export const defaultRibbonLayout = (): RibbonLayout => ({ order: DEFAULT_RIBBON_TABS.map((t) => t.id), hidden: [] });

/** A saved (or hand-made) layout made whole: known tabs only, each once, Home never hidden. */
export function normalizeRibbonLayout(raw: unknown): RibbonLayout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof RibbonLayout, unknown>>;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is RibbonTabId => KNOWN.has(x as RibbonTabId)) : []);
  const order = [...new Set(ids(r.order))];
  for (const t of DEFAULT_RIBBON_TABS) if (!order.includes(t.id)) order.push(t.id);
  const hidden = [...new Set(ids(r.hidden))].filter((id) => id !== PINNED_TAB);
  return { order, hidden };
}

function load(): RibbonLayout {
  try {
    const text = localStorage.getItem(KEY);
    return text ? normalizeRibbonLayout(JSON.parse(text)) : defaultRibbonLayout();
  } catch {
    return defaultRibbonLayout();
  }
}

function save(layout: RibbonLayout) {
  try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch { /* private window: this session only */ }
}

export const useRibbonLayout = create<RibbonLayout & { customizing: boolean }>(() => ({ ...load(), customizing: false }));

export function setRibbonLayout(layout: RibbonLayout) {
  const next = normalizeRibbonLayout(layout);
  useRibbonLayout.setState(next);
  save(next);
}

export const resetRibbonLayout = () => setRibbonLayout(defaultRibbonLayout());

/** `layout` with `id` moved by `delta` places (clamped). */
export function moveTab(layout: RibbonLayout, id: RibbonTabId, delta: number): RibbonLayout {
  const order = layout.order.filter((t) => t !== id);
  const at = Math.max(0, Math.min(order.length, layout.order.indexOf(id) + delta));
  order.splice(at, 0, id);
  return { ...layout, order };
}

export function toggleTab(layout: RibbonLayout, id: RibbonTabId, visible: boolean): RibbonLayout {
  if (id === PINNED_TAB) return layout;
  const hidden = layout.hidden.filter((t) => t !== id);
  return { ...layout, hidden: visible ? hidden : [...hidden, id] };
}

/** The tabs to draw, in the user's order: the visible ones, plus the active one even if hidden. */
export function visibleRibbonTabs(layout: RibbonLayout, active: RibbonTabId) {
  const byId = new Map(DEFAULT_RIBBON_TABS.map((t) => [t.id, t]));
  return layout.order.filter((id) => id === active || !layout.hidden.includes(id)).map((id) => byId.get(id)!);
}
