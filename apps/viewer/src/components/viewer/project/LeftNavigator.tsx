/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The left navigation slot: the model Hierarchy and the Project Navigator
 * as two tabs. The project sync runs here, not in the navigator, so the
 * project follows model loads even while the Model tab is showing.
 */

import { useState } from 'react';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/utils';
import { HierarchyPanel } from '@/components/viewer/HierarchyPanel';
import { useProjectSync } from '@/project/project-sync';
import { ProjectNavigatorPanel } from './ProjectNavigatorPanel';
import { NewProjectHost } from './NewProjectDialog';

type LeftTab = 'model' | 'project';

const TAB_STORAGE_KEY = 'ifc-lite:left-navigator-tab';

function readTab(): LeftTab {
  try {
    return localStorage.getItem(TAB_STORAGE_KEY) === 'project' ? 'project' : 'model';
  } catch (err) {
    console.warn('[project] could not read the left panel tab', err);
    return 'model';
  }
}

export function LeftNavigator() {
  const { t } = useTranslation();
  useProjectSync();
  const [tab, setTab] = useState<LeftTab>(readTab);
  const select = (next: LeftTab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch (err) {
      console.warn('[project] could not remember the left panel tab', err);
    }
  };
  const tabs: { id: LeftTab; label: string }[] = [
    { id: 'model', label: t('projectNavigator.tab.model') },
    { id: 'project', label: t('projectNavigator.tab.project') },
  ];
  return (
    <div className="h-full flex flex-col">
      <div role="tablist" aria-label={t('projectNavigator.tabs')} className="flex shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={cn(
              'flex-1 h-8 text-xs font-medium border-b-2 transition-colors',
              tab === id ? 'border-primary text-zinc-900 dark:text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200',
            )}
            onClick={() => select(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex-1 min-h-0">
        {tab === 'model' ? <HierarchyPanel /> : <ProjectNavigatorPanel />}
      </div>
      <NewProjectHost />
    </div>
  );
}
