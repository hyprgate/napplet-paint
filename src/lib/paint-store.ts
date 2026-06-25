import { storage } from '@napplet/sdk';

/**
 * Persistence for the paint napplet.
 *
 * Doodles are stored through NAP-STORAGE (the napplet-scoped KV store served by
 * the Kehto runtime). Each doodle's bitmap is a base64 PNG data URL kept under
 * its own key; a lightweight index lists the metadata so the gallery can render
 * without loading every bitmap. NAP-STORAGE is capped at ~512 KB per napplet, so
 * saves are best-effort and quota failures are surfaced to the UI rather than
 * thrown. The resource API (NAP-RESOURCE) is read-only and cannot save, and
 * NAP-UPLOAD/Blossom is not wired into the shell yet; if that lands, this module
 * is the single seam to swap the backend behind.
 *
 * Publishing is intentionally out of scope. Paint is a local doodle tool: it
 * declares no relay capability (manifest `requires` is `['storage', 'theme']`)
 * and performs no Nostr I/O, so NAP-OUTBOX is correctly absent — there is no
 * relay fanout to route. A future "Share to Nostr" action would host the bitmap
 * via NAP-UPLOAD (still unwired) and then publish a picture/note event through
 * `outbox.publish` for outbox-aware write-relay fanout; that publish call is the
 * seam to add it, not a local relay subscription.
 */

/** Minimal async KV surface — matches `@napplet/sdk` `storage`, injectable for tests. */
export interface PaintStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Metadata for a saved doodle (everything except the pixels). */
export interface DoodleMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  updatedAt: number;
}

export type SaveResult =
  | { ok: true; meta: DoodleMeta }
  | { ok: false; error: string };

export const INDEX_KEY = 'paint:index:v1';

export function doodleKey(id: string): string {
  return `paint:doodle:${id}`;
}

const defaultStorage: PaintStorage = storage;

/** Stable-ish id derived from the save time; callers pass `now` for determinism. */
export function makeDoodleId(now: number): string {
  return `doodle-${now}`;
}

/** Coerce untrusted JSON into a clean, newest-first metadata list. */
export function normalizeIndex(raw: unknown): DoodleMeta[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value): DoodleMeta | null => {
      if (!value || typeof value !== 'object') return null;
      const candidate = value as Partial<DoodleMeta>;
      if (typeof candidate.id !== 'string' || !candidate.id) return null;
      if (typeof candidate.name !== 'string') return null;
      const width = Number(candidate.width);
      const height = Number(candidate.height);
      const updatedAt = Number(candidate.updatedAt);
      if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
      return {
        id: candidate.id,
        name: candidate.name,
        width,
        height,
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
      };
    })
    .filter((item): item is DoodleMeta => item !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Insert or replace a doodle's metadata, keeping the list newest-first. */
export function upsertMeta(list: DoodleMeta[], meta: DoodleMeta): DoodleMeta[] {
  const rest = list.filter((item) => item.id !== meta.id);
  return [meta, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function removeMeta(list: DoodleMeta[], id: string): DoodleMeta[] {
  return list.filter((item) => item.id !== id);
}

async function readIndex(store: PaintStorage): Promise<DoodleMeta[]> {
  try {
    const raw = await store.getItem(INDEX_KEY);
    if (!raw) return [];
    return normalizeIndex(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function writeIndex(store: PaintStorage, list: DoodleMeta[]): Promise<void> {
  await store.setItem(INDEX_KEY, JSON.stringify(list));
}

export async function listDoodles(store: PaintStorage = defaultStorage): Promise<DoodleMeta[]> {
  return readIndex(store);
}

/** Load a doodle's PNG data URL, or null if it is missing. */
export async function loadDoodle(
  id: string,
  store: PaintStorage = defaultStorage,
): Promise<string | null> {
  try {
    return await store.getItem(doodleKey(id));
  } catch {
    return null;
  }
}

export interface SaveInput {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  now: number;
}

/**
 * Persist a doodle's bitmap and update the index. Writes the bitmap first so a
 * quota failure cannot leave a dangling index entry pointing at missing pixels.
 */
export async function saveDoodle(
  input: SaveInput,
  store: PaintStorage = defaultStorage,
): Promise<SaveResult> {
  const name = input.name.trim() || 'Untitled';
  const meta: DoodleMeta = {
    id: input.id,
    name,
    width: input.width,
    height: input.height,
    updatedAt: input.now,
  };
  try {
    await store.setItem(doodleKey(input.id), input.dataUrl);
  } catch (error) {
    return { ok: false, error: storageErrorMessage(error) };
  }
  try {
    const index = await readIndex(store);
    await writeIndex(store, upsertMeta(index, meta));
  } catch (error) {
    // Bitmap saved but index update failed (e.g. quota); roll back the orphan.
    await store.removeItem(doodleKey(input.id)).catch(() => {});
    return { ok: false, error: storageErrorMessage(error) };
  }
  return { ok: true, meta };
}

export async function deleteDoodle(
  id: string,
  store: PaintStorage = defaultStorage,
): Promise<void> {
  const index = await readIndex(store);
  await writeIndex(store, removeMeta(index, id)).catch(() => {});
  await store.removeItem(doodleKey(id)).catch(() => {});
}

function storageErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/quota/i.test(text)) {
    return 'Out of storage space — delete a saved doodle and try again.';
  }
  return text || 'Could not save doodle.';
}
