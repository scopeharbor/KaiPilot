import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ConnectionsManager,
  formatTokenLimitInput,
  getOcrModelOptions,
  parseTokenLimitInput,
} from '@/components/ai/ConnectionsManager'
import { aiConnectionsApi, aiModelCatalogApi } from '@/lib/api/ai-connections'
import type { AiModelCapability } from '@aiproj/types'

vi.mock('@/lib/api/ai-connections', () => ({
  aiConnectionsApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    test: vi.fn(),
    previewOcr: vi.fn(),
  },
  aiModelCatalogApi: {
    search: vi.fn(),
    match: vi.fn(),
    provider: vi.fn(),
    refresh: vi.fn(),
  },
}))

const connectionCatalogDefaults = {
  catalogProviderId: null,
  catalogProviderName: null,
  catalogProviderLogoUrl: null,
  catalogProviderDocUrl: null,
  catalogProviderEnvKeys: [],
  catalogSyncedAt: null,
}

const modelCatalogDefaults = {
  catalogProviderId: null,
  catalogModelId: null,
  pricingSnapshotId: null,
  catalogMetadata: null,
  contextWindowTokens: null,
  maxInputTokens: null,
  maxOutputTokens: null,
  tokenLimitSource: null,
}

const activeConnection = {
  id: '2',
  organizationId: '1',
  displayName: '我的模型',
  protocol: 'openai_compatible' as const,
  baseUrl: 'https://api.openai.com/v1',
  ...connectionCatalogDefaults,
  model: 'gpt-4o',
  hasKey: true,
  keyHint: null,
  capabilities: null,
  toolCallingMode: 'prompt_json' as const,
  isActive: true,
  lastTestedAt: '2026-07-07T00:00:00.000Z',
  createdAt: '2026-07-07T00:00:00.000Z',
  updatedAt: null,
  models: [
    {
      id: '20',
      connectionId: '2',
      organizationId: '1',
      modelName: 'gpt-4o',
      capabilities: [
        'chat',
        'project_draft',
        'structured_output',
        'tool_calling',
      ] as AiModelCapability[],
      ...modelCatalogDefaults,
      rpmLimit: null,
      tpmLimit: null,
      isActive: true,
      lastTestedAt: null,
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: null,
    },
  ],
}

const inactiveConnection = {
  id: '1',
  organizationId: '1',
  displayName: '停用模型',
  protocol: 'openai_compatible' as const,
  baseUrl: 'https://api.openai.com/v1',
  ...connectionCatalogDefaults,
  model: 'gpt-5.4-mini',
  hasKey: true,
  keyHint: null,
  capabilities: null,
  toolCallingMode: 'prompt_json' as const,
  isActive: false,
  lastTestedAt: null,
  createdAt: '2026-07-07T00:00:00.000Z',
  updatedAt: null,
  models: [
    {
      id: '10',
      connectionId: '1',
      organizationId: '1',
      modelName: 'gpt-5.4-mini',
      capabilities: ['chat', 'project_draft'] as AiModelCapability[],
      ...modelCatalogDefaults,
      rpmLimit: null,
      tpmLimit: null,
      isActive: true,
      lastTestedAt: null,
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: null,
    },
  ],
}

const ocrConnection = {
  ...activeConnection,
  id: '3',
  displayName: '硅基流动',
  baseUrl: 'https://api.siliconflow.cn/v1',
  model: 'PaddlePaddle/PaddleOCR-VL-1.5',
  models: [
    {
      id: '30',
      connectionId: '3',
      organizationId: '1',
      modelName: 'PaddlePaddle/PaddleOCR-VL-1.5',
      capabilities: ['ocr', 'vision'] as AiModelCapability[],
      ...modelCatalogDefaults,
      rpmLimit: null,
      tpmLimit: null,
      isActive: true,
      lastTestedAt: null,
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: null,
    },
  ],
}

