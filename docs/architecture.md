# Architecture

## Overview

`json-manager` is a client-side React application written in TypeScript and built with Vite. It is completely frontend-only: the JSON file the user works with is read and written entirely in the browser, and its contents are never transmitted anywhere. There is no backend, no local server, and no build-time file API.

## Current structure

```text
Browser
  └─ React component tree (src/)
      ├─ App                       file selection, working copy, save flow
      ├─ components/RecordTable    searchable, sortable record table
      ├─ components/RecordForm     add / edit modal
      └─ lib/
          ├─ db.ts                 parsing, validation, record operations, sorting
          └─ files.ts              browser file access (picker, handle reads/writes, download)
```

The app has no runtime dependencies beyond React. File I/O uses browser APIs from `src/lib/files.ts`.

## File access model

The app starts with no file selected. The user must click **Choose File** on every page load; nothing is ever loaded automatically and nothing is remembered between sessions.

Two access modes are available, chosen at runtime by feature detection (`'showOpenFilePicker' in window`), never by browser-name sniffing:

### File System Access API (Chromium-based browsers)

- `window.showOpenFilePicker()` opens the native picker, restricted to JSON files. The returned `FileSystemFileHandle` is kept in memory for the current page session only.
- The file text is read with `handle.getFile()` → `File.text()`.
- A handle is only treated as directly writable when it exposes `createWritable()`. A handle without it still loads normally but drops the app into download mode.
- **Save Changes** validates the document, then checks write permission via `handle.queryPermission({ mode: 'readwrite' })` and, when it is not already granted, `handle.requestPermission({ mode: 'readwrite' })`. Both run inside the Save click so the browser's user-activation requirement for the permission prompt is satisfied; nothing is requested on page load or on file open.
- Once permission is granted, the write goes through `handle.createWritable()` → `write()` → `close()`, replacing the selected file in place. A failed write aborts the stream (so the original file is left intact) and reports the underlying `DOMException` name.
- **Reload from Disk** re-reads the selected file through the same handle.

### When a direct write cannot happen

- A denied permission prompt, or any write failure, leaves the working copy dirty and shows a specific message: `NotAllowedError` → permission not granted, `NoModificationAllowedError` → file open or locked elsewhere, `NotFoundError` → original file gone, anything else → "Could not save the file." Unexpected error names and messages are logged to the browser console for troubleshooting; the UI never shows file paths.
- The error banner also offers **Download Copy**, which downloads the edited JSON under the original filename. The original file is unchanged, so the changes stay unsaved. The download only ever happens on an explicit user action.

### File input fallback (other browsers)

- An `<input type="file" accept=".json,application/json">` is used when the File System Access API is unavailable.
- The file text is read via `File.text()`; the handle is `null`.
- Because the original file cannot be overwritten, **Save Changes** downloads the updated JSON (`Blob` + object URL on a temporary link) using the original filename. The app shows an unobtrusive notice explaining this. This is the same path used for a File System Access handle that lacks `createWritable()`.
- **Reload from Disk** is disabled because there is no handle to re-read.

In both modes the working copy stays in memory until **Save Changes**; while dirty, the header shows an indicator and the browser warns before leaving the page.

## Data model rules

- The file must be a JSON object with an object-valued `_default` root whose values are all objects; anything else is rejected with a specific error (`invalid_json`, `invalid_root`, `invalid_default`, `invalid_record_structure`). A leading UTF-8 BOM is accepted.
- Record IDs are string object keys under `_default`; existing IDs are never renumbered.
- New IDs are `max(existing numeric IDs) + 1`; non-numeric keys are ignored when computing the next ID.
- ZIP codes remain strings so leading zeroes are preserved.
- Unknown root properties and unknown record properties are preserved.
- Saved output uses 2-space indentation. Nothing is transmitted or stored off-device.

## Tooling

- Vite provides local development and production bundling of the static frontend.
- React and TypeScript provide the UI and static type checking.
- ESLint enforces baseline code quality rules.
- Vitest and Testing Library provide unit and component tests in a jsdom environment.

## Boundaries

JSON Manager has no database, authentication layer, payment integration, cloud storage, external API dependency, or backend of any kind. Its only durable state lives in the local JSON file the user chooses, and all processing happens in the browser.

## Deployment foundation

The app is a static frontend and is hosted as one on Cloudflare Pages:

```text
https://jsonmanager.rareobjectlabs.app
  -> Cloudflare Pages
  -> static build (dist/)
```

- Porkbun is the domain registrar.
- Cloudflare is the DNS provider and hosts Pages.
- GitHub provides source control.
- `rareobjectlabs.app` is the umbrella domain.
- The app's hosted POC domain is `jsonmanager.rareobjectlabs.app`.

Cloudflare Pages, DNS records, and registration are deployment infrastructure, not application runtime dependencies. This repository contains no deployment or DNS configuration and provisions nothing.

## Configuration

There are no application environment variables and no `.env` support. File selection is never configured — the active file is always chosen manually in the UI on every page load.