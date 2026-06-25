// Shared server identity, capabilities, and agent instructions — used by BOTH
// entry points (the stdio bin in index.ts and a hosted HTTP route) so a remote
// server guides agents identically to the local one. Kept separate from
// index.ts so the library entry can import these without the stdio bootstrap.

export const SERVER_INFO = { name: 'clipkit', version: '0.0.0' };

export const SERVER_CAPABILITIES = { tools: {}, resources: {} };

export const SERVER_INSTRUCTIONS =
  'Clipkit MCP — author Clipkit Protocol videos via tools, and read the canonical ' +
  'authoring docs as resources. ' +
  'BEFORE composing, call read_docs for the authoring guide (read_docs topic:"protocol" for ' +
  'field semantics, topic:"brand" for brand-correct visuals). For exact field names + types ' +
  'call get_schema (optionally with an element_type). These are TOOLS, not resources, so you ' +
  'can read them directly. ' +
  'TWO WAYS TO BUILD — pick by the brief, do NOT default to one: ' +
  '(A) AUTHOR IT YOURSELF — write a full source JSON and call set_project. This is the full ' +
  'creative canvas: every element type (text, image, video, shape, audio, group, caption, ' +
  'particles) plus effects, 3D camera, lighting, gradients, keyframe animation, and ' +
  'expressions. Use this for anything specific, original, or not a stock promo — most briefs. ' +
  '(B) create_promo — a FAST path that assembles a conventional promo/intro/product/data ' +
  'video from prebuilt scenes (it handles camera/glass/lighting/motion/layout). Good when a ' +
  'template fits; it is ONE option, not the default. Mix scene types and fit the structure to ' +
  'the content — do NOT reflexively make a glass-orb hero + CTA. ' +
  'TWEAK an existing project with add_element / edit_element / delete_element. ' +
  'SEE YOUR WORK — you cannot otherwise see the video: call preview_still for a frame, and ' +
  'validate_project / describe_project for a structural read-back with render-time warnings. ' +
  'The loop is edit → preview_still → fix. ' +
  'CAPTIONS: transcribe_to_captions turns a media url (or local file) into a timed caption. ' +
  'DELIVER: open_in_editor returns a free editor link; load_project re-imports a shared ' +
  'project by id/URL; render_video renders a finished MP4 in the cloud (paid; needs ' +
  'CLIPKIT_API_KEY). ' +
  'PROJECT IDS: create_project / set_project / create_promo / load_project return a ' +
  'project_id; pass it to subsequent tools (get_project / edit_element / preview_still / ' +
  'validate_project / render_video / …). When working on a single local project you may omit it.';
