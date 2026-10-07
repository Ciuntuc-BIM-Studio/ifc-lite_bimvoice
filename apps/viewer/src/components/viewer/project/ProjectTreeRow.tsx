/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * One row of the Project Navigator: a folder header or an item. Items open
 * on double-click / Enter, rename in place on F2 or "Rename", and carry a
 * right-click menu. Purely presentational; the panel owns every action.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/utils';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';

export interface ProjectFolderRowProps {
  label: string;
  icon: ReactNode;
  count: number;
  open: boolean;
  onToggle: () => void;
  /** Hover action at the right edge (e.g. "+ new"). */
  action?: ReactNode;
}

export function ProjectFolderRow({ label, icon, count, open, onToggle, action }: ProjectFolderRowProps) {
  return (
    <div className="group flex items-center gap-1 px-2 h-7 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900">
      <button type="button" className="flex flex-1 min-w-0 items-center gap-1.5 text-left" aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
        <span className="shrink-0 text-zinc-500">{icon}</span>
        <span className="truncate">{label}</span>
        <span className="ml-1 font-normal text-zinc-400 tabular-nums">{count}</span>
      </button>
      {action ? <span className="opacity-0 group-hover:opacity-100 focus-within:opacity-100">{action}</span> : null}
    </div>
  );
}

export interface ProjectItemRowProps {
  label: string;
  /** What the rename field starts with, when the row label adds more (a number, an elevation). */
  renameValue?: string;
  icon: ReactNode;
  active: boolean;
  /** Greyed with this hint when the item cannot open (e.g. its level is not loaded). */
  unresolvedHint?: string;
  renaming: boolean;
  onOpen: () => void;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
  onDuplicate?: () => void;
  onDelete: () => void;
}

export function ProjectItemRow(props: ProjectItemRowProps) {
  const { t } = useTranslation();
  const { label, icon, active, unresolvedHint, renaming, onOpen, onStartRename, onDuplicate, onDelete } = props;
  if (renaming) return <RenameField {...props} />;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          title={unresolvedHint}
          className={cn(
            'flex w-full items-center gap-1.5 h-7 pl-8 pr-2 text-xs text-left truncate',
            'hover:bg-zinc-100 dark:hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary',
            active && 'bg-primary/10 text-primary font-medium',
            unresolvedHint && 'text-zinc-400 dark:text-zinc-600 italic',
          )}
          onDoubleClick={onOpen}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onOpen();
            else if (e.key === 'F2') onStartRename();
            else if (e.key === 'Delete') onDelete();
          }}
        >
          <span className="shrink-0 text-zinc-500">{icon}</span>
          <span className="truncate">{label}</span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onOpen}>{t('projectNavigator.action.open')}</ContextMenuItem>
        <ContextMenuItem onSelect={onStartRename}>{t('projectNavigator.action.rename')}</ContextMenuItem>
        {onDuplicate ? <ContextMenuItem onSelect={onDuplicate}>{t('projectNavigator.action.duplicate')}</ContextMenuItem> : null}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onDelete}>{t('projectNavigator.action.delete')}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function RenameField({ label, renameValue, onRename, onCancelRename }: ProjectItemRowProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(renameValue ?? label);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.select();
  }, []);
  return (
    <div className="h-7 pl-8 pr-2 flex items-center">
      <input
        ref={ref}
        aria-label={t('projectNavigator.renameLabel')}
        className="w-full h-6 px-1 text-xs bg-white dark:bg-zinc-950 border border-primary rounded-sm outline-none"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onRename(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onRename(value);
          else if (e.key === 'Escape') onCancelRename();
        }}
      />
    </div>
  );
}
