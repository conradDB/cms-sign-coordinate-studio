# CMS Sign — Coordinate Studio

Internal tool for **CMS Systems** (automotive software, South Africa) that places digital-signing
field coordinates onto PDF documents (offers to purchase, lease agreements, etc.) and exports them
as a JSON file the CMS admin system imports.

The original pain point: coordinates were found by hand in Adobe Acrobat, one box at a time, across
documents up to 50 pages. This tool replaces that with a visual drag-to-draw picker.

## Architecture

Deliberately a **static, dependency-free, single-page app**. No framework, no build step, no server,
no bundler. Just three files loaded directly by the browser:

| File          | Contents                                                              |
|---------------|-----------------------------------------------------------------------|
| `index.html`  | Markup + DOM structure. Loads `styles.css` and `app.js`.              |
| `styles.css`  | All styling. CMS corporate-identity design system (see Design below). |
| `app.js`      | All application logic. ~1400 lines of vanilla JS, no modules.         |
| `assets/`     | CMS logo artwork + self-hosted Roboto TTFs.                           |

External libraries are loaded from CDN in `index.html` (not bundled):
- **pdf.js** (`cdnjs`) — renders PDF pages to a canvas
- **jsPDF** (`cdnjs`) — generates the PDF coordinate-report export

Fonts are **self-hosted** from `assets/fonts/` (Roboto Regular/Medium/Bold/Italic) via `@font-face` —
no external font CDN.

### Why no framework
Portability is the point. A CMS staffer can double-click `index.html` and it runs. It can be dropped
onto any static host. Keep it that way unless there's a strong reason not to — do **not** introduce
React, a bundler, or a build step without discussing the tradeoff.

## How it works (mental model)

Three stacked `<canvas>` elements inside `#canvasCont`:
1. `#pdfCanvas` — the rendered PDF page (from pdf.js), retina-scaled via `devicePixelRatio`
2. `#overlayCanvas` — all the drawn signature boxes, labels, and preview stamps
3. `#drawCanvas` — the top interaction layer that captures mouse events

`drawAllBoxes()` is the central render function — it clears the overlay and repaints every box for the
current page. Call it after any state change that affects what's on screen.

### Multiple open documents
Several PDFs can be open at once, shown as a tab bar (`#docTabs`) above the PDF panel.
- `docs[]` — one object per open PDF: `{id, name, baseName, pdfDoc, totalPages, pageOriginalSizes,
  allBoxes, boxCounter, currentPage, scale, selectedId, multiSelected, previewMode, fitted}`
- `activeDocId` — which doc the module vars below currently mirror.
- `activateDoc(id)` saves the live vars back into the outgoing doc (`saveActiveDoc()`), hydrates them
  from the incoming doc, then re-renders. `closeDoc(id)`, `renderTabs()`, `loadPDFFromFile()` (adds a doc).
- **Shared across all docs:** `signees[]`, `currentTool`, the clipboards. **Per-doc:** everything else.
- `renderPage()` is serialised (`renderChain`) + generation-guarded so fast tab switching can't collide
  two `pdf.js` renders on the shared canvas.

### Core state (module-level vars in app.js — always mirror the ACTIVE doc)
- `allBoxes[]` — signature boxes for the active doc. Each: `{id, name, signeeId, page, x, y, w, h, fieldType, previewText}`
- `signees[]` — `{id, name, color, rgb, order, type}`. Defaults: Prospect Owner (type 1), Manager (3), Client (2). Shared across docs.
- `currentPage`, `totalPages`, `scale` — active-doc PDF view state
- `currentTool` — `'draw'` | `'move'` | `'multi'` (shared)
- `multiSelected` (Set) — box ids in the current multi-selection (per-doc)
- `previewMode` (bool) — stamp-preview overlay on/off (per-doc)

### Coordinate system
Boxes are stored in **PDF points** (unscaled). On screen they're multiplied by `scale`. When exporting,
the stored point values go straight out — they match what the CMS admin system expects. Don't store
scaled/pixel values in `allBoxes`.

## Field types (must match CMS admin system)
| Value | Meaning                    | Preview render                          |
|-------|----------------------------|-----------------------------------------|
| 0     | Signature                  | Full CMS Sign signature block (see below)|
| 2     | Date Auto Stamp            | Today's date, Arial 8pt                 |
| 5     | Plain Text (Mandatory)     | Typed text, Arial 8pt                    |
| 6     | Plain Text (Optional)      | Typed text, Arial 8pt                    |
| 9     | Check Box                  | ✔ mark, Adobe Pi Std 7pt (falls back to ZapfDingbats) |

