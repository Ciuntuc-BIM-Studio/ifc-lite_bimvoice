/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The left navigation slot: the Project Navigator and the model Hierarchy
 * as two tabs, Project first and shown by default. The project sync runs here, not in the navigator, so the
 * project follows model loads even while the Model tab is showing.
 */

import { TrussDialog } from '@/components/viewer/timber/TrussDialog';
import { TimberFrameDialog } from '@/components/viewer/timber/TimberFrameDialog';
import { CltDialog } from '@/components/viewer/timber/CltDialog';
import { useState } from 'react';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/utils';
import { HierarchyPanel } from '@/components/viewer/HierarchyPanel';
import { useProjectSync } from '@/project/project-sync';
import { useLinkedElementSync } from '@/project/useLinkedElementSync';
import { useElementTagSync } from '@/project/useElementTagSync';
import { useFaceSync } from '@/project/useFaceSync';
import { ProjectNavigatorPanel } from './ProjectNavigatorPanel';
import { NewProjectHost } from './NewProjectDialog';
import { NativeConversionPrompt } from './NativeConversionPrompt';
import { ProjectPackageHost } from './ProjectPackageHost';
import { ProjectVersionsHost } from './ProjectVersionsHost';
import { RoofEditBar } from '../roof/RoofEditBar';
import { DraftingStandardsDialog } from '../drafting/standards/DraftingStandardsDialog';
import { JoineryDialog } from '../joinery/JoineryDialog';
import { RoofSystemDialog } from '../roof/RoofSystemDialog';
import { CorridorDialog } from '../civil/CorridorDialog';
import { ProjectLocationDialog } from './ProjectLocationDialog';
import { GroupEditBar } from '../groups/GroupEditBar';
import { ProfileLibraryDialog } from '../civil/ProfileLibraryDialog';
import { MoveToStoreyDialog } from '../properties/MoveToStoreyDialog';
import { MaterialsDialog } from '../materials/MaterialsDialog';
import { installGroupBehaviour } from '@/project/element-groups';
import { installRoofBlocks } from '@/project/roof-block';
import { installCurtainWallBlocks } from '@/project/curtain-wall-element';
import { CurtainWallDialog } from '../curtain-wall/CurtainWallDialog';
import '@/joinery/placement';
import '@/element-types/model-sync';
import '@/project/cut-priorities';
import { ElementTypesDialog } from '../element-types/ElementTypesDialog';
import { installStudioFeatures } from '@/project/studio-feature';

// Clicking a member selects its group; a group in edit mode keeps the rest locked.
installGroupBehaviour();
installRoofBlocks();
installCurtainWallBlocks();
installStudioFeatures();

type LeftTab = 'model' | 'project';

// v2: Project became the default; a Model choice remembered under the old key does not carry over.
const TAB_STORAGE_KEY = 'lapin:left-navigator-tab:v2';

function readTab(): LeftTab {
  try {
    return localStorage.getItem(TAB_STORAGE_KEY) === 'model' ? 'model' : 'project';
  } catch (err) {
    console.warn('[project] could not read the left panel tab', err);
    return 'project';
  }
}

export function LeftNavigator() {
  const { t } = useTranslation();
  useProjectSync();
  useLinkedElementSync();
  useElementTagSync();
  useFaceSync();
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
    { id: 'project', label: t('projectNavigator.tab.project') },
    { id: 'model', label: t('projectNavigator.tab.model') },
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
      <ProjectPackageHost />
      <NativeConversionPrompt />
      <ProjectVersionsHost />
      <RoofEditBar />
      <CurtainWallDialog />
      <DraftingStandardsDialog />
      <JoineryDialog />
      <ElementTypesDialog />
      <RoofSystemDialog />
      <TrussDialog />
      <TimberFrameDialog />
      <CltDialog />
      <CorridorDialog />
      <ProjectLocationDialog />
      <GroupEditBar />
      <ProfileLibraryDialog />
      <MaterialsDialog />
      <MoveToStoreyDialog />
    </div>
  );
}
