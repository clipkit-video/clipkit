// Source pane (EDITORS B10) — a CodeMirror 6 JSON view of the WHOLE
// document, living as the left rail's third tab (ruled by Ian
// 2026-06-11). Bidirectional:
//
//   editor → store   valid edits commit (debounced) through
//                    replaceSource — one history entry each, engine
//                    syncs through the normal subscription. Invalid
//                    text NEVER commits; it lints inline instead.
//   store → editor   canvas/inspector edits rewrite the pane,
//                    UNLESS the pane is focused mid-edit (the user's
//                    keystrokes win; we resync on blur/commit).
//
// Selection sync rides the lezer syntax tree, not regexes: cursor
// inside an element's object selects it on canvas; canvas selection
// scrolls the pane to that element. Inline validation is two-layer:
// jsonParseLinter for syntax, the protocol's normative validate()
// for schema — zod issue paths are resolved to exact text ranges by
// walking the tree.

'use client';

import { useEffect, useRef } from 'react';
import { EditorState, StateEffect, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter, lintGutter } from '@codemirror/lint';
import {
  search,
  searchKeymap,
  openSearchPanel,
  highlightSelectionMatches,
} from '@codemirror/search';
import {
  HighlightStyle,
  bracketMatching,
  ensureSyntaxTree,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { validate, type Source } from '@clipkit/protocol';
import { useEditor, useEditorContext } from '@clipkit/editor-core';

const COMMIT_DEBOUNCE_MS = 400;

const format = (source: Source): string => JSON.stringify(source, null, 2);

/**
 * Lezer parses lazily (viewport-first); elements deep in the document
 * aren't in the tree yet when selection sync needs them. Force a full
 * parse (bounded) before tree walks.
 */
function fullTree(state: EditorState) {
  return (
    ensureSyntaxTree(state, state.doc.length, 200) ??
    ensureSyntaxTree(state, state.doc.length, 1000)
  );
}

// ── Syntax tree helpers ─────────────────────────────────────────────

type JsonNode = NonNullable<
  ReturnType<typeof ensureSyntaxTree>
>['topNode'];

/** Resolve a key/index path to the value NODE (not just its range). */
function nodeForPath(
  state: EditorState,
  path: ReadonlyArray<string | number>,
): JsonNode | null {
  const tree = fullTree(state);
  if (!tree) return null;
  let node = tree.topNode.firstChild; // JsonText → root value
  for (const seg of path) {
    if (!node) return null;
    if (node.name === 'Object' && typeof seg === 'string') {
      let found = null;
      for (let prop = node.firstChild; prop; prop = prop.nextSibling) {
        if (prop.name !== 'Property') continue;
        const keyNode = prop.firstChild;
        if (!keyNode) continue;
        const key = state.sliceDoc(keyNode.from + 1, keyNode.to - 1);
        if (key === seg) {
          found = keyNode.nextSibling;
          break;
        }
      }
      node = found;
    } else if (node.name === 'Array' && typeof seg === 'number') {
      let i = -1;
      let found = null;
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.name === '[' || child.name === ']') continue;
        i += 1;
        if (i === seg) {
          found = child;
          break;
        }
      }
      node = found;
    } else {
      return null;
    }
  }
  return node ?? null;
}

/** Resolve a zod issue path (keys + indices) to the value's text range. */
function rangeForPath(
  state: EditorState,
  path: ReadonlyArray<string | number>,
): { from: number; to: number } | null {
  const node = nodeForPath(state, path);
  return node ? { from: node.from, to: node.to } : null;
}