Signee types: Prospect Owner = 1, Client = 2, Manager = 3.

## Export format (CMS JSON) — DO NOT CHANGE STRUCTURE
The CMS admin importer requires this exact shape (see `buildCMSJson()`):
```json
{
  "DocumentID": 1234,                    // auto-generated random 4-digit
  "DocSignees": [{
    "Order": 1, "Type": 1, "Description": "Prospect Owner", "IsActive": true,
    "DocSignFields": [{
      "Page": 1, "Type": 0,
      "XCoordinate": 40, "XOffset": null, "YCoordinate": 684, "YOffset": null,
      "Width": 127, "Height": 30, "TagName": "Sign",
      "IsInvisible": false, "IsActive": true
    }]
  }]
}
```
`previewText` is UI-only and must **never** appear in any export.

## Feature map (where things live in app.js)
- **Open documents / tab bar** — `docs[]`, `activateDoc()`, `saveActiveDoc()`, `closeDoc()`, `renderTabs()`, `loadPDFFromFile()`
- **Drawing / moving boxes** — `drawCanvas` mousedown/move/up handlers
- **Multi-select + alignment** — `alignBoxes()`, `distributeBoxes()`, `bulkNudge()`, `applyBulkSize()`
- **Same-tab copy/paste to page** — `copySelection()`, `pasteSelectionToPage()`
- **Cross-tab clipboard** (across *browser* tabs) — `copyToCrossTab()` / `pasteFromCrossTab()` via `localStorage` key `cms_signbox_xtab_clipboard` + `storage` event
- **JSON import (preview existing coords)** — `importJSON()`, `showImportModal()`, `applyImport()` (targets the active doc)
- **Export** — `downloadCMSJson()` only (CMS JSON, named `<pdf name> - Coordinates.json`). `exportPDF()` (jsPDF report) still defined but no longer wired to a button.
- **Stamp preview** — `previewMode`, `drawSignatureBlock()`, `drawSignatureScrawl()`, inline editing via `showInlineEdit()`/`commitInlineEdit()`

### The signature block preview (`drawSignatureBlock`)
Reproduces the real CMS Sign stamp: white rounded-border box, blue "Signature" legend sitting *on*
the top border, a bezier-drawn handwritten scrawl, and a "Powered by ● CMS Sign" footer sitting *on*
the bottom border (white break in the line behind both legends, fieldset-style).

## Design system (styles.css)
**CMS Systems corporate identity** — per the "CMS Systems Visual Guide (CI)". Build from white.
- **Palette:** Blue `#31459C` (structure, headings, primary buttons), Turquoise `#00AEED` (accents,
  selection, focus rings), Red `#FD4545` (danger / alerts only — used sparingly), text `#2E2E2E` /
  `#585858`, borders `#D8D8D8` / `#B2B2B2`, surfaces white / `#F4F6F9` / `#EEF1F6`.
- `.glass` primitive: now just a clean white card (border + soft shadow). The class name and the
  `--glass-*` / `--ease-glass` token names are retained so markup didn't need to change.
- Signee colour-code: 8 CI-palette colours (`--s1..--s8`) — core + supporting palette, all legible
  on white. Mirrored by `COLORS` / `RGBS` in `app.js`.
- Fonts: **Roboto** everywhere (self-hosted). Coordinate/number fields use Roboto with
  `font-variant-numeric: tabular-nums` (the CI names no monospace face).
- Logo: approved artwork only — `assets/cms-logo.png` (the "CMS eco" lock-up), never redrawn or
  set in a font. The PDF export embeds the same file.
- CSS custom properties define everything — change tokens in `:root`, not individual rules.

## Conventions & gotchas
- **After editing coordinates or boxes, always call `drawAllBoxes()`** to repaint.
- **Retina**: canvases are sized `cssPx * devicePixelRatio` and the context is scaled; don't assume 1:1.
- **Preview mode suppresses all editing chrome** (labels, handles, selection outlines) at every zoom level.
- **`select` dropdowns**: native option lists are OS-rendered and can't be fully custom-styled — this is a known browser limitation, not a bug.
- **Element IDs are the integration contract** between `app.js` and `index.html` — if you rename one, grep both files.
- When adding a new field type, update: the type table above, the card `<select>` in `updatePanel()`, and the preview renderer.

## Local dev
```bash
npm install      # only installs a static server (serve)
npm start        # serves at http://localhost:3000
```
Or just open `index.html` directly — no server strictly required (pdf.js worker prefers http(s),
so the server is recommended).

## Deploy
Static host, any provider. `netlify.toml` is included (headers + SPA redirect). Netlify Drop:
drag the folder onto app.netlify.com/drop.
