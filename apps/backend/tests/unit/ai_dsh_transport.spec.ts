import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpenAiAdapter } from '../../app/services/ai_m0/openai_adapter.ts'
import { AnthropicCompatibleAdapter } from '../../app/services/ai_m0/anthropic_compatible_adapter.ts'
import type { GenerateOptions, StreamChunk } from '../../app/services/ai_m0/gateway.ts'
import { buildStrategyPrompt } from '../../app/services/ai_m0/prompts.ts'

const DSH_USER_AGENT =
  'deepseek-harness/0.1.5-rc.1 (+https://github.com/deepseek-ai/deepseek-harness)'
const DSH_MINIMAL_SYSTEM_PROMPT = 'You are a helpful software engineer assistant.'
const FIXTURE_KEY = 'loopback-fixture-key'
const FIXTURE_MODEL = 'loopback-fixture-model'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const protocols = ['openai', 'anthropic'] as const
type Protocol = (typeof protocols)[number]

interface CapturedRequest {
  method: string
  path: string
  headers: IncomingHttpHeaders
  body: Record<string, unknown>
  bodyBytes: number
}

type FixtureHandler = (request: CapturedRequest, response: ServerResponse, index: number) => void

const servers = new Set<Server>()
let identityDirectory: string
let previousIdentityPath: string | undefined

beforeAll(async () => {
  previousIdentityPath = process.env.AI_DSH_IDENTITY_PATH
  identityDirectory = await mkdtemp(join(tmpdir(), 'aiproj-dsh-transport-'))
  process.env.AI_DSH_IDENTITY_PATH = join(identityDirectory, 'anonymous-user-id')
})

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
          server.closeAllConnections()
        }),
    ),
  )
  servers.clear()
})

afterAll(async () => {
  if (previousIdentityPath === undefined) delete process.env.AI_DSH_IDENTITY_PATH
  else process.env.AI_DSH_IDENTITY_PATH = previousIdentityPath
  if (identityDirectory) await rm(identityDirectory, { recursive: true, force: true })
})

async function startFixture(handler: FixtureHandler = replySuccess) {
  const requests: CapturedRequest[] = []
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const text = Buffer.concat(chunks).toString('utf8')
      const captured: CapturedRequest = {
        method: request.method ?? '',
        path: request.url ?? '',
        headers: request.headers,
        body: text ? JSON.parse(text) : {},
        bodyBytes: Buffer.byteLength(text),
      }
      requests.push(captured)
      handler(captured, response, requests.length)
    })().catch(() => {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Invalid loopback fixture request' } }))
    })
  })
  servers.add(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing loopback fixture address')
  return { baseURL: `http://127.0.0.1:${address.port}/v1`, requests }
}

