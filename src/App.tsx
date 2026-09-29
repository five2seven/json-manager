import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  applyAdd,
  applyDelete,
  applyEdit,
  cloneJson,
  matchesSearch,
  nextNumericId,
  parseJsonStructure,
  recordName,
  serializeJson,
  sortedEntries,
  sortRows,
} from './lib/db'
import type { DatabaseFile, SortDirection, SortKey } from './lib/db'
import {
  downloadJsonText,
  ensureWritePermission,
  isWritableHandle,
  pickJsonFile,
  readFileText,
  readHandleText,
  supportsFileSystemAccess,
  writeErrorMessage,
  writeHandleText,
} from './lib/files'
import type { FileSystemFileHandleLike } from './lib/files'
import { RecordForm } from './components/RecordForm'
import { RecordTable } from './components/RecordTable'
import type { TableRow } from './components/RecordTable'
import './App.css'

type EditorState = null | { mode: 'add' } | { mode: 'edit'; id: string }

interface FileError {
  code: string
  message: string
}

const ERROR_TITLES: Record<string, string> = {
  invalid_json: 'Invalid JSON',
  invalid_root: 'Invalid file structure',
  invalid_default: 'Missing or invalid "_default"',
  invalid_record_structure: 'Invalid record structure',
  read_failed: 'Could not read the file',
  write_failed: 'Save failed',
  picker_failed: 'File chooser error',
}

const STRUCTURE_MESSAGES: Record<string, string> = {
  invalid_json: 'The file is not valid JSON.',
  invalid_root: 'The file must contain an object at its top level.',
  invalid_default: 'The file must contain an object named "_default".',
  invalid_record_structure: 'Every record under "_default" must be an object.',
}

function errorTitle(code: string): string {
  return ERROR_TITLES[code] ?? 'Error'
}

function structureMessage(code: string): string {
  return STRUCTURE_MESSAGES[code] ?? 'The file does not match the expected structure.'
}

