import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ensureWritePermission,
  isWritableHandle,
  writeErrorMessage,
  writeHandleText,
} from './files'
import type { FileSystemFileHandleLike } from './files'

function makeHandle(
  overrides: Partial<FileSystemFileHandleLike> = {},
): FileSystemFileHandleLike {
  return {
    name: 'db.json',
    getFile: async () => new File(['{}'], 'db.json', { type: 'application/json' }),
    createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    ...overrides,
  }
}

function domError(name: string, message: string): DOMException {
  return new DOMException(message, name)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isWritableHandle', () => {
  it('reports true when createWritable is available', () => {
    expect(isWritableHandle(makeHandle())).toBe(true)
  })

  it('reports false when the handle has no createWritable', () => {
    expect(isWritableHandle(makeHandle({ createWritable: undefined }))).toBe(false)
  })
})

describe('ensureWritePermission', () => {
  it('returns true without prompting when readwrite is already granted', async () => {
    const queryPermission = vi.fn(async () => 'granted' as PermissionState)
    const requestPermission = vi.fn(async () => 'granted' as PermissionState)

    const allowed = await ensureWritePermission(
      makeHandle({ queryPermission, requestPermission }),
    )

    expect(allowed).toBe(true)
    expect(queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('requests readwrite permission and returns true when the prompt is granted', async () => {
    const queryPermission = vi.fn(async () => 'prompt' as PermissionState)
    const requestPermission = vi.fn(async () => 'granted' as PermissionState)

    const allowed = await ensureWritePermission(
      makeHandle({ queryPermission, requestPermission }),
    )

    expect(allowed).toBe(true)
    expect(queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
  })

  it('returns false when the permission prompt is denied', async () => {
    const queryPermission = vi.fn(async () => 'prompt' as PermissionState)
    const requestPermission = vi.fn(async () => 'denied' as PermissionState)

    const allowed = await ensureWritePermission(
      makeHandle({ queryPermission, requestPermission }),
    )

    expect(allowed).toBe(false)
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
  })

  it('still requests when the current readwrite state is not granted', async () => {
    const queryPermission = vi.fn(async () => 'denied' as PermissionState)
    const requestPermission = vi.fn(async () => 'denied' as PermissionState)

    const allowed = await ensureWritePermission(
      makeHandle({ queryPermission, requestPermission }),
    )

    expect(allowed).toBe(false)
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
  })

  it('returns false when the handle cannot request permission at all', async () => {
    const queryPermission = vi.fn(async () => 'prompt' as PermissionState)

    const allowed = await ensureWritePermission(makeHandle({ queryPermission }))

    expect(allowed).toBe(false)
  })

  it('returns false when requestPermission throws', async () => {
    const queryPermission = vi.fn(async () => 'prompt' as PermissionState)
    const requestPermission = vi.fn(async () => {
      throw new DOMException('needs user activation', 'TypeError')
    })

    const allowed = await ensureWritePermission(
      makeHandle({ queryPermission, requestPermission }),
    )

    expect(allowed).toBe(false)
  })

  it('does not request anything when queryPermission is unsupported', async () => {
    const requestPermission = vi.fn(async () => 'granted' as PermissionState)

    const allowed = await ensureWritePermission(makeHandle({ requestPermission }))

    expect(allowed).toBe(true)
    expect(requestPermission).not.toHaveBeenCalled()
  })
})

describe('writeErrorMessage', () => {
  it('maps NotAllowedError to a permission message', () => {
    expect(writeErrorMessage(domError('NotAllowedError', 'nope'))).toBe(
      'Permission to modify this file was not granted.',
    )
  })

  it('maps NoModificationAllowedError to a locked-file message', () => {
    expect(writeErrorMessage(domError('NoModificationAllowedError', 'locked'))).toBe(
      'The file could not be modified. It may be open or locked by another application.',
    )
  })

  it('maps NotFoundError to a missing-file message', () => {
    expect(writeErrorMessage(domError('NotFoundError', 'gone'))).toBe(
      'The original file could no longer be found.',
    )
  })

  it('falls back to a generic message and logs unexpected errors', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = domError('QuotaExceededError', '/Users/rae/private/db.json is full')

    expect(writeErrorMessage(error)).toBe('Could not save the file.')
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(String(consoleError.mock.calls[0][0])).toContain('QuotaExceededError')
    expect(String(consoleError.mock.calls[0][0])).toContain('/Users/rae/private/db.json is full')
  })

  it('falls back to a generic message for non-error values', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(writeErrorMessage('boom')).toBe('Could not save the file.')
    expect(consoleError).toHaveBeenCalledTimes(1)
  })

  it('does not log recognized errors', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    writeErrorMessage(domError('NotFoundError', 'gone'))

    expect(consoleError).not.toHaveBeenCalled()
  })
})

describe('writeHandleText', () => {
  it('writes then closes the stream', async () => {
    const calls: string[] = []
    const createWritable = vi.fn(async () => ({
      write: async () => {
        calls.push('write')
      },
      close: async () => {
        calls.push('close')
      },
    }))

    await writeHandleText(makeHandle({ createWritable }), '{"a":1}')

    expect(calls).toEqual(['write', 'close'])
  })

  it('throws a NotAllowedError when the handle cannot be written', async () => {
    await expect(
      writeHandleText(makeHandle({ createWritable: undefined }), '{"a":1}'),
    ).rejects.toMatchObject({ name: 'NotAllowedError' })
  })

  it('aborts the stream and rethrows the original error when the write fails', async () => {
    const close = vi.fn(async () => {})
    const abort = vi.fn(async () => {})
    const createWritable = vi.fn(async () => ({
      write: async () => {
        throw domError('NotFoundError', 'gone')
      },
      close,
      abort,
    }))

    await expect(writeHandleText(makeHandle({ createWritable }), '{"a":1}')).rejects.toMatchObject(
      { name: 'NotFoundError' },
    )
    expect(abort).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()
  })

  it('preserves the original error when the release call also fails', async () => {
    const createWritable = vi.fn(async () => ({
      write: async () => {
        throw domError('NoModificationAllowedError', 'locked')
      },
      close: async () => {},
      abort: async () => {
        throw new Error('abort failed')
      },
    }))

    await expect(writeHandleText(makeHandle({ createWritable }), '{"a":1}')).rejects.toMatchObject(
      { name: 'NoModificationAllowedError' },
    )
  })

  it('falls back to close when the stream has no abort', async () => {
    const close = vi.fn(async () => {})
    const createWritable = vi.fn(async () => ({
      write: async () => {
        throw domError('NotAllowedError', 'nope')
      },
      close,
    }))

    await expect(writeHandleText(makeHandle({ createWritable }), '{"a":1}')).rejects.toMatchObject(
      { name: 'NotAllowedError' },
    )
    expect(close).toHaveBeenCalledTimes(1)
  })
})
