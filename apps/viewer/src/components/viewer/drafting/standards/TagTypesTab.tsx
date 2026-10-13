/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Tag types editor: the project's tag types on the left (the current one —
 * what TAG places — marked, new / duplicate / delete), the selected type's
 * name, template and classes on the right. The template's `{fields}` are
 * mapped on element parameters; the fields of the selected model element are
 * listed to insert, and the preview fills the template from it (a field it
 * lacks reads a red NaN, as on the drawing).
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { useViewerStore } from '@/store';
import { useProjectStore } from '@/project/project-store';
import { addTagType, removeTagType, updateTagType } from '@/project/drafting-standards';
import { entityFields, entityTagText, fillTemplate } from '@/project/tag-fields';
import { useStandardsDialog } from '@/project/standards-dialog-store';
import { currentStyles, setCurrentStyles, useDraftingSession } from '@/drafting/session';
import type { TagType } from '@/drafting/styles';
import { INPUT, Row } from './StyleTabs';

const WIDE = INPUT.replace('w-32', 'w-full');
const MISSING_COLOR = '#dc2626';

function Preview({ text, missing }: { text: string; missing: ReadonlyArray<[number, number]> }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [a, b] of missing) {
    if (a > at) parts.push(text.slice(at, a));
    parts.push(<span key={a} style={{ color: MISSING_COLOR }}>{text.slice(a, b)}</span>);
    at = b;
  }
  parts.push(text.slice(at));
  return <p className="min-h-6 rounded-sm border border-zinc-200 bg-white px-2 py-1 font-mono text-sm text-zinc-900 dark:border-zinc-800">{parts}</p>;
}

export function TagTypesTab() {
  const { t } = useTranslation();
  useDraftingSession((s) => s.revision);
  const types = useProjectStore((s) => s.tagTypes) ?? [];
  const wanted = useStandardsDialog((s) => s.styleId);
  const [picked, setPicked] = useState<string | null>(null);
  const selectedId = [picked, wanted].find((id) => id && types.some((x) => x.id === id)) ?? types[0]?.id ?? null;
  const type = types.find((x) => x.id === selectedId) ?? null;
  const current = currentStyles().tagType;
  const set = (patch: Partial<Omit<TagType, 'id'>>) => { if (type) updateTagType(type.id, patch); };

  const selection = useViewerStore((s) => s.selectedEntity);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const fields = useMemo(
    () => (selection ? entityFields(selection.modelId, selection.expressId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection?.modelId, selection?.expressId, mutationVersion],
  );
  const preview = type
    ? (selection ? entityTagText(selection.modelId, selection.expressId, type.template) : null) ?? fillTemplate(type.template, () => null)
    : null;

  const create = () => setPicked(addTagType({ name: t('standards.tags.newName', { n: types.length + 1 }), template: '{Tag}', classes: [] }));

  return (
    <div className="flex gap-4 text-xs">
      <div className="w-48 shrink-0 space-y-1 border-r border-zinc-200 pr-2 dark:border-zinc-800">
        <ul className="space-y-0.5">
          {types.map((s) => (
            <li key={s.id} className={`flex items-center gap-1 rounded-sm px-1 ${s.id === selectedId ? 'bg-primary/10' : ''}`}>
              <button type="button" className="min-w-0 flex-1 truncate py-1 text-left" onClick={() => setPicked(s.id)}>
                {s.name}{s.id === current ? <span className="ml-1 text-2xs text-primary">{t('standards.style.current')}</span> : null}
              </button>
              <IconButton label={`${t('standards.style.duplicate')} ${s.name}`} className="size-6"
                onClick={() => setPicked(addTagType({ name: t('standards.style.copyName', { name: s.name }), template: s.template, classes: [...s.classes] }))}>
                <Copy className="size-3" />
              </IconButton>
              <IconButton label={`${t('standards.style.delete')} ${s.name}`} className="size-6"
                onClick={() => { if (current === s.id) setCurrentStyles({ tagType: '' }); removeTagType(s.id); }}>
                <Trash2 className="size-3" />
              </IconButton>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="outline" className="w-full" onClick={create}><Plus className="mr-1 size-3" />{t('standards.tags.add')}</Button>
      </div>
      {type ? (
        <div className="flex-1 space-y-1">
          <Row label={t('standards.style.name')}>
            <input aria-label={t('standards.style.name')} className={INPUT} defaultValue={type.name} key={type.id + type.name}
              onBlur={(e) => e.target.value.trim() && set({ name: e.target.value.trim() })} />
          </Row>
          <label className="block space-y-1">
            <span className="text-zinc-500">{t('standards.tags.template')}</span>
            <input aria-label={t('standards.tags.template')} className={`${WIDE} font-mono`} value={type.template}
              onChange={(e) => set({ template: e.target.value })} />
          </label>
          <label className="block space-y-1">
            <span className="text-zinc-500">{t('standards.tags.classes')}</span>
            <input aria-label={t('standards.tags.classes')} className={WIDE} placeholder={t('standards.tags.classesAny')}
              defaultValue={type.classes.join(', ')} key={type.id + type.classes.join()}
              onBlur={(e) => set({ classes: e.target.value.split(/[,\s]+/).map((c) => c.trim()).filter(Boolean) })} />
          </label>
          <div className="pt-1">
            <span className="text-zinc-500">{t('standards.tags.preview')}</span>
            {preview ? <Preview {...preview} /> : null}
            <p className="text-2xs text-zinc-500">{selection ? t('standards.tags.previewSelected') : t('standards.tags.previewNone')}</p>
          </div>
          <Button size="sm" variant="outline" disabled={current === type.id} onClick={() => setCurrentStyles({ tagType: type.id })}>
            {t('standards.tags.makeCurrent')}
          </Button>
        </div>
      ) : (
        <p className="flex-1 text-zinc-500">{t('standards.tags.empty')}</p>
      )}
      <div className="w-[320px] shrink-0 space-y-2">
        <p className="text-2xs text-zinc-500">{t('standards.tags.rule')}</p>
        {type && fields.length ? (
          <>
            <p className="text-zinc-500">{t('standards.tags.fields')}</p>
            <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-sm border border-zinc-200 p-1 dark:border-zinc-800">
              {fields.map((f) => (
                <li key={f.field}>
                  <button type="button" className="flex w-full items-baseline justify-between gap-2 rounded-sm px-1 py-0.5 text-left hover:bg-primary/10"
                    title={t('standards.tags.insert')} onClick={() => set({ template: `${type.template}{${f.field}}` })}>
                    <span className="truncate font-mono">{f.field}</span>
                    <span className="max-w-[40%] truncate text-zinc-500">{f.value}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
