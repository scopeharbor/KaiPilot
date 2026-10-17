import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createDshFetch, DSH_USER_AGENT } from '../../app/services/ai_m0/dsh_transport.ts'

const FIXTURE_USER_ID = '68f7341f-1d7d-49db-b1d3-d7f793f73ca1'
const FIXTURE_URL = 'https://provider.example/v1/messages'
const TEMP_PREFIX = 'aiproj-dsh-headers-'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const temporaryDirectories: string[] = []

beforeEach(() => {
  vi.resetModules()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) {
    const absoluteDirectory = resolve(directory)
    if (
      dirname(absoluteDirectory) !== resolve(tmpdir()) ||
      !basename(absoluteDirectory).startsWith(TEMP_PREFIX)
    ) {
      throw new Error('Refused cleanup outside the DSH header test temporary directory')
    }
    await rm(absoluteDirectory, { recursive: true, force: true })
  }
})

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), TEMP_PREFIX))
  temporaryDirectories.push(directory)
  return directory
}

function createFetchFixture() {
  const response = new Response('fixture-response')
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response)
  const userId = vi.fn<() => Promise<string>>().mockResolvedValue(FIXTURE_USER_ID)
  return { response, fetch, userId, transport: createDshFetch({ fetch, userId }) }
}

describe('DSH 请求头传输边界', () => {
  test.each<{ name: string; auth: Record<string, string> }>([
    { name: 'OpenAI Bearer', auth: { Authorization: 'Bearer fixture-api-key' } },
    { name: 'Anthropic API key', auth: { 'X-Api-Key': 'fixture-api-key' } },
  ])('$name：清理 SDK 身份头，保留鉴权、协议、请求体和取消信号', async ({ auth }) => {
    const fixture = createFetchFixture()
    const controller = new AbortController()
    const body = JSON.stringify({ model: 'fixture-model', stream: false, messages: [] })
    const headers = new Headers({
      ...auth,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Anthropic-Version': '2023-06-01',
      'Anthropic-Beta': 'fixture-beta',
      'User-Agent': 'original-sdk',
      'X-Stainless-Lang': 'js',
      'x-STAINLESS-Retry-Count': '1',
      'X-Provider-Routing': 'fixture-route',
    })

    const response = await fixture.transport(FIXTURE_URL, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
      redirect: 'manual',
    })

    expect(response).toBe(fixture.response)
    expect(fixture.fetch).toHaveBeenCalledTimes(1)
    const [sentInput, sentInit] = fixture.fetch.mock.calls[0]!
    const sentHeaders = new Headers(sentInit?.headers)
    expect(sentInput).toBe(FIXTURE_URL)
    expect(sentInit).toMatchObject({ method: 'POST', body, redirect: 'manual' })
    expect(sentInit?.signal).toBe(controller.signal)
    for (const [name, value] of headers) {
      if (name !== 'user-agent' && !name.startsWith('x-stainless-')) {
        expect(sentHeaders.get(name)).toBe(value)
      }
    }
    expect(sentHeaders.get('user-agent')).toBe(DSH_USER_AGENT)
    expect(sentHeaders.get('x-deepseek-harness-user-id')).toBe(FIXTURE_USER_ID)
    expect([...sentHeaders.keys()].some((name) => name.startsWith('x-stainless-'))).toBe(false)
    expect(sentHeaders.has('x-deepseek-harness-compact')).toBe(false)
    expect(sentHeaders.has('x-deepseek-harness-session-id')).toBe(false)
    expect([...sentHeaders.keys()].some((name) => name.includes('minimal'))).toBe(false)
    expect(fixture.userId).toHaveBeenCalledTimes(1)
    expect(headers.get('user-agent')).toBe('original-sdk')
    expect(headers.get('x-stainless-lang')).toBe('js')
    controller.abort()
    expect(sentInit?.signal?.aborted).toBe(true)
  })

  test('URL + init 的流式 JSON 使用 SSE Accept，同时保持原始请求体', async () => {
    const fixture = createFetchFixture()
    const body = JSON.stringify({ model: 'fixture-model', stream: true, messages: [] })

    await fixture.transport(FIXTURE_URL, {
      method: 'POST',
      headers: { authorization: 'Bearer fixture-api-key', 'content-type': 'application/json' },
      body,
    })

    const sentInit = fixture.fetch.mock.calls[0]![1]
    const sentHeaders = new Headers(sentInit?.headers)
    expect(sentHeaders.get('accept')).toBe('text/event-stream')
    expect(sentHeaders.get('content-type')).toBe('application/json')
    expect(sentInit?.body).toBe(body)
  })

  test('Request 的流式 JSON 检测不消费原 body，并保留 Request 的信号', async () => {
    const fixture = createFetchFixture()
    const controller = new AbortController()
    const body = JSON.stringify({ model: 'fixture-model', stream: true, messages: [] })
    const request = new Request(FIXTURE_URL, {
      method: 'POST',
      headers: {
        authorization: 'Bearer fixture-api-key',
        'content-type': 'application/json',
        'X-Stainless-Package-Version': 'fixture-version',
      },
      body,
      signal: controller.signal,
    })

    await fixture.transport(request)

    const [sentInput, sentInit] = fixture.fetch.mock.calls[0]!
    expect(sentInput).toBe(request)
    expect(new Headers(sentInit?.headers).get('accept')).toBe('text/event-stream')
    expect(new Headers(sentInit?.headers).has('x-stainless-package-version')).toBe(false)
    expect(request.bodyUsed).toBe(false)
    expect(await request.text()).toBe(body)
    controller.abort()
    expect((sentInput as Request).signal.aborted).toBe(true)
  })

  test('init 覆盖 Request headers 和 body，遵循 fetch 原有优先级', async () => {
    const fixture = createFetchFixture()
    const request = new Request(FIXTURE_URL, {
      method: 'POST',
      headers: {
        authorization: 'Bearer original-fixture-key',
        'content-type': 'application/json',
        'x-request-only': 'must-not-be-merged',
      },
      body: JSON.stringify({ stream: true }),
    })
    const body = JSON.stringify({ stream: false, model: 'replacement-model' })

    await fixture.transport(request, {
      headers: {
        authorization: 'Bearer replacement-fixture-key',
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body,
    })

    const sentInit = fixture.fetch.mock.calls[0]![1]
    const sentHeaders = new Headers(sentInit?.headers)
    expect(sentHeaders.get('authorization')).toBe('Bearer replacement-fixture-key')
    expect(sentHeaders.get('accept')).toBe('application/json')
    expect(sentHeaders.has('x-request-only')).toBe(false)
    expect(sentInit?.body).toBe(body)
    expect(request.bodyUsed).toBe(false)
  })
})

