/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The fields of a structure profile: identity and IFC class; a preset's
 * parameters (or "Edit points" to detach it); a custom outline's points and
 * where its origin sits; the named anchors.
 */

import { Plus, Trash2 } from 'lucide-react';
import { PROFILE_PRESETS, regenerateProfile, toCustomProfile, type P2, type StructureKind, type StructureProfile } from '@ifc-lite/create';
import { useTranslation, type TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { INPUT, Section } from '../joinery/JoineryFields';
import { moveOrigin } from '@/civil/profile-library';
import { Cell } from './CorridorFields';

const KINDS: StructureKind[] = ['retaining-wall', 'tunnel', 'bridge-deck', 'barrier', 'kerb', 'ditch', 'custom'];
const CLASSES = ['IfcWall', 'IfcSlab', 'IfcKerb', 'IfcRailing', 'IfcBeam', 'IfcColumn', 'IfcFooting', 'IfcCourse', 'IfcBuildingElementProxy'];

interface Props {
  profile: StructureProfile;
  onChange: (p: StructureProfile) => void;
  active: number | null;
  onActive: (i: number | null) => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[1fr_9rem] items-center gap-2 text-xs">
      <span className="truncate text-zinc-600 dark:text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

export function IdentityFields({ profile: p, onChange }: Pick<Props, 'profile' | 'onChange'>) {
  const { t } = useTranslation();
  return (
    <Section title={t('profiles.zone.identity')}>
      <Row label={t('profiles.field.name')}>
        <input className={INPUT} defaultValue={p.name} key={`${p.id}:${p.name}`} onBlur={(e) => e.target.value.trim() && onChange({ ...p, name: e.target.value.trim() })} />
      </Row>
      <Row label={t('profiles.field.kind')}>
        <select aria-label={t('profiles.field.kind')} className={INPUT} value={p.kind} onChange={(e) => onChange({ ...p, kind: e.target.value as StructureKind })}>
          {KINDS.map((k) => <option key={k} value={k}>{t(`profiles.kind.${k}`)}</option>)}
        </select>
      </Row>
      <Row label={t('profiles.field.material')}>
        <input className={INPUT} defaultValue={p.material} key={`${p.id}:m:${p.material}`} onBlur={(e) => onChange({ ...p, material: e.target.value.trim() })} />
      </Row>
      <Row label={t('profiles.field.colour')}>
        <input type="color" aria-label={t('profiles.field.colour')} className="h-6 w-10 cursor-pointer border-0 bg-transparent p-0" value={p.color} onChange={(e) => onChange({ ...p, color: e.target.value })} />
      </Row>
      <Row label={t('profiles.field.ifcClass')}>
        <select aria-label={t('profiles.field.ifcClass')} className={INPUT} value={p.ifcClass} onChange={(e) => onChange({ ...p, ifcClass: e.target.value })}>
          {[...new Set([p.ifcClass, ...CLASSES])].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Row>
      <Row label={t('profiles.field.predefinedType')}>
        <input className={INPUT} defaultValue={p.predefinedType ?? ''} key={`${p.id}:pt:${p.predefinedType}`} onBlur={(e) => onChange({ ...p, predefinedType: e.target.value.trim().toUpperCase() || undefined })} />
      </Row>
      <Row label={t('profiles.field.objectType')}>
        <input className={INPUT} defaultValue={p.objectType ?? ''} key={`${p.id}:ot:${p.objectType}`} onBlur={(e) => onChange({ ...p, objectType: e.target.value.trim() || undefined })} />
      </Row>
    </Section>
  );
}

export function ShapeFields({ profile: p, onChange, active, onActive }: Props) {
  const { t } = useTranslation();
  if (p.preset) {
    const def = PROFILE_PRESETS[p.preset.id];
    const setParam = (key: string, v: number) => onChange(regenerateProfile({ ...p, preset: { id: p.preset!.id, params: { ...p.preset!.params, [key]: v } } }));
    return (
      <Section title={t('profiles.zone.parameters', { preset: t(`profiles.preset.${p.preset.id}`) })}>
        {def.params.map((q) => (
          <Row key={q.key} label={t(`profiles.param.${q.key}` as TranslationKey)}>
            <Cell label={t(`profiles.param.${q.key}` as TranslationKey)} value={p.preset!.params[q.key]} min={q.min} onCommit={(v) => setParam(q.key, v)} />
          </Row>
        ))}
        <Button size="sm" variant="outline" onClick={() => onChange(toCustomProfile(p))}>{t('profiles.editPoints')}</Button>
        <p className="text-2xs text-zinc-500">{t('profiles.editPointsHint')}</p>
      </Section>
    );
  }
  const set = (outer: P2[]) => onChange({ ...p, outer });
  return (
    <Section title={t('profiles.zone.points')}>
      <p className="text-2xs text-zinc-500">{t('profiles.pointsHint')}</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-zinc-500">
            <th className="w-6 font-medium">{t('profiles.col.index')}</th>
            <th className="font-medium">{t('profiles.col.x')}</th>
            <th className="font-medium">{t('profiles.col.y')}</th>
            <th className="w-20" aria-label={t('profiles.actions')} />
          </tr>
        </thead>
        <tbody>
          {p.outer.map((q, i) => (
            <tr key={i} className={i === active ? 'bg-primary/10' : ''} onFocus={() => onActive(i)}>
              <td className="tabular-nums text-zinc-500">{i + 1}</td>
              <td><Cell label={`X ${i + 1}`} value={q[0]} onCommit={(x) => set(p.outer.map((r, k) => (k === i ? [x, r[1]] : r)))} /></td>
              <td><Cell label={`Y ${i + 1}`} value={q[1]} onCommit={(y) => set(p.outer.map((r, k) => (k === i ? [r[0], y] : r)))} /></td>
              <td className="flex justify-end">
                <IconButton label={t('profiles.insertPoint')} className="size-6" onClick={() => {
                  const n = p.outer[(i + 1) % p.outer.length];
                  set([...p.outer.slice(0, i + 1), [(q[0] + n[0]) / 2, (q[1] + n[1]) / 2], ...p.outer.slice(i + 1)]);
                }}><Plus className="size-3" /></IconButton>
                <IconButton label={t('profiles.removePoint')} className="size-6" disabled={p.outer.length <= 3} onClick={() => set(p.outer.filter((_, k) => k !== i))}><Trash2 className="size-3" /></IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.holes.length ? <p className="text-2xs text-zinc-500">{t('profiles.holes', { count: p.holes.length })}</p> : null}
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" disabled={active === null} onClick={() => active !== null && onChange(moveOrigin(p, p.outer[active]))}>{t('profiles.originHere')}</Button>
        {p.holes.length ? <Button size="sm" variant="ghost" onClick={() => onChange({ ...p, holes: [] })}>{t('profiles.removeHoles')}</Button> : null}
      </div>
    </Section>
  );
}

export function AnchorFields({ profile: p, onChange }: Pick<Props, 'profile' | 'onChange'>) {
  const { t } = useTranslation();
  const set = (anchors: StructureProfile['anchors']) => onChange({ ...(p.preset ? toCustomProfile(p) : p), anchors });
  return (
    <Section title={t('profiles.zone.anchors')}>
      <table className="w-full text-xs">
        <tbody>
          {p.anchors.map((a, i) => (
            <tr key={`${i}:${a.name}`}>
              <td><input aria-label={`${t('profiles.anchorName')} ${i + 1}`} className={INPUT} defaultValue={a.name} onBlur={(e) => e.target.value.trim() && set(p.anchors.map((x, k) => (k === i ? { ...x, name: e.target.value.trim() } : x)))} /></td>
              <td className="w-20"><Cell label={`X ${a.name}`} value={a.at[0]} onCommit={(x) => set(p.anchors.map((y, k) => (k === i ? { ...y, at: [x, y.at[1]] } : y)))} /></td>
              <td className="w-20"><Cell label={`Y ${a.name}`} value={a.at[1]} onCommit={(v) => set(p.anchors.map((y, k) => (k === i ? { ...y, at: [y.at[0], v] } : y)))} /></td>
              <td className="w-7"><IconButton label={t('profiles.removeAnchor')} className="size-6" onClick={() => set(p.anchors.filter((_, k) => k !== i))}><Trash2 className="size-3" /></IconButton></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="flex items-center gap-1 rounded-sm border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        onClick={() => set([...p.anchors, { name: `point${p.anchors.length + 1}`, at: [0, 0] }])}>
        <Plus className="size-3" />{t('profiles.addAnchor')}
      </button>
    </Section>
  );
}