const catalogOpenAiModel = {
  id: 'gpt-4o-mini',
  name: 'GPT-4o mini',
  providerId: 'openai',
  providerName: 'OpenAI',
  providerApi: 'https://api.openai.com/v1',
  providerDocsUrl: 'https://platform.openai.com/docs',
  providerEnvKeys: ['OPENAI_API_KEY'],
  providerLogoUrl: 'https://models.dev/logos/openai.svg',
  npmPackage: '@ai-sdk/openai',
  protocol: 'openai_compatible' as const,
  supportLevel: 'one_click' as const,
  baseUrl: 'https://api.openai.com/v1',
  baseUrlNeedsManualEdit: false,
  family: 'gpt-4o',
  description: 'fast fixture model',
  modalities: { input: ['text', 'image'], output: ['text'] },
  capabilities: ['chat', 'vision', 'structured_output', 'tool_calling'] as AiModelCapability[],
  limit: { context: 128000, input: 128000, output: 16384 },
  cost: {
    input: 0.15,
    output: 0.6,
    cacheRead: 0.075,
    cacheWrite: 0.2,
    inputAudio: null,
    outputAudio: null,
    reasoning: null,
    contextOver200k: null,
    tiers: null,
  },
  knowledgeCutoff: '2024-10',
  releaseDate: '2024-07-18',
  lastUpdated: '2026-07-30',
  status: 'stable',
  attachment: true,
  reasoning: null,
  reasoningOptions: null,
  toolCall: true,
  structuredOutput: true,
  temperature: true,
  openWeights: false,
  weights: null,
  benchmarks: null,
  license: null,
  links: null,
  experimentalModes: null,
  providerOverride: null,
  pricingSnapshotId: null,
  rawModel: { _catalog: { sourceHash: 'openai-hash' } },
}

const catalogUnsupportedModel = {
  ...catalogOpenAiModel,
  id: 'bedrock-special',
  name: 'Bedrock Special',
  providerId: 'bedrock',
  providerName: 'AWS Bedrock',
  providerApi: '${BEDROCK_ENDPOINT}',
  providerDocsUrl: 'https://docs.aws.amazon.com/bedrock',
  providerEnvKeys: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
  providerLogoUrl: 'https://models.dev/logos/bedrock.svg',
  npmPackage: '@ai-sdk/amazon-bedrock',
  protocol: null,
  supportLevel: 'unsupported' as const,
  baseUrl: null,
  baseUrlNeedsManualEdit: true,
  limit: { context: 200000, input: 180000, output: 8000 },
  cost: {
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
    inputAudio: null,
    outputAudio: null,
    reasoning: null,
    contextOver200k: null,
    tiers: null,
  },
  rawModel: { _catalog: { sourceHash: 'bedrock-hash' } },
}

function renderManager(readOnly = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ConnectionsManager readOnly={readOnly} />
    </QueryClientProvider>,
  )
}

describe('token limit shorthand', () => {
  it('parses K/M suffixes, decimals, lowercase, and full numbers', () => {
    expect(parseTokenLimitInput('1M')).toBe(1_000_000)
    expect(parseTokenLimitInput('1.05m')).toBe(1_050_000)
    expect(parseTokenLimitInput('64K')).toBe(64_000)
    expect(parseTokenLimitInput('65.536k')).toBe(65_536)
    expect(parseTokenLimitInput('1,000,000')).toBe(1_000_000)
    expect(parseTokenLimitInput('invalid')).toBeNull()
  })

  it('formats token limits as readable K/M values', () => {
    expect(formatTokenLimitInput(1_000_000)).toBe('1M')
    expect(formatTokenLimitInput(900_000)).toBe('900K')
    expect(formatTokenLimitInput(65_536)).toBe('65.536K')
  })
})

