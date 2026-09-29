import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { FileSystemFileHandleLike } from './lib/files'

const VALID_TEXT = JSON.stringify({
  _default: {
    '2': {
      uname: 'Sparks 89431',
      name: 'Tobi Returns',
      address: '50 Greg St',
      address2: '',
      city: 'Sparks',
      state: 'NV',
      zip: '08901',
      phone: '',
      zone: '',
      region: '',
    },
  },
})

function makeHandle(
  name: string,
  content: string,
  overrides: Partial<FileSystemFileHandleLike> = {},
): { handle: FileSystemFileHandleLike; writes: string[] } {
  const writes: string[] = []
  const handle: FileSystemFileHandleLike = {
    name,
    getFile: async () => new File([content], name, { type: 'application/json' }),
    createWritable: async () => ({
      write: async (data: string) => {
        writes.push(data)
      },
      close: async () => {},
    }),
    ...overrides,
  }
  return { handle, writes }
}

function domError(name: string, message: string): DOMException {
  return new DOMException(message, name)
}

function chooseFromPicker(handle: FileSystemFileHandleLike): void {
  vi.stubGlobal('showOpenFilePicker', vi.fn(async () => [handle]))
}

function captureDownloads(): { anchors: HTMLAnchorElement[]; blobs: Blob[] } {
  const anchors: HTMLAnchorElement[] = []
  const blobs: Blob[] = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation((source) => {
    blobs.push(source as Blob)
    return 'blob:test'
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const originalCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = originalCreate(tag)
    if (tag === 'a') {
      anchors.push(el as HTMLAnchorElement)
    }
    return el
  })
  return { anchors, blobs }
}

async function loadViaFallback(container: HTMLElement, file: File): Promise<void> {
  fireEvent.click(screen.getAllByRole('button', { name: 'Choose File' })[0])
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [file] })
  fireEvent.change(input)
}

async function openViaPicker(handle: FileSystemFileHandleLike): Promise<void> {
  chooseFromPicker(handle)
  fireEvent.click(screen.getAllByRole('button', { name: 'Choose File' })[0])
  await screen.findByText('Tobi Returns')
}

