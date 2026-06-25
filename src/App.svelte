<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { floodFill, hexToRgba } from './lib/flood-fill';
  import {
    deleteDoodle,
    listDoodles,
    loadDoodle,
    makeDoodleId,
    saveDoodle,
    type DoodleMeta,
  } from './lib/paint-store';

  const WIDTH = 480;
  const HEIGHT = 360;
  const BG = '#ffffff';

  type Tool = 'pencil' | 'eraser' | 'fill';

  // Classic MS Paint-style palette.
  const PALETTE = [
    '#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200',
    '#22b14c', '#00a2e8', '#3f48cc', '#a349a4', '#ffffff', '#c3c3c3',
    '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea',
    '#7092be', '#c8bfe7',
  ];
  const BRUSH_SIZES = [1, 2, 4, 8, 16];

  let canvas = $state<HTMLCanvasElement | null>(null);
  let ctx: CanvasRenderingContext2D | null = null;

  // Save-name modal: collects the file name instead of a persistent footer input.
  let saveDialog = $state<HTMLDialogElement | null>(null);
  let nameInput = $state<HTMLInputElement | null>(null);
  let dialogName = $state('');
  let forkOnSave = false;

  let tool = $state<Tool>('pencil');
  let color = $state('#000000');
  let brushSize = $state(4);

  let doodles = $state<DoodleMeta[]>([]);
  let currentId = $state<string | null>(null);
  let name = $state('');
  let dirty = $state(false);
  let busy = $state(false);
  let message = $state<{ text: string; kind: 'info' | 'error' } | null>(null);

  // Menu bar state. `openMenu` is the id of the open dropdown ('file' | 'image')
  // or null; `activeTop` drives roving tabindex across the top-level menu items.
  let menubarEl = $state<HTMLElement | null>(null);
  let openMenu = $state<string | null>(null);
  let activeTop = $state(0);

  let drawing = false;
  let lastX = 0;
  let lastY = 0;

  onMount(() => {
    const context = canvas?.getContext('2d', { willReadFrequently: true }) ?? null;
    ctx = context;
    clearCanvas();
    void refreshGallery();

    window.addEventListener('keydown', onWindowKeydown);
    window.addEventListener('pointerdown', onWindowPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onWindowKeydown);
      window.removeEventListener('pointerdown', onWindowPointerDown, true);
    };
  });

  async function refreshGallery(): Promise<void> {
    doodles = await listDoodles();
  }

  function notify(text: string, kind: 'info' | 'error' = 'info'): void {
    message = { text, kind };
  }

  function clearCanvas(): void {
    if (!ctx) return;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  function newCanvas(): void {
    clearCanvas();
    currentId = null;
    name = '';
    dirty = false;
    notify('New canvas');
  }

  function clearArtwork(): void {
    clearCanvas();
    dirty = true;
    notify('Canvas cleared');
  }

  // Map a pointer event to integer canvas-space pixel coordinates.
  function toCanvasPoint(event: PointerEvent): { x: number; y: number } {
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.floor((event.clientX - rect.left) * scaleX),
      y: Math.floor((event.clientY - rect.top) * scaleY),
    };
  }

  function strokeTo(x: number, y: number): void {
    if (!ctx) return;
    ctx.strokeStyle = tool === 'eraser' ? BG : color;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    lastX = x;
    lastY = y;
  }

  function dot(x: number, y: number): void {
    if (!ctx) return;
    ctx.fillStyle = tool === 'eraser' ? BG : color;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(brushSize / 2, 0.5), 0, Math.PI * 2);
    ctx.fill();
  }

  function bucketFill(x: number, y: number): void {
    if (!ctx) return;
    const image = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    const changed = floodFill(image.data, WIDTH, HEIGHT, x, y, hexToRgba(color));
    if (changed) {
      ctx.putImageData(image, 0, 0);
      dirty = true;
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if (!ctx) return;
    event.preventDefault();
    closeMenu();
    try {
      canvas?.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic/invalid pointer ids (tests) can't be captured — drawing still works.
    }
    const { x, y } = toCanvasPoint(event);
    if (tool === 'fill') {
      bucketFill(x, y);
      return;
    }
    drawing = true;
    dirty = true;
    lastX = x;
    lastY = y;
    dot(x, y);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drawing) return;
    const { x, y } = toCanvasPoint(event);
    strokeTo(x, y);
  }

  function endStroke(event: PointerEvent): void {
    if (!drawing) return;
    drawing = false;
    try {
      canvas?.releasePointerCapture?.(event.pointerId);
    } catch {
      // Ignore release for uncaptured/synthetic pointers.
    }
  }

  async function save(): Promise<void> {
    if (!canvas || busy) return;
    busy = true;
    message = null;
    try {
      const id = currentId ?? makeDoodleId(Date.now());
      const dataUrl = canvas.toDataURL('image/png');
      const result = await saveDoodle({
        id,
        name,
        dataUrl,
        width: WIDTH,
        height: HEIGHT,
        now: Date.now(),
      });
      if (result.ok) {
        currentId = id;
        name = result.meta.name;
        dirty = false;
        await refreshGallery();
        notify(`Saved "${result.meta.name}"`);
      } else {
        notify(result.error, 'error');
      }
    } finally {
      busy = false;
    }
  }

  // Save the current doodle. An already-named doodle overwrites silently; an
  // unsaved one prompts for a file name through the modal.
  function requestSave(): void {
    if (currentId) {
      void save();
      return;
    }
    forkOnSave = false;
    openNameDialog();
  }

  // "Save As" always forks the bitmap into a freshly-named copy.
  function requestSaveAs(): void {
    forkOnSave = true;
    openNameDialog();
  }

  function openNameDialog(): void {
    dialogName = name;
    message = null;
    saveDialog?.showModal();
    void tick().then(() => nameInput?.select());
  }

  async function confirmSave(event: Event): Promise<void> {
    event.preventDefault();
    name = dialogName.trim();
    if (forkOnSave) currentId = null;
    saveDialog?.close();
    await save();
  }

  function cancelSave(): void {
    saveDialog?.close();
  }

  async function load(meta: DoodleMeta): Promise<void> {
    if (busy) return;
    busy = true;
    message = null;
    try {
      const dataUrl = await loadDoodle(meta.id);
      if (!dataUrl) {
        notify('Could not load that doodle', 'error');
        return;
      }
      await drawDataUrl(dataUrl);
      currentId = meta.id;
      name = meta.name;
      dirty = false;
      notify(`Loaded "${meta.name}"`);
    } finally {
      busy = false;
    }
  }

  function drawDataUrl(dataUrl: string): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        clearCanvas();
        ctx?.drawImage(img, 0, 0, WIDTH, HEIGHT);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = dataUrl;
    });
  }

  async function remove(meta: DoodleMeta): Promise<void> {
    await deleteDoodle(meta.id);
    if (currentId === meta.id) currentId = null;
    await refreshGallery();
    notify(`Deleted "${meta.name}"`);
    // Keep the File menu open and land focus back on a real item.
    await tick();
    panelItems()[0]?.focus();
  }

  function exportPng(): void {
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = `${(name.trim() || 'doodle').replace(/[^a-z0-9-_]+/gi, '-')}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  }

  // ---- Menu bar: WAI-ARIA menubar with full keyboard support ----------------

  function topButtons(): HTMLButtonElement[] {
    return menubarEl
      ? Array.from(menubarEl.querySelectorAll<HTMLButtonElement>('[data-menu]'))
      : [];
  }

  function topButtonFor(menu: string): HTMLButtonElement | null {
    return menubarEl?.querySelector<HTMLButtonElement>(`[data-menu="${menu}"]`) ?? null;
  }

  // Focusable items inside the currently-open dropdown, in DOM order.
  function panelItems(): HTMLButtonElement[] {
    if (!menubarEl || !openMenu) return [];
    return Array.from(
      menubarEl.querySelectorAll<HTMLButtonElement>(
        `[data-menu-panel="${openMenu}"] [role="menuitem"]:not([disabled])`,
      ),
    );
  }

  function closeMenu(): void {
    openMenu = null;
  }

  function toggleMenu(menu: string): void {
    openMenu = openMenu === menu ? null : menu;
  }

  async function openAndFocus(menu: string): Promise<void> {
    openMenu = menu;
    await tick();
    panelItems()[0]?.focus();
  }

  function closeAndFocusTop(menu: string): void {
    closeMenu();
    topButtonFor(menu)?.focus();
  }

  // Run a menu action and dismiss the dropdown.
  function select(fn: () => void): void {
    closeMenu();
    fn();
  }

  async function switchMenu(fromMenu: string, dir: 1 | -1): Promise<void> {
    const tops = topButtons();
    if (tops.length === 0) return;
    const idx = tops.findIndex((b) => b.dataset.menu === fromMenu);
    const nextIdx = (idx + dir + tops.length) % tops.length;
    const next = tops[nextIdx];
    activeTop = nextIdx;
    openMenu = next.dataset.menu ?? null;
    await tick();
    panelItems()[0]?.focus();
  }

  function onTopKeydown(event: KeyboardEvent, menu: string, index: number): void {
    const tops = topButtons();
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowLeft': {
        event.preventDefault();
        const dir = event.key === 'ArrowRight' ? 1 : -1;
        const nextIdx = (index + dir + tops.length) % tops.length;
        activeTop = nextIdx;
        const next = tops[nextIdx];
        next.focus();
        if (openMenu) openMenu = next.dataset.menu ?? null;
        break;
      }
      case 'ArrowDown':
      case 'Enter':
      case ' ': {
        event.preventDefault();
        void openAndFocus(menu);
        break;
      }
      case 'Escape':
        closeMenu();
        break;
    }
  }

  function onPanelKeydown(event: KeyboardEvent): void {
    const menu = (event.currentTarget as HTMLElement).dataset.menuPanel ?? '';
    const items = panelItems();
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        items[(current + 1 + items.length) % items.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        items[(current - 1 + items.length) % items.length]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        items[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case 'ArrowRight':
        event.preventDefault();
        void switchMenu(menu, 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        void switchMenu(menu, -1);
        break;
      case 'Escape':
        event.preventDefault();
        closeAndFocusTop(menu);
        break;
      case 'Tab':
        closeMenu();
        break;
    }
  }

  function onWindowPointerDown(event: PointerEvent): void {
    if (!openMenu) return;
    const target = event.target as Node | null;
    if (menubarEl && target && menubarEl.contains(target)) return;
    closeMenu();
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        closeMenu();
        requestSave();
        return;
      }
      if (key === 'e') {
        event.preventDefault();
        closeMenu();
        exportPng();
        return;
      }
    }
    if (event.key === 'Escape' && openMenu) {
      closeMenu();
    }
  }
</script>

<div
  class="paint"
  data-paint-root
  data-paint-tool={tool}
  data-paint-dirty={dirty}
  data-doodle-count={doodles.length}
  data-current-id={currentId ?? ''}
>
  <div class="menubar" role="menubar" aria-label="Paint menu" bind:this={menubarEl}>
    <div class="menu-wrap">
      <button
        type="button"
        class="top"
        class:open={openMenu === 'file'}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={openMenu === 'file'}
        data-menu="file"
        tabindex={activeTop === 0 ? 0 : -1}
        onclick={() => toggleMenu('file')}
        onkeydown={(e) => onTopKeydown(e, 'file', 0)}
        onfocus={() => (activeTop = 0)}
        onmouseenter={() => openMenu && (openMenu = 'file')}
      >
        File
      </button>

      {#if openMenu === 'file'}
        <div class="menu" role="menu" aria-label="File" tabindex="-1" data-menu-panel="file" onkeydown={onPanelKeydown}>
          <button type="button" class="mi" role="menuitem" data-testid="new" onclick={() => select(newCanvas)} disabled={busy}>
            <span>New</span>
          </button>
          <button type="button" class="mi" role="menuitem" data-testid="save" onclick={() => select(requestSave)} disabled={busy}>
            <span>{currentId ? 'Save' : 'Save…'}</span><span class="sc">Ctrl+S</span>
          </button>
          <button type="button" class="mi" role="menuitem" onclick={() => select(requestSaveAs)} disabled={busy}>
            <span>Save As…</span>
          </button>
          <button type="button" class="mi" role="menuitem" onclick={() => select(exportPng)} disabled={busy}>
            <span>Export as PNG</span><span class="sc">Ctrl+E</span>
          </button>

          <div class="sep" role="separator"></div>
          <div class="menu-head" aria-hidden="true">Open saved ({doodles.length})</div>

          {#if doodles.length === 0}
            <button type="button" class="mi muted" role="menuitem" disabled>
              <span>No saved doodles</span>
            </button>
          {:else}
            {#each doodles as meta (meta.id)}
              <div class="chip mi-row" class:current={currentId === meta.id} data-doodle-id={meta.id}>
                <button
                  type="button"
                  class="mi mi-load"
                  role="menuitem"
                  data-testid="chip-load"
                  title={meta.name}
                  onclick={() => select(() => load(meta))}
                  disabled={busy}
                >
                  {currentId === meta.id ? '● ' : ''}{meta.name}
                </button>
                <button
                  type="button"
                  class="mi mi-del"
                  role="menuitem"
                  aria-label={`Delete ${meta.name}`}
                  title={`Delete ${meta.name}`}
                  onclick={() => remove(meta)}
                  disabled={busy}
                >
                  ×
                </button>
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>

    <div class="menu-wrap">
      <button
        type="button"
        class="top"
        class:open={openMenu === 'image'}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={openMenu === 'image'}
        data-menu="image"
        tabindex={activeTop === 1 ? 0 : -1}
        onclick={() => toggleMenu('image')}
        onkeydown={(e) => onTopKeydown(e, 'image', 1)}
        onfocus={() => (activeTop = 1)}
        onmouseenter={() => openMenu && (openMenu = 'image')}
      >
        Image
      </button>

      {#if openMenu === 'image'}
        <div class="menu" role="menu" aria-label="Image" tabindex="-1" data-menu-panel="image" onkeydown={onPanelKeydown}>
          <button type="button" class="mi" role="menuitem" onclick={() => select(clearArtwork)} disabled={busy}>
            <span>Clear Image</span>
          </button>
        </div>
      {/if}
    </div>

    <span class="brand">paint</span>
    {#if dirty}<span class="dirty" title="Unsaved changes">●</span>{/if}
  </div>

  <header class="bar">
    <div class="group" role="group" aria-label="Tools">
      <button class:active={tool === 'pencil'} onclick={() => (tool = 'pencil')} title="Pencil">✎ Pencil</button>
      <button class:active={tool === 'eraser'} onclick={() => (tool = 'eraser')} title="Eraser">⌫ Eraser</button>
      <button class:active={tool === 'fill'} onclick={() => (tool = 'fill')} title="Fill bucket">▣ Fill</button>
    </div>

    <div class="group" role="group" aria-label="Brush size">
      {#each BRUSH_SIZES as size (size)}
        <button class:active={brushSize === size} onclick={() => (brushSize = size)} title={`${size}px brush`}>{size}</button>
      {/each}
    </div>

    <div class="group colors" role="group" aria-label="Colors">
      <input type="color" bind:value={color} title="Pick a color" aria-label="Current color" />
      {#each PALETTE as swatch (swatch)}
        <button
          class="swatch"
          class:active={color.toLowerCase() === swatch}
          style={`background:${swatch}`}
          onclick={() => (color = swatch)}
          title={swatch}
          aria-label={`Color ${swatch}`}
        ></button>
      {/each}
    </div>
  </header>

  <div class="canvas-wrap">
    <canvas
      bind:this={canvas}
      width={WIDTH}
      height={HEIGHT}
      class="surface"
      class:fill-cursor={tool === 'fill'}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={endStroke}
      onpointercancel={endStroke}
    ></canvas>
  </div>

  <footer class="statusbar">
    {#if message}
      <span class="msg" class:error={message.kind === 'error'}>{message.text}</span>
    {:else}
      <span class="msg">{currentId ? `Saved as “${name || 'Untitled'}”` : 'Unsaved doodle'}</span>
    {/if}
    <span class="dims">{WIDTH} × {HEIGHT}</span>
  </footer>

  <dialog class="save-dialog" bind:this={saveDialog}>
    <form method="dialog" onsubmit={confirmSave}>
      <h2 class="dlg-title">{forkOnSave ? 'Save a copy' : 'Save doodle'}</h2>
      <label class="dlg-field">
        <span>File name</span>
        <input
          class="name"
          type="text"
          placeholder="Untitled"
          bind:this={nameInput}
          bind:value={dialogName}
          maxlength="60"
          aria-label="Doodle name"
        />
      </label>
      <div class="dlg-actions">
        <button type="button" class="dlg-btn" onclick={cancelSave}>Cancel</button>
        <button type="submit" class="dlg-btn primary" data-testid="save-confirm" disabled={busy}>Save</button>
      </div>
    </form>
  </dialog>
</div>

<style>
  .paint {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--hg-bg, #070707);
    color: var(--hg-text, #f3f1e8);
    font-family: var(--hg-font-body, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    font-size: 13px;
  }

  /* ---- Menu bar -------------------------------------------------------- */
  .menubar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px 8px;
    border-bottom: 1px solid var(--hg-border, #303030);
    background: var(--hg-surface, #101010);
  }

  .menu-wrap {
    position: relative;
  }

  .top {
    border: 1px solid transparent;
    background: none;
    color: var(--hg-text, #f3f1e8);
    font: inherit;
    padding: 4px 10px;
    cursor: pointer;
    border-radius: 3px;
    line-height: 1.2;
  }
  .top:hover,
  .top:focus-visible {
    background: color-mix(in srgb, var(--hg-accent, #9ee493) 14%, transparent);
    outline: none;
  }
  .top.open {
    background: color-mix(in srgb, var(--hg-accent, #9ee493) 20%, transparent);
    border-color: var(--hg-accent, #9ee493);
  }

  .menu {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    z-index: 20;
    min-width: 200px;
    max-height: min(60vh, 420px);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 4px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    background: var(--hg-surface, #141414);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
  }

  .mi {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    border: 1px solid transparent;
    background: none;
    color: var(--hg-text, #f3f1e8);
    font: inherit;
    text-align: left;
    padding: 6px 10px;
    cursor: pointer;
    border-radius: 3px;
    line-height: 1.2;
    white-space: nowrap;
  }
  .mi:hover:not(:disabled),
  .mi:focus-visible {
    background: color-mix(in srgb, var(--hg-accent, #9ee493) 16%, transparent);
    outline: none;
  }
  .mi:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .mi.muted {
    color: var(--hg-text-muted, #b8b1a4);
    font-style: italic;
  }
  .sc {
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 11px;
  }

  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--hg-border, #303030);
  }
  .menu-head {
    padding: 4px 10px 2px;
    color: var(--hg-accent-cyan, #82d8f7);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  /* Saved-doodle row: a plain full-width menu item (load) with a subtle delete
     that surfaces on hover/focus — styled to match the New/Save items above. */
  .mi-row {
    display: flex;
    align-items: stretch;
    border-radius: 3px;
  }
  .mi-load {
    flex: 1 1 auto;
    min-width: 0;
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mi-row.current .mi-load {
    color: var(--hg-accent, #9ee493);
  }
  .mi-del {
    flex: 0 0 auto;
    width: 28px;
    padding: 6px 0;
    justify-content: center;
    color: var(--hg-text-muted, #b8b1a4);
    opacity: 0;
  }
  .mi-row:hover .mi-del,
  .mi-row:focus-within .mi-del,
  .mi-del:focus-visible {
    opacity: 1;
  }
  .mi-del:hover:not(:disabled),
  .mi-del:focus-visible {
    color: var(--hg-danger, #ff6b6b);
  }

  /* ---- Drawing toolbar ------------------------------------------------- */
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--hg-border, #303030);
    background: var(--hg-surface, #101010);
  }

  .brand {
    margin-left: auto;
    color: var(--hg-accent, #9ee493);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .group {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-right: 8px;
    border-right: 1px solid var(--hg-border, #303030);
  }
  .group:last-child { border-right: none; }

  .bar button {
    border: 1px solid var(--hg-border, #303030);
    background: var(--hg-surface, #111);
    color: var(--hg-text, #f3f1e8);
    font: inherit;
    padding: 4px 8px;
    cursor: pointer;
    border-radius: 3px;
    line-height: 1.2;
  }
  .bar button:hover:not(:disabled) { border-color: var(--hg-accent, #9ee493); }
  .bar button:disabled { opacity: 0.5; cursor: default; }
  .bar button.active {
    border-color: var(--hg-accent, #9ee493);
    color: var(--hg-accent, #9ee493);
    background: color-mix(in srgb, var(--hg-accent, #9ee493) 14%, transparent);
  }

  .colors { flex-wrap: wrap; }
  .colors input[type='color'] {
    width: 28px;
    height: 24px;
    padding: 0;
    border: 1px solid var(--hg-border, #303030);
    background: none;
    cursor: pointer;
  }
  .swatch {
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 2px;
  }
  .swatch.active { outline: 2px solid var(--hg-accent, #9ee493); outline-offset: 1px; }

  /* ---- Status bar ------------------------------------------------------ */
  .statusbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-top: 1px solid var(--hg-border, #303030);
    background: var(--hg-surface, #101010);
  }

  .dirty { color: var(--hg-accent-cyan, #82d8f7); }
  .msg { color: var(--hg-text-muted, #b8b1a4); }
  .msg.error { color: var(--hg-danger, #ff6b6b); }
  .dims { margin-left: auto; color: var(--hg-text-muted, #b8b1a4); }

  /* ---- Save dialog ----------------------------------------------------- */
  .save-dialog {
    margin: auto;
    width: min(360px, 90vw);
    padding: 0;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 6px;
    background: var(--hg-surface, #141414);
    color: var(--hg-text, #f3f1e8);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
  }
  .save-dialog::backdrop {
    background: rgba(0, 0, 0, 0.55);
  }
  .save-dialog form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
  }
  .dlg-title {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.03em;
  }
  .dlg-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    color: var(--hg-text-muted, #b8b1a4);
  }
  .name {
    width: 100%;
    border: 1px solid var(--hg-border, #303030);
    background: var(--hg-bg, #070707);
    color: var(--hg-text, #f3f1e8);
    font: inherit;
    padding: 6px 8px;
    border-radius: 3px;
  }
  .name:focus-visible {
    outline: none;
    border-color: var(--hg-accent, #9ee493);
  }
  .dlg-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .dlg-btn {
    border: 1px solid var(--hg-border, #303030);
    background: var(--hg-surface, #111);
    color: var(--hg-text, #f3f1e8);
    font: inherit;
    padding: 6px 14px;
    border-radius: 3px;
    cursor: pointer;
  }
  .dlg-btn:hover:not(:disabled) {
    border-color: var(--hg-accent, #9ee493);
  }
  .dlg-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .dlg-btn.primary {
    border-color: var(--hg-accent, #9ee493);
    color: var(--hg-accent, #9ee493);
    background: color-mix(in srgb, var(--hg-accent, #9ee493) 14%, transparent);
  }

  .canvas-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    padding: 16px;
    background:
      repeating-conic-gradient(var(--hg-border, #303030) 0% 25%, transparent 0% 50%) 0 / 16px 16px;
  }

  .surface {
    background: #ffffff;
    box-shadow: 0 0 0 1px var(--hg-border, #303030), 0 8px 24px rgba(0, 0, 0, 0.5);
    max-width: 100%;
    max-height: 100%;
    image-rendering: pixelated;
    cursor: crosshair;
    touch-action: none;
  }
  .surface.fill-cursor { cursor: cell; }
</style>
