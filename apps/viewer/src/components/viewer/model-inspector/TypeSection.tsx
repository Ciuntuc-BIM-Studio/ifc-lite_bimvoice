/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Model inspector's Type section (charter #6232, M2 §1.7.1): the
 * `IfcXxxType`s of the element's class in the model (file and session),
 * "No type", and "New type…".
 *
 * Selection mode types the element right away (IfcRelDefinesByType, one
 * undo step); a wall, slab, column or beam can also take a project type
 * (`element-types/`), which fits its geometry to the type. Defaults mode stores the pick for the kind; the transaction
 * types every element a command builds with it (`authored-defaults.ts`).
 */

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/i18n';
import { useViewerStore } from '@/store';
import { AUTHORED_KINDS, typeClassInSchema, typeOf, typesOfKind, type LiveModel } from '@/lib/commands/modeling/authored-kinds';
import type { AuthoredElementKind } from '@/store/slices/authoringDefaultsSlice';
import { InspectorCaption, InspectorRow, InspectorSection } from './InspectorControls';
import { createElementType, setElementType } from './inspector-edits';
import { useProjectStore } from '@/project/project-store';
import { elementTypeOfElement, retypeElements } from '@/element-types/model-sync';
import { openElementTypes } from '@/element-types/dialog-store';

const NONE = 'none';
const NEW = 'new';
const EDIT = 'edit-types';

export interface TypeSectionProps {
  modelId: string;
  live: LiveModel;
  kind: AuthoredElementKind;
  /** The element to type; absent in defaults mode. */
  elementId?: number;
}

export function TypeSection(props: TypeSectionProps) {
  const { t } = useTranslation();
  const { live, kind } = props;
  // D2: a schema without the kind's type class (IFC2X3 has no IfcDoorType) offers no type to pick or create.
  if (!typeClassInSchema(live, kind)) {
    return (
      <InspectorSection title={t('modelInspector.type.title')}>
        <InspectorCaption>
          {t('modelInspector.type.noClass', { schema: String(live.dataStore.schemaVersion ?? ''), typeClass: AUTHORED_KINDS[kind].type })}
        </InspectorCaption>
      </InspectorSection>
    );
  }
  return <TypePicker {...props} />;
}

