import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { readFileSync } from 'node:fs';
import App from './App.svelte';
import { saveDoodle } from './lib/paint-store';

vi.mock('./lib/paint-store', () => ({
  deleteDoodle: vi.fn().mockResolvedValue(undefined),
  listDoodles: vi.fn().mockResolvedValue([]),
  loadDoodle: vi.fn().mockResolvedValue(null),
  makeDoodleId: vi.fn(() => 'doodle-1'),
  saveDoodle: vi.fn(async (input: { id: string; name: string }) => ({
    ok: true,
    meta: { id: input.id, name: input.name || 'Untitled' },
  })),
}));

vi.mock('./lib/paint-upload', () => ({
  canvasToPngBlob: vi.fn(),
  detectUploadSupport: vi.fn().mockResolvedValue(false),
  uploadImageBlob: vi.fn(),
}));

let component: ReturnType<typeof mount> | null = null;

function openDialog(this: HTMLDialogElement): void {
  this.setAttribute('open', '');
}

function closeDialog(this: HTMLDialogElement): void {
  this.removeAttribute('open');
}

beforeEach(() => {
  // jsdom has neither modal dialogs nor a canvas backend.
  HTMLDialogElement.prototype.showModal = openDialog;
  HTMLDialogElement.prototype.close = closeDialog;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,AAAA');
  component = mount(App, { target: document.body });
  flushSync();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

const root = () => document.querySelector('[data-paint-root]')!;
const flag = () => document.querySelector('[data-paint-doc-state]')?.textContent;

function menu(id: string, testIdOrText: string): void {
  document.querySelector<HTMLButtonElement>(`[data-menu="${id}"]`)!.click();
  flushSync();
  const panel = document.querySelector(`[data-menu-panel="${id}"]`)!;
  const item = panel.querySelector<HTMLButtonElement>(`[data-testid="${testIdOrText}"]`)
    ?? [...panel.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(testIdOrText))!;
  item.click();
  flushSync();
}

function nameBox(text: string): HTMLInputElement {
  const box = document.querySelector<HTMLInputElement>('[aria-label="Doodle name"]')!;
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  return box;
}

describe('saving', () => {
  // jsdom happily submits forms, so this can't be proven by behaviour here. The
  // real browser blocks submission under the sandbox: see e2e/napplet-proof/paint.spec.ts.
  it('uses no forms, which the app sandbox would never submit', () => {
    expect(document.querySelector('form')).toBeNull();
    expect(readFileSync('src/App.svelte', 'utf8')).not.toMatch(/<form|onsubmit/);
  });

  it('saves when Enter is pressed in the name box', async () => {
    menu('file', 'save');
    const box = nameBox('Red and blue');

    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(() => expect(saveDoodle).toHaveBeenCalledWith(expect.objectContaining({ name: 'Red and blue' })));
    expect(document.querySelector('.save-dialog')?.hasAttribute('open')).toBe(false);
  });

  it('saves when the Save button is clicked', async () => {
    menu('file', 'save');
    nameBox('Clicked');

    document.querySelector<HTMLButtonElement>('[data-testid="save-confirm"]')!.click();

    await vi.waitFor(() => expect(saveDoodle).toHaveBeenCalledWith(expect.objectContaining({ name: 'Clicked' })));
  });

  it('does not save on other keys or Cancel', () => {
    menu('file', 'save');
    const box = nameBox('Nope');

    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    [...document.querySelectorAll<HTMLButtonElement>('.dlg-btn')].find((b) => b.textContent === 'Cancel')!.click();

    expect(saveDoodle).not.toHaveBeenCalled();
  });
});

describe('unsaved work', () => {
  it('shows the document state in words', () => {
    expect(flag()).toBe('Nothing to save yet');

    menu('image', 'Clear Image');

    expect(flag()).toBe('Unsaved changes');
    expect(root().getAttribute('data-paint-dirty')).toBe('true');
  });

  it('asks before New throws away unsaved work', () => {
    menu('image', 'Clear Image');
    menu('file', 'new');
    flushSync();

    expect(document.querySelector('[data-testid="discard-dialog"]')?.hasAttribute('open')).toBe(true);
    expect(flag()).toBe('Unsaved changes');

    document.querySelector<HTMLButtonElement>('[data-testid="discard-cancel"]')!.click();
    flushSync();
    expect(flag()).toBe('Unsaved changes');

    menu('file', 'new');
    document.querySelector<HTMLButtonElement>('[data-testid="discard-confirm"]')!.click();
    flushSync();
    expect(flag()).toBe('Nothing to save yet');
  });

  it('does not ask when there is nothing to lose', () => {
    menu('file', 'new');

    expect(document.querySelector('[data-testid="discard-dialog"]')?.hasAttribute('open')).toBe(false);
  });
});

describe('keyboard', () => {
  function press(key: string, target: EventTarget = window): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    flushSync();
  }

  it('picks tools with single keys', () => {
    press('e');
    expect(root().getAttribute('data-paint-tool')).toBe('eraser');
    press('F');
    expect(root().getAttribute('data-paint-tool')).toBe('fill');
    press('p');
    expect(root().getAttribute('data-paint-tool')).toBe('pencil');
  });

  it('leaves letters alone while a dialog is open', () => {
    menu('file', 'save');
    press('e');

    expect(root().getAttribute('data-paint-tool')).toBe('pencil');
  });

  it('opens the shortcut list with ? and from the Help menu', () => {
    const dialog = () => document.querySelector('[data-testid="shortcuts-dialog"]')!;
    press('?');
    expect(dialog().hasAttribute('open')).toBe(true);
    dialog().removeAttribute('open');

    menu('help', 'shortcuts');
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(dialog().textContent).toContain('Ctrl+Z');
  });

  it('keeps Undo and Redo on the toolbar, off until there is something to do', () => {
    expect(document.querySelector<HTMLButtonElement>('[data-testid="toolbar-undo"]')!.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('[data-testid="toolbar-redo"]')!.disabled).toBe(true);
  });
});
