/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The element's type from the configurators' libraries
 * (`element-types/type-slot.ts`), at the top of the Properties panel and in
 * the Model inspector: a window or door from the joinery catalogue, a wall,
 * slab, column or beam from the element types, a roof from the roof types.
 * Picking another entry retypes and refits the element; "Edit types…" opens
 * the configurator on the current one.
 */

import { useId, useMemo } from 'react';
import { Shapes } from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useViewerStore } from '@/store';
import { toast } from '@/components/ui/toast';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useProjectStore } from '@/project/project-store';
import { changeType, editTypes, typeSlotOf, type TypeSlot } from '@/element-types/type-slot';

const NONE = '__none';
const EDIT = '__edit';

/** The element's slot, recomputed when the model or a library changes. */
export function useTypeSlot(modelId: string | undefined, expressId: number | undefined): TypeSlot | null {
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const elementTypes = useProjectStore((s) => s.elementTypes);
  const joinery = useProjectStore((s) => s.joineryTypes);
  return useMemo(() => {
    void mutationVersion; void elementTypes; void joinery;
    if (!modelId || modelId === 'legacy' || expressId === undefined) return null;
    try { return typeSlotOf(modelId, expressId); } catch { return null; }
  }, [modelId, expressId, mutationVersion, elementTypes, joinery]);
}

/** The picker alone, for a row in another layout. */
export function ElementTypeSelect({ slot, id }: { slot: TypeSlot; id?: string }) {
  const { t } = useTranslation();
  const choose = (value: string) => {
    if (value === EDIT) { editTypes(slot); return; }
    if (value === NONE || value === slot.current) return;
    const result = changeType(slot, value);
    if (result.ok) toast.success(t('elementTypes.changed', { name: slot.options.find((o) => o.id === value)?.label ?? value }));
    else toast.error(t('elementTypes.changeFailed', { reason: result.error }));
  };
  return (
    <Select value={slot.current ?? NONE} onValueChange={choose}>
      <SelectTrigger id={id} data-element-type className="h-7 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {slot.current === null && <SelectItem value={NONE} className="text-xs">{slot.foreign ?? t('elementTypes.noProjectType')}</SelectItem>}
        {slot.options.map((o) => <SelectItem key={o.id} value={o.id} className="text-xs">{o.label}</SelectItem>)}
        <SelectSeparator />
        <SelectItem value={EDIT} className="text-xs">{t('elementTypes.editTypes')}</SelectItem>
      </SelectContent>
    </Select>
  );
}

const LIBRARY: Record<TypeSlot['kind'], TranslationKey> = {
  wall: 'elementTypes.library.wall', slab: 'elementTypes.library.slab', column: 'elementTypes.library.column', beam: 'elementTypes.library.beam',
  door: 'elementTypes.library.door', window: 'elementTypes.library.window', roof: 'elementTypes.library.roof',
};

/** The Properties panel's card. Nothing for an element no configurator covers. */
export function ElementTypeCard({ modelId, expressId }: { modelId: string; expressId: number }) {
  const { t } = useTranslation();
  const id = useId();
  const slot = useTypeSlot(modelId, expressId);
  if (!slot) return null;
  return (
    <section data-element-type-card className="mb-3 border border-overlay-accent/40 bg-overlay-accent/5 px-2 py-1.5">
      <label htmlFor={id} className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground">
        <Shapes className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1">{t('elementTypes.cardTitle')}</span>
        <span className="text-2xs font-normal normal-case tracking-normal text-muted-foreground">{t(LIBRARY[slot.kind])}</span>
      </label>
      <ElementTypeSelect slot={slot} id={id} />
      {slot.options.length === 0 && <p className="mt-1 text-2xs text-muted-foreground">{t('elementTypes.libraryEmpty')}</p>}
    </section>
  );
}
