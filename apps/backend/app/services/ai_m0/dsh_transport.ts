import { randomUUID } from 'node:crypto'
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * DSH sdk-minimal shares the ordinary Harness HTTP identity; it has no mode header.
 * Reference: deepseek-ai/deepseek-harness/docs/deepseek-llm-api-wire-extensions.md.
 * Pin the identity to the locally verified DSH release, without depending on its installation.
 */
export const DSH_USER_AGENT =
  'deepseek-harness/0.1.5-rc.1 (+https://github.com/deepseek-ai/deepseek-harness)'

let anonymousUserId: Promise<string> | undefined

async function loadAnonymousUserId(): Promise<string> {
  const path =
    process.env.AI_DSH_IDENTITY_PATH ??
    fileURLToPath(new URL('../../../storage/secrets/dsh-anonymous-user-id', import.meta.url))
  try {
    return validateAnonymousUserId(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, randomUUID(), { flag: 'wx', mode: 0o600 })
  try {
    // Publish only a complete file; competing workers must read the same persisted UUID.
    await link(temporaryPath, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  } finally {
    await unlink(temporaryPath)
  }
  return validateAnonymousUserId(await readFile(path, 'utf8'))
}

function validateAnonymousUserId(storedValue: string): string {
  const value = storedValue.trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('AI DSH anonymous identity must be a UUID v4')
  }
  return value
}

function getAnonymousUserId(): Promise<string> {
  anonymousUserId ??= loadAnonymousUserId().catch((error: unknown) => {
    anonymousUserId = undefined
    throw error
  })
  return anonymousUserId
}

function isStreamingBody(body: RequestInit['body']): boolean {
  if (typeof body !== 'string') return false
  try {
    return JSON.parse(body)?.stream === true
  } catch {
    return false
  }
}

/** Apply identity after SDK header assembly, including SDK-generated retries. */
export function createDshFetch(
  options: { fetch?: typeof globalThis.fetch; userId?: () => Promise<string> } = {},
): typeof globalThis.fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined
    const headers = new Headers(init?.headers ?? request?.headers)
    for (const name of [...headers.keys()]) {
      if (name.startsWith('x-stainless-')) headers.delete(name)
    }
    headers.set('user-agent', DSH_USER_AGENT)

    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    if (method === 'POST' && (headers.has('authorization') || headers.has('x-api-key'))) {
      headers.set('x-deepseek-harness-user-id', await (options.userId ?? getAnonymousUserId)())
    }
    const body =
      init?.body ??
      (request && headers.get('content-type')?.includes('application/json')
        ? await request.clone().text()
        : undefined)
    if (isStreamingBody(body)) headers.set('accept', 'text/event-stream')

    // Preserve provider URL, credentials, protocol headers, payload and AbortSignal.
    // No fake minimal/compaction flag, plugin inventory or session-log upload is added.
    return (options.fetch ?? globalThis.fetch)(input, { ...init, headers })
  }
}

export const dshFetch = createDshFetch()
