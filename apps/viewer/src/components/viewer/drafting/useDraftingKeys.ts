/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Keyboard for the drafting view in front: typing goes to the command line
 * (CAD style — no need to click it first), Enter / Space confirm or repeat,
 * Escape cancels, Delete erases the selection, Ctrl/Cmd+Z / Shift+Z (or Y)
 * undo / redo, F3 toggles snap and F8 ortho.
 */

import { useEffect, useRef } from 'react';
import { redoDrafts, undoDrafts } from '@/drafting/draft-store';
import { pressEnter, pressEscape, startDraftCommand, toggleOrtho, toggleSnap, useDraftingSession } from '@/drafting/session';

interface Params {
  inputRef: React.RefObject<HTMLInputElement | null>;
  setText: React.Dispatch<React.SetStateAction<string>>;
  /** Confirm with an empty line (Enter / Space outside the input). */
  submit: () => void;
}

/** Whether a key event belongs to another text field than the command line. */
function inOtherField(target: EventTarget | null, input: HTMLInputElement | null): boolean {
  if (!(target instanceof HTMLElement) || target === input) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function useDraftingKeys({ inputRef, setText, submit }: Params): void {
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const input = inputRef.current;
      if (inOtherField(e.target, input)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoDrafts();
        else undoDrafts();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redoDrafts();
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        toggleSnap();
        return;
      }
      if (e.key === 'F8') {
        e.preventDefault();
        toggleOrtho();
        return;
      }
      if (e.target === input) return; // the command line handles its own Enter / Escape / typing
      if (e.key === 'Escape') {
        pressEscape();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (useDraftingSession.getState().selection.size > 0 && !useDraftingSession.getState().commandId) {
          e.preventDefault();
          startDraftCommand('erase');
          pressEnter();
        }
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        submitRef.current();
        return;
      }
      if (!mod && !e.altKey && e.key.length === 1 && /[\w@<.,-]/.test(e.key) && input) {
        e.preventDefault();
        input.focus();
        setText((prev) => prev + e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inputRef, setText]);
}
