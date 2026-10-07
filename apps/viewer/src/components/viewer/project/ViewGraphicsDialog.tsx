/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Visibility / Graphics of one view (`project/view-graphics.ts`): its
 * graphic preset, and per category its visibility, line colour, cut fill,
 * line weight and cut hatch. Every change applies to the view at once.
 */

import { useMemo } from 'react';
import { RotateCcw } from 'lucide-react';
import { BUILT_IN_PRESETS } from '@ifc-lite/drawing-2d';
import { useTranslation, type TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { updateProjectView, useProjectStore } from '@/project/project-store';
import { DEFAULT_VIEW_PRESET, VIEW_CATEGORIES } from '@/project/view-graphics';
import { builtInPatterns } from '@/drafting/hatch/library';
import { parsePat } from '@/drafting/hatch/pattern';
import type { CategoryGraphics, CategoryLineWeight, ProjectView } from '@/project/types';

const WEIGHTS: readonly CategoryLineWeight[] = ['heavy', 'medium', 'light', 'hairline'];
const NONE = '__none__';
const BY_PRESET = '';

const select = 'h-7 rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1 text-xs';

interface Props {
  view: ProjectView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ViewGraphicsDialog({ view, open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const patternText = useProjectStore((s) => s.hatchPatterns ?? '');
  const patterns = useMemo(() => [...builtInPatterns(), ...parsePat(patternText).patterns].map((p) => p.name), [patternText]);
  const graphics = view.graphics ?? {};
  const presetId = graphics.presetId === undefined ? DEFAULT_VIEW_PRESET : graphics.presetId;

  const setPreset = (value: string) => updateProjectView(view.id, { graphics: { ...graphics, presetId: value === NONE ? null : value } });
  const setCategory = (id: string, patch: Partial<CategoryGraphics> | null) => {
    const categories = { ...graphics.categories };
    if (patch === null) delete categories[id];
    else {
      const next: CategoryGraphics = { ...categories[id], ...patch };
      for (const key of Object.keys(next) as (keyof CategoryGraphics)[]) if (next[key] === undefined) delete next[key];
      if (Object.keys(next).length === 0) delete categories[id];
      else categories[id] = next;
    }
    updateProjectView(view.id, { graphics: { ...graphics, categories } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[860px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('viewGraphics.title', { view: view.name })}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">{t('viewGraphics.preset')}</span>
          <select aria-label={t('viewGraphics.preset')} className={select} value={presetId ?? NONE} onChange={(e) => setPreset(e.target.value)}>
            <option value={NONE}>{t('viewGraphics.presetNone')}</option>
            {BUILT_IN_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => updateProjectView(view.id, { graphics: undefined })}>{t('viewGraphics.reset')}</Button>
        </div>
        <p className="text-xs text-zinc-500">{t('viewGraphics.hint')}</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="py-1 font-medium">{t('viewGraphics.category')}</th>
              <th className="py-1 font-medium">{t('viewGraphics.visible')}</th>
              <th className="py-1 font-medium">{t('viewGraphics.lineColor')}</th>
              <th className="py-1 font-medium">{t('viewGraphics.fillColor')}</th>
              <th className="py-1 font-medium">{t('viewGraphics.lineWeight')}</th>
              <th className="py-1 font-medium">{t('viewGraphics.hatch')}</th>
              <th className="py-1 font-medium">{t('viewGraphics.hatchScale')}</th>
              <th><span className="sr-only">{t('viewGraphics.reset')}</span></th>
            </tr>
          </thead>
          <tbody>
            {VIEW_CATEGORIES.map((category) => {
              const g = graphics.categories?.[category.id] ?? {};
              const name = t(category.labelKey as TranslationKey);
              return (
                <tr key={category.id} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="py-1 pr-2 font-medium">{name}</td>
                  <td className="py-1">
                    <input type="checkbox" aria-label={`${name} · ${t('viewGraphics.visible')}`} checked={g.visible !== false}
                      onChange={(e) => setCategory(category.id, { visible: e.target.checked ? undefined : false })} />
                  </td>
                  <td className="py-1"><ColorField label={`${name} · ${t('viewGraphics.lineColor')}`} value={g.lineColor} byPreset={t('viewGraphics.byPreset')} onChange={(v) => setCategory(category.id, { lineColor: v })} /></td>
                  <td className="py-1"><ColorField label={`${name} · ${t('viewGraphics.fillColor')}`} value={g.fillColor} byPreset={t('viewGraphics.byPreset')} onChange={(v) => setCategory(category.id, { fillColor: v })} /></td>
                  <td className="py-1">
                    <select aria-label={`${name} · ${t('viewGraphics.lineWeight')}`} className={select} value={g.lineWeight ?? BY_PRESET}
                      onChange={(e) => setCategory(category.id, { lineWeight: (e.target.value || undefined) as CategoryLineWeight | undefined })}>
                      <option value={BY_PRESET}>{t('viewGraphics.byPreset')}</option>
                      {WEIGHTS.map((w) => <option key={w} value={w}>{t(`viewGraphics.weight.${w}` as TranslationKey)}</option>)}
                    </select>
                  </td>
                  <td className="py-1">
                    <select aria-label={`${name} · ${t('viewGraphics.hatch')}`} className={select} value={g.cutHatch ?? BY_PRESET}
                      onChange={(e) => setCategory(category.id, { cutHatch: e.target.value || undefined })}>
                      <option value={BY_PRESET}>{t('viewGraphics.none')}</option>
                      {patterns.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                  <td className="py-1">
                    <input type="number" min={0.05} step={0.25} aria-label={`${name} · ${t('viewGraphics.hatchScale')}`}
                      className="h-7 w-16 rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1 text-right tabular-nums"
                      value={g.hatchScale ?? 1} disabled={!g.cutHatch}
                      onChange={(e) => { const v = Number(e.target.value); if (v > 0) setCategory(category.id, { hatchScale: v === 1 ? undefined : v }); }} />
                  </td>
                  <td className="py-1 text-right">
                    <IconButton label={t('viewGraphics.resetRow', { category: name })} className="size-6" onClick={() => setCategory(category.id, null)}>
                      <RotateCcw className="size-3.5" />
                    </IconButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t('viewGraphics.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A colour swatch that can also be "by preset" (unset). */
function ColorField({ label, value, byPreset, onChange }: { label: string; value: string | undefined; byPreset: string; onChange: (v: string | undefined) => void }) {
  return (
    <div className="flex items-center gap-1">
      <input type="color" aria-label={label} className="h-6 w-8 cursor-pointer rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent"
        value={value ?? '#000000'} onChange={(e) => onChange(e.target.value)} />
      {value ? (
        <button type="button" className="text-2xs text-zinc-500 hover:underline" onClick={() => onChange(undefined)}>{byPreset}</button>
      ) : <span className="text-2xs text-zinc-400">{byPreset}</span>}
    </div>
  );
}
