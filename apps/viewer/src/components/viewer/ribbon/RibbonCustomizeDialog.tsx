/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Customize ribbon: tick the tabs to show and move them with the arrows
 * into the order wanted. Changes apply at once; Reset brings the default
 * ribbon back. Opened from the tab strip's right-click menu.
 */

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu';
import type { RibbonTabId } from '@/store/constants';
import { useViewerStore } from '@/store';
import {
  DEFAULT_RIBBON_TABS, PINNED_TAB, moveTab, resetRibbonLayout, setRibbonLayout, toggleTab, useRibbonLayout,
} from './ribbon-layout';

export const openRibbonCustomize = () => useRibbonLayout.setState({ customizing: true });

/** Right-click on the tab strip: hide the tab under the pointer, show them all, or customize. */
export function RibbonTabsMenu({ tab: target }: { tab: RibbonTabId | null }) {
  const { t } = useTranslation();
  const order = useRibbonLayout((s) => s.order);
  const hidden = useRibbonLayout((s) => s.hidden);
  const label = t(DEFAULT_RIBBON_TABS.find((tab) => tab.id === target)?.labelKey ?? 'ribbon.tab.home');
  const hide = (id: RibbonTabId) => {
    setRibbonLayout(toggleTab({ order, hidden }, id, false));
    // The active tab would stay drawn while active: the ribbon goes Home.
    if (useViewerStore.getState().ribbonTab === id) useViewerStore.getState().setRibbonTab(PINNED_TAB);
  };
  const item = 'flex px-3 py-1.5 text-xs';
  return (
    <ContextMenuContent>
      {target && target !== PINNED_TAB ? (
        <ContextMenuItem className={item} onSelect={() => hide(target)}>{t('ribbonLayout.menu.hide', { tab: label })}</ContextMenuItem>
      ) : null}
      {hidden.length ? <ContextMenuItem className={item} onSelect={() => setRibbonLayout({ order, hidden: [] })}>{t('ribbonLayout.menu.showAll')}</ContextMenuItem> : null}
      <ContextMenuItem className={item} onSelect={openRibbonCustomize}>{t('ribbonLayout.menu.customize')}</ContextMenuItem>
    </ContextMenuContent>
  );
}

export function RibbonCustomizeDialog() {
  const { t } = useTranslation();
  const open = useRibbonLayout((s) => s.customizing);
  const order = useRibbonLayout((s) => s.order);
  const hidden = useRibbonLayout((s) => s.hidden);
  const labels = new Map(DEFAULT_RIBBON_TABS.map((tab) => [tab.id, t(tab.labelKey)]));
  const layout = { order, hidden };
  const close = () => useRibbonLayout.setState({ customizing: false });
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader><DialogTitle>{t('ribbonLayout.title')}</DialogTitle></DialogHeader>
        <p className="text-xs text-zinc-500">{t('ribbonLayout.hint')}</p>
        <ul className="space-y-1" aria-label={t('ribbonLayout.title')}>
          {order.map((id, i) => {
            const visible = !hidden.includes(id);
            const label = labels.get(id) ?? id;
            return (
              <li key={id} className="flex items-center gap-2 rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700">
                <label className="flex flex-1 items-center gap-2">
                  <input type="checkbox" checked={visible} disabled={id === PINNED_TAB}
                    onChange={(e) => setRibbonLayout(toggleTab(layout, id, e.target.checked))} />
                  <span className={visible ? '' : 'text-zinc-400'}>{label}</span>
                </label>
                <Button size="icon-sm" variant="ghost" disabled={i === 0} aria-label={t('ribbonLayout.up', { tab: label })}
                  onClick={() => setRibbonLayout(moveTab(layout, id, -1))}><ArrowUp className="h-3.5 w-3.5" /></Button>
                <Button size="icon-sm" variant="ghost" disabled={i === order.length - 1} aria-label={t('ribbonLayout.down', { tab: label })}
                  onClick={() => setRibbonLayout(moveTab(layout, id, 1))}><ArrowDown className="h-3.5 w-3.5" /></Button>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={resetRibbonLayout}>{t('ribbonLayout.reset')}</Button>
          <Button onClick={close}>{t('ribbonLayout.done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
