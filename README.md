# CMS Sign — Coordinate Studio

Visual tool for placing digital-signing field coordinates onto PDF documents and exporting
them as JSON for the CMS admin system. Replaces the manual "find coordinates in Adobe Acrobat"
workflow with a drag-to-draw picker.

![CMS Sign](https://img.shields.io/badge/type-static%20web%20app-3d7eff) ![No build](https://img.shields.io/badge/build-none-00e5b0)

## Quick start

Just open `index.html` in a browser — that's it. No install, no server, no build.

For the smoothest experience (pdf.js prefers an http origin for its worker), run the tiny dev server:

```bash
npm install
npm start          # → http://localhost:3000
```

## What it does

- **Open any PDF** and draw signature/field boxes on it by clicking and dragging
- **Multi-page** — boxes tracked per page, copy a set of boxes to another page or another tab
- **Signees** — assign each box to a signee (Prospect Owner / Client / Manager, or add your own)
- **Field types** — Signature, Date Auto Stamp, Plain Text (mandatory/optional), Check Box
- **Preview mode** — see exactly how stamps will render on the page (real signature block, dates,
  check marks, Arial 8pt text) and click-to-type into fields like Adobe form fields
- **Align & distribute** — multi-select boxes and align edges/centres, bulk-resize, bulk-move
- **Import** existing CMS JSON to visualise current coordinates on the PDF
- **Export** as CMS JSON (for the admin importer), CSV, TABLE, or a formatted PDF report

Everything runs **client-side** — PDFs never leave the browser.

## Project structure

```
cms-sign-app/
├── index.html      # markup + DOM; loads styles.css and app.js
├── styles.css      # liquid-glass design system
├── app.js          # all application logic (vanilla JS, no framework)
├── netlify.toml    # deploy headers + SPA redirect
├── package.json    # local dev server only
├── CLAUDE.md       # architecture notes for Claude Code
└── README.md       # this file
```

## Deploy

Any static host works. Netlify Drop is fastest:

1. Go to https://app.netlify.com/drop
2. Drag this folder onto the page
3. Live URL in seconds

See `CLAUDE.md` for full architecture notes before making changes.

## Tech

Vanilla HTML/CSS/JS. CDN dependencies: [pdf.js](https://mozilla.github.io/pdf.js/) (rendering),
[jsPDF](https://github.com/parallax/jsPDF) (PDF export), Google Fonts.
