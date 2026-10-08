/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which drafting layers a sheet viewport shows, on top of its view's own
 * visibility: the same view can sit in two viewports with different layers.
 * Layers off everywhere (themselves, their group or the view) are listed
 * greyed — the viewport cannot bring back what its view hides.
 */

import { useTranslation } from '@/i18n';
import { useProjectStore } from '@/project/project-store';
import { toggleViewportLayer } from '@/project/drafting-standards';
import { layerShows } from '@/drafting/styles';
import type { SheetViewport } from '@/project/types';

export function ViewportLayers({ sheetId, viewport }: { sheetId: string; viewport: SheetViewport }) {
  const { t } = useTranslation();
  const layers = useProjectStore((s) => s.draftLayers);
  const groups = useProjectStore((s) => s.layerGroups) ?? [];
  const view = useProjectStore((s) => s.views.find((v) => v.id === viewport.viewId));
  const sections = [
    ...groups.map((g) => ({ name: g.name, members: layers.filter((l) => l.group === g.id) })),
    { name: t('standards.layer.ungrouped'), members: layers.filter((l) => !l.group || !groups.some((g) => g.id === l.group)) },
  ].filter((s) => s.members.length > 0);
  return (
    <div className="space-y-1">
      <h4 className="pt-1 font-semibold">{t('standards.viewport.layers')}</h4>
      {sections.map((section) => (
        <div key={section.name}>
          {groups.length > 0 ? <div className="text-2xs uppercase tracking-wider text-zinc-500">{section.name}</div> : null}
          {section.members.map((l) => {
            const available = layerShows(l, groups, { view: view?.hiddenLayers });
            return (
              <label key={l.id} className={`flex items-center gap-2 py-0.5 ${available ? '' : 'opacity-50'}`}>
                <input type="checkbox" disabled={!available} checked={available && !viewport.hiddenLayers?.includes(l.id)} onChange={() => toggleViewportLayer(sheetId, viewport.id, l.id)} />
                <span className="inline-block size-2.5 rounded-sm border border-zinc-300" style={{ background: l.color }} />
                <span className="truncate">{l.name}</span>
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}