function TypePicker({ modelId, live, kind, elementId }: TypeSectionProps) {
  const { t } = useTranslation();
  const id = useId();
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const defaultPick = useViewerStore((s) => s.authoringDefaults.typeIds[kind]);
  const [naming, setNaming] = useState(false);

  const types = useMemo(() => { void mutationVersion; return typesOfKind(live, kind); }, [live, kind, mutationVersion]);
  const current = useMemo(() => {
    void mutationVersion;
    if (elementId !== undefined) return typeOf(live, elementId);
    return defaultPick?.modelId === modelId && types.some((type) => type.expressId === defaultPick.expressId) ? defaultPick.expressId : null;
  }, [live, elementId, defaultPick, modelId, types, mutationVersion]);

  const pickDefault = (typeId: number | null) => {
    const { typeIds } = useViewerStore.getState().authoringDefaults;
    const { [kind]: _dropped, ...rest } = typeIds;
    useViewerStore.getState().setAuthoringDefaults({ typeIds: typeId === null ? rest : { ...rest, [kind]: { modelId, expressId: typeId } } });
  };

  const choose = (value: string) => {
    if (value === NEW) { setNaming(true); return; }
    const typeId = value === NONE ? null : Number(value);
    if (elementId === undefined) pickDefault(typeId);
    else setElementType(modelId, elementId, typeId);
  };

  const create = (name: string) => {
    const typeId = createElementType(modelId, kind, name, elementId);
    if (typeId === null) return;
    if (elementId === undefined) pickDefault(typeId);
    setNaming(false);
  };

  return (
    <InspectorSection title={t('modelInspector.type.title')}>
      {elementId !== undefined && <ProjectTypeRow modelId={modelId} kind={kind} elementId={elementId} />}
      <InspectorRow label={t('modelInspector.type.label')} htmlFor={id}>
        <Select value={current === null ? NONE : String(current)} onValueChange={choose}>
          <SelectTrigger id={id} data-inspector-type className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE} className="text-xs">{t('modelInspector.type.none')}</SelectItem>
            {types.map((type) => (
              <SelectItem key={type.expressId} value={String(type.expressId)} className="text-xs">{type.name}</SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value={NEW} className="text-xs">{t('modelInspector.type.new')}</SelectItem>
          </SelectContent>
        </Select>
      </InspectorRow>
      {naming && <NewTypeRow placeholder={AUTHORED_KINDS[kind].type} onCreate={create} onCancel={() => setNaming(false)} />}
      {elementId === undefined && current !== null && <InspectorCaption>{t('modelInspector.type.defaultsHint')}</InspectorCaption>}
    </InspectorSection>
  );
}

/** "New type…": a name, then Create (or Enter). Escape or Cancel closes it without writing. */
function NewTypeRow({ placeholder, onCreate, onCancel }: { placeholder: string; onCreate: (name: string) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) onCreate(name.trim());
  };
  return (
    <form onSubmit={submit}>
      <InspectorRow label={t('modelInspector.type.newName')} htmlFor={id}>
        <div className="flex items-center gap-1">
          <Input
            id={id}
            ref={input}
            value={name}
            placeholder={placeholder}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') onCancel(); }}
            className="h-7 flex-1 text-xs"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!name.trim()} className="h-7 px-2 text-2xs">
            {t('modelInspector.type.create')}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-2xs" onClick={onCancel}>
            {t('modelInspector.type.cancel')}
          </Button>
        </div>
      </InspectorRow>
    </form>
  );
}

/** The kinds the project's type catalogue covers. */
const CATALOG_KIND: Partial<Record<AuthoredElementKind, 'wall' | 'slab' | 'column' | 'beam'>> = { wall: 'wall', slab: 'slab', column: 'column', beam: 'beam' };

/**
 * The project type (`element-types/`) the element is typed by: picking
 * another one types it by that entry and fits it — a wall's or slab's
 * thickness and layers, a column's or beam's section — in one undo step.
 */
function ProjectTypeRow({ modelId, kind, elementId }: { modelId: string; kind: AuthoredElementKind; elementId: number }) {
  const { t } = useTranslation();
  const id = useId();
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const all = useProjectStore((s) => s.elementTypes);
  const catalogKind = CATALOG_KIND[kind];
  const entries = useMemo(() => (all ?? []).filter((e) => e.kind === catalogKind), [all, catalogKind]);
  const current = useMemo(() => { void mutationVersion; return elementTypeOfElement(modelId, elementId)?.id ?? null; }, [modelId, elementId, mutationVersion]);
  if (!catalogKind) return null;
  const choose = (value: string) => {
    if (value === EDIT) { openElementTypes(catalogKind, current); return; }
    const spec = entries.find((e) => e.id === value);
    if (spec && spec.id !== current) retypeElements(modelId, [elementId], spec);
  };
  return (
    <InspectorRow label={t('elementTypes.changeType')} htmlFor={id}>
      <Select value={current ?? NONE} onValueChange={choose}>
        <SelectTrigger id={id} data-inspector-project-type className="h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {current === null && <SelectItem value={NONE} className="text-xs">{t('elementTypes.noProjectType')}</SelectItem>}
          {entries.map((e) => <SelectItem key={e.id} value={e.id} className="text-xs">{e.mark ? `${e.mark} · ${e.name}` : e.name}</SelectItem>)}
          <SelectSeparator />
          <SelectItem value={EDIT} className="text-xs">{t('elementTypes.editTypes')}</SelectItem>
        </SelectContent>
      </Select>
    </InspectorRow>
  );
}