describe('ConnectionsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(aiModelCatalogApi.search).mockResolvedValue({
      data: [],
      meta: {
        query: '',
        providerId: null,
        total: 0,
        stale: false,
        fetchedAt: '2026-07-30T00:00:00.000Z',
        expiresAt: '2026-07-30T06:00:00.000Z',
      },
    })
    vi.mocked(aiModelCatalogApi.match).mockResolvedValue({
      provider: null,
      model: null,
      candidates: [],
      stale: false,
    })
    vi.mocked(aiModelCatalogApi.refresh).mockResolvedValue({
      ok: true,
      stale: false,
      providerCount: 1,
      modelCount: 1,
      fetchedAt: '2026-07-30T00:00:00.000Z',
      expiresAt: '2026-07-30T06:00:00.000Z',
      sourceHash: 'test',
    })
  })

  describe('列表与加载', () => {
    it('加载中显示 loading 提示', () => {
      vi.mocked(aiConnectionsApi.list).mockReturnValue(new Promise(() => {}))
      renderManager()
      expect(screen.getByText('加载中…')).toBeInTheDocument()
    })

    it('加载失败显示错误', async () => {
      vi.mocked(aiConnectionsApi.list).mockRejectedValue(new Error('网络错误'))
      renderManager()
      await waitFor(() => {
        expect(screen.getByText(/加载失败/)).toBeInTheDocument()
      })
    })

    it('空列表显示引导文案', async () => {
      vi.mocked(aiConnectionsApi.list).mockResolvedValue([])
      renderManager()
      await waitFor(() => {
        expect(screen.getByText(/尚无连接/)).toBeInTheDocument()
      })
    })
  })

  describe('停用连接测试', () => {
    beforeEach(() => {
      vi.mocked(aiConnectionsApi.list).mockResolvedValue([inactiveConnection])
    })

    it('停用状态下提示先启用才可以测试，且不发起测试请求', async () => {
      renderManager()
      await screen.findByText('停用模型')
      fireEvent.click(screen.getByRole('button', { name: '测试' }))
      await waitFor(() => {
        expect(screen.getByText(/请你先启用之后才可以测试/)).toBeInTheDocument()
      })
      expect(aiConnectionsApi.test).not.toHaveBeenCalled()
    })
  })

  describe('激活连接测试', () => {
    beforeEach(() => {
      vi.mocked(aiConnectionsApi.list).mockResolvedValue([activeConnection])
    })

    it('测试成功显示连通结果与耗时', async () => {
      vi.mocked(aiConnectionsApi.test).mockResolvedValue({
        ok: true,
        latencyMs: 320,
        model: 'gpt-4o',
        detectedCapabilities: {
          supportsStrictSchema: true,
          supportsToolCalling: true,
          supportsStreamingTool: true,
        },
      })
      renderManager()
      await screen.findByText('我的模型')
      fireEvent.click(screen.getByRole('button', { name: '测试' }))
      await waitFor(() => {
        expect(screen.getByText(/已连通/)).toBeInTheDocument()
        expect(screen.getByText(/320ms/)).toBeInTheDocument()
      })
    })

    it('测试失败显示错误', async () => {
      vi.mocked(aiConnectionsApi.test).mockResolvedValue({
        ok: false,
        latencyMs: 5000,
        model: null,
        detectedCapabilities: {},
        errorKind: 'AI_SERVICE_ERROR',
        errorMessage: '连接超时',
      })
      renderManager()
      await screen.findByText('我的模型')
      fireEvent.click(screen.getByRole('button', { name: '测试' }))
      await waitFor(() => {
        expect(screen.getByText(/连接超时/)).toBeInTheDocument()
      })
    })

    it('测试抛出异常显示通用错误', async () => {
      vi.mocked(aiConnectionsApi.test).mockRejectedValue(new Error('网络异常'))
      renderManager()
      await screen.findByText('我的模型')
      fireEvent.click(screen.getByRole('button', { name: '测试' }))
      await waitFor(() => {
        expect(screen.getByText(/网络异常/)).toBeInTheDocument()
      })
    })
  })

  describe('models.dev 目录选择', () => {
    beforeEach(() => {
      vi.mocked(aiConnectionsApi.list).mockResolvedValue([])
      vi.mocked(aiConnectionsApi.create).mockResolvedValue(activeConnection)
    })

    it('连接表单覆盖固定顶栏，并在动态视口内独立滚动', async () => {
      renderManager()
      fireEvent.click(await screen.findByRole('button', { name: '新增连接' }))

      const dialog = screen.getByRole('dialog', { name: '新增连接' })
      expect(dialog.parentElement).toHaveClass('z-[var(--z-modal)]')
      expect(dialog).toHaveClass(
        'max-h-[calc(100dvh-1rem)]',
        'sm:max-h-[calc(100dvh-2rem)]',
        'overflow-y-auto',
        'overscroll-contain',
      )
    })

    it('手动新增模型预填 1M 前沿模型保守上下文限制', async () => {
      renderManager()
      fireEvent.click(await screen.findByRole('button', { name: '新增连接' }))

      expect(screen.getByLabelText('上下文窗口 token')).toHaveValue('1M')
      expect(screen.getByLabelText('最大输入 token')).toHaveValue('900K')
      expect(screen.getByLabelText('最大输出 token')).toHaveValue('65.536K')
      expect(screen.getByText('= 1,000,000 tokens')).toBeInTheDocument()
    })

    it('离开模型 ID 输入框时按 Base URL 与模型 ID 自动精确匹配目录', async () => {
      vi.mocked(aiModelCatalogApi.match).mockResolvedValueOnce({
        provider: null,
        model: catalogOpenAiModel,
        candidates: [catalogOpenAiModel],
        stale: false,
      })
      renderManager()
      fireEvent.click(await screen.findByRole('button', { name: '新增连接' }))
      fireEvent.change(screen.getByLabelText('Base URL(留空 = 该协议默认端点)'), {
        target: { value: 'https://api.openai.com/v1' },
      })
      const modelName = screen.getByLabelText('Model Name')
      fireEvent.change(modelName, { target: { value: 'gpt-4o-mini' } })
      fireEvent.blur(modelName)

      await waitFor(() => {
        expect(aiModelCatalogApi.match).toHaveBeenCalledWith({
          baseUrl: 'https://api.openai.com/v1',
          modelName: 'gpt-4o-mini',
          limit: 8,
        })
      })
      expect(await screen.findByText(/精确匹配/)).toBeInTheDocument()
      expect(screen.getAllByDisplayValue('128K')).toHaveLength(2)
      expect(screen.getByDisplayValue('16.384K')).toBeInTheDocument()
    })

    it('搜寻并选用目录模型后预填 Base URL、价格与上下文限制', async () => {
      vi.mocked(aiModelCatalogApi.search).mockResolvedValueOnce({
        data: [catalogOpenAiModel],
        meta: {
          query: 'OpenAI',
          providerId: null,
          total: 1,
          stale: false,
          fetchedAt: '2026-07-30T00:00:00.000Z',
          expiresAt: '2026-07-30T06:00:00.000Z',
        },
      })

      renderManager()
      fireEvent.click(await screen.findByRole('button', { name: '新增连接' }))
      fireEvent.change(screen.getByLabelText('搜寻供应商 / 模型'), {
        target: { value: 'OpenAI' },
      })
      fireEvent.click(screen.getByRole('button', { name: '搜寻' }))
      await screen.findByText('OpenAI / GPT-4o mini')
      fireEvent.click(screen.getByRole('button', { name: '选用' }))

      expect(screen.getByDisplayValue('OpenAI')).toBeInTheDocument()
      expect(screen.getByDisplayValue('gpt-4o-mini')).toBeInTheDocument()
      expect(screen.getByDisplayValue('https://api.openai.com/v1')).toBeInTheDocument()
      expect(screen.getAllByDisplayValue('128K')).toHaveLength(2)
      expect(screen.getByDisplayValue('16.384K')).toBeInTheDocument()
      expect(screen.getAllByText(/输入 \$0.15\/1M/).length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText(/知识截止 2024-10/).length).toBeGreaterThanOrEqual(1)

      fireEvent.change(screen.getByLabelText('最大输出 token'), { target: { value: '2.048K' } })
      fireEvent.blur(screen.getByLabelText('最大输出 token'))
      fireEvent.click(screen.getByRole('button', { name: '保存' }))

      await waitFor(() => {
        expect(aiConnectionsApi.create).toHaveBeenCalled()
      })
      expect(vi.mocked(aiConnectionsApi.create).mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          displayName: 'OpenAI',
          protocol: 'openai_compatible',
          baseUrl: 'https://api.openai.com/v1',
          catalogProviderId: 'openai',
          catalogProviderName: 'OpenAI',
          catalogProviderEnvKeys: ['OPENAI_API_KEY'],
          models: [
            expect.objectContaining({
              modelName: 'gpt-4o-mini',
              catalogProviderId: 'openai',
              catalogModelId: 'gpt-4o-mini',
              contextWindowTokens: 128000,
              maxInputTokens: 128000,
              maxOutputTokens: 2048,
              tokenLimitSource: 'manual',
            }),
          ],
        }),
      )
    })

    it('unsupported 供应商只载入资料，需手动填写 Base URL 才能保存', async () => {
      vi.mocked(aiModelCatalogApi.search).mockResolvedValueOnce({
        data: [catalogUnsupportedModel],
        meta: {
          query: 'Bedrock',
          providerId: null,
          total: 1,
          stale: false,
          fetchedAt: '2026-07-30T00:00:00.000Z',
          expiresAt: '2026-07-30T06:00:00.000Z',
        },
      })

      renderManager()
      fireEvent.click(await screen.findByRole('button', { name: '新增连接' }))
      fireEvent.change(screen.getByLabelText('搜寻供应商 / 模型'), {
        target: { value: 'Bedrock' },
      })
      fireEvent.click(screen.getByRole('button', { name: '搜寻' }))
      await screen.findByText('AWS Bedrock / Bedrock Special')
      fireEvent.click(screen.getByRole('button', { name: '选用' }))

      expect(screen.getByText(/需要手动确认协议与 Base URL/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()

      fireEvent.change(screen.getByLabelText('Base URL(留空 = 该协议默认端点)'), {
        target: { value: 'https://bedrock-proxy.example.com/v1' },
      })
      expect(screen.getByRole('button', { name: '保存' })).not.toBeDisabled()
    })
  })

  describe('编辑安全', () => {
    beforeEach(() => {
      vi.mocked(aiConnectionsApi.list).mockResolvedValue([activeConnection])
    })

    it('编辑连接时 API Key 字段不回显明文', async () => {
      renderManager()
      await screen.findByText('我的模型')
      fireEvent.click(screen.getByRole('button', { name: '编辑' }))
      const keyInput = screen.getByLabelText('API Key(留空 = 不变)') as HTMLInputElement
      expect(keyInput.type).toBe('password')
      expect(keyInput.value).toBe('')
    })
  })

  describe('readOnly 模式', () => {
    beforeEach(() => {
      vi.mocked(aiConnectionsApi.list).mockResolvedValue([activeConnection])
    })

    it('readOnly 模式下隐藏新增、编辑、删除、启停按钮', async () => {
      renderManager(true)
      await screen.findByText('我的模型')
      expect(screen.queryByText('+ 新增连接')).not.toBeInTheDocument()
      expect(screen.queryByText('编辑')).not.toBeInTheDocument()
      expect(screen.queryByText('删除')).not.toBeInTheDocument()
      expect(screen.queryByText('停用')).not.toBeInTheDocument()
      // 测试按钮始终可见
      expect(screen.getByRole('button', { name: '测试' })).toBeInTheDocument()
    })
  })

  describe('OCR 预览候选', () => {
    it('只列出启用且具备 OCR/vision 能力的模型', () => {
      expect(getOcrModelOptions([activeConnection, inactiveConnection, ocrConnection])).toEqual([
        expect.objectContaining({
          connectionId: '3',
          modelId: '30',
          label: '硅基流动 / PaddlePaddle/PaddleOCR-VL-1.5',
        }),
      ])
    })

    it('没有 OCR 模型时显示降级选项', async () => {
      vi.mocked(aiConnectionsApi.list).mockResolvedValue([activeConnection])
      renderManager()
      await screen.findByText('我的模型')
      expect(screen.getByText('没有可用 OCR 模型')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '运行 OCR' })).toBeDisabled()
    })

    it('上传图片后运行 OCR 并显示候选文本', async () => {
      vi.mocked(aiConnectionsApi.list).mockResolvedValue([activeConnection, ocrConnection])
      vi.mocked(aiConnectionsApi.previewOcr).mockResolvedValue({
        contractVersion: '1.0',
        status: 'succeeded',
        extractedText: '开项 OCR 测试 123',
        image: { mimeType: 'image/png', sizeBytes: 5 },
        provider: {
          provider: 'openai-compatible',
          model: 'PaddlePaddle/PaddleOCR-VL-1.5',
          latencyMs: 64504,
          usage: { totalTokens: 237 },
          usingRealAdapter: true,
        },
        warnings: [],
      })
      renderManager()
      await screen.findByText('硅基流动')

      const file = new File(['Hello'], 'ocr.png', { type: 'image/png' })
      fireEvent.change(screen.getByLabelText('图片'), { target: { files: [file] } })
      await screen.findByText(/已选择：ocr.png/)
      fireEvent.click(screen.getByRole('button', { name: '运行 OCR' }))

      await waitFor(() => {
        expect(aiConnectionsApi.previewOcr).toHaveBeenCalledWith(
          expect.objectContaining({
            connectionId: '3',
            modelId: '30',
            image: expect.objectContaining({ fileName: 'ocr.png' }),
          }),
        )
        expect(screen.getByText('开项 OCR 测试 123')).toBeInTheDocument()
        expect(screen.getByText(/Token 237/)).toBeInTheDocument()
      })
      expect(screen.queryByText(/写入|应用|同步/)).not.toBeInTheDocument()
    })

    it('OCR 失败时显示安全错误', async () => {
      vi.mocked(aiConnectionsApi.list).mockResolvedValue([ocrConnection])
      vi.mocked(aiConnectionsApi.previewOcr).mockRejectedValue(new Error('OCR 预览失败'))
      renderManager()
      await screen.findByText('硅基流动')

      const file = new File(['Hello'], 'ocr.png', { type: 'image/png' })
      fireEvent.change(screen.getByLabelText('图片'), { target: { files: [file] } })
      await screen.findByText(/已选择：ocr.png/)
      fireEvent.click(screen.getByRole('button', { name: '运行 OCR' }))

      await waitFor(() => {
        expect(screen.getByText('OCR 预览失败')).toBeInTheDocument()
      })
    })
  })
})