export default function App() {
  const [fileName, setFileName] = useState('')
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandleLike | null>(null)
  const [fallbackMode, setFallbackMode] = useState(false)
  const [working, setWorking] = useState<DatabaseFile | null>(null)
  const [snapshotText, setSnapshotText] = useState('')
  const [loadError, setLoadError] = useState<FileError | null>(null)
  const [saveError, setSaveError] = useState<FileError | null>(null)
  const [saveNotice, setSaveNotice] = useState('')
  const [copyAvailable, setCopyAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<EditorState>(null)
  const [sortKey, setSortKey] = useState<SortKey>('id')
  const [sortDir, setSortDir] = useState<SortDirection>('asc')
  const fallbackInputRef = useRef<HTMLInputElement>(null)

  const workingText = useMemo(() => (working ? serializeJson(working) : ''), [working])
  const dirty = working !== null && workingText !== snapshotText
  const recordCount = working ? Object.keys(working._default).length : 0

  const clearErrors = useCallback(() => {
    setLoadError(null)
    setSaveError(null)
    setSaveNotice('')
    setCopyAvailable(false)
  }, [])

  const applyDocument = useCallback(
    (text: string, nextFileName: string, handle: FileSystemFileHandleLike | null): boolean => {
      const result = parseJsonStructure(text)
      if (!result.ok) {
        setLoadError({ code: result.code, message: structureMessage(result.code) })
        return false
      }
      const struct = cloneJson(result.struct)
      setFileName(nextFileName)
      setFileHandle(handle)
      setFallbackMode(handle ? !isWritableHandle(handle) : true)
      setWorking(struct)
      setSnapshotText(serializeJson(struct))
      setSearch('')
      setEditor(null)
      clearErrors()
      return true
    },
    [clearErrors],
  )

  useEffect(() => {
    if (!dirty) {
      return
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  async function handleChooseFile() {
    if (dirty && !window.confirm('Discard unsaved changes and choose a different JSON file?')) {
      return
    }
    clearErrors()
    if (supportsFileSystemAccess()) {
      setBusy(true)
      let handle: FileSystemFileHandleLike | null
      try {
        handle = await pickJsonFile()
      } catch {
        setLoadError({ code: 'picker_failed', message: 'The file chooser could not be opened.' })
        setBusy(false)
        return
      }
      if (!handle) {
        setBusy(false)
        return
      }
      try {
        const text = await readHandleText(handle)
        applyDocument(text, handle.name, handle)
      } catch {
        setLoadError({ code: 'read_failed', message: 'The selected file could not be read.' })
      }
      setBusy(false)
      return
    }
    setFallbackMode(true)
    fallbackInputRef.current?.click()
  }

  async function handleFallbackFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    setBusy(true)
    clearErrors()
    if (!file) {
      setBusy(false)
      return
    }
    try {
      const text = await readFileText(file)
      applyDocument(text, file.name, null)
    } catch {
      setLoadError({ code: 'read_failed', message: 'The selected file could not be read.' })
    }
    setBusy(false)
  }

  async function handleReload() {
    if (dirty && !window.confirm('Discard unsaved changes and reload the file from disk?')) {
      return
    }
    if (!fileHandle) {
      return
    }
    setBusy(true)
    clearErrors()
    try {
      const text = await readHandleText(fileHandle)
      applyDocument(text, fileHandle.name, fileHandle)
    } catch {
      setLoadError({ code: 'read_failed', message: 'The file could not be read back from disk.' })
    }
    setBusy(false)
  }

  async function handleSave() {
    if (!working || !dirty) {
      return
    }
    const text = workingText
    const result = parseJsonStructure(text)
    if (!result.ok) {
      setSaveError({ code: result.code, message: 'Unsaved changes produced an invalid file.' })
      return
    }
    const handle = fileHandle && isWritableHandle(fileHandle) ? fileHandle : null
    setBusy(true)
    setSaveError(null)
    setSaveNotice('')
    setCopyAvailable(false)
    try {
      if (handle) {
        if (!(await ensureWritePermission(handle))) {
          throw new DOMException('Write permission was not granted.', 'NotAllowedError')
        }
        await writeHandleText(handle, text)
        setSnapshotText(text)
      } else {
        downloadJsonText(fileName, text)
        setSnapshotText(text)
        setSaveNotice(
          `Saved. Your browser cannot overwrite the original file, so the updated JSON was downloaded as "${fileName}".`,
        )
      }
    } catch (error) {
      setSaveError({ code: 'write_failed', message: writeErrorMessage(error) })
      setCopyAvailable(true)
    }
    setBusy(false)
  }

  function handleDownloadCopy() {
    if (!working) {
      return
    }
    try {
      downloadJsonText(fileName, workingText)
      setSaveNotice(
        `Downloaded the edited JSON as "${fileName}". The original file is unchanged, so these changes are still unsaved.`,
      )
    } catch (error) {
      setSaveError({ code: 'write_failed', message: writeErrorMessage(error) })
    }
  }

  function handleSubmitDraft(values: Record<string, unknown>) {
    if (!working) {
      return
    }
    if (editor?.mode === 'edit') {
      setWorking({
        ...working,
        _default: applyEdit(working._default, editor.id, values),
      })
    } else {
      const next = applyAdd(working._default, values)
      setWorking({ ...working, _default: next.records })
    }
    setEditor(null)
  }

  function requestDelete(id: string) {
    if (!working) {
      return
    }
    const name = recordName(working._default[id] ?? {})
    const label = name ? `${name} (ID ${id})` : `ID ${id}`
    const confirmed = window.confirm(
      `Delete record ${label}? The change stays unsaved until you click Save Changes.`,
    )
    if (confirmed) {
      setWorking({ ...working, _default: applyDelete(working._default, id) })
    }
  }

  function requestSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((direction) => (direction === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const rows: TableRow[] = useMemo(() => {
    if (!working) {
      return []
    }
    return sortRows(
      sortedEntries(working._default)
        .filter(([id, record]) => matchesSearch(id, record, search))
        .map(([id, record]) => ({ id, record })),
      sortKey,
      sortDir,
    )
  }, [working, search, sortKey, sortDir])

  const addRecordId = working ? nextNumericId(working._default) : ''

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-row">
          <h1>JSON Manager</h1>
          <span className={`unsaved-indicator${dirty ? ' dirty' : ''}`} role="status">
            {dirty ? 'Unsaved changes' : 'All changes saved'}
          </span>
        </div>
        <div className="file-meta">
          {fileName ? (
            <span className="file-chip">{fileName}</span>
          ) : (
            <span>No file selected</span>
          )}
          <span>
            {recordCount} {recordCount === 1 ? 'record' : 'records'}
          </span>
          <button type="button" className="button" onClick={handleChooseFile} disabled={busy}>
            Choose File
          </button>
        </div>
        <div className="toolbar">
          <button
            type="button"
            className="button"
            onClick={handleReload}
            disabled={!fileHandle || busy}
          >
            Reload from Disk
          </button>
          <button
            type="button"
            className="button primary"
            onClick={handleSave}
            disabled={!dirty || busy || !working}
          >
            Save Changes
          </button>
        </div>
      </header>

      <main className="app-main">
        {loadError && (
          <div className="error-banner" role="alert">
            <strong>{errorTitle(loadError.code)}</strong>
            <span>{loadError.message}</span>
          </div>
        )}

        {saveError && (
          <div className="error-banner" role="alert">
            <strong>{errorTitle(saveError.code)}</strong>
            <span>{saveError.message}</span>
            {copyAvailable && (
              <button
                type="button"
                className="button"
                onClick={handleDownloadCopy}
                disabled={busy}
              >
                Download Copy
              </button>
            )}
          </div>
        )}

        {saveNotice && (
          <p className="save-note" role="status">
            {saveNotice}
          </p>
        )}

        {!fileName && (
          <section className="empty-state">
            <h2>No file selected</h2>
            <p>
              JSON Manager reads and edits one structured JSON file at a time. It never loads a
              file automatically — click Choose File and pick the file you want to manage.
            </p>
            <button
              type="button"
              className="button primary"
              onClick={handleChooseFile}
              disabled={busy}
            >
              Choose File
            </button>
          </section>
        )}

        {fileName && fallbackMode && (
          <p className="notice" role="status">
            This browser cannot overwrite the original file, so Save Changes downloads the updated
            JSON instead.
          </p>
        )}

        {fileName && working && (
          <>
            <div className="main-toolbar">
              <div className="search">
                <label htmlFor="search">Search</label>
                <input
                  id="search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="ID, name, city…"
                />
              </div>
              <button
                type="button"
                className="button primary"
                onClick={() => setEditor({ mode: 'add' })}
              >
                Add Entry
              </button>
            </div>
            {rows.length === 0 ? (
              <p className="notice">
                {recordCount === 0 ? 'No records in this file yet.' : 'No records match your search.'}
              </p>
            ) : (
              <RecordTable
                rows={rows}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={requestSort}
                onEdit={(id) => setEditor({ mode: 'edit', id })}
                onDelete={requestDelete}
              />
            )}
          </>
        )}
      </main>

      {editor && working && (
        <RecordForm
          mode={editor.mode}
          idText={editor.mode === 'edit' ? editor.id : addRecordId}
          initial={editor.mode === 'edit' ? (working._default[editor.id] ?? {}) : {}}
          onCancel={() => setEditor(null)}
          onSubmit={handleSubmitDraft}
        />
      )}

      <input
        ref={fallbackInputRef}
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        onChange={handleFallbackFile}
      />
    </div>
  )
}