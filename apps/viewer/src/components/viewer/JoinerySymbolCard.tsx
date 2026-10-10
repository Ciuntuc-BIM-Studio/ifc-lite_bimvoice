/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which configurator entry draws a door or window the model does not type
 * itself (the project's symbol mapping, `joinery/symbol-mapping.ts`): how it
 * was found (by name, by dimensions, chosen), and a picker to choose another
 * — for this element or for every element of its IFC type — or none, or to
 * go back to the automatic rules. The model is not changed.
 */

import { useId, useMemo, useState } from 'react';
import { Stamp } from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useViewerStore } from '@/store';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useProjectStore } from '@/project/project-store';
import { drawnJoinery, elementFacts } from '@/joinery/mapped-joinery';
import { currentMapping, setElementSymbol, setTypeSymbol } from '@/joinery/mapping-actions';
import { openJoinery } from '@/joinery/dialog-store';

const AUTO = '__auto';
const NONE = '__none';
const EDIT = '__edit';

const SOURCE: Record<string, TranslationKey> = {
  element: 'joinerySymbol.source.element', type: 'joinerySymbol.source.type', name: 'joinerySymbol.source.name', dimensions: 'joinerySymbol.source.dimensions',
};

export function JoinerySymbolCard({ modelId, expressId }: { modelId: string; expressId: number }) {
  const { t } = useTranslation();
  const id = useId();
  const [scope, setScope] = useState<'element' | 'type'>('element');
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const catalogue = useProjectStore((s) => s.joineryTypes);
  const mapping = useProjectStore((s) => s.joineryMapping);
  const read = useMemo(() => {
    void mutationVersion; void catalogue; void mapping;
    const facts = elementFacts(modelId, expressId);
    return facts ? { facts, drawn: drawnJoinery(modelId, expressId) } : null;
  }, [modelId, expressId, mutationVersion, catalogue, mapping]);
  // Not a door / window, or typed by the model itself (its type card covers it).
  if (!read || read.drawn?.source === 'model') return null;
  const { facts, drawn } = read;
  const entries = (catalogue ?? []).filter((e) => e.kind === facts.kind && e.id);
  const m = currentMapping();
  const manual = scope === 'type'
    ? (facts.typeGlobalId ? m.types[facts.typeGlobalId] : undefined)
    : (facts.globalId ? m.elements[facts.globalId] : undefined);
  const value = manual === undefined ? AUTO : manual === null ? NONE : manual;
  const choose = (v: string) => {
    if (v === EDIT) { openJoinery(drawn?.entry?.id ?? null); return; }
    const choice = v === AUTO ? undefined : v === NONE ? null : v;
    if (scope === 'type' && facts.typeGlobalId) setTypeSymbol(facts.typeGlobalId, choice);
    else if (facts.globalId) setElementSymbol([facts.globalId], choice);
  };
  const status = drawn?.entry
    ? t('joinerySymbol.drawnAs', { name: `${drawn.entry.mark} · ${drawn.entry.name}`, how: t(SOURCE[drawn.source] ?? SOURCE.name) })
    : t('joinerySymbol.fromMesh');
  return (
    <section data-joinery-symbol-card className="mb-3 border border-overlay-accent/40 bg-overlay-accent/5 px-2 py-1.5">
      <label htmlFor={id} className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground">
        <Stamp className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1">{t('joinerySymbol.title')}</span>
      </label>
      <p className="mb-1 text-2xs text-muted-foreground">{status}</p>
      {facts.typeGlobalId ? (
        <div role="radiogroup" aria-label={t('joinerySymbol.scope')} className="mb-1 flex gap-3 text-2xs">
          {(['element', 'type'] as const).map((s) => (
            <label key={s} className="flex items-center gap-1">
              <input type="radio" name={`${id}-scope`} checked={scope === s} onChange={() => setScope(s)} />
              {t(s === 'element' ? 'joinerySymbol.scope.element' : 'joinerySymbol.scope.type')}
            </label>
          ))}
        </div>
      ) : null}
      <Select value={value} onValueChange={choose}>
        <SelectTrigger id={id} data-joinery-symbol className="h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO} className="text-xs">{t('joinerySymbol.auto')}</SelectItem>
          <SelectItem value={NONE} className="text-xs">{t('joinerySymbol.none')}</SelectItem>
          {entries.map((e) => <SelectItem key={e.id} value={e.id!} className="text-xs">{`${e.mark} · ${e.name}`}</SelectItem>)}
          <SelectSeparator />
          <SelectItem value={EDIT} className="text-xs">{t('joinerySymbol.openLibrary')}</SelectItem>
        </SelectContent>
      </Select>
      {entries.length === 0 && <p className="mt-1 text-2xs text-muted-foreground">{t('joinerySymbol.libraryEmpty')}</p>}
    </section>
  );
}
