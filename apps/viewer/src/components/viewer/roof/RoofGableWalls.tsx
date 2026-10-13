/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The roof configurator's gable walls: a wall under every gable edge, of a
 * project wall type (or a plain thickness), its outer face at a distance
 * inside the outline, cut under the roof's covering or under its structure,
 * and flipped when its layers face the wrong way. They are walls like any
 * other (grips, Flip, types) and follow the roof when it is applied.
 */

import type { GableWallSpec, RoofSystemSpec } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { useProjectStore } from '@/project/project-store';
import { gableWallThickness } from '@/project/roof-walls';
import { INPUT, NumberField, Section } from '../joinery/JoineryFields';

const DEFAULT_GABLE_WALLS: GableWallSpec = { enabled: false, thickness: 0.25, offset: 0, flip: false, top: 'structure' };

export function GableWallFields({ spec, onChange }: { spec: RoofSystemSpec; onChange: (spec: RoofSystemSpec) => void }) {
  const { t } = useTranslation();
  const types = (useProjectStore((s) => s.elementTypes) ?? []).filter((e) => e.kind === 'wall');
  const g = { ...DEFAULT_GABLE_WALLS, ...spec.gableWalls };
  const set = (patch: Partial<GableWallSpec>) => onChange({ ...spec, gableWalls: { ...g, ...patch } });
  const gables = spec.rules.filter((r) => r.kind === 'gable').length;
  const typed = types.some((e) => e.id === g.typeId);
  return (
    <Section title={t('roof.gableWalls')}>
      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={g.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        {t('roof.gableWalls.enabled', { count: gables })}
      </label>
      {g.enabled ? (
        <>
          <label className="grid grid-cols-[1fr_9rem] items-center gap-2 text-xs">
            <span className="text-zinc-600 dark:text-zinc-400">{t('roof.gableWalls.type')}</span>
            <select aria-label={t('roof.gableWalls.type')} className={INPUT} value={typed ? g.typeId : ''} onChange={(e) => set({ typeId: e.target.value || undefined })}>
              <option value="">{t('roof.gableWalls.noType')}</option>
              {types.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          {typed
            ? <p className="text-2xs text-zinc-500">{t('roof.gableWalls.typeThickness', { mm: Math.round(gableWallThickness(g) * 1000) })}</p>
            : <NumberField label={t('roof.gableWalls.thickness')} value={g.thickness} onChange={(v) => v !== undefined && v > 0 && set({ thickness: v })} />}
          <NumberField label={t('roof.gableWalls.offset')} value={g.offset} min={-5} onChange={(v) => v !== undefined && set({ offset: v })} />
          <label className="grid grid-cols-[1fr_9rem] items-center gap-2 text-xs">
            <span className="text-zinc-600 dark:text-zinc-400">{t('roof.gableWalls.top')}</span>
            <select aria-label={t('roof.gableWalls.top')} className={INPUT} value={g.top} onChange={(e) => set({ top: e.target.value === 'covering' ? 'covering' : 'structure' })}>
              <option value="structure">{t('roof.gableWalls.top.structure')}</option>
              <option value="covering">{t('roof.gableWalls.top.covering')}</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={g.flip} onChange={(e) => set({ flip: e.target.checked })} />
            {t('roof.gableWalls.flip')}
          </label>
          <p className="text-2xs text-zinc-500">{t('roof.gableWalls.hint')}</p>
        </>
      ) : null}
    </Section>
  );
}
