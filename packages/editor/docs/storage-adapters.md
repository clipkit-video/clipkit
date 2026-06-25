# Storage adapters (`AssetStore`)

The editor stores nothing on a server itself. Media files in the **Assets → Your
media** bin go through one small interface — `AssetStore` — and the editor only
ever calls `list` / `upload` / `remove`. That keeps `@clipkit/editor`
dependency-free and storage-agnostic: it has no database SDK, no API keys, no
backend assumptions.

This is the same pattern as `onSourceChange` (persistence) and `onRender`
(rendering): the library defines the seam, you inject the behavior.

## Default: zero-config, local, no backend

Mount the editor with nothing extra and you get a working bin immediately:

```tsx
import { Editor } from '@clipkit/editor';

<Editor initialSource={source} />
```

Under the hood that's `createLocalAssetStore()` — files are kept in the browser's
**IndexedDB** (the blobs survive reloads) and served to the runtime as object
URLs. No server, no keys. Great for trying the editor, demos, and local-first
apps.

> Session-only variant: `createMemoryAssetStore()` (no persistence). Used
> automatically when IndexedDB is unavailable (e.g. SSR).

## The interface

```ts
export type AssetKind = 'image' | 'video' | 'audio';

export interface ClipkitAsset {
  id: string;
  name: string;
  kind: AssetKind;
  url: string;          // a URL the runtime can load now (object URL, data URL, remote)
  width?: number; height?: number; duration?: number; size?: number;
  createdAt?: number;
}

export interface AssetStore {
  list(): Promise<ClipkitAsset[]>;            // newest first
  upload(file: File): Promise<ClipkitAsset>;  // persist + return the record
  remove(id: string): Promise<void>;
  resolveUrl?(asset: ClipkitAsset): Promise<string>; // optional: re-sign short-lived URLs
}
```

## Bring your own backend

Implement `AssetStore` against anything and pass it in. The editor doesn't change.

```tsx
import { Editor, type AssetStore } from '@clipkit/editor';

const myStore: AssetStore = {
  async list() { /* fetch your rows → ClipkitAsset[] */ },
  async upload(file) { /* PUT to your storage, return a ClipkitAsset */ },
  async remove(id) { /* delete it */ },
};

<Editor initialSource={source} assetStore={myStore} />
```

### Example: Supabase Storage

The connector lives in **your** app — you construct it with your own client/keys.
The editor package never imports `@supabase/*`.

```ts
import { createClient } from '@supabase/supabase-js';
import type { AssetStore, ClipkitAsset, AssetKind } from '@clipkit/editor';

const supabase = createClient(URL, ANON_KEY);
const BUCKET = 'assets';
const kindOf = (t: string): AssetKind =>
  t.startsWith('video/') ? 'video' : t.startsWith('audio/') ? 'audio' : 'image';

export const supabaseAssetStore: AssetStore = {
  async list() {
    const { data } = await supabase.storage.from(BUCKET).list();
    return (data ?? []).map((f): ClipkitAsset => ({
      id: f.name,
      name: f.name,
      kind: kindOf(f.metadata?.mimetype ?? ''),
      url: supabase.storage.from(BUCKET).getPublicUrl(f.name).data.publicUrl,
      size: f.metadata?.size,
    }));
  },
  async upload(file) {
    const id = `${crypto.randomUUID()}-${file.name}`;
    await supabase.storage.from(BUCKET).upload(id, file);
    return {
      id, name: file.name, kind: kindOf(file.type),
      url: supabase.storage.from(BUCKET).getPublicUrl(id).data.publicUrl,
      size: file.size,
    };
  },
  async remove(id) { await supabase.storage.from(BUCKET).remove([id]); },
};
```

For private buckets, return a signed URL from `upload`/`list` and implement
`resolveUrl` to refresh it when it expires. The same shape works for S3
(`@aws-sdk/client-s3` + presigned URLs), a REST API, or anything else.

## Documents vs. assets

- **Assets** (media files) → `assetStore`.
- **The document** (the Source JSON) → `onSourceChange(source)` to persist,
  `initialSource` to load. Same local-default-or-inject philosophy.