/** The id of the top-level `elements[i]` object containing `pos`. */
function elementIdAtPos(state: EditorState, pos: number): string | null {
  const arr = nodeForPath(state, ['elements']);
  if (!arr || arr.name !== 'Array') return null;
  if (pos < arr.from || pos > arr.to) return null;
  for (let child = arr.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'Object' || pos < child.from || pos > child.to) continue;
    for (let prop = child.firstChild; prop; prop = prop.nextSibling) {
      if (prop.name !== 'Property') continue;
      const keyNode = prop.firstChild;
      if (!keyNode) continue;
      if (state.sliceDoc(keyNode.from + 1, keyNode.to - 1) === 'id') {
        const value = keyNode.nextSibling;
        if (value?.name === 'String') {
          return state.sliceDoc(value.from + 1, value.to - 1);
        }
      }
    }
    return null; // inside an element without an id
  }
  return null;
}

/** Text range of the top-level element object with this id. */
function rangeForElementId(
  state: EditorState,
  id: string,
): { from: number; to: number } | null {
  const arr = nodeForPath(state, ['elements']);
  if (!arr || arr.name !== 'Array') return null;
  for (let child = arr.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'Object') continue;
    for (let prop = child.firstChild; prop; prop = prop.nextSibling) {
      if (prop.name !== 'Property') continue;
      const keyNode = prop.firstChild;
      if (!keyNode) continue;
      if (state.sliceDoc(keyNode.from + 1, keyNode.to - 1) === 'id') {
        const value = keyNode.nextSibling;
        if (
          value?.name === 'String' &&
          state.sliceDoc(value.from + 1, value.to - 1) === id
        ) {
          return { from: child.from, to: child.to };
        }
      }
    }
  }
  return null;
}

// ── Theme (the editor's tokens; flips with data-theme for free) ────

const cmTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '11px',
    backgroundColor: 'transparent',
    color: 'var(--color-foreground)',
  },
  '.cm-scroller': {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: '1.55',
  },
  '.cm-content': { caretColor: 'var(--color-foreground)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--color-muted-foreground)',
    border: 'none',
    opacity: 0.7,
  },
  '.cm-activeLine': { backgroundColor: 'var(--color-secondary)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  // Dedicated selection band (theme-tuned, see --color-selection). The
  // old --color-ring (#2e2e2e) painted a near-black block; a blue tint
  // clashed hue-for-hue with the blue string text. This muted blue-gray
  // keeps every syntax color legible on the selection.
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--color-selection) !important',
  },
  '.cm-cursor': { borderLeftColor: 'var(--color-foreground)' },
  '.cm-foldGutter .cm-gutterElement': { cursor: 'pointer' },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--color-destructive) 1px',
    textUnderlineOffset: '2.5px',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--color-popover)',
    color: 'var(--color-popover-foreground)',
    border: '1px solid var(--color-border)',
    borderRadius: '6px',
    fontSize: '11px',
  },
  // Search / replace panel — flat, matching the inspector chrome:
  // bg-background (no card), bg-field wells, a focus ring instead of
  // borders, rounded-md. Same tokens the inspector's controls use.
  '.cm-panels': {
    backgroundColor: 'var(--color-background)',
    color: 'var(--color-foreground)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--color-border)' },
  '.cm-panel.cm-search': { padding: '6px 10px', fontSize: '11px' },
  '.cm-panel.cm-search label': {
    fontSize: '11px',
    color: 'var(--color-muted-foreground)',
  },
  '.cm-panel.cm-search .cm-textfield': {
    backgroundColor: 'var(--color-field)',
    color: 'var(--color-foreground)',
    border: 'none',
    outline: 'none',
    borderRadius: '6px',
    padding: '3px 7px',
    fontSize: '11px',
  },
  '.cm-panel.cm-search .cm-textfield:focus': {
    outline: 'none',
    boxShadow: '0 0 0 1px var(--color-ring)',
  },
  '.cm-panel.cm-search .cm-button': {
    backgroundColor: 'var(--color-field)',
    color: 'var(--color-foreground)',
    border: 'none',
    backgroundImage: 'none',
    borderRadius: '6px',
    padding: '3px 9px',
    fontSize: '11px',
  },
  '.cm-panel.cm-search .cm-button:hover': {
    backgroundColor: 'var(--color-field-hover)',
  },
  '.cm-panel.cm-search button[name=close]': {
    color: 'var(--color-muted-foreground)',
    cursor: 'pointer',
    fontSize: '14px',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--color-yellow) 28%, transparent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--color-yellow) 55%, transparent)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'color-mix(in srgb, var(--color-playhead) 22%, transparent)',
  },
});

const jsonHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--color-syntax-key)' },
  { tag: tags.string, color: 'var(--color-syntax-string)' },
  { tag: tags.number, color: 'var(--color-syntax-number)' },
  { tag: [tags.bool, tags.null], color: 'var(--color-syntax-bool)' },
  { tag: tags.punctuation, color: 'var(--color-muted-foreground)' },
]);

// ── The panel ───────────────────────────────────────────────────────

export function SourcePanel() {
  const { store } = useEditorContext();
  const actions = useEditor();

  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Guards against feedback loops between the two sync directions.
    let applyingExternal = false; // store → editor rewrite in flight
    let committed = false; // our own commit echoing back from the store
    let commitTimer: ReturnType<typeof setTimeout> | undefined;
    let lastSelected: string | null = null;

    const setStatus = (text: string, bad: boolean): void => {
      const el = statusRef.current;
      if (!el) return;
      el.textContent = text;
      el.style.color = bad
        ? 'var(--color-destructive)'
        : 'var(--color-muted-foreground)';
    };

    const tryCommit = (view: EditorView): void => {
      const text = view.state.doc.toString();
      const result = validate(text);
      if (!result.valid) {
        setStatus(
          `${result.errors.length} issue${result.errors.length === 1 ? '' : 's'}`,
          true,
        );
        return;
      }
      setStatus('valid', false);
      if (text === format(store.getState().source)) return; // no-op edit
      committed = true;
      actionsRef.current.replaceSource(result.data);
    };

    const protocolLinter = linter((view) => {
      const text = view.state.doc.toString();
      try {
        JSON.parse(text);
      } catch {
        return []; // syntax layer (jsonParseLinter) owns this state
      }
      const result = validate(text);
      if (result.valid) return [];
      return result.errors.map((err) => {
        const range = rangeForPath(view.state, err.path);
        return {
          from: range?.from ?? 0,
          to: range?.to ?? 0,
          severity: 'error' as const,
          message: err.path.length
            ? `${err.path.join('.')}: ${err.message}`
            : err.message,
        };
      });
    });

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !applyingExternal) {
        setStatus('editing…', false);
        clearTimeout(commitTimer);
        commitTimer = setTimeout(() => tryCommit(update.view), COMMIT_DEBOUNCE_MS);
      }
      // Cursor → canvas selection (only for user-driven selection moves
      // while the pane has focus, and only when the text is parseable).
      if (
        update.selectionSet &&
        !applyingExternal &&
        update.view.hasFocus
      ) {
        const id = elementIdAtPos(
          update.view.state,
          update.view.state.selection.main.head,
        );
        if (id && id !== lastSelected) {
          lastSelected = id;
          const current = store.getState().selection;
          if (!(current.length === 1 && current[0] === id)) {
            actionsRef.current.selectOne(id);
          }
        }
      }
    });

    const extensions: Extension = [
      lineNumbers(),
      foldGutter(),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      json(),
      syntaxHighlighting(jsonHighlight),
      linter(jsonParseLinter()),
      protocolLinter,
      lintGutter(),
      // Find / replace docked at the TOP of the pane (⌘F / the Find button).
      search({ top: true }),
      highlightSelectionMatches(),
      keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      cmTheme,
      updateListener,
      EditorView.lineWrapping,
    ];

    const view = new EditorView({
      state: EditorState.create({
        doc: format(store.getState().source),
        extensions,
      }),
      parent: host,
    });
    viewRef.current = view;
    setStatus('valid', false);

    // Store → editor. Skip the echo of our own commit; let focused
    // keystrokes win over external edits until blur.
    const unsubSource = store.subscribe((state, prev) => {
      if (state.source === prev.source) return;
      if (committed) {
        committed = false;
        // Even our own commit may re-serialize differently (e.g. zod
        // defaults); only rewrite if the canonical text drifted AND
        // the user isn't already typing the next edit.
        if (view.hasFocus) return;
      }
      const text = format(state.source);
      if (text === view.state.doc.toString()) return;
      if (view.hasFocus) return; // user mid-edit: their keystrokes win
      applyingExternal = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
      applyingExternal = false;
      setStatus('valid', false);
      // Live autoscroll-to-edit: when a single element is selected and
      // its source is changing under us (e.g. a timeline/stage drag),
      // keep that element's JSON in view so the user watches it update
      // in real time. Selection unchanged → the selection sub below
      // won't fire, so we re-pin here. The hasFocus guard above means
      // we never do this while the user is typing.
      if (state.selection.length === 1) {
        const range = rangeForElementId(view.state, state.selection[0]!);
        if (range) {
          view.dispatch({
            effects: EditorView.scrollIntoView(range.from, { y: 'start', yMargin: 24 }),
          });
        }
      }
    });

    // On blur, resync from the store if the pane diverged invalidly.
    const onBlur = (): void => {
      const text = format(store.getState().source);
      if (view.state.doc.toString() !== text && !validate(view.state.doc.toString()).valid) {
        applyingExternal = true;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
        });
        applyingExternal = false;
        setStatus('valid', false);
      }
    };
    view.contentDOM.addEventListener('blur', onBlur);

    // Click-outside → blur the pane. The stage/timeline targets aren't
    // focusable, so clicking them leaves focus sitting in this
    // contentEditable: the cursor lingers AND the hasFocus guard below
    // keeps blocking live store→editor updates (drags rewriting the JSON)
    // until you click something focusable. Blurring on any pointerdown
    // outside the pane drops the cursor and resumes live updates — which
    // is what you'd expect from clicking away. Capture phase so it runs
    // before handlers that stopPropagation.
    const onOutsidePointerDown = (e: Event): void => {
      if (!view.hasFocus) return;
      const target = e.target as Node | null;
      if (target && host.contains(target)) return; // inside pane → keep focus
      view.contentDOM.blur();
    };
    document.addEventListener('pointerdown', onOutsidePointerDown, true);

    // Canvas selection → scroll the pane to the element.
    const unsubSelection = store.subscribe((state, prev) => {
      if (state.selection === prev.selection) return;
      if (state.selection.length !== 1) return;
      const id = state.selection[0]!;
      if (id === lastSelected) return;
      lastSelected = id;
      if (view.hasFocus) return; // don't yank the cursor mid-edit
      const range = rangeForElementId(view.state, id);
      if (!range) return;
      view.dispatch({
        selection: { anchor: range.from },
        effects: EditorView.scrollIntoView(range.from, { y: 'start', yMargin: 24 }),
      });
    });

    return () => {
      clearTimeout(commitTimer);
      view.contentDOM.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerdown', onOutsidePointerDown, true);
      unsubSource();
      unsubSelection();
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div ref={hostRef} className="flex-1 min-h-0 overflow-hidden" />
      <div className="flex items-center justify-between h-6 px-2 border-t border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground/60">Source</span>
          <button
            type="button"
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            title="Find / replace (⌘F)"
            onClick={() => {
              const v = viewRef.current;
              if (v) {
                openSearchPanel(v);
                v.focus();
              }
            }}
          >
            <svg width="11" height="11" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path d="M9 9 L12 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Find
          </button>
        </div>
        <span ref={statusRef} className="text-[10px] text-muted-foreground" />
      </div>
    </div>
  );
}
