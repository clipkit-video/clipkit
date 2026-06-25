// Command registry + keyboard map. Commands are DATA (id, title,
// shortcut, run) so the keyboard handler, menus, and a future command
// palette all read one table. Shortcuts follow the editor convention:
// space = transport, arrows = frame stepping, cmd/ctrl+z = history.

'use client';

import { useEffect } from 'react';
import type { PlaybackEngine } from '@clipkit/playback';
import type { EditorStore, UseEditorReturn } from '@clipkit/editor-core';

export interface CommandContext {
  store: EditorStore;
  engine: PlaybackEngine | null;
  actions: UseEditorReturn;
}

export interface EditorCommand {
  id: string;
  title: string;
  /** Display + match key, e.g. 'Space', 'ArrowLeft', 'Mod+Z', 'Shift+Mod+Z'. */
  shortcut?: string;
  run: (ctx: CommandContext) => void;
}

export const EDITOR_COMMANDS: readonly EditorCommand[] = [
  {
    id: 'transport.toggle-play',
    title: 'Play / pause',
    shortcut: 'Space',
    run: ({ actions }) => void actions.togglePlay(),
  },
  {
    id: 'transport.step-back',
    title: 'Previous frame',
    shortcut: 'ArrowLeft',
    run: ({ engine }) => engine?.stepFrame(-1),
  },
  {
    id: 'transport.step-forward',
    title: 'Next frame',
    shortcut: 'ArrowRight',
    run: ({ engine }) => engine?.stepFrame(1),
  },
  {
    id: 'transport.go-start',
    title: 'Go to start',
    shortcut: 'Home',
    run: ({ actions }) => actions.seek(0),
  },
  {
    id: 'history.undo',
    title: 'Undo',
    shortcut: 'Mod+Z',
    run: ({ actions }) => actions.undo(),
  },
  {
    id: 'history.redo',
    title: 'Redo',
    shortcut: 'Shift+Mod+Z',
    run: ({ actions }) => actions.redo(),
  },
  {
    id: 'selection.clear',
    title: 'Clear selection',
    shortcut: 'Escape',
    run: ({ actions }) => actions.clearSelection(),
  },
  {
    id: 'selection.delete',
    title: 'Delete selected',
    shortcut: 'Backspace',
    run: ({ store, actions }) => {
      for (const id of store.getState().selection) actions.removeElement(id);
    },
  },
];

function matches(shortcut: string, e: KeyboardEvent): boolean {
  const parts = shortcut.split('+');
  const key = parts[parts.length - 1]!;
  const needMod = parts.includes('Mod');
  const needShift = parts.includes('Shift');
  const mod = e.metaKey || e.ctrlKey;
  if (needMod !== mod) return false;
  if (needShift !== e.shiftKey) return false;
  if (e.altKey) return false;
  const k = e.key === ' ' ? 'Space' : e.key;
  return k.toLowerCase() === key.toLowerCase();
}

function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return false;
  return (
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT' ||
    t.isContentEditable
  );
}

/** Bind the command table to the window. One listener per editor. */
export function useKeyboardCommands(ctx: CommandContext): void {
  const { store, engine, actions } = ctx;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTypingTarget(e)) return;
      for (const cmd of EDITOR_COMMANDS) {
        if (cmd.shortcut && matches(cmd.shortcut, e)) {
          e.preventDefault();
          cmd.run({ store, engine, actions });
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, engine, actions]);
}
