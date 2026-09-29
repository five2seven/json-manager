export interface FileSystemWritableFileStreamLike {
  write(data: string): Promise<void>
  close(): Promise<void>
  abort?(): Promise<void>
}

export interface FileSystemPermissionDescriptorLike {
  mode: 'read' | 'readwrite'
}

export type FileSystemPermissionMethod = (
  descriptor: FileSystemPermissionDescriptorLike,
) => Promise<PermissionState>

export interface FileSystemFileHandleLike {
  name: string
  getFile(): Promise<File>
  createWritable?: () => Promise<FileSystemWritableFileStreamLike>
  queryPermission?: FileSystemPermissionMethod
  requestPermission?: FileSystemPermissionMethod
}

type ShowOpenFilePickerFn = (options: {
  types: Array<{ description: string; accept: Record<string, string[]> }>
  multiple?: boolean
}) => Promise<FileSystemFileHandleLike[]>

const WRITE_ERROR_MESSAGES: Record<string, string> = {
  NotAllowedError: 'Permission to modify this file was not granted.',
  NoModificationAllowedError:
    'The file could not be modified. It may be open or locked by another application.',
  NotFoundError: 'The original file could no longer be found.',
}

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window
}

export function isWritableHandle(handle: FileSystemFileHandleLike): boolean {
  return typeof handle.createWritable === 'function'
}

export async function ensureWritePermission(
  handle: FileSystemFileHandleLike,
): Promise<boolean> {
  if (typeof handle.queryPermission !== 'function') {
    return true
  }
  let current: PermissionState
  try {
    current = await handle.queryPermission({ mode: 'readwrite' })
  } catch {
    return true
  }
  if (current === 'granted') {
    return true
  }
  if (typeof handle.requestPermission !== 'function') {
    return false
  }
  try {
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

export function writeErrorMessage(error: unknown): string {
  const name = errorText(error, 'name')
  const known = WRITE_ERROR_MESSAGES[name]
  if (known !== undefined) {
    return known
  }
  console.error(`JSON Manager could not write the file. ${name}: ${errorText(error, 'message')}`)
  return 'Could not save the file.'
}

function errorText(error: unknown, key: 'name' | 'message'): string {
  if (typeof error !== 'object' || error === null) {
    return String(error)
  }
  const value = (error as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

export async function pickJsonFile(): Promise<FileSystemFileHandleLike | null> {
  const picker = (window as Window & { showOpenFilePicker?: ShowOpenFilePickerFn })
    .showOpenFilePicker
  if (typeof picker !== 'function') {
    return null
  }
  const handles = await picker({
    types: [{ description: 'JSON files', accept: { 'application/json': ['.json'] } }],
    multiple: false,
  })
  return handles[0] ?? null
}

export async function readFileText(file: File): Promise<string> {
  return file.text()
}

export async function readHandleText(handle: FileSystemFileHandleLike): Promise<string> {
  return readFileText(await handle.getFile())
}

export async function writeHandleText(
  handle: FileSystemFileHandleLike,
  text: string,
): Promise<void> {
  if (typeof handle.createWritable !== 'function') {
    throw new DOMException('This file handle cannot be written to.', 'NotAllowedError')
  }
  const writable = await handle.createWritable()
  try {
    await writable.write(text)
    await writable.close()
  } catch (error) {
    await releaseWritable(writable)
    throw error
  }
}

async function releaseWritable(writable: FileSystemWritableFileStreamLike): Promise<void> {
  const release = typeof writable.abort === 'function' ? writable.abort : writable.close
  try {
    await release.call(writable)
  } catch {
    return
  }
}

export function downloadJsonText(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
