# @hyprgate/napp-paint

A classic MS Paint-style doodling canvas napplet for the hyprgate shell.

## Drawing toolbar

- **Pencil** — freehand drawing in the selected color and brush size.
- **Eraser** — paints back to the white background.
- **Fill** — flood-fills the contiguous region under the cursor.
- **Palette** — classic color swatches plus a native color picker.
- **Brush sizes** — 1 / 2 / 4 / 8 / 16 px.

## Menu bar

A classic MS Paint-style menu bar holds every non-drawing action. It is a
keyboard-accessible WAI-ARIA `menubar`:

- **File** — New, Save (`Ctrl+S`), Save As…, Export as PNG (`Ctrl+E`), and the
  **Open saved** list of stored doodles (load or delete each).
- **Edit** — Copy image (`Ctrl+C`) and Paste image (`Ctrl+V`). Copy puts the whole
  canvas on the system clipboard as a PNG; Paste composites a clipboard image over
  the current artwork at the top-left.
- **Image** — Clear Image.

> Copy/Paste call the browser-native async Clipboard API directly. Inside the
> shell's opaque-origin sandbox (no `allow-same-origin`, `connect-src 'none'`) the
> API is frequently unavailable — `read()`/paste in particular cannot be granted to
> an opaque origin — so each path is feature-detected and a blocked clipboard
> surfaces a status message instead of throwing. When a `clipboard` NAP domain
> lands, the real I/O should move to the shell (trusted top-level origin) and be
> proxied in over postMessage like NAP-STORAGE; `copyImage`/`pasteImage` in
> `src/App.svelte` are the single seam to swap.

Saving an unsaved doodle (or **Save As…**) opens a modal name dialog rather than
a persistent footer field; an already-named doodle re-saves in place. The dialog
is a native `<dialog>` (focus-trapped, `Esc` to cancel, `Enter` to confirm).

Keyboard support: `Tab` reaches the bar, `←`/`→` move between menus, `↓`/`Enter`/
`Space` open a menu, `↑`/`↓`/`Home`/`End` move between items, `Enter` activates,
and `Esc` closes the dropdown. `Ctrl+S`, `Ctrl+E`, `Ctrl+C`, and `Ctrl+V` work
globally (clipboard shortcuts defer to normal text editing while a field is focused).

## Persistence

Doodles are saved and loaded through **NAP-STORAGE** (`@napplet/sdk` `storage`),
the napplet-scoped KV store served by the Kehto runtime. Each bitmap is stored as
a base64 PNG data URL under its own key, with a lightweight metadata index for the
gallery (`src/lib/paint-store.ts`).

> NAP-STORAGE is capped at **~512 KB per napplet**, so only a handful of small
> doodles fit. Saves are best-effort: a quota failure is surfaced in the UI and
> never leaves a dangling index entry. The read-only resource API (NAP-RESOURCE)
> cannot save, and NAP-UPLOAD/Blossom is not yet wired into the shell — when it
> is, `paint-store.ts` is the single seam to swap the backend for durable,
> multi-device image storage.

## Develop

```bash
pnpm --filter @hyprgate/napp-paint dev          # standalone dev server (port 5192)
pnpm --filter @hyprgate/napp-paint test         # unit tests (flood fill + store)
pnpm --filter @hyprgate/napp-paint type-check
pnpm --filter @hyprgate/napp-paint build
```

The shell registers this napplet as the builtin `paint` (manifest `d` tag
`paint`); see `apps/shell/src/lib/launcher/napplet-registry.ts`.
