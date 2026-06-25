import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadImageBlob, detectUploadSupport, type PaintUploader } from './paint-upload.js';
import type { UploadRequest, UploadResult } from '@napplet/sdk';

function pngBlob(type = 'image/png'): Blob {
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type });
}

function uploaderReturning(result: UploadResult): PaintUploader & {
  calls: UploadRequest[];
} {
  const calls: UploadRequest[] = [];
  return {
    calls,
    async upload(request) {
      calls.push(request);
      return result;
    },
  };
}

const okResult: UploadResult = {
  ok: true,
  uploadId: 'u1',
  status: 'complete',
  rail: 'blossom',
  url: 'blossom://abc.png?xs=https://s.example',
  fallbackUrls: ['https://s.example/abc.png'],
  sha256: 'abc',
  size: 4,
};

describe('uploadImageBlob', () => {
  it('returns the shell-provided URL on success', async () => {
    const uploader = uploaderReturning(okResult);
    const outcome = await uploadImageBlob(pngBlob(), { filename: 'doodle.png' }, uploader);

    expect(outcome.ok).toBe(true);
    expect(outcome.url).toBe('blossom://abc.png?xs=https://s.example');
    expect(outcome.fallbackUrls).toEqual(['https://s.example/abc.png']);
    expect(outcome.sha256).toBe('abc');
  });

  it('forwards bytes, mime, filename and caption to the shell — and no rail hint', async () => {
    const uploader = uploaderReturning(okResult);
    await uploadImageBlob(pngBlob(), { filename: 'doodle.png', caption: 'My art' }, uploader);

    const req = uploader.calls[0]!;
    expect(req.data).toBeInstanceOf(Blob);
    expect(req.mimeType).toBe('image/png');
    expect(req.filename).toBe('doodle.png');
    expect(req.caption).toBe('My art');
    // Rail-agnostic: the napplet never picks a backend; the shell does.
    expect(req.rail).toBeUndefined();
  });

  it('falls back to image/png when the blob has no type', async () => {
    const uploader = uploaderReturning(okResult);
    await uploadImageBlob(pngBlob(''), { filename: 'doodle.png' }, uploader);
    expect(uploader.calls[0]!.mimeType).toBe('image/png');
  });

  it('reports the shell error when the upload fails', async () => {
    const uploader = uploaderReturning({
      ok: false,
      uploadId: 'u2',
      status: 'failed',
      rail: 'blossom',
      error: 'no server configured',
    });
    const outcome = await uploadImageBlob(pngBlob(), { filename: 'doodle.png' }, uploader);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('no server configured');
  });

  it('treats an ok result with no URL as a failure', async () => {
    const uploader = uploaderReturning({
      ok: true,
      uploadId: 'u3',
      status: 'complete',
      rail: 'blossom',
    });
    const outcome = await uploadImageBlob(pngBlob(), { filename: 'doodle.png' }, uploader);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('Upload failed');
  });

  it('collapses a thrown transport error into a failure outcome', async () => {
    const uploader: PaintUploader = {
      upload: vi.fn(async () => {
        throw new Error('shell disconnected');
      }),
    };
    const outcome = await uploadImageBlob(pngBlob(), { filename: 'doodle.png' }, uploader);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('shell disconnected');
  });
});

describe('detectUploadSupport', () => {
  afterEach(() => {
    delete (globalThis as { napplet?: unknown }).napplet;
  });

  function stubShell(shell: unknown): void {
    (globalThis as { napplet?: unknown }).napplet = { shell };
  }

  it('returns false when no shell is present (standalone)', async () => {
    expect(await detectUploadSupport()).toBe(false);
  });

  it('returns true when the shell reports upload after ready()', async () => {
    const supports = vi.fn((domain: string) => domain === 'upload');
    stubShell({ ready: async () => {}, supports });
    expect(await detectUploadSupport()).toBe(true);
    // Capability is queried only after the handshake settles.
    expect(supports).toHaveBeenCalledWith('upload');
  });

  it('returns false when the shell does not offer upload', async () => {
    stubShell({ ready: async () => {}, supports: (d: string) => d === 'storage' });
    expect(await detectUploadSupport()).toBe(false);
  });

  it('returns false when the ready handshake rejects', async () => {
    stubShell({ ready: async () => { throw new Error('no host'); }, supports: () => true });
    expect(await detectUploadSupport()).toBe(false);
  });
});
