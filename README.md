# JSON Manager

A small web application for viewing, editing, adding, and deleting records in a structured JSON file. It is a **frontend-only** app: the file you work with stays on your computer and its contents never leave your browser. There is no backend, database, or upload.

## Data file format

Records live under a `_default` root object whose keys are numeric-string record IDs:

```json
{
  "_default": {
    "2": {
      "uname": "Sparks 89431",
      "name": "Tobi Returns",
      "address": "50 Greg St",
      "address2": "",
      "city": "Sparks",
      "state": "NV",
      "zip": "89431",
      "phone": "",
      "zone": "",
      "region": ""
    },
    "3": { ... }
  }
}
```

Data rules the app follows:

- IDs are string object keys, not array indexes. Existing records are never renumbered.
- New records use `max(existing numeric IDs) + 1`.
- ZIP codes stay strings so leading zeroes are preserved.
- The `_default` root structure is preserved on save.
- Unknown root properties and unknown record properties are preserved.
- Existing values are never silently trimmed, normalized, corrected, or reinterpreted.

## How it works

The app is a React + TypeScript + Vite frontend. Files are handled entirely in the browser:

- **Chromium-based browsers** (Chrome, Edge, Opera) use the File System Access API: **Choose File** opens the native picker, and **Save Changes** writes the updated JSON directly back to the original file.
- **Other browsers** (for example Firefox) use a regular file input and cannot rewrite the original file. **Save Changes** downloads the updated JSON with the original filename, and the app says so instead of letting you think the file was overwritten.

The app:

- never loads a JSON file automatically; the file is always chosen by the user with **Choose File**
- never uploads, transmits, or stores your file contents anywhere
- validates that the file is valid JSON with a `_default` object before showing it
- validates every saved document before writing it
- keeps unsaved edits in memory until you click **Save Changes** — nothing is written before that
- never creates backups or any other files; the original file only changes on an explicit save

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer

## Getting started

1. Install dependencies with `npm install`.
2. Run `npm run dev` and open the URL Vite prints.
3. Click **Choose File** and select the JSON file you want to manage.

The app never opens a file on its own. Every page load begins with **No file selected**, and the selected file is kept in memory only for that page session. Refresh or close the page and you choose a file again.

## Choosing a file

The app manages one JSON file at a time, and **you always choose it from the UI — there is no automatic loading.** Click **Choose File** in the header. The app reads and validates the chosen file before showing it. Selecting a file never modifies it.

If you have unsaved edits, you are asked for confirmation before switching. No recent-file history, favorites, or remembered paths exist. In browsers that support it, the picker only lists JSON files; in other browsers the app falls back to the standard file input. The app detects support at runtime — it does not guess by browser name.

## Available commands

- `npm run dev` starts the Vite development server.
- `npm run build` type-checks and creates a production build in `dist`.
- `npm run lint` checks the codebase with ESLint.
- `npm test` runs the Vitest test suite once.
- `npm run test:watch` runs Vitest in watch mode.

## Production hosting

The app is a static frontend and is hosted as one on Cloudflare Pages:

```text
https://jsonmanager.rareobjectlabs.app
  -> Cloudflare Pages
  -> static build (dist/)
  -> browser-only file handling
```

DNS, Pages configuration, and the Cloudflare account are external deployment concerns and are not configured in this repository.

## Save behavior and backups

All edits happen in the in-memory working copy. Nothing is written until **Save Changes** is clicked.

- In a Chromium-based browser the updated JSON is written back to the exact file you chose.
- In fallback browsers the updated JSON is downloaded with the original filename; the original file is left untouched.

There are no automatic or manual backups. The app never creates sibling files next to your JSON, including when saving through the File System Access API.

## Unsaved changes

While there are unsaved changes the header shows an indicator and the browser warns before refresh or navigation. **Reload from Disk** re-reads the file from disk (available in browsers that support direct saving) and, like **Choose File**, asks for confirmation before discarding your local changes.

## Sorting

Every table column except **Actions** is sortable by clicking its header: click once for ascending, again for descending, and on a different column to start ascending there. Sorting is client-side only and never changes the underlying record order or the JSON file; it applies to whatever rows match the current search.

## Environment variables

There are no application environment variables and no `.env` support. JSON Manager never loads a JSON file automatically, so there is nothing to configure for a startup file — the file is always chosen with **Choose File**.

## Standard deployment foundation

Proof-of-concept deployments follow this convention:

```text
https://jsonmanager.rareobjectlabs.app
  -> Cloudflare Pages (static frontend)
```

- Registrar: Porkbun
- DNS provider: Cloudflare
- POC hosting: Cloudflare Pages
- Source control: GitHub
- Umbrella domain: `rareobjectlabs.app`
- App POC domain: `jsonmanager.rareobjectlabs.app`

This template documents the convention only. Cloudflare configuration, DNS records, and deployment setup are performed separately.

## Project structure

```text
src/                  React application, components, and tests
docs/                 Product, architecture, and decision records
index.html             Vite HTML entry point
vite.config.ts         Vite and Vitest configuration
eslint.config.js       ESLint flat configuration
```

## Testing

`npm test` runs Vitest in a jsdom environment. Coverage includes parsing and rejecting the `_default` structure, preserving ZIP strings, next-ID calculation, add/edit/delete operations, serialization, client-side table sorting, the no-auto-load startup state, opening files through the File System Access API picker, saving through a writable file-system handle, the fallback file-input flow, and the fallback download behavior.
