/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which typical cross-section the corridor uses: pick one from the
 * project's library (its lanes, shoulder, courses and slopes replace the
 * corridor's), save the corridor's own as a new one, or write a changed one
 * back to the library entry it came from.
 */

import { useEffect, useState } from 'react';
import type { CorridorSpec } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { useProjectStore } from '@/project/project-store';
import { addTypicalSection, ensureStarterTypicalSections, updateTypicalSection } from '@/civil/assembly-library';
import { INPUT } from '../joinery/JoineryFields';

export function TypicalSectionBar({ spec, onChange }: { spec: CorridorSpec; onChange: (spec: CorridorSpec) => void }) {
  const { t } = useTranslation();
  const library = useProjectStore((s) => s.typicalSections) ?? [];
  const [naming, setNaming] = useState<string | null>(null);
  useEffect(() => { ensureStarterTypicalSections(); }, []);
  const current = library.find((x) => x.id === spec.typicalSectionId) ?? null;
  const changed = !!current && JSON.stringify(current.assembly) !== JSON.stringify(spec.assembly);
  const pick = (id: string) => {
    const entry = library.find((x) => x.id === id);
    if (entry) onChange({ ...spec, typicalSectionId: entry.id, assembly: structuredClone(entry.assembly) });
  };
  return (
    <div className="space-y-1 rounded-md border border-zinc-200 p-1.5 text-xs dark:border-zinc-700">
      <label className="grid grid-cols-[auto_1fr] items-center gap-2">
        <span className="text-zinc-600 dark:text-zinc-400">{t('civil.typical.label')}</span>
        <select aria-label={t('civil.typical.label')} className={INPUT} value={current ? current.id : ''} onChange={(e) => pick(e.target.value)}>
          {!current ? <option value="">{t('civil.typical.own')}</option> : null}
          {library.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>
      {changed ? <p className="text-2xs text-amber-700 dark:text-amber-400">{t('civil.typical.changed', { name: current!.name })}</p> : null}
      <div className="flex flex-wrap gap-1">
        {changed ? (
          <>
            <Button size="sm" variant="outline" onClick={() => { updateTypicalSection(current!.id, spec.assembly); toast.success(t('civil.typical.updated', { name: current!.name })); }}>{t('civil.typical.update')}</Button>
            <Button size="sm" variant="ghost" onClick={() => pick(current!.id)}>{t('civil.typical.revert')}</Button>
          </>
        ) : null}
        {naming === null ? (
          <Button size="sm" variant="ghost" onClick={() => setNaming(spec.name)}>{t('civil.typical.saveAs')}</Button>
        ) : (
          <span className="flex flex-1 gap-1">
            <input aria-label={t('civil.typical.name')} className={INPUT} value={naming} onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setNaming(null); }} />
            <Button size="sm" disabled={!naming.trim()} onClick={() => {
              const id = addTypicalSection(naming.trim(), spec.assembly);
              onChange({ ...spec, typicalSectionId: id });
              toast.success(t('civil.typical.saved', { name: naming.trim() }));
              setNaming(null);
            }}>{t('civil.typical.save')}</Button>
          </span>
        )}
      </div>
    </div>
  );
}
