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
- **Image** — Clear Image.

Saving an unsaved doodle (or **Save As…**) opens a modal name dialog rather than
a persistent footer field; an already-named doodle re-saves in place. The dialog
is a native `<dialog>` (focus-trapped, `Esc` to cancel, `Enter` to confirm).

Keyboard support: `Tab` reaches the bar, `←`/`→` move between menus, `↓`/`Enter`/
`Space` open a menu, `↑`/`↓`/`Home`/`End` move between items, `Enter` activates,
and `Esc` closes the dropdown. `Ctrl+S` and `Ctrl+E` work globally.

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
