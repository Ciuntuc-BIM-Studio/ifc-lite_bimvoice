/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Project Navigator: the project's views and sheets, Revit-browser style —
 * Floor Plans, Sections, Elevations, 3D Views, Sheets — plus the models the
 * project refers to. Opening a view points the live section / camera at it
 * (`project/open-view.ts`); the project round-trips through the
 * `.ifclite-project.json` sidecar.
 */

import { can } from '@/edition';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Spline, Box, Building2, Camera, FileBox, FilePlus2, FolderOpen, LayoutTemplate, Plus, Rows3, Save, Scissors, Search, SquareDashed, Table2 } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { requestNewProject } from '@/project/new-project';
import { IconButton } from '@/components/ui/icon-button';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/toast';
import {
  addProjectSheet,
  duplicateProjectSheet,
  duplicateProjectView,
  loadProjectDocument,
  projectDocument,
  removeProjectItem,
  renameProjectItem,
  useProjectStore,
} from '@/project/project-store';
import { exportProjectFile, importProjectFile, PROJECT_FILE_SUFFIX } from '@/project/project-file';
import { activateDocumentTab, openProjectView, saveLiveCameraAsView, saveLiveSectionAsView } from '@/project/open-view';
import { resolvePlanLevel } from '@/project/view-defaults';
import { addSchedule } from '@/joinery/schedules';
import { duplicateCivilDrawing } from '@/civil/civil-drawings';
import { newCivilDrawing } from '@/civil/civil-drawing-actions';
import type { ProjectView, ProjectViewKind } from '@/project/types';
import { ProjectFolderRow, ProjectItemRow } from './ProjectTreeRow';
import { ViewPropertiesPanel } from './ViewPropertiesPanel';
import { LevelsFolder } from './LevelsFolder';
import { useNavigatorDialogs } from './useNavigatorDialogs';

type FolderId = ProjectViewKind | 'sheets' | 'schedules' | 'civil' | 'models';

const FOLDER_ORDER: readonly FolderId[] = ['plan', 'section', 'elevation', '3d', 'schedules', 'civil', 'sheets', 'models'];

const ICONS: Record<FolderId, ReactNode> = {
  plan: <LayoutTemplate className="size-3.5" />,
  section: <Scissors className="size-3.5" />,
  elevation: <Building2 className="size-3.5" />,
  '3d': <Box className="size-3.5" />,
  sheets: <Rows3 className="size-3.5" />,
  schedules: <Table2 className="size-3.5" />,
  civil: <Spline className="size-3.5" />,
  models: <FileBox className="size-3.5" />,
};

const FOLDER_LABELS = {
  plan: 'projectNavigator.folder.floorPlans',
  section: 'projectNavigator.folder.sections',
  elevation: 'projectNavigator.folder.elevations',
  '3d': 'projectNavigator.folder.views3d',
  sheets: 'projectNavigator.folder.sheets',
  schedules: 'schedule.folder',
  civil: 'civilDwg.folder',
  models: 'projectNavigator.folder.models',
} as const;

const matches = (label: string, query: string) => label.toLowerCase().includes(query);

