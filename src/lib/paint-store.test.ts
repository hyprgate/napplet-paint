import { describe, expect, it } from 'vitest';
import {
  INDEX_KEY,
  doodleKey,
  listDoodles,
  loadDoodle,
  saveDoodle,
  deleteDoodle,
  normalizeIndex,
  upsertMeta,
  removeMeta,
  type DoodleMeta,
  type PaintStorage,
} from './paint-store.js';

function createMemoryStorage(opts: { failOn?: (key: string) => boolean } = {}): PaintStorage & {
  raw: Map<string, string>;
} {
  const raw = new Map<string, string>();
  return {
    raw,
    async getItem(key) {
      return raw.has(key) ? raw.get(key)! : null;
    },
    async setItem(key, value) {
      if (opts.failOn?.(key)) throw new Error('quota-exceeded');
      raw.set(key, value);
    },
    async removeItem(key) {
      raw.delete(key);
    },
  };
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAA=';

describe('normalizeIndex', () => {
  it('drops malformed entries and sorts newest-first', () => {
    const result = normalizeIndex([
      { id: 'a', name: 'A', width: 10, height: 10, updatedAt: 100 },
      { id: 'b', name: 'B', width: 10, height: 10, updatedAt: 300 },
      { name: 'no id', width: 1, height: 1, updatedAt: 999 },
      'garbage',
      null,
    ]);
    expect(result.map((m) => m.id)).toEqual(['b', 'a']);
  });

  it('returns [] for non-array input', () => {
    expect(normalizeIndex(null)).toEqual([]);
    expect(normalizeIndex('nope')).toEqual([]);
  });
});

describe('upsertMeta / removeMeta', () => {
  const base: DoodleMeta = { id: 'a', name: 'A', width: 10, height: 10, updatedAt: 100 };

  it('replaces an existing id rather than duplicating', () => {
    const updated = { ...base, name: 'A2', updatedAt: 500 };
    const result = upsertMeta([base], updated);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('A2');
  });

  it('keeps the list sorted newest-first after insert', () => {
    const older: DoodleMeta = { id: 'b', name: 'B', width: 1, height: 1, updatedAt: 50 };
    const result = upsertMeta([base], older);
    expect(result.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('removeMeta drops the matching id only', () => {
    expect(removeMeta([base], 'a')).toEqual([]);
    expect(removeMeta([base], 'missing')).toEqual([base]);
  });
});

describe('saveDoodle / loadDoodle / listDoodles', () => {
  it('saves the bitmap and indexes its metadata', async () => {
    const store = createMemoryStorage();
    const result = await saveDoodle(
      { id: 'd1', name: 'Sun', dataUrl: PNG, width: 480, height: 360, now: 1000 },
      store,
    );
    expect(result.ok).toBe(true);

    expect(await loadDoodle('d1', store)).toBe(PNG);
    const list = await listDoodles(store);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'd1', name: 'Sun', width: 480, height: 360 });
    expect(store.raw.get(doodleKey('d1'))).toBe(PNG);
  });

  it('blank names fall back to Untitled', async () => {
    const store = createMemoryStorage();
    await saveDoodle({ id: 'd1', name: '   ', dataUrl: PNG, width: 1, height: 1, now: 1 }, store);
    expect((await listDoodles(store))[0]!.name).toBe('Untitled');
  });

  it('re-saving the same id overwrites without duplicating the index', async () => {
    const store = createMemoryStorage();
    await saveDoodle({ id: 'd1', name: 'v1', dataUrl: PNG, width: 1, height: 1, now: 1 }, store);
    await saveDoodle({ id: 'd1', name: 'v2', dataUrl: PNG, width: 2, height: 2, now: 2 }, store);
    const list = await listDoodles(store);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'v2', width: 2, height: 2 });
  });

  it('reports a friendly error and leaves no orphan when the bitmap exceeds quota', async () => {
    const store = createMemoryStorage({ failOn: (key) => key.startsWith('paint:doodle:') });
    const result = await saveDoodle(
      { id: 'd1', name: 'big', dataUrl: PNG, width: 1, height: 1, now: 1 },
      store,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/storage space/i);
    expect(store.raw.has(INDEX_KEY)).toBe(false);
    expect(store.raw.has(doodleKey('d1'))).toBe(false);
  });

  it('rolls back the bitmap when the index write fails', async () => {
    const store = createMemoryStorage({ failOn: (key) => key === INDEX_KEY });
    const result = await saveDoodle(
      { id: 'd1', name: 'x', dataUrl: PNG, width: 1, height: 1, now: 1 },
      store,
    );
    expect(result.ok).toBe(false);
    expect(store.raw.has(doodleKey('d1'))).toBe(false);
  });
});

describe('deleteDoodle', () => {
  it('removes both the bitmap and its index entry', async () => {
    const store = createMemoryStorage();
    await saveDoodle({ id: 'd1', name: 'a', dataUrl: PNG, width: 1, height: 1, now: 1 }, store);
    await saveDoodle({ id: 'd2', name: 'b', dataUrl: PNG, width: 1, height: 1, now: 2 }, store);

    await deleteDoodle('d1', store);

    expect(await loadDoodle('d1', store)).toBeNull();
    const list = await listDoodles(store);
    expect(list.map((m) => m.id)).toEqual(['d2']);
  });
});