function replySuccess(request: CapturedRequest, response: ServerResponse) {
  if (request.path === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        object: 'list',
        data: [{ id: 'deepseek-ai/DeepSeek-OCR', object: 'model' }],
      }),
    )
    return
  }

  const anthropic = request.path === '/v1/messages'
  if (request.body.stream === true) {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    if (anthropic) {
      const events = [
        {
          type: 'message_start',
          message: {
            id: 'msg_loopback',
            type: 'message',
            role: 'assistant',
            model: FIXTURE_MODEL,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 2, output_tokens: 0 },
          },
        },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 1 },
        },
        { type: 'message_stop' },
      ]
      for (const event of events) {
        response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      }
    } else {
      response.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl_loopback',
          object: 'chat.completion.chunk',
          model: FIXTURE_MODEL,
          choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: null }],
        })}\n\n`,
      )
      response.write('data: [DONE]\n\n')
    }
    response.end()
    return
  }

  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(
    JSON.stringify(
      anthropic
        ? {
            id: 'msg_loopback',
            type: 'message',
            role: 'assistant',
            model: FIXTURE_MODEL,
            content: [{ type: 'text', text: 'OK' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 2, output_tokens: 1 },
          }
        : {
            id: 'chatcmpl_loopback',
            object: 'chat.completion',
            choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
          },
    ),
  )
}

function buildAdapter(protocol: Protocol, baseURL: string) {
  const config = {
    apiKey: FIXTURE_KEY,
    baseURL: protocol === 'anthropic' ? baseURL.replace(/\/v1$/, '') : baseURL,
    model: FIXTURE_MODEL,
    requestTimeoutMsDefault: 5000,
  }
  return protocol === 'openai' ? new OpenAiAdapter(config) : new AnthropicCompatibleAdapter(config)
}

function expectDshHeaders(request: CapturedRequest, protocol: Protocol, streaming = false) {
  expect(request.headers['user-agent']).toBe(DSH_USER_AGENT)
  expect(Object.keys(request.headers).filter((name) => name.startsWith('x-stainless-'))).toEqual([])
  expect(request.headers).not.toHaveProperty('x-deepseek-harness-compact')
  expect(request.headers).not.toHaveProperty('x-deepseek-harness-session-id')
  expect(request.headers).not.toHaveProperty('x-deepseek-harness-mode')
  expect(request.headers).not.toHaveProperty('x-deepseek-harness-minimal')
  if (request.method === 'POST') {
    expect(request.headers['content-type']).toBe('application/json')
    expect(request.headers['x-deepseek-harness-user-id']).toMatch(UUID_PATTERN)
  }
  if (streaming) expect(request.headers.accept).toBe('text/event-stream')
  if (protocol === 'openai') {
    expect(request.headers.authorization).toBe(`Bearer ${FIXTURE_KEY}`)
  } else {
    expect(request.headers['x-api-key']).toBe(FIXTURE_KEY)
    expect(request.headers['anthropic-version']).toBe('2023-06-01')
  }
}

function expectDshPrompt(request: CapturedRequest, protocol: Protocol, originalPrompt?: string) {
  const prompt =
    protocol === 'anthropic'
      ? request.body.system
      : (request.body.messages as Array<{ role: string; content: unknown }>)[0]?.content
  const expected = originalPrompt
    ? `${DSH_MINIMAL_SYSTEM_PROMPT}\n\n${originalPrompt}`
    : DSH_MINIMAL_SYSTEM_PROMPT
  expect(prompt).toBe(expected)
  expect(String(prompt).split(DSH_MINIMAL_SYSTEM_PROMPT)).toHaveLength(2)
}

async function collect(stream: AsyncIterable<StreamChunk>) {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('DSH identity and minimal prompt over real SDK requests to a loopback fixture', () => {
  test.each(protocols)(
    '%s ping prepends the minimal prompt while keeping authentication and its original user message',
    async (protocol) => {
      const fixture = await startFixture()
      const result = await buildAdapter(protocol, fixture.baseURL).ping()

      expect(result.ok).toBe(true)
      expect(fixture.requests).toHaveLength(1)
      const [request] = fixture.requests
      expectDshHeaders(request!, protocol)
      expectDshPrompt(request!, protocol)
      expect(request!.path).toBe(protocol === 'openai' ? '/v1/chat/completions' : '/v1/messages')
      expect(request!.body).toMatchObject({
        model: FIXTURE_MODEL,
        max_tokens: protocol === 'openai' ? 128 : 4,
        temperature: 0,
        messages:
          protocol === 'openai'
            ? [
                { role: 'system', content: DSH_MINIMAL_SYSTEM_PROMPT },
                { role: 'user', content: 'Reply with exactly OK.' },
              ]
            : [{ role: 'user', content: 'Reply with exactly OK.' }],
      })
    },
  )

  test('OpenAI-compatible ping retries hidden reasoning truncated before visible content', async () => {
    const fixture = await startFixture((request, response, index) => {
      if (index === 1) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            id: 'chatcmpl_reasoning_only',
            object: 'chat.completion',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  reasoning_content: 'hidden reasoning consumed the first budget',
                },
                finish_reason: 'length',
              },
            ],
            usage: {
              prompt_tokens: 2,
              completion_tokens: 128,
              total_tokens: 130,
              completion_tokens_details: { reasoning_tokens: 128 },
            },
          }),
        )
        return
      }
      replySuccess(request, response)
    })

    const result = await buildAdapter('openai', fixture.baseURL).ping()

    expect(result).toEqual({
      ok: true,
      usage: { inputTokens: 4, outputTokens: 129, totalTokens: 133 },
    })
    expect(fixture.requests.map((request) => request.body.max_tokens)).toEqual([128, 512])
  })

  test('OpenAI-compatible ping accepts a chat completion wrapped in data', async () => {
    const fixture = await startFixture((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          success: true,
          data: {
            id: 'chatcmpl_wrapped',
            object: 'chat.completion',
            choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
          },
        }),
      )
    })

    const result = await buildAdapter('openai', fixture.baseURL).ping()

    expect(result).toEqual({
      ok: true,
      usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    })
    expect(fixture.requests).toHaveLength(1)
  })

  test('OpenAI-compatible ping keeps a genuine empty final response as failure', async () => {
    const fixture = await startFixture((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          id: 'chatcmpl_empty',
          object: 'chat.completion',
          choices: [{ message: { role: 'assistant', content: '   ' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 2, completion_tokens: 0, total_tokens: 2 },
        }),
      )
    })

    const result = await buildAdapter('openai', fixture.baseURL).ping()

    expect(result).toMatchObject({
      ok: false,
      errorKind: 'model_refusal_or_empty',
      errorMessage: '测试失败：供应商返回了空响应。',
    })
    expect(fixture.requests).toHaveLength(1)
  })

  for (const protocol of protocols) {
    test.each(['prompt', 'native', 'tool'] as const)(
      `${protocol} %s stream prepends the minimal prompt and keeps custom prompts and structured output`,
      async (strategy) => {
        const fixture = await startFixture()
        const schema = {
          type: 'object',
          properties: { title: { type: 'string' } },
          required: ['title'],
          additionalProperties: false,
        }
        const options: GenerateOptions = {
          sentence: '本机协议测试',
          strategy,
          temperature: 0.3,
          maxOutputTokens: 123,
          jsonSchema: schema,
          promptSet: { systemPrompt: '系统提示保持不变', userPrompt: '用户提示保持不变' },
        }

        const chunks = await collect(buildAdapter(protocol, fixture.baseURL).stream(options))

        expect(chunks).toEqual([
          expect.objectContaining({ kind: 'text', text: 'OK' }),
          expect.objectContaining({ kind: 'done' }),
        ])
        expect(fixture.requests).toHaveLength(1)
        const [request] = fixture.requests
        expectDshHeaders(request!, protocol, true)
        expectDshPrompt(request!, protocol, '系统提示保持不变')
        expect(options.promptSet).toEqual({
          systemPrompt: '系统提示保持不变',
          userPrompt: '用户提示保持不变',
        })
        expect(request!.body).toMatchObject({
          model: FIXTURE_MODEL,
          temperature: 0.3,
          max_tokens: 123,
          stream: true,
        })
        if (protocol === 'openai') {
          expect(request!.body.messages).toEqual([
            {
              role: 'system',
              content: `${DSH_MINIMAL_SYSTEM_PROMPT}\n\n系统提示保持不变`,
            },
            { role: 'user', content: '用户提示保持不变' },
          ])
          expect(request!.body.stream_options).toEqual({ include_usage: true })
          if (strategy === 'native') {
            expect(request!.body.response_format).toEqual({
              type: 'json_schema',
              json_schema: { name: 'AiProjectDraft', schema, strict: true },
            })
          } else if (strategy === 'tool') {
            expect(request!.body.tools).toEqual([
              expect.objectContaining({
                type: 'function',
                function: expect.objectContaining({
                  name: 'submit_ai_project_draft',
                  parameters: schema,
                }),
              }),
            ])
            expect(request!.body.tool_choice).toEqual({
              type: 'function',
              function: { name: 'submit_ai_project_draft' },
            })
          }
        } else {
          expect(request!.body.system).toBe(`${DSH_MINIMAL_SYSTEM_PROMPT}\n\n系统提示保持不变`)
          expect(request!.body.messages).toEqual([{ role: 'user', content: '用户提示保持不变' }])
          if (strategy === 'native') {
            expect(request!.body.output_config).toEqual({ format: { type: 'json_schema', schema } })
          } else if (strategy === 'tool') {
            expect(request!.body.tools).toEqual([
              expect.objectContaining({ name: 'submit_ai_project_draft', input_schema: schema }),
            ])
            expect(request!.body.tool_choice).toEqual({
              type: 'tool',
              name: 'submit_ai_project_draft',
            })
          }
        }
        if (strategy === 'prompt') {
          expect(request!.body).not.toHaveProperty('tools')
          expect(request!.body).not.toHaveProperty('response_format')
          expect(request!.body).not.toHaveProperty('output_config')
        }
      },
    )

    test.each(['prompt', 'native', 'tool'] as const)(
      `${protocol} %s stream places the minimal prompt before the complete default project prompt`,
      async (strategy) => {
        const fixture = await startFixture()
        const sentence = '默认提示词顺序测试'
        const original = buildStrategyPrompt({ sentence, strategy })

        const chunks = await collect(
          buildAdapter(protocol, fixture.baseURL).stream({ sentence, strategy }),
        )

        expect(chunks).toContainEqual(expect.objectContaining({ kind: 'done' }))
        expect(fixture.requests).toHaveLength(1)
        const request = fixture.requests[0]!
        expectDshHeaders(request, protocol, true)
        expectDshPrompt(request, protocol, original.systemPrompt)
        const expectedUser = { role: 'user', content: original.userPrompt }
        if (protocol === 'openai') {
          expect(request.body.messages).toEqual([
            {
              role: 'system',
              content: `${DSH_MINIMAL_SYSTEM_PROMPT}\n\n${original.systemPrompt}`,
            },
            expectedUser,
          ])
        } else {
          expect(request.body.messages).toEqual([expectedUser])
        }
      },
    )

    test(`${protocol} stream preserves an already prefixed system prompt without duplicating it`, async () => {
      const fixture = await startFixture()
      const projectPrompt = '已有前缀之后的项目规则'
      const systemPrompt = `${DSH_MINIMAL_SYSTEM_PROMPT}\n\n${projectPrompt}`
      const promptSet = { systemPrompt, userPrompt: '原始用户内容' }

      const chunks = await collect(
        buildAdapter(protocol, fixture.baseURL).stream({
          sentence: '已有前缀测试',
          strategy: 'prompt',
          promptSet,
        }),
      )

      expect(chunks).toContainEqual(expect.objectContaining({ kind: 'done' }))
      expect(fixture.requests).toHaveLength(1)
      expectDshPrompt(fixture.requests[0]!, protocol, projectPrompt)
      expect(promptSet).toEqual({ systemPrompt, userPrompt: '原始用户内容' })
    })
  }

  test('OCR preserves image data and prompts while carrying the same DSH identity', async () => {
    const fixture = await startFixture()
    const adapter = new OpenAiAdapter({
      apiKey: FIXTURE_KEY,
      baseURL: fixture.baseURL,
      model: 'generic-vision-fixture',
    })
    const imageDataUrl = 'data:image/png;base64,dGVzdA=='
    const result = await adapter.ocrPreview({
      imageDataUrl,
      promptHint: '保留中文',
      maxOutputTokens: 99,
    })

    expect(result).toMatchObject({ ok: true, extractedText: 'OK' })
    expect(fixture.requests).toHaveLength(1)
    const [request] = fixture.requests
    expectDshHeaders(request!, 'openai')
    expectDshPrompt(request!, 'openai')
    expect(request!.body).toMatchObject({
      model: 'generic-vision-fixture',
      stream: false,
      max_tokens: 99,
      messages: [
        { role: 'system', content: DSH_MINIMAL_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageDataUrl } },
            {
              type: 'text',
              text: '请进行 OCR。只返回图片中可见的文字，保持原有语言和顺序。\n不要解释、不要补写、不要推测不可见内容。\n额外提示：保留中文',
            },
          ],
        },
      ],
    })
  })

  test('DeepSeek OCR connection test keeps GET model listing free of body and user identity', async () => {
    const fixture = await startFixture()
    const adapter = new OpenAiAdapter({
      apiKey: FIXTURE_KEY,
      baseURL: fixture.baseURL,
      model: 'deepseek-ai/DeepSeek-OCR',
    })
    const result = await adapter.ping()

    expect(result.ok).toBe(true)
    expect(fixture.requests).toHaveLength(1)
    const [request] = fixture.requests
    expectDshHeaders(request!, 'openai')
    expect(request).toMatchObject({ method: 'GET', path: '/v1/models', body: {} })
    expect(request!.bodyBytes).toBe(0)
    expect(request!.headers).not.toHaveProperty('x-deepseek-harness-user-id')
  })

  test.each(protocols)(
    '%s retries preserve the same body with exactly one minimal prompt prefix',
    async (protocol) => {
      const fixture = await startFixture((request, response, index) => {
        if (index === 1) {
          response.writeHead(429, { 'content-type': 'application/json', 'retry-after-ms': '1' })
          response.end(
            JSON.stringify({ error: { type: 'rate_limit_error', message: 'Fixture retry' } }),
          )
          return
        }
        replySuccess(request, response)
      })

      const originalPrompt = '重试时保持原项目提示词且不重复前缀'
      const chunks = await collect(
        buildAdapter(protocol, fixture.baseURL).stream({
          sentence: '本机重试测试',
          strategy: 'prompt',
          promptSet: { systemPrompt: originalPrompt, userPrompt: '用户输入保持原样' },
        }),
      )

      expect(chunks).toContainEqual(expect.objectContaining({ kind: 'done' }))
      expect(fixture.requests).toHaveLength(2)
      for (const request of fixture.requests) {
        expectDshHeaders(request, protocol, true)
        expectDshPrompt(request, protocol, originalPrompt)
      }
      expect(fixture.requests[1]!.body).toEqual(fixture.requests[0]!.body)
      expect(fixture.requests[1]!.headers['x-deepseek-harness-user-id']).toBe(
        fixture.requests[0]!.headers['x-deepseek-harness-user-id'],
      )
    },
  )

  test.each(protocols)(
    '%s cancellation still closes an in-flight HTTP request',
    async (protocol) => {
      let requestReceived!: () => void
      let responseClosed!: () => void
      const received = new Promise<void>((resolve) => {
        requestReceived = resolve
      })
      const closed = new Promise<void>((resolve) => {
        responseClosed = resolve
      })
      const fixture = await startFixture((_request, response) => {
        response.once('close', responseClosed)
        requestReceived()
      })
      const controller = new AbortController()
      const pending = buildAdapter(protocol, fixture.baseURL).ping({ signal: controller.signal })
      await received

      controller.abort()

      const result = await pending
      expect(result.ok).toBe(false)
      await closed
      expect(fixture.requests).toHaveLength(1)
      expectDshHeaders(fixture.requests[0]!, protocol)
    },
  )
})
