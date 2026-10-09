/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A structural element's cut priority (`project/cut-priorities.ts`): where
 * it overlaps another, the higher priority cuts the lower. Its own value
 * (0 … 100) or its class's; editing it re-cuts the element, one undo step.
 */

import { useId, useMemo } from 'react';
import { CUT_PRIORITY_PROP, CUT_PRIORITY_PSET, DEFAULT_CUT_PRIORITY, cutPriorityOf } from '@ifc-lite/create';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n';
import { useViewerStore } from '@/store';
import { setCutPriority } from '@/project/cut-priorities';
import { CommitField, InspectorCaption, InspectorRow, InspectorSection } from './InspectorControls';
import type { InspectorSelection } from './useInspectorTarget';

export function CutPrioritySection({ selection }: { selection: InspectorSelection }) {
  const { t } = useTranslation();
  const id = useId();
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const { modelId, expressId, live } = selection;
  const read = useMemo(() => {
    void mutationVersion;
    const priority = cutPriorityOf(live.dataStore, expressId, live.view);
    const own = live.view?.getPropertyValue(expressId, CUT_PRIORITY_PSET, CUT_PRIORITY_PROP) ?? null;
    return { priority, own: own !== null };
  }, [live, expressId, mutationVersion]);
  if (read.priority === null) return null;
  const classDefault = DEFAULT_CUT_PRIORITY[selection.ifcClass.toUpperCase()];
  const commit = (value: string) => {
    const n = Number(value.replace(',', '.'));
    if (!Number.isFinite(n)) return false;
    return setCutPriority(modelId, expressId, n);
  };
  return (
    <InspectorSection title={t('cutPriority.title')}>
      <InspectorRow label={t('cutPriority.label')} htmlFor={id}>
        <div className="flex items-center gap-1">
          <CommitField id={id} value={String(read.priority)} onCommit={commit} className="flex-1" />
          {read.own && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-2xs" onClick={() => setCutPriority(modelId, expressId, null)}>
              {t('cutPriority.reset')}
            </Button>
          )}
        </div>
      </InspectorRow>
      <InspectorCaption>{t('cutPriority.hint', { value: classDefault ?? read.priority })}</InspectorCaption>
    </InspectorSection>
  );
}
