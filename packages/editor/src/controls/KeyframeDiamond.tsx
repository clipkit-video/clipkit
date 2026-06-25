// The ◇/◆ keyframe diamond (re-ruled by Ian 2026-06-11): a true
// keyframe toggle, AE-style, reading state from the document + the
// playhead:
//
//   muted outline  — property has NO keyframes; click starts an
//                    animation with one keyframe at the playhead
//   BLUE outline   — keyframes exist, playhead is between them;
//                    click adds another at the playhead (value
//                    sampled from the curve via normative applyEasing)
//   BLUE fill      — playhead is ON a keyframe; click removes it
//                    (removing the last drops the whole entry)
//
// Shared toggle logic with the timeline lane rows (lib/keyframes.ts).
// The playhead subscription is a derived boolean — the button only
// re-renders when on/off-keyframe actually flips.

'use client';

import type { Element, Keyframe } from '@clipkit/protocol';
import {
  elementTime,
  useEditor,
  useEditorContext,
  useEditorStore,
} from '@clipkit/editor-core';
import { cn } from '../lib/utils.js';
import {
  findElementById as findById,
  isOnKeyframe,
  toggleKeyframeAt,
} from '../lib/keyframes.js';

export function KeyframeDiamond({
  elementId,
  property,
  animated,
  current,
  percentDefault,
}: {
  elementId: string;
  property: string;
  /** Has a keyframe_animations entry (the editor's animation surface). */
  animated: boolean;
  /** The field's current value — seeds the first keyframe. */
  current: unknown;
  /** Unauthored percent fields read 100, not 0. */
  percentDefault?: boolean;
}) {
  const { store } = useEditorContext();
  const actions = useEditor();

  // Derived boolean — re-renders only when the playhead crosses a
  // keyframe boundary, not on every tick.
  const onKf = useEditorStore((s) => {
    if (!animated) return false;
    const el = findById(s.source.elements, elementId);
    const anim = el?.keyframe_animations?.find((a) => a.property === property);
    if (!el || !anim) return false;
    // Same clamp as the click handler: a playhead before the element
    // maps to its first frame.
    return isOnKeyframe(anim, Math.max(0, s.playback.time - elementTime(el)));
  });

  // In-field keyframes (volume: Keyframe[]) — authored outside the
  // editor; shown filled but edited via the Source pane, not here.
  const inField = Array.isArray(current);

  const onClick = (): void => {
    const st = store.getState();
    const el = findById(st.source.elements, elementId);
    if (!el?.id) return;
    const local = Math.max(
      0,
      Math.round((st.playback.time - elementTime(el)) * 1000) / 1000,
    );
    const anims = el.keyframe_animations ?? [];
    const ai = anims.findIndex((a) => a.property === property);
    if (ai < 0) {
      // First keyframe — start the animation, seeded with the field's
      // current value.
      const seed =
        typeof current === 'number' || typeof current === 'string'
          ? current
          : percentDefault
            ? 100
            : 0;
      actions.updateElement(elementId, {
        keyframe_animations: [
          ...anims,
          { property, keyframes: [{ time: local, value: seed as Keyframe['value'] }] },
        ],
      } as Partial<Element>);
      return;
    }
    actions.updateElement(elementId, {
      keyframe_animations: toggleKeyframeAt(anims, ai, local),
    } as Partial<Element>);
  };

  const title = inField
    ? 'Keyframed in the document (edit via the Source pane)'
    : onKf
      ? 'Remove keyframe at current time'
      : 'Add keyframe at current time';

  return (
    <button
      type="button"
      className="w-5 h-5 grid place-items-center group shrink-0 disabled:cursor-default"
      title={title}
      aria-label={title}
      disabled={inField}
      onClick={onClick}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rotate-45 transition-colors border',
          inField
            ? 'bg-primary border-primary'
            : onKf
              ? '' // blue fill via style
              : animated
                ? 'bg-transparent' // blue stroke via style
                : 'bg-transparent border-muted-foreground/60 group-hover:border-foreground',
        )}
        style={
          inField
            ? undefined
            : onKf
              ? { background: 'var(--color-playhead)', borderColor: 'var(--color-playhead)' }
              : animated
                ? { borderColor: 'var(--color-playhead)' }
                : undefined
        }
      />
    </button>
  );
}
