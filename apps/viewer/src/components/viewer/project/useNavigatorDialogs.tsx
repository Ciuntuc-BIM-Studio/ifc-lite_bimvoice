/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Project Navigator's "New …" dialogs: a level (a real
 * IfcBuildingStorey in a loaded model), a floor plan on a level, an
 * elevation. Each returns the element the panel mounts and an opener.
 */

import { useState } from 'react';
import { useTranslation } from '@/i18n';
import { useViewerStore } from '@/store';
import { addProjectView, useProjectStore } from '@/project/project-store';
import { addModelLevel } from '@/project/model-levels';
import { DEFAULT_PLAN_CUT_HEIGHT_M, ELEVATION_DIRECTIONS } from '@/project/view-defaults';
import { openProjectView } from '@/project/open-view';
import type { ElevationDirection } from '@/project/types';
import { NewItemDialog, type DialogField, type DialogValues } from './NewItemDialog';

type Kind = 'level' | 'plan' | 'elevation';

const DIRECTION_KEYS = {
  north: 'projectNavigator.props.north',
  south: 'projectNavigator.props.south',
  east: 'projectNavigator.props.east',
  west: 'projectNavigator.props.west',
} as const;

export function useNavigatorDialogs() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Kind | null>(null);
  const models = useViewerStore((s) => s.models);
  const levels = useProjectStore((s) => s.levels);

  const loaded = [...models.values()].filter((m) => m.ifcDataStore);
  const top = levels[0];
  const fields: DialogField[] = [];
  let title = '';
  const submitLabel = t('projectNavigator.dialog.create');
  let onSubmit: (v: DialogValues) => string | null = () => null;

  if (kind === 'level') {
    title = t('projectNavigator.dialog.newLevel');
    fields.push({ key: 'name', label: t('projectNavigator.dialog.name'), type: 'text', initial: `Level ${levels.length}` });
    fields.push({ key: 'elevation', label: t('projectNavigator.dialog.elevation'), type: 'number', initial: top ? Number((top.elevation + 3).toFixed(2)) : 0 });
    if (loaded.length > 1) {
      fields.push({ key: 'model', label: t('projectNavigator.dialog.model'), type: 'select', initial: loaded[0].id, options: loaded.map((m) => ({ value: m.id, label: m.name })) });
    }
    onSubmit = (v) => {
      const modelId = v.model ?? loaded[0]?.id;
      const elevation = Number(v.elevation);
      if (!modelId) return t('projectNavigator.dialog.noModel');
      if (!Number.isFinite(elevation)) return t('projectNavigator.dialog.badNumber');
      const result = addModelLevel(modelId, v.name ?? '', elevation);
      return result.ok ? null : result.error;
    };
  } else if (kind === 'plan') {
    title = t('projectNavigator.dialog.newPlan');
    fields.push({ key: 'level', label: t('projectNavigator.dialog.level'), type: 'select', initial: '0', options: levels.map((l, i) => ({ value: String(i), label: `${l.name} (${l.elevation.toFixed(2)} m)` })) });
    fields.push({ key: 'name', label: t('projectNavigator.dialog.name'), type: 'text', initial: '' });
    fields.push({ key: 'cut', label: t('projectNavigator.props.cutHeight'), type: 'number', initial: DEFAULT_PLAN_CUT_HEIGHT_M });
    onSubmit = (v) => {
      const level = levels[Number(v.level)];
      const cut = Number(v.cut);
      if (!level) return t('projectNavigator.dialog.noLevel');
      if (!Number.isFinite(cut)) return t('projectNavigator.dialog.badNumber');
      const id = addProjectView({ kind: 'plan', name: v.name?.trim() || level.name, level: { ...level, storeyGlobalIds: [...level.storeyGlobalIds] }, cutHeight: cut });
      openProjectView(id);
      return null;
    };
  } else if (kind === 'elevation') {
    title = t('projectNavigator.dialog.newElevation');
    fields.push({ key: 'direction', label: t('projectNavigator.props.facing'), type: 'select', initial: 'north', options: ELEVATION_DIRECTIONS.map((d) => ({ value: d, label: t(DIRECTION_KEYS[d]) })) });
    fields.push({ key: 'name', label: t('projectNavigator.dialog.name'), type: 'text', initial: '' });
    onSubmit = (v) => {
      const direction = (v.direction ?? 'north') as ElevationDirection;
      const id = addProjectView({ kind: 'elevation', name: v.name?.trim() || t('projectNavigator.dialog.elevationName', { direction: t(DIRECTION_KEYS[direction]) }), direction });
      openProjectView(id);
      return null;
    };
  }

  const dialog = (
    <NewItemDialog
      open={kind !== null}
      title={title}
      submitLabel={submitLabel}
      fields={fields}
      onOpenChange={(open) => { if (!open) setKind(null); }}
      onSubmit={onSubmit}
    />
  );
  return { dialog, open: (k: Kind) => setKind(k) };
}