describe('DSH 匿名身份持久化', () => {
  test('在临时路径创建 UUID，模块重新加载后仍复用同一文件', async () => {
    const directory = await createTemporaryDirectory()
    const path = join(directory, 'secrets', 'anonymous-user-id')
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('fixture'))
    vi.stubEnv('AI_DSH_IDENTITY_PATH', path)
    vi.stubGlobal('fetch', fetch)
    const init = {
      method: 'POST',
      headers: { authorization: 'Bearer fixture-api-key' },
      body: '{}',
    }
    const firstModule = await import('../../app/services/ai_m0/dsh_transport.ts')

    await firstModule.dshFetch(FIXTURE_URL, init)
    const storedValue = await readFile(path, 'utf8')
    const persisted = storedValue.trim()
    // Only boolean assertions involve the generated identity, so failures do not print it.
    expect(UUID_PATTERN.test(persisted)).toBe(true)
    expect(
      new Headers(fetch.mock.calls[0]![1]?.headers).get('x-deepseek-harness-user-id') === persisted,
    ).toBe(true)

    vi.resetModules()
    const reloadedModule = await import('../../app/services/ai_m0/dsh_transport.ts')
    await reloadedModule.dshFetch(FIXTURE_URL, init)

    expect(fetch).toHaveBeenCalledTimes(2)
    const reloadedValue = await readFile(path, 'utf8')
    expect(reloadedValue.trim() === persisted).toBe(true)
    expect(
      new Headers(fetch.mock.calls[1]![1]?.headers).get('x-deepseek-harness-user-id') === persisted,
    ).toBe(true)
    expect(await readdir(dirname(path))).toEqual(['anonymous-user-id'])
  })

  test('持久化路径不可写时拒绝请求，绝不调用外部 fetch', async () => {
    const directory = await createTemporaryDirectory()
    const blockedDirectory = join(directory, 'not-a-directory')
    await writeFile(blockedDirectory, 'fixture file blocks directory creation')
    vi.stubEnv('AI_DSH_IDENTITY_PATH', join(blockedDirectory, 'anonymous-user-id'))
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('fixture'))
    vi.stubGlobal('fetch', fetch)
    const { dshFetch } = await import('../../app/services/ai_m0/dsh_transport.ts')

    await expect(
      dshFetch(FIXTURE_URL, {
        method: 'POST',
        headers: { authorization: 'Bearer fixture-api-key' },
        body: '{}',
      }),
    ).rejects.toThrow()

    expect(fetch).not.toHaveBeenCalled()
  })
})