export function ProjectNavigatorPanel() {
  const { t } = useTranslation();
  const name = useProjectStore((s) => s.name);
  const views = useProjectStore((s) => s.views);
  const sheets = useProjectStore((s) => s.sheets);
  const schedules = useProjectStore((s) => s.schedules) ?? [];
  const civilDrawings = useProjectStore((s) => s.civilDrawings) ?? [];
  const models = useProjectStore((s) => s.models);
  const levels = useProjectStore((s) => s.levels);
  const activeItemId = useProjectStore((s) => s.activeItemId);
  const dirty = useProjectStore((s) => s.dirty);
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<ReadonlySet<FolderId>>(new Set(['models']));
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialogs = useNavigatorDialogs();

  const q = query.trim().toLowerCase();
  const byKind = useMemo(() => {
    const groups: Record<ProjectViewKind, ProjectView[]> = { plan: [], section: [], elevation: [], '3d': [] };
    for (const view of views) if (!q || matches(view.name, q)) groups[view.kind].push(view);
    // Floor plans read top-down by their level, like the Levels folder.
    groups.plan.sort((a, b) => (b.kind === 'plan' ? b.level.elevation : 0) - (a.kind === 'plan' ? a.level.elevation : 0));
    return groups;
  }, [views, q]);
  const visibleSheets = useMemo(() => sheets.filter((s) => !q || matches(`${s.number} ${s.name}`, q)), [sheets, q]);

  if (views.length === 0 && sheets.length === 0) {
    return (
      <div className="h-full flex flex-col bg-white dark:bg-black">
        <Header title={t('projectNavigator.title')} />
        <EmptyState className="flex-1" icon={<LayoutTemplate className="size-8" />} title={t('projectNavigator.empty.title')} description={t('projectNavigator.empty.hint')} />
        <div className="p-4 pt-0 flex justify-center">
          <Button onClick={requestNewProject}><FilePlus2 className="size-4 mr-1" />{t('newProject.command')}</Button>
        </div>
      </div>
    );
  }

  const toggle = (id: FolderId) => setClosed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const isOpen = (id: FolderId) => Boolean(q) || !closed.has(id);

  const open = (view: ProjectView) => {
    const result = openProjectView(view.id);
    if (result === 'unresolved') toast.error(t('projectNavigator.error.unresolved'));
  };
  const rename = (id: string, value: string) => {
    renameProjectItem(id, value);
    setRenamingId(null);
  };
  const saveSection = () => {
    const id = saveLiveSectionAsView(t('projectNavigator.newSectionName'));
    if (!id) toast.error(t('projectNavigator.error.noSection'));
    else setRenamingId(id);
  };
  const save3d = () => {
    const id = saveLiveCameraAsView(t('projectNavigator.new3dName'));
    if (!id) toast.error(t('projectNavigator.error.noCamera'));
    else setRenamingId(id);
  };
  const newSheet = () => setRenamingId(addProjectSheet());
  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const doc = await importProjectFile(file);
      loadProjectDocument(doc);
      toast.success(t('projectNavigator.imported', { name: doc.name }));
    } catch (err) {
      toast.error(t('projectNavigator.error.import', { detail: err instanceof Error ? err.message : String(err) }));
    }
  };

  const folderAction: Partial<Record<FolderId, ReactNode>> = {
    section: <AddButton label={t('projectNavigator.action.saveSection')} onClick={saveSection} />,
    '3d': <AddButton label={t('projectNavigator.action.save3d')} onClick={save3d} icon={<Camera className="size-3.5" />} />,
    sheets: <AddButton label={t('projectNavigator.action.newSheet')} onClick={newSheet} />,
    schedules: <AddButton label={t('schedule.new')} onClick={() => setRenamingId(addSchedule('all', t('schedule.newName')))} />,
    civil: <AddButton label={t('civilDwg.newProfileAction')} onClick={() => newCivilDrawing('profile')} />,
    plan: <AddButton label={t('projectNavigator.action.newPlan')} onClick={() => dialogs.open('plan')} />,
    elevation: <AddButton label={t('projectNavigator.action.newElevation')} onClick={() => dialogs.open('elevation')} />,
  };

  const viewRow = (view: ProjectView) => (
    <ProjectItemRow
      key={view.id}
      label={view.name}
      icon={ICONS[view.kind]}
      active={activeItemId === view.id}
      unresolvedHint={view.kind === 'plan' && levels.length > 0 && !resolvePlanLevel(view, levels) ? t('projectNavigator.unresolved') : undefined}
      renaming={renamingId === view.id}
      onOpen={() => open(view)}
      onStartRename={() => setRenamingId(view.id)}
      onRename={(value) => rename(view.id, value)}
      onCancelRename={() => setRenamingId(null)}
      onDuplicate={() => setRenamingId(duplicateProjectView(view.id))}
      onDelete={() => removeProjectItem(view.id)}
      dragViewId={view.kind === '3d' ? undefined : view.id}
    />
  );

  const folderBody = (id: FolderId): { count: number; rows: ReactNode } => {
    if (id === 'sheets') {
      return {
        count: visibleSheets.length,
        rows: visibleSheets.map((sheet) => (
          <ProjectItemRow
            key={sheet.id}
            label={t('projectNavigator.sheetLabel', { number: sheet.number, name: sheet.name })}
            renameValue={sheet.name}
            icon={<SquareDashed className="size-3.5" />}
            active={activeItemId === sheet.id}
            renaming={renamingId === sheet.id}
            onOpen={() => activateDocumentTab(sheet.id)}
            onStartRename={() => setRenamingId(sheet.id)}
            onRename={(value) => rename(sheet.id, value)}
            onCancelRename={() => setRenamingId(null)}
            onDuplicate={() => setRenamingId(duplicateProjectSheet(sheet.id))}
            onDelete={() => removeProjectItem(sheet.id)}
          />
        )),
      };
    }
    if (id === 'schedules') {
      const shown = schedules.filter((s) => !q || matches(s.name, q));
      return {
        count: shown.length,
        rows: shown.map((schedule) => (
          <ProjectItemRow
            key={schedule.id}
            label={schedule.name}
            icon={ICONS.schedules}
            active={activeItemId === schedule.id}
            renaming={renamingId === schedule.id}
            onOpen={() => activateDocumentTab(schedule.id)}
            onStartRename={() => setRenamingId(schedule.id)}
            onRename={(value) => rename(schedule.id, value)}
            onCancelRename={() => setRenamingId(null)}
            onDuplicate={() => setRenamingId(addSchedule(schedule.kind, `${schedule.name} (2)`))}
            onDelete={() => removeProjectItem(schedule.id)}
            dragViewId={schedule.id}
          />
        )),
      };
    }
    if (id === 'civil') {
      const shown = civilDrawings.filter((d) => !q || matches(d.name, q));
      return {
        count: shown.length,
        rows: shown.map((d) => (
          <ProjectItemRow
            key={d.id}
            label={d.name}
            icon={ICONS.civil}
            active={activeItemId === d.id}
            renaming={renamingId === d.id}
            onOpen={() => activateDocumentTab(d.id)}
            onStartRename={() => setRenamingId(d.id)}
            onRename={(value) => rename(d.id, value)}
            onCancelRename={() => setRenamingId(null)}
            onDuplicate={() => setRenamingId(duplicateCivilDrawing(d.id))}
            onDelete={() => removeProjectItem(d.id)}
            dragViewId={d.id}
          />
        )),
      };
    }
    if (id === 'models') {
      return {
        count: models.length,
        rows: models.map((m) => (
          <div key={m.key} className="flex items-center gap-1.5 h-7 pl-8 pr-2 text-xs text-zinc-600 dark:text-zinc-400 truncate">
            {ICONS.models}
            <span className="truncate">{m.name}</span>
          </div>
        )),
      };
    }
    return { count: byKind[id].length, rows: byKind[id].map(viewRow) };
  };

  const activeView = views.find((v) => v.id === activeItemId);
  // Road drawings come from corridors, which only the full edition models.
  const folders = FOLDER_ORDER.filter((id) => id !== 'civil' || can('infrastructure')).map((id) => ({ id, ...folderBody(id) })).filter((f) => !q || f.count > 0);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-black">
      <Header title={name} dirty={dirty}>
        <IconButton label={t('newProject.command')} className="size-7" onClick={requestNewProject}>
          <FilePlus2 className="size-4" />
        </IconButton>
        <IconButton label={t('projectNavigator.action.openFile')} className="size-7" onClick={() => fileInput.current?.click()}>
          <FolderOpen className="size-4" />
        </IconButton>
        <IconButton
          label={t('projectNavigator.action.saveFile')}
          className="size-7"
          onClick={() => {
            exportProjectFile(projectDocument());
            useProjectStore.setState({ dirty: false });
          }}
        >
          <Save className="size-4" />
        </IconButton>
        <input ref={fileInput} type="file" accept={`${PROJECT_FILE_SUFFIX},application/json`} className="hidden" onChange={(e) => {
          void onImport(e.target.files?.[0]);
          e.target.value = '';
        }} />
      </Header>
      <div className="p-2 border-b border-zinc-200 dark:border-zinc-800">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-zinc-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('projectNavigator.search')} aria-label={t('projectNavigator.search')} className="h-7 pl-7 text-xs" />
        </div>
      </div>
      <nav className="flex-1 min-h-0 overflow-y-auto py-1" aria-label={t('projectNavigator.title')}>
        <LevelsFolder query={q} onNewLevel={() => dialogs.open('level')} />
        {folders.length === 0 && q ? <p className="p-4 text-xs text-zinc-500">{t('projectNavigator.noMatches')}</p> : null}
        {folders.map((folder) => (
          <div key={folder.id}>
            <ProjectFolderRow
              label={t(FOLDER_LABELS[folder.id])}
              icon={ICONS[folder.id]}
              count={folder.count}
              open={isOpen(folder.id)}
              onToggle={() => toggle(folder.id)}
              action={folderAction[folder.id]}
            />
            {isOpen(folder.id) ? folder.rows : null}
          </div>
        ))}
      </nav>
      {activeView ? <ViewPropertiesPanel view={activeView} /> : null}
      {dialogs.dialog}
    </div>
  );
}

function Header({ title, dirty, children }: { title: string; dirty?: boolean; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1 px-3 h-11 border-b-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black">
      <h2 className="flex-1 min-w-0 truncate font-bold uppercase tracking-wider text-xs text-zinc-900 dark:text-zinc-100">
        {title}
        {dirty ? <span className="ml-1 text-primary" title={t('projectNavigator.unsaved')} aria-label={t('projectNavigator.unsaved')}>•</span> : null}
      </h2>
      {children}
    </div>
  );
}

function AddButton({ label, onClick, icon }: { label: string; onClick: () => void; icon?: ReactNode }) {
  return (
    <IconButton label={label} className="size-6" onClick={onClick}>
      {icon ?? <Plus className="size-3.5" />}
    </IconButton>
  );
}