async function editName(nextName: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: nextName } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Record' }))
  await screen.findByText(nextName)
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('App', () => {
  it('starts with no file selected and never auto-loads a file', async () => {
    const pickerSpy = vi.fn(async () => [] as FileSystemFileHandleLike[])
    vi.stubGlobal('showOpenFilePicker', pickerSpy)

    render(<App />)

    expect(
      await screen.findByRole('heading', { name: 'No file selected' }),
    ).toBeInTheDocument()
    const chooseButtons = screen.getAllByRole('button', { name: 'Choose File' })
    chooseButtons.forEach((button) => {
      expect(button).toBeEnabled()
    })
    expect(screen.getByRole('button', { name: 'Reload from Disk' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
    expect(pickerSpy).not.toHaveBeenCalled()
  })

  it('loads records after a successful picker selection', async () => {
    const { handle } = makeHandle('db.json', VALID_TEXT)
    chooseFromPicker(handle)

    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Choose File' })[0])

    expect(await screen.findByText('db.json')).toBeInTheDocument()
    expect(screen.getByText('1 record')).toBeInTheDocument()
    expect(screen.getByText('Tobi Returns')).toBeInTheDocument()
    expect(screen.getByText('Sparks 89431')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Label' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reload from Disk' })).toBeEnabled()
    expect(screen.queryByRole('heading', { name: 'No file selected' })).not.toBeInTheDocument()
  })

  it('keeps the empty state when the picker is cancelled', async () => {
    vi.stubGlobal('showOpenFilePicker', vi.fn(async () => []))

    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Choose File' })[0])

    expect(
      await screen.findByRole('heading', { name: 'No file selected' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('db.json')).not.toBeInTheDocument()
  })

  it('shows a clear error for an invalid JSON file', async () => {
    const { handle } = makeHandle('bad.json', '{ not valid json')
    chooseFromPicker(handle)

    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Choose File' })[0])

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Invalid JSON')
    expect(screen.getByRole('heading', { name: 'No file selected' })).toBeInTheDocument()
  })

  it('shows a clear error when the file has no valid _default', async () => {
    const { handle } = makeHandle('records.json', JSON.stringify({ records: [] }))
    chooseFromPicker(handle)

    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Choose File' })[0])

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Missing or invalid "_default"')
  })

  it('saves edits back to the file via the writable handle', async () => {
    const { handle, writes } = makeHandle('db.json', VALID_TEXT)
    chooseFromPicker(handle)

    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Choose File' })[0])

    await screen.findByText('Tobi Returns')
    await editName('Renamed Person')

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(writes.length).toBe(1))
    expect(writes[0]).toContain('"name": "Renamed Person"')
    expect(writes[0]).toContain('  "2": {')
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
    expect(screen.getByText('All changes saved')).toBeInTheDocument()
  })

  it('never asks for write permission while opening or reading a file', async () => {
    const queryPermission = vi.fn(async () => 'prompt' as PermissionState)
    const requestPermission = vi.fn(async () => 'granted' as PermissionState)
    const { handle } = makeHandle('db.json', VALID_TEXT, { queryPermission, requestPermission })
    chooseFromPicker(handle)

    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Choose File' })[0])

    await screen.findByText('Tobi Returns')
    expect(queryPermission).not.toHaveBeenCalled()
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('prompts for readwrite permission during Save Changes and writes when granted', async () => {
    const queryPermission = vi.fn(async () => 'prompt' as PermissionState)
    const requestPermission = vi.fn(async () => 'granted' as PermissionState)
    const { handle, writes } = makeHandle('db.json', VALID_TEXT, {
      queryPermission,
      requestPermission,
    })

    render(<App />)
    await openViaPicker(handle)
    await editName('Granted Person')

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(writes.length).toBe(1))
    expect(queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(writes[0]).toContain('"name": "Granted Person"')
    expect(screen.getByText('All changes saved')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Download Copy' })).not.toBeInTheDocument()
  })

  it('skips the prompt when readwrite permission is already granted', async () => {
    const queryPermission = vi.fn(async () => 'granted' as PermissionState)
    const requestPermission = vi.fn(async () => 'granted' as PermissionState)
    const { handle, writes } = makeHandle('db.json', VALID_TEXT, {
      queryPermission,
      requestPermission,
    })

    render(<App />)
    await openViaPicker(handle)
    await editName('Already Granted')

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(writes.length).toBe(1))
    expect(queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(requestPermission).not.toHaveBeenCalled()
    expect(screen.getByText('All changes saved')).toBeInTheDocument()
  })

  it('does not write and keeps changes unsaved when write permission is denied', async () => {
    const { anchors } = captureDownloads()
    const queryPermission = vi.fn(async () => 'prompt' as PermissionState)
    const requestPermission = vi.fn(async () => 'denied' as PermissionState)
    const { handle, writes } = makeHandle('db.json', VALID_TEXT, {
      queryPermission,
      requestPermission,
    })

    render(<App />)
    await openViaPicker(handle)
    await editName('Denied Person')

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Permission to modify this file was not granted.')
    expect(writes).toHaveLength(0)
    expect(anchors).toHaveLength(0)
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
  })

  it('offers a Download Copy that saves the edits as a separate file', async () => {
    const { anchors, blobs } = captureDownloads()
    const requestPermission = vi.fn(async () => 'denied' as PermissionState)
    const { handle } = makeHandle('db.json', VALID_TEXT, {
      queryPermission: vi.fn(async () => 'prompt' as PermissionState),
      requestPermission,
    })

    render(<App />)
    await openViaPicker(handle)
    await editName('Copied Person')

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await screen.findByRole('alert')

    fireEvent.click(screen.getByRole('button', { name: 'Download Copy' }))

    await waitFor(() => expect(anchors).toHaveLength(1))
    expect(anchors[0].download).toBe('db.json')
    expect(await blobs[0].text()).toContain('"name": "Copied Person"')
    expect(await blobs[0].text()).toContain('  "2": {')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('falls back to download mode when the handle has no createWritable', async () => {
    const { anchors, blobs } = captureDownloads()
    const { handle } = makeHandle('readonly.json', VALID_TEXT, { createWritable: undefined })

    render(<App />)
    await openViaPicker(handle)

    expect(screen.getByText(/cannot overwrite the original file/)).toBeInTheDocument()

    await editName('Downloaded Person')
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(anchors).toHaveLength(1))
    expect(anchors[0].download).toBe('readonly.json')
    expect(await blobs[0].text()).toContain('"name": "Downloaded Person"')
    expect(screen.getByText('All changes saved')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports NotAllowedError raised by the write itself', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { handle, writes } = makeHandle('db.json', VALID_TEXT, {
      createWritable: async () => {
        throw domError('NotAllowedError', 'read only')
      },
    })

    render(<App />)
    await openViaPicker(handle)
    await editName('Locked Person')

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Permission to modify this file was not granted.')
    expect(writes).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Download Copy' })).toBeInTheDocument()
  })

  it('reports NoModificationAllowedError and keeps changes unsaved', async () => {
    const { handle } = makeHandle('db.json', VALID_TEXT, {
      createWritable: async () => {
        throw domError('NoModificationAllowedError', 'file is open elsewhere')
      },
    })

    render(<App />)
    await openViaPicker(handle)
    await editName('Locked Person')

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'The file could not be modified. It may be open or locked by another application.',
    )
    expect(screen.getByText('Locked Person')).toBeInTheDocument()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
  })

  it('reports NotFoundError when the original file disappeared', async () => {
    const { handle } = makeHandle('db.json', VALID_TEXT, {
      createWritable: async () => {
        throw domError('NotFoundError', 'no such file')
      },
    })

    render(<App />)
    await openViaPicker(handle)
    await editName('Missing Person')

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The original file could no longer be found.')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('logs unexpected write errors to the console and shows a generic message', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { handle } = makeHandle('db.json', VALID_TEXT, {
      createWritable: async () => {
        throw domError('QuotaExceededError', 'quota')
      },
    })

    render(<App />)
    await openViaPicker(handle)
    await editName('Overflow Person')

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not save the file.')
    expect(String(consoleError.mock.calls[0][0])).toContain('QuotaExceededError')
    expect(consoleError.mock.calls[0][0]).not.toBe('Could not save the file.')
  })

  it('uses the file input fallback and explains that saves download the file', async () => {
    const { container } = render(<App />)
    const file = new File([VALID_TEXT], 'store.json', { type: 'application/json' })
    await loadViaFallback(container, file)

    expect(await screen.findByText('store.json')).toBeInTheDocument()
    expect(screen.getByText('Sparks 89431')).toBeInTheDocument()
    expect(screen.getByText(/cannot overwrite the original file/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload from Disk' })).toBeDisabled()
  })

  it('downloads the updated JSON in fallback browsers', async () => {
    const { anchors, blobs } = captureDownloads()

    const { container } = render(<App />)
    const file = new File([VALID_TEXT], 'store.json', { type: 'application/json' })
    await loadViaFallback(container, file)

    await screen.findByText('store.json')
    await editName('Downloaded Person')

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(anchors).toHaveLength(1))
    expect(anchors[0].download).toBe('store.json')
    expect(await blobs[0].text()).toContain('"name": "Downloaded Person"')
    expect(await blobs[0].text()).toContain('  "2": {')
    expect(screen.getByText('All changes saved')).toBeInTheDocument()
  })
})
