import { test } from '@japa/runner'
import { OpenAiAdapter } from '#services/ai_m0/openai_adapter'

const DSH_MINIMAL_SYSTEM_PROMPT = 'You are a helpful software engineer assistant.'

function adapterWithClient(model: string, client: unknown) {
  const adapter = new OpenAiAdapter({
    apiKey: 'test-key',
    baseURL: 'https://provider.example/v1',
    model,
  })
  ;(adapter as any).clientPromise = Promise.resolve(client)
  return adapter
}

test.group('OpenAiAdapter DeepSeek OCR', () => {
  test('连接测试查询模型目录，不向纯 OCR 模型发送文本聊天', async ({ assert }) => {
    let chatCalled = false
    const adapter = adapterWithClient('deepseek-ai/DeepSeek-OCR', {
      models: {
        list: async () => ({ data: [{ id: 'deepseek-ai/DeepSeek-OCR' }] }),
      },
      chat: {
        completions: {
          create: async () => {
            chatCalled = true
            return { choices: [] }
          },
        },
      },
    })

    const result = await adapter.ping()

    assert.isTrue(result.ok)
    assert.isFalse(chatCalled)
  })

  test('模型目录缺少配置模型时返回明确失败', async ({ assert }) => {
    const adapter = adapterWithClient('deepseek-ai/DeepSeek-OCR', {
      models: {
        list: async () => ({ data: [{ id: 'different/model' }] }),
      },
    })

    const result = await adapter.ping()

    assert.isFalse(result.ok)
    assert.equal(result.errorKind, 'RESOURCE_NOT_FOUND')
    assert.include(result.errorMessage, 'deepseek-ai/DeepSeek-OCR')
  })

  test('OCR 请求遵循供应商提示词并把图片放在文字之前', async ({ assert }) => {
    let payload: any
    const adapter = adapterWithClient('deepseek-ai/DeepSeek-OCR', {
      chat: {
        completions: {
          create: async (request: unknown) => {
            payload = request
            return {
              choices: [{ message: { content: '开项 KaiPilot' } }],
              usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
            }
          },
        },
      },
    })

    const result = await adapter.ocrPreview({
      imageDataUrl: 'data:image/png;base64,dGVzdA==',
      promptHint: '保留中文',
    })

    assert.isTrue(result.ok)
    assert.equal(result.extractedText, '开项 KaiPilot')
    assert.lengthOf(payload.messages, 2)
    assert.deepEqual(payload.messages[0], { role: 'system', content: DSH_MINIMAL_SYSTEM_PROMPT })
    assert.equal(payload.messages[1].role, 'user')
    const content = payload.messages[1].content
    assert.equal(content[0].type, 'image_url')
    assert.equal(content[0].image_url.url, 'data:image/png;base64,dGVzdA==')
    assert.equal(content[1].type, 'text')
    // DeepSeek-OCR 预览走纯文本提示，不输出 grounding/定位标记
    assert.include(content[1].text, '只输出图片中可见的文字')
    assert.isFalse(/<\|grounding\|>|<image>/.test(content[1].text))
    assert.include(content[1].text, 'Context: 保留中文')
    assert.equal(
      content[1].text,
      'OCR this image. 只输出图片中可见的文字，保持原文语言和顺序。\n不要输出定位框、JSON 或任何标记。\nContext: 保留中文',
    )
  })

  test('通用视觉模型仍使用防幻觉 OCR 提示词', async ({ assert }) => {
    let payload: any
    const adapter = adapterWithClient('generic-vision-model', {
      chat: {
        completions: {
          create: async (request: unknown) => {
            payload = request
            return { choices: [{ message: { content: '可见文字' } }] }
          },
        },
      },
    })

    const result = await adapter.ocrPreview({
      imageDataUrl: 'data:image/png;base64,dGVzdA==',
    })

    assert.isTrue(result.ok)
    assert.lengthOf(payload.messages, 2)
    assert.deepEqual(payload.messages[0], { role: 'system', content: DSH_MINIMAL_SYSTEM_PROMPT })
    assert.equal(payload.messages[1].role, 'user')
    assert.deepEqual(payload.messages[1].content[0], {
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,dGVzdA==' },
    })
    assert.include(payload.messages[1].content[1].text, '不要解释、不要补写')
    assert.equal(
      payload.messages[1].content[1].text,
      '请进行 OCR。只返回图片中可见的文字，保持原有语言和顺序。\n不要解释、不要补写、不要推测不可见内容。',
    )
  })

  test('多段 content 文本数组容错提取（任务 4.2 契约）', async ({ assert }) => {
    const adapter = adapterWithClient('openai-compatible-model', {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: [
                    { type: 'text', text: '开项 ' },
                    { type: 'text', text: '多段文本识别' },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
          }),
        },
      },
    })

    const result = await adapter.ocrPreview({
      imageDataUrl: 'data:image/png;base64,dGVzdA==',
    })

    assert.isTrue(result.ok)
    assert.equal(result.extractedText, '开项 多段文本识别')
    assert.equal(result.usage?.totalTokens, 18)
  })

  test('content 为空时容错回退至 reasoning_content（任务 4.2 契约）', async ({ assert }) => {
    const adapter = adapterWithClient('reasoning-vision-model', {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: '',
                  reasoning_content: '推理提取到的文字：项目章程草案',
                },
              },
            ],
          }),
        },
      },
    })

    const result = await adapter.ocrPreview({
      imageDataUrl: 'data:image/png;base64,dGVzdA==',
    })

    assert.isTrue(result.ok)
    assert.equal(result.extractedText, '推理提取到的文字：项目章程草案')
  })

  test('兼容 choice.text 与 message.text 字段形态（任务 4.2 契约）', async ({ assert }) => {
    const adapter1 = adapterWithClient('legacy-completions-model', {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ text: 'legacy choice.text 结果' }],
          }),
        },
      },
    })
    const res1 = await adapter1.ocrPreview({ imageDataUrl: 'data:image/png;base64,dGVzdA==' })
    assert.isTrue(res1.ok)
    assert.equal(res1.extractedText, 'legacy choice.text 结果')

    const adapter2 = adapterWithClient('compat-message-text-model', {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { text: 'compat message.text 结果' } }],
          }),
        },
      },
    })
    const res2 = await adapter2.ocrPreview({ imageDataUrl: 'data:image/png;base64,dGVzdA==' })
    assert.isTrue(res2.ok)
    assert.equal(res2.extractedText, 'compat message.text 结果')
  })

  test('模型明确拒答时返回可区分的 model_refusal_or_empty 错误（任务 4.2 契约）', async ({
    assert,
  }) => {
    const adapter = adapterWithClient('refusal-model', {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: '',
                  refusal: '该图片包含敏感信息，模型拒绝处理',
                },
              },
            ],
          }),
        },
      },
    })

    const result = await adapter.ocrPreview({
      imageDataUrl: 'data:image/png;base64,dGVzdA==',
    })

    assert.isFalse(result.ok)
    assert.equal(result.errorKind, 'model_refusal_or_empty')
    assert.include(result.errorMessage, '该图片包含敏感信息，模型拒绝处理')
  })

  test('空响应与缺失 choices 时返回可区分的 PROVIDER_MALFORMED_RESPONSE 错误（任务 4.2 契约）', async ({
    assert,
  }) => {
    const adapterEmptyChoices = adapterWithClient('empty-choices-model', {
      chat: {
        completions: {
          create: async () => ({ choices: [] }),
        },
      },
    })
    const resEmpty = await adapterEmptyChoices.ocrPreview({
      imageDataUrl: 'data:image/png;base64,dGVzdA==',
    })
    assert.isFalse(resEmpty.ok)
    assert.equal(resEmpty.errorKind, 'PROVIDER_MALFORMED_RESPONSE')
    assert.include(resEmpty.errorMessage, '缺失 choices')

    const adapterBlankContent = adapterWithClient('blank-content-model', {
      chat: {
        completions: {
          create: async () => ({ choices: [{ message: { content: '   ' } }] }),
        },
      },
    })
    const resBlank = await adapterBlankContent.ocrPreview({
      imageDataUrl: 'data:image/png;base64,dGVzdA==',
    })
    assert.isFalse(resBlank.ok)
    assert.equal(resBlank.errorKind, 'PROVIDER_MALFORMED_RESPONSE')
    assert.include(resBlank.errorMessage, '未包含任何可见文本内容')
  })
})
