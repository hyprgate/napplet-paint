import { upload as sdkUpload } from '@napplet/sdk';
import type { UploadRequest, UploadResult } from '@napplet/sdk';

/**
 * Shell-mediated upload for the paint napplet (NAP-UPLOAD).
 *
 * The napplet hands the shell raw PNG bytes plus intent and receives back a
 * stable URL. Storage backend, server selection, and authorization are entirely
 * the shell's concern — the napplet stays rail-agnostic and never touches
 * signing keys, server credentials, or network access.
 *
 * The minimal `PaintUploader` surface mirrors `@napplet/sdk` `upload` so the
 * logic stays injectable for tests (the SDK talks postMessage to the shell,
 * which is unavailable under jsdom). See paint-store.ts for the same pattern.
 */
export interface PaintUploader {
  upload(request: UploadRequest): Promise<UploadResult>;
}

/** Normalized result the UI consumes: a copyable URI, or a human error. */
export interface UploadOutcome {
  ok: boolean;
  /** Primary URI to surface for copy; its scheme/format is the shell's choice. */
  url?: string;
  /** Mirror / alternative server URLs, when the shell reports them. */
  fallbackUrls?: string[];
  /** Hash of the stored blob (NIP-94 `x`), when known. */
  sha256?: string;
  /** Human-readable failure reason. */
  error?: string;
}

const defaultUploader: PaintUploader = sdkUpload;

/** The slice of `window.napplet.shell` we need for capability detection. */
interface ShellLike {
  ready(): Promise<unknown>;
  supports(domain: string, protocol?: string): boolean;
}

function getShell(): ShellLike | null {
  return (
    globalThis as unknown as { napplet?: { shell?: ShellLike } }
  ).napplet?.shell ?? null;
}

/**
 * Resolve whether the running shell advertises the NAP-UPLOAD capability.
 *
 * `supports()` answers `false` until the shell delivers its environment, so we
 * await `ready()` first. Returns `false` (rather than hanging) when there is no
 * shell — e.g. the napplet served standalone in dev — so callers can hide the
 * upload affordance and degrade gracefully.
 */
export async function detectUploadSupport(): Promise<boolean> {
  const shell = getShell();
  if (!shell) return false;
  try {
    await shell.ready();
    return shell.supports('upload');
  } catch {
    return false;
  }
}

/** Render the current canvas to a PNG Blob (null if the browser refuses). */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

/**
 * Upload PNG bytes through the shell and normalize the reply. Never throws —
 * transport/shell errors collapse into `{ ok: false, error }` for the UI.
 */
export async function uploadImageBlob(
  blob: Blob,
  opts: { filename: string; caption?: string },
  uploader: PaintUploader = defaultUploader,
): Promise<UploadOutcome> {
  try {
    const result = await uploader.upload({
      data: blob,
      mimeType: blob.type || 'image/png',
      filename: opts.filename,
      caption: opts.caption,
    });
    if (!result.ok || !result.url) {
      return { ok: false, error: result.error ?? 'Upload failed' };
    }
    return {
      ok: true,
      url: result.url,
      fallbackUrls: result.fallbackUrls,
      sha256: result.sha256,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    };
  }
}
