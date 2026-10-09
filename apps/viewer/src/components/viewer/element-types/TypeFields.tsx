/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The fields of an element type entry, per kind: a layer build-up (walls,
 * slabs, roof coverings), a cross-section (columns, beams), a roof's form
 * and structure system, an opening's size. Lengths are typed in millimetres.
 */

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { catalogLayerColour, type ProfileSectionType } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { IconButton } from '@/components/ui/icon-button';
import { PROFILE_FIELDS, PROFILE_KINDS, PROFILE_KIND_LABEL, DEFAULT_SECTIONS, sectionDimensions } from '@/lib/profile-section/profile-kinds';
import { layersThickness, type ElementTypeSpec, type TypeLayer } from '@/element-types/spec';

const CELL = 'h-6 w-full rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1 tabular-nums';

/** A length field in millimetres over metres; commits on blur / Enter when positive (or zero with `zero`). */
export function Mm({ label, value, onCommit, zero = false }: { label: string; value: number; onCommit: (metres: number) => void; zero?: boolean }) {
  return (
    <input aria-label={label} className={CELL} inputMode="decimal" defaultValue={Math.round(value * 10000) / 10} key={value}
      onBlur={(e) => {
        const v = Number(e.target.value.replace(',', '.'));
        if (Number.isFinite(v) && (v > 0 || (zero && v === 0))) onCommit(v / 1000);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[8rem_1fr] items-center gap-2">
      <span className="text-zinc-500">{label}</span>
      <span className="min-w-0">{children}</span>
    </label>
  );
}

/** A build-up, first layer first: colour, material name and thickness per row. */
export function LayerTable({ layers, onChange, caption }: { layers: TypeLayer[]; onChange: (layers: TypeLayer[]) => void; caption: string }) {
  const { t } = useTranslation();
  const set = (next: TypeLayer[]) => { if (next.length) onChange(next); };
  const patch = (i: number, p: Partial<TypeLayer>) => set(layers.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...layers];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    set(next);
  };
  return (
    <div className="space-y-1">
      <p className="text-zinc-500">{caption}</p>
      <table className="w-full">
        <thead>
          <tr className="text-left text-zinc-500">
            <th className="w-6" aria-label={t('elementTypes.layer.colour')} />
            <th className="font-medium">{t('elementTypes.layer.material')}</th>
            <th className="w-20 font-medium">{t('elementTypes.layer.thickness')}</th>
            <th className="w-20" aria-label={t('elementTypes.layer.actions')} />
          </tr>
        </thead>
        <tbody>
          {layers.map((l, i) => (
            <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
              <td>
                <input type="color" aria-label={`${t('elementTypes.layer.colour')} ${i + 1}`} className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0"
                  value={catalogLayerColour(layers, i)} onChange={(e) => patch(i, { color: e.target.value })} />
              </td>
              <td>
                <input aria-label={`${t('elementTypes.layer.material')} ${i + 1}`} className={CELL} defaultValue={l.name} key={`${i}:${l.name}`}
                  onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== l.name && patch(i, { name: e.target.value.trim() })} />
              </td>
              <td><Mm label={`${t('elementTypes.layer.thickness')} ${i + 1}`} value={l.thickness} onCommit={(v) => patch(i, { thickness: v })} /></td>
              <td className="flex justify-end">
                <IconButton label={t('elementTypes.layer.up')} className="size-6" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-3" /></IconButton>
                <IconButton label={t('elementTypes.layer.down')} className="size-6" disabled={i === layers.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-3" /></IconButton>
                <IconButton label={t('elementTypes.layer.remove')} className="size-6" disabled={layers.length === 1} onClick={() => set(layers.filter((_, k) => k !== i))}><Trash2 className="size-3" /></IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between">
        <button type="button" className="flex items-center gap-1 rounded-sm border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          onClick={() => set([...layers, { name: t('elementTypes.layer.new'), thickness: 0.02 }])}>
          <Plus className="size-3" />{t('elementTypes.layer.add')}
        </button>
        <span className="tabular-nums text-zinc-500">{t('elementTypes.layer.total', { mm: Math.round(layersThickness(layers) * 10000) / 10 })}</span>
      </div>
    </div>
  );
}

/** A column's or beam's cross-section: its kind and dimensions. */
function SectionFields({ spec, onChange }: { spec: Extract<ElementTypeSpec, { kind: 'column' | 'beam' }>; onChange: (spec: ElementTypeSpec) => void }) {
  const { t } = useTranslation();
  const type = spec.section.Type;
  const dims = sectionDimensions(spec.section);
  const setKind = (kind: ProfileSectionType) => onChange({
    ...spec, section: kind === 'Rectangle' ? { Type: 'Rectangle', XDim: 0.3, YDim: 0.3 } : structuredClone(DEFAULT_SECTIONS[kind]),
  });
  return (
    <>
      <Field label={t('elementTypes.section')}>
        <select aria-label={t('elementTypes.section')} className={CELL} value={type} onChange={(e) => setKind(e.target.value as ProfileSectionType)}>
          {PROFILE_KINDS.map((k) => <option key={k} value={k}>{t(PROFILE_KIND_LABEL[k])}</option>)}
        </select>
      </Field>
      {PROFILE_FIELDS[type].map((f) => (
        <Field key={f.name} label={`${t(f.labelKey)} (mm)`}>
          <Mm label={t(f.labelKey)} value={dims[f.name] ?? 0} onCommit={(v) => onChange({ ...spec, section: { ...spec.section, [f.name]: v } as typeof spec.section })} />
        </Field>
      ))}
    </>
  );
}

export function TypeFields({ spec, onChange }: { spec: ElementTypeSpec; onChange: (spec: ElementTypeSpec) => void }) {
  const { t } = useTranslation();
  switch (spec.kind) {
    case 'wall':
      return (
        <>
          <Field label={t('elementTypes.height')}><Mm label={t('elementTypes.height')} value={spec.height} onCommit={(height) => onChange({ ...spec, height })} /></Field>
          <LayerTable layers={spec.layers} onChange={(layers) => onChange({ ...spec, layers })} caption={t('elementTypes.wallLayers')} />
        </>
      );
    case 'slab':
      return <LayerTable layers={spec.layers} onChange={(layers) => onChange({ ...spec, layers })} caption={t('elementTypes.slabLayers')} />;
    case 'column':
      return (
        <>
          <Field label={t('elementTypes.height')}><Mm label={t('elementTypes.height')} value={spec.height} onCommit={(height) => onChange({ ...spec, height })} /></Field>
          <SectionFields spec={spec} onChange={onChange} />
        </>
      );
    case 'beam':
      return <SectionFields spec={spec} onChange={onChange} />;
    case 'opening':
      return (
        <>
          <Field label={t('elementTypes.width')}><Mm label={t('elementTypes.width')} value={spec.width} onCommit={(width) => onChange({ ...spec, width })} /></Field>
          <Field label={t('elementTypes.height')}><Mm label={t('elementTypes.height')} value={spec.height} onCommit={(height) => onChange({ ...spec, height })} /></Field>
          <Field label={t('elementTypes.sill')}><Mm label={t('elementTypes.sill')} value={spec.sill} zero onCommit={(sill) => onChange({ ...spec, sill })} /></Field>
        </>
      );
    case 'roof':
      return (
        <>
          <Field label={t('elementTypes.roof.shape')}>
            <select aria-label={t('elementTypes.roof.shape')} className={CELL} value={spec.shape} onChange={(e) => onChange({ ...spec, shape: e.target.value as typeof spec.shape })}>
              {(['gable', 'hip', 'mono'] as const).map((k) => <option key={k} value={k}>{t(`elementTypes.roof.shape.${k}`)}</option>)}
            </select>
          </Field>
          <Field label={t('elementTypes.roof.pitch')}>
            <input aria-label={t('elementTypes.roof.pitch')} type="number" min={0} max={80} className={CELL} value={spec.pitch} onChange={(e) => onChange({ ...spec, pitch: Number(e.target.value) })} />
          </Field>
          <Field label={t('elementTypes.roof.overhang')}><Mm label={t('elementTypes.roof.overhang')} value={spec.overhang} zero onCommit={(overhang) => onChange({ ...spec, overhang })} /></Field>
          <Field label={t('elementTypes.roof.structure')}>
            <select aria-label={t('elementTypes.roof.structure')} className={CELL} value={spec.structure.system}
              onChange={(e) => onChange({ ...spec, structure: { ...spec.structure, system: e.target.value as typeof spec.structure.system } })}>
              {(['rafters', 'trusses', 'none'] as const).map((k) => <option key={k} value={k}>{t(`elementTypes.roof.system.${k}`)}</option>)}
            </select>
          </Field>
          <Field label={t('elementTypes.roof.timber')}>
            <input type="color" aria-label={t('elementTypes.roof.timber')} className="h-5 w-8 cursor-pointer border-0 bg-transparent p-0" value={spec.timberColor} onChange={(e) => onChange({ ...spec, timberColor: e.target.value })} />
          </Field>
          <LayerTable layers={spec.layers} onChange={(layers) => onChange({ ...spec, layers, color: layers[0]?.color ?? spec.color })} caption={t('elementTypes.roofLayers')} />
          <p className="text-zinc-500">{t('elementTypes.roof.configuratorHint')}</p>
        </>
      );
  }
}

/** The build-up drawn to scale: a wall's layers across it, a slab's or roof's down through it. */
export function LayerPreview({ spec }: { spec: ElementTypeSpec }) {
  if (spec.kind !== 'wall' && spec.kind !== 'slab' && spec.kind !== 'roof') return null;
  const total = layersThickness(spec.layers) || 1;
  const across = spec.kind === 'wall';
  const W = 220, H = 160;
  let at = 0;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="rounded-sm border border-zinc-200 dark:border-zinc-800" aria-hidden="true">
      {spec.layers.map((l, i) => {
        const size = (l.thickness / total) * (across ? W - 40 : H - 40);
        const x = across ? 20 + at : 20, y = across ? 20 : 20 + at;
        at += size;
        return <rect key={i} x={x} y={y} width={across ? size : W - 40} height={across ? H - 40 : size} fill={catalogLayerColour(spec.layers, i)} stroke="currentColor" strokeWidth={0.5} />;
      })}
    </svg>
  );
}
