/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The navigator's Levels folder: every loaded model's effective building
 * storeys (parsed + added in this session), top-down. Open shows the
 * level's floor plan (creating it if needed); rename writes the IFC Name;
 * delete removes a level added in this session while it is still empty.
 */

import { useMemo, useState } from 'react';
import { Plus, Layers3 } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { IconButton } from '@/components/ui/icon-button';
import { toast } from '@/components/ui/toast';
import { useViewerStore } from '@/store';
import { modelLevels, removeModelLevel, renameModelLevel, type ModelLevel } from '@/project/model-levels';
import { addProjectView, useProjectStore } from '@/project/project-store';
import { DEFAULT_PLAN_CUT_HEIGHT_M, resolvePlanLevel, sameElevation } from '@/project/view-defaults';
import { openProjectView } from '@/project/open-view';
import type { PlanProjectView } from '@/project/types';
import { ProjectFolderRow, ProjectItemRow } from './ProjectTreeRow';

interface Row extends ModelLevel {
  modelId: string;
  modelName: string;
}

function openLevelPlan(level: Row): void {
  const { views, levels } = useProjectStore.getState();
  const projectLevel = levels.find((l) => (level.globalId && l.storeyGlobalIds.includes(level.globalId)) || sameElevation(l.elevation, level.elevation));
  const plan = views.find((v): v is PlanProjectView => v.kind === 'plan' && !!projectLevel && resolvePlanLevel(v, [projectLevel]) === projectLevel);
  if (plan) {
    openProjectView(plan.id);
    return;
  }
  const id = addProjectView({
    kind: 'plan',
    name: level.name,
    level: { name: level.name, elevation: level.elevation, storeyGlobalIds: level.globalId ? [level.globalId] : [] },
    cutHeight: DEFAULT_PLAN_CUT_HEIGHT_M,
  });
  openProjectView(id);
}

export function LevelsFolder({ query, onNewLevel }: { query: string; onNewLevel: () => void }) {
  const { t } = useTranslation();
  const models = useViewerStore((s) => s.models);
  const version = useViewerStore((s) => s.mutationVersion);
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState<string | null>(null);

  const rows = useMemo((): Row[] => {
    const all: Row[] = [];
    for (const model of models.values()) {
      for (const level of modelLevels(model.id)) all.push({ ...level, modelId: model.id, modelName: model.name });
    }
    return all.sort((a, b) => b.elevation - a.elevation);
    // `version` re-reads the levels after every model edit (add / rename / undo).
  }, [models, version]);

  const multi = models.size > 1;
  const visible = rows.filter((r) => !query || r.name.toLowerCase().includes(query));
  if (query && visible.length === 0) return null;
  const isOpen = !!query || open;
  const key = (r: Row) => `${r.modelId}:${r.expressId}`;
  const report = (result: { ok: boolean; error?: string }) => {
    if (!result.ok && result.error) toast.error(result.error);
  };

  return (
    <div>
      <ProjectFolderRow
        label={t('projectNavigator.folder.levels')}
        icon={<Layers3 className="size-3.5" />}
        count={visible.length}
        open={isOpen}
        onToggle={() => setOpen((o) => !o)}
        action={(
          <IconButton label={t('projectNavigator.action.newLevel')} className="size-6" onClick={onNewLevel}>
            <Plus className="size-3.5" />
          </IconButton>
        )}
      />
      {isOpen ? visible.map((r) => (
        <ProjectItemRow
          key={key(r)}
          label={t(multi ? 'projectNavigator.levelLabelModel' : 'projectNavigator.levelLabel', { name: r.name, elevation: r.elevation.toFixed(2), model: r.modelName })}
          renameValue={r.name}
          icon={<Layers3 className="size-3.5" />}
          active={false}
          renaming={renaming === key(r)}
          onOpen={() => openLevelPlan(r)}
          onStartRename={() => setRenaming(key(r))}
          onRename={(name) => {
            setRenaming(null);
            if (name.trim() && name.trim() !== r.name) report(renameModelLevel(r.modelId, r.expressId, name));
          }}
          onCancelRename={() => setRenaming(null)}
          onDelete={() => report(removeModelLevel(r.modelId, r.expressId))}
        />
      )) : null}
    </div>
  );
}
