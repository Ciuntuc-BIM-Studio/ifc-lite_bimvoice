/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The configurator's symbol mapping fields (`joinery/symbol-mapping.ts`):
 * the automatic rules for the whole project (by name, by dimensions within a
 * tolerance), and for the selected entry the extra names it matches and
 * "Map selection", which makes it the symbol of the selected doors or
 * windows. Only the project changes, never a model.
 */

import { Stamp } from 'lucide-react';
import type { JoinerySpec } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { useProjectStore } from '@/project/project-store';
import { DEFAULT_JOINERY_MAPPING } from '@/joinery/symbol-mapping';
import { mapSelectionTo, setEntryAliases, setMappingRules } from '@/joinery/mapping-actions';

const INPUT = 'h-7 w-full rounded-sm border border-zinc-300 bg-transparent px-1 text-xs dark:border-zinc-700';

/** Project-wide rules (the configurator's side bar). */
export function MappingRules() {
  const { t } = useTranslation();
  const m = useProjectStore((s) => s.joineryMapping) ?? DEFAULT_JOINERY_MAPPING;
  return (
    <fieldset className="space-y-1 text-2xs text-zinc-500">
      <legend className="mb-0.5">{t('joinerySymbol.rules')}</legend>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={m.byName} onChange={(e) => setMappingRules({ byName: e.target.checked })} />
        {t('joinerySymbol.rules.byName')}
      </label>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={m.byDimensions} onChange={(e) => setMappingRules({ byDimensions: e.target.checked })} />
        {t('joinerySymbol.rules.byDimensions')}
      </label>
      <label className="flex items-center justify-between gap-2">
        <span>{t('joinerySymbol.rules.tolerance')}</span>
        <input
          aria-label={t('joinerySymbol.rules.tolerance')} className={`${INPUT} w-16`} inputMode="numeric" disabled={!m.byDimensions}
          defaultValue={Math.round(m.tolerance * 1000)} key={m.tolerance}
          onBlur={(e) => {
            const mm = Number(e.target.value.replace(',', '.'));
            if (Number.isFinite(mm) && mm >= 0) setMappingRules({ tolerance: mm / 1000 });
          }}
        />
      </label>
    </fieldset>
  );
}

/** The selected entry's aliases and "Map selection". */
export function EntryMapping({ entry }: { entry: JoinerySpec }) {
  const { t } = useTranslation();
  const aliases = useProjectStore((s) => (entry.id ? s.joineryMapping?.aliases[entry.id] : undefined)) ?? [];
  if (!entry.id) return null;
  const id = entry.id;
  const mapSelection = () => {
    const count = mapSelectionTo(id, entry.kind);
    if (count === 0) toast.info(t('joinerySymbol.nothingSelected', { kind: t(entry.kind === 'door' ? 'joinery.kind.door' : 'joinery.kind.window') }));
    else toast.success(t('joinerySymbol.mapped', { count, name: entry.name }));
  };
  return (
    <section data-joinery-mapping className="space-y-1 rounded-sm border border-zinc-200 p-2 dark:border-zinc-800">
      <h3 className="flex items-center gap-1.5 font-semibold"><Stamp className="size-3.5" aria-hidden="true" />{t('joinerySymbol.entryTitle')}</h3>
      <label className="block space-y-0.5">
        <span className="block text-zinc-500">{t('joinerySymbol.aliases')}</span>
        <input
          aria-label={t('joinerySymbol.aliases')} className={INPUT} placeholder={t('joinerySymbol.aliasesHint')}
          defaultValue={aliases.join(', ')} key={aliases.join('|')}
          onBlur={(e) => setEntryAliases(id, e.target.value.split(/[,;\n]/))}
        />
      </label>
      <Button size="sm" variant="outline" onClick={mapSelection}>{t('joinerySymbol.mapSelection')}</Button>
    </section>
  );
}
