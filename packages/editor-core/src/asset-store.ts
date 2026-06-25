// AssetStore — the editor's storage PORT. The editor never talks to a database;
// it talks to THIS interface. A zero-config local default (IndexedDB) ships so
// the "Your media" bin works the moment you mount <Editor> — no backend, no
// keys, no DB. Consumers inject their own adapter (Supabase, S3, their own API)
// via the `assetStore` prop, so the library itself stays dependency-free and
// storage-agnostic. Same philosophy as `onSourceChange` / `onRender`.

export type AssetKind = 'image' | 'video' | 'audio';

export interface ClipkitAsset {
  id: string;
  name: string;
  kind: AssetKind;
  /** A URL the runtime can load right now (object URL, data URL, or remote). */
  url: string;
  width?: number;
  height?: number;
  duration?: number;
  size?: number;
  createdAt?: number;
}

/**
 * Where the editor's media bin reads and writes. Implement this against any
 * backend; the editor only ever calls these methods.
 */
export interface AssetStore {
  /** Everything in the bin, newest first. */
  list(): Promise<ClipkitAsset[]>;
  /** Persist a file and return its record (with a url the runtime can load). */
  upload(file: File): Promise<ClipkitAsset>;
  /** Drop an asset by id. */
  remove(id: string): Promise<void>;
  /**
   * Optional: refresh a url for stores that hand out short-lived signed URLs
   * (S3/Supabase). Local stores don't need it.
   */
  resolveUrl?(asset: ClipkitAsset): Promise<string>;
}

function kindOf(type: string): AssetKind | null {
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return null;
}

function uid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `a_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Best-effort intrinsic dimensions / duration. Never throws (returns {}). */
async function probe(file: File, kind: AssetKind): Promise<Pick<ClipkitAsset, 'width' | 'height' | 'duration'>> {
  try {
    if (kind === 'image' && typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(file);
      const out = { width: bmp.width, height: bmp.height };
      bmp.close();
      return out;
    }
    if ((kind === 'video' || kind === 'audio') && typeof document !== 'undefined') {
      const url = URL.createObjectURL(file);
      try {
        const el = document.createElement(kind === 'video' ? 'video' : 'audio');
        el.preload = 'metadata';
        await new Promise<void>((resolve, reject) => {
          el.onloadedmetadata = () => resolve();
          el.onerror = () => reject(new Error('probe failed'));
          el.src = url;
        });
        const v = el as HTMLVideoElement;
        return {
          duration: Number.isFinite(el.duration) ? el.duration : undefined,
          width: v.videoWidth || undefined,
          height: v.videoHeight || undefined,
        };
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  } catch {
    /* probing is best-effort — the asset is still usable without metadata */
  }
  return {};
}

// ── IndexedDB-backed local store (the zero-config default) ────────────────────

const DB_NAME = 'clipkit-assets';
const STORE = 'assets';

interface StoredAsset {
  id: string;
  name: string;
  kind: AssetKind;
  width?: number;
  height?: number;
  duration?: number;
  size?: number;
  createdAt: number;
  blob: Blob;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * The default `AssetStore`: files live in the browser's IndexedDB (the blobs
 * survive reloads), served to the runtime as object URLs. No server, no keys.
 * On a platform without IndexedDB (SSR), falls back to an in-memory store so
 * calls never throw.
 */
export function createLocalAssetStore(): AssetStore {
  if (typeof indexedDB === 'undefined') return createMemoryAssetStore();

  const urls = new Map<string, string>(); // id → object URL (created once, reused)
  const toAsset = (r: StoredAsset): ClipkitAsset => {
    let url = urls.get(r.id);
    if (!url) {
      url = URL.createObjectURL(r.blob);
      urls.set(r.id, url);
    }
    return {
      id: r.id, name: r.name, kind: r.kind, url,
      width: r.width, height: r.height, duration: r.duration, size: r.size, createdAt: r.createdAt,
    };
  };

  return {
    async list() {
      const db = await openDb();
      try {
        const records = await new Promise<StoredAsset[]>((resolve, reject) => {
          const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
          req.onsuccess = () => resolve(req.result as StoredAsset[]);
          req.onerror = () => reject(req.error);
        });
        return records.sort((a, b) => b.createdAt - a.createdAt).map(toAsset);
      } finally {
        db.close();
      }
    },
    async upload(file) {
      const kind = kindOf(file.type);
      if (!kind) throw new Error(`Unsupported file type: ${file.type || 'unknown'}`);
      const meta = await probe(file, kind);
      const rec: StoredAsset = {
        id: uid(), name: file.name, kind, size: file.size, createdAt: Date.now(), blob: file,
        width: meta.width, height: meta.height, duration: meta.duration,
      };
      const db = await openDb();
      try {
        await new Promise<void>((resolve, reject) => {
          const t = db.transaction(STORE, 'readwrite');
          t.objectStore(STORE).put(rec);
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
        });
      } finally {
        db.close();
      }
      return toAsset(rec);
    },
    async remove(id) {
      const db = await openDb();
      try {
        await new Promise<void>((resolve, reject) => {
          const t = db.transaction(STORE, 'readwrite');
          t.objectStore(STORE).delete(id);
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
        });
      } finally {
        db.close();
      }
      const u = urls.get(id);
      if (u) {
        URL.revokeObjectURL(u);
        urls.delete(id);
      }
    },
  };
}

/** Session-only in-memory store (no persistence). SSR fallback / tests. */
export function createMemoryAssetStore(): AssetStore {
  const items: ClipkitAsset[] = [];
  return {
    async list() {
      return [...items].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    },
    async upload(file) {
      const kind = kindOf(file.type);
      if (!kind) throw new Error(`Unsupported file type: ${file.type || 'unknown'}`);
      const meta = await probe(file, kind);
      const asset: ClipkitAsset = {
        id: uid(), name: file.name, kind, url: URL.createObjectURL(file),
        size: file.size, createdAt: Date.now(),
        width: meta.width, height: meta.height, duration: meta.duration,
      };
      items.push(asset);
      return asset;
    },
    async remove(id) {
      const found = items.find((a) => a.id === id);
      if (found) {
        URL.revokeObjectURL(found.url);
        items.splice(items.indexOf(found), 1);
      }
    },
  };
}
