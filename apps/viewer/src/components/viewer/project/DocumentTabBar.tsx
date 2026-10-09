/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The central tab strip: the permanent 3D tab, then one tab per opened
 * drawing view. Click brings a tab forward; the × or a middle click closes
 * it (the view stays in the project).
 */

import type { ReactNode } from 'react';
import { Box, Building2, LayoutTemplate, Scissors, SquareDashed, X, Table2, Spline } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/project/project-store';
import { MODEL_TAB_ID, useDocumentTabs } from '@/project/document-tabs';
import { activateDocumentTab, closeProjectTab } from '@/project/open-view';
import type { ProjectViewKind } from '@/project/types';

const ICONS: Record<ProjectViewKind, ReactNode> = {
  plan: <LayoutTemplate className="size-3.5" />,
  section: <Scissors className="size-3.5" />,
  elevation: <Building2 className="size-3.5" />,
  '3d': <Box className="size-3.5" />,
};

export function DocumentTabBar() {
  const { t } = useTranslation();
  const openIds = useDocumentTabs((s) => s.openIds);
  const activeId = useDocumentTabs((s) => s.activeId);
  const views = useProjectStore((s) => s.views);
  const sheets = useProjectStore((s) => s.sheets);
  const schedules = useProjectStore((s) => s.schedules);
  const civilDrawings = useProjectStore((s) => s.civilDrawings);
  const tabs = openIds.flatMap((id): { id: string; label: string; icon: ReactNode }[] => {
    const view = views.find((v) => v.id === id);
    if (view) return [{ id, label: view.name, icon: ICONS[view.kind] }];
    const schedule = schedules?.find((s) => s.id === id);
    if (schedule) return [{ id, label: schedule.name, icon: <Table2 className="size-3.5" /> }];
    const civil = civilDrawings?.find((d) => d.id === id);
    if (civil) return [{ id, label: civil.name, icon: <Spline className="size-3.5" /> }];
    const sheet = sheets.find((s) => s.id === id);
    return sheet ? [{ id, label: t('projectNavigator.sheetLabel', { number: sheet.number, name: sheet.name }), icon: <SquareDashed className="size-3.5" /> }] : [];
  });

  return (
    <div role="tablist" aria-label={t('projectNavigator.documentTabs')} className="flex shrink-0 items-end gap-px overflow-x-auto h-8 px-1 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950">
      <Tab active={activeId === MODEL_TAB_ID} icon={ICONS['3d']} label={t('projectNavigator.tab.model3d')} onSelect={() => activateDocumentTab(MODEL_TAB_ID)} />
      {tabs.map((tab) => (
        <Tab
          key={tab.id}
          active={activeId === tab.id}
          icon={tab.icon}
          label={tab.label}
          onSelect={() => activateDocumentTab(tab.id)}
          onClose={() => closeProjectTab(tab.id)}
          closeLabel={t('projectNavigator.tab.close', { name: tab.label })}
        />
      ))}
    </div>
  );
}

interface TabProps {
  active: boolean;
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  onClose?: () => void;
  closeLabel?: string;
}

function Tab({ active, icon, label, onSelect, onClose, closeLabel }: TabProps) {
  return (
    <div
      className={cn(
        'group flex items-center h-7 max-w-[220px] rounded-t-md border border-b-0 text-xs',
        active
          ? 'bg-white dark:bg-black border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium'
          : 'border-transparent text-zinc-500 hover:bg-zinc-200/70 dark:hover:bg-zinc-900 hover:text-zinc-800 dark:hover:text-zinc-200',
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className="flex min-w-0 items-center gap-1.5 h-full pl-2.5 pr-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-t-md"
        onClick={onSelect}
        onAuxClick={(e) => {
          if (e.button === 1 && onClose) onClose();
        }}
      >
        <span className="shrink-0 text-zinc-500">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
      {onClose ? (
        <button
          type="button"
          aria-label={closeLabel}
          title={closeLabel}
          className={cn('mr-1 rounded p-0.5 hover:bg-zinc-300/60 dark:hover:bg-zinc-800', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
          onClick={onClose}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
