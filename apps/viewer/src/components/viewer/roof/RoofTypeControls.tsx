/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The roof configurator's link to the project's roof types: pick one to take
 * its covering and structure (the roof's outline and edge rules stay), or
 * save this roof's build-up as a new type. A roof made from a type is
 * rebuilt when the type changes.
 */

import { coveringLayers, type RoofSystemSpec } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { useProjectStore } from '@/project/project-store';
import { addElementType, elementType, updateElementType } from '@/element-types/catalog';
import { roofSpecFromType } from '@/element-types/model-sync';
import type { RoofTypeSpec } from '@/element-types/spec';

const NONE = '';

export function RoofTypeControls({ spec, onChange }: { spec: RoofSystemSpec; onChange: (spec: RoofSystemSpec) => void }) {
  const { t } = useTranslation();
  const types = (useProjectStore((s) => s.elementTypes) ?? []).filter((x): x is RoofTypeSpec => x.kind === 'roof');
  const choose = (id: string) => {
    const type = types.find((x) => x.id === id);
    if (type) onChange(roofSpecFromType(spec, type));
    else onChange({ ...spec, typeId: undefined });
  };
  const saveAsType = () => {
    const id = addElementType('roof');
    const created = elementType(id);
    if (!created || created.kind !== 'roof') return;
    const eave = spec.rules.find((r) => r.kind === 'eave') ?? spec.rules[0];
    const eaves = spec.rules.filter((r) => r.kind === 'eave').length;
    const type: RoofTypeSpec = {
      ...created, name: spec.name,
      shape: eaves === spec.rules.length ? 'hip' : eaves === 1 ? 'mono' : 'gable',
      pitch: eave?.pitch ?? created.pitch, overhang: eave?.overhang ?? created.overhang,
      layers: coveringLayers(spec.covering).map((l) => ({ ...l })), color: spec.covering.color, timberColor: spec.timberColor,
      structure: structuredClone(spec.structure),
    };
    updateElementType(type);
    onChange({ ...spec, typeId: id });
    toast.success(t('elementTypes.savedAsType', { name: type.name }));
  };
  return (
    <div className="flex items-center gap-2 text-xs">
      <label className="flex items-center gap-1.5">
        <span className="text-zinc-500">{t('elementTypes.changeType')}</span>
        <select aria-label={t('elementTypes.changeType')} className="h-7 rounded-sm border border-zinc-300 bg-transparent px-1 dark:border-zinc-700"
          value={spec.typeId && types.some((x) => x.id === spec.typeId) ? spec.typeId : NONE} onChange={(e) => choose(e.target.value)}>
          <option value={NONE}>{t('elementTypes.noProjectType')}</option>
          {types.map((x) => <option key={x.id} value={x.id}>{x.mark ? `${x.mark} · ${x.name}` : x.name}</option>)}
        </select>
      </label>
      <Button size="sm" variant="ghost" onClick={saveAsType}>{t('elementTypes.saveAsType')}</Button>
    </div>
  );
}
