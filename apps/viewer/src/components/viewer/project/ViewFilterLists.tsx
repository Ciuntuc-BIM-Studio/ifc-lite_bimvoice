/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The view's visibility by IFC class (every class the loaded models draw,
 * with its element count) and by IFC presentation layer (the CAD layers of
 * the IFC). A filter box narrows the classes; "all" / "none" set a list at once.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from '@/i18n';
import { updateProjectView } from '@/project/project-store';
import { modelClassCounts, modelLayerNames } from '@/project/model-classes-layers';
import type { ProjectView, ViewGraphics } from '@/project/types';

type Key = 'classes' | 'layers';

function FilterList({ title, items, hidden, onSet, empty, search }: {
  title: string; items: Array<[name: string, label: string]>; hidden: (name: string) => boolean;
  onSet: (names: string[], visible: boolean) => void; empty: string; search?: boolean;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const shown = query ? items.filter(([, label]) => label.toLowerCase().includes(query.toLowerCase())) : items;
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">{title}</span>
        <span className="flex-1" />
        <button type="button" className="text-2xs text-zinc-500 hover:underline" disabled={!shown.length} onClick={() => onSet(shown.map(([n]) => n), true)}>{t('viewGraphics.all')}</button>
        <button type="button" className="text-2xs text-zinc-500 hover:underline" disabled={!shown.length} onClick={() => onSet(shown.map(([n]) => n), false)}>{t('viewGraphics.noneShown')}</button>
      </div>
      {search && items.length > 8 && (
        <input aria-label={t('viewGraphics.filterClasses')} placeholder={t('viewGraphics.filterClasses')} value={query} onChange={(e) => setQuery(e.target.value)}
          className="h-7 rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1 text-xs" />
      )}
      <div className="max-h-56 overflow-y-auto rounded-sm border border-zinc-200 dark:border-zinc-800 p-1">
        {shown.length === 0 && <p className="p-1 text-2xs text-zinc-500">{empty}</p>}
        {shown.map(([name, label]) => (
          <label key={name} className="flex items-center gap-2 px-1 py-0.5 text-xs">
            <input type="checkbox" checked={!hidden(name)} onChange={(e) => onSet([name], e.target.checked)} />
            <span className="truncate">{label}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

export function ViewFilterLists({ view, open }: { view: ProjectView; open: boolean }) {
  const { t } = useTranslation();
  // Read when the dialog opens: the models do not change under an open dialog.
  const classes = useMemo(() => (open ? modelClassCounts() : []), [open]);
  const layers = useMemo(() => (open ? modelLayerNames() : []), [open]);
  const graphics: ViewGraphics = view.graphics ?? {};
  const set = (key: Key) => (names: string[], visible: boolean) => {
    const next: Record<string, { visible?: boolean }> = { ...graphics[key] };
    for (const name of names) {
      if (visible) delete next[name];
      else next[name] = { visible: false };
    }
    updateProjectView(view.id, { graphics: { ...graphics, [key]: Object.keys(next).length ? next : undefined } });
  };
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <FilterList title={t('viewGraphics.byClass')} search empty={t('viewGraphics.noClasses')}
        items={classes.map(([k, name, n]) => [k, `${name} · ${n}`])} hidden={(k) => graphics.classes?.[k]?.visible === false} onSet={set('classes')} />
      <FilterList title={t('viewGraphics.byLayer')} empty={t('viewGraphics.noLayers')}
        items={layers.map((n) => [n, n])} hidden={(n) => graphics.layers?.[n]?.visible === false} onSet={set('layers')} />
    </div>
  );
}
