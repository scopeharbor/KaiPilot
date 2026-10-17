'use client'

/**
 * ai-gateway-abstraction —— AI 连接管理共用组件(沙箱 + 正式页双轨复用)。
 *
 * 列表 / 新增 / 编辑 / 删除 / 启停 / 测连接。TanStack Query 驱动。
 * 红线:API key 字段 password,编辑时留空=不变;展示只 hasKey(永不回明文)。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ExternalLink, FileText, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  aiConnectionsApi,
  aiModelCatalogApi,
  type AiConnectionModelInput,
} from '@/lib/api/ai-connections'
import {
  AI_CONNECTION_PROTOCOLS,
  DEFAULT_AI_MODEL_CONTEXT_LIMITS,
  AI_MODEL_CAPABILITIES,
  OCR_PREVIEW_MAX_IMAGE_BYTES,
  type AiConnectionDto,
  type AiConnectionModelDto,
  type AiConnectionProtocol,
  type AiConnectionTestResult,
  type AiModelCatalogCost,
  type AiModelCatalogModelDto,
  type AiModelCatalogSearchResponse,
  type AiModelCapability,
  type AiModelTokenLimitSource,
  type OcrPreviewResult,
  modelHasOcrCapability,
  resolveAiModelContextLimits,
  validateOcrDataUrl,
} from '@aiproj/types'

type ModelInput = {
  modelName: string
  capabilities: AiModelCapability[]
  catalogProviderId: string | null
  catalogModelId: string | null
  pricingSnapshotId: string | null
  catalogMetadata: AiConnectionModelDto['catalogMetadata']
  contextWindowTokens: number | null
  maxInputTokens: number | null
  maxOutputTokens: number | null
  tokenLimitSource: AiModelTokenLimitSource | null
  rpmLimit: number | null
  tpmLimit: number | null
  isActive: boolean
}

/** 连接写入输入(对应后端 create/update validator)。 */
type ConnectionInput = {
  displayName: string
  protocol: AiConnectionProtocol
  model: string
  models: AiConnectionModelInput[]
  baseUrl?: string | null
  catalogProviderId?: string | null
  catalogProviderName?: string | null
  catalogProviderLogoUrl?: string | null
  catalogProviderDocUrl?: string | null
  catalogProviderEnvKeys?: string[]
  apiKey?: string
  isActive?: boolean
}

function errMsg(e: unknown, fallback: string): string {
  return (e as { message?: string })?.message ?? fallback
}

function formatUsage(result: AiConnectionTestResult): string {
  const usage = result.usage
  if (!usage) return ''
  const parts = [
    typeof usage.inputTokens === 'number' ? `输入 ${usage.inputTokens}` : null,
    typeof usage.outputTokens === 'number' ? `输出 ${usage.outputTokens}` : null,
    typeof usage.cacheReadTokens === 'number' ? `缓存命中 ${usage.cacheReadTokens}` : null,
    typeof usage.cacheWriteTokens === 'number' ? `缓存写入 ${usage.cacheWriteTokens}` : null,
    typeof usage.inputAudioTokens === 'number' ? `音频输入 ${usage.inputAudioTokens}` : null,
    typeof usage.outputAudioTokens === 'number' ? `音频输出 ${usage.outputAudioTokens}` : null,
    typeof usage.reasoningTokens === 'number' ? `推理 ${usage.reasoningTokens}` : null,
    typeof usage.totalTokens === 'number' ? `总计 ${usage.totalTokens}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? ` · Token ${parts.join(' / ')}` : ''
}

function protocolLabel(protocol: AiConnectionProtocol | null): string {
  if (protocol === 'openai_compatible') return 'OpenAI 兼容'
  if (protocol === 'anthropic_compatible') return 'Anthropic 兼容'
  return '需手动配置'
}

function supportLabel(
  model: Pick<AiModelCatalogModelDto, 'supportLevel' | 'baseUrlNeedsManualEdit'>,
) {
  if (model.supportLevel === 'one_click') return '可一键保存'
  if (model.supportLevel === 'manual' || model.baseUrlNeedsManualEdit) return '需处理 Base URL'
  return '仅浏览资料'
}

function formatTokens(value: number | null | undefined): string {
  if (!value) return '未知'
  if (value >= 1_000_000) return `${value / 1_000_000}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(value)
}

export function parseTokenLimitInput(value: string): number | null {
  const normalized = value.trim().replaceAll(',', '').toUpperCase()
  if (!normalized) return null
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*([KM]?)$/)
  if (!match) return null
  const amount = Number(match[1])
  const multiplier = match[2] === 'M' ? 1_000_000 : match[2] === 'K' ? 1_000 : 1
  const tokens = Math.round(amount * multiplier)
  return Number.isSafeInteger(tokens) && tokens > 0 ? tokens : null
}

export function formatTokenLimitInput(value: number | null | undefined): string {
  if (!value) return ''
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(3))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(3))}K`
  return String(value)
}

function TokenLimitField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number | null
  onCommit: (value: number | null) => void
}) {
  const [draft, setDraft] = useState(() => formatTokenLimitInput(value))
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    setDraft(formatTokenLimitInput(value))
    setInvalid(false)
  }, [value])

  const commit = () => {
    if (!draft.trim()) {
      setInvalid(false)
      onCommit(null)
      return
    }
    const parsed = parseTokenLimitInput(draft)
    if (parsed === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setDraft(formatTokenLimitInput(parsed))
    onCommit(parsed)
  }

  const preview = parseTokenLimitInput(draft)
  return (
    <Field label={label}>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        className={INP}
        placeholder="例如 1M、900K、65536"
        value={draft}
        aria-invalid={invalid}
        onChange={(event) => {
          setDraft(event.target.value)
          setInvalid(false)
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
        }}
      />
      <span className={`mt-1 block text-[11px] ${invalid ? 'text-rose-600' : 'text-slate-400'}`}>
        {invalid
          ? '请输入正整数，或使用 K / M，例如 64K、1M。'
          : preview
            ? `= ${preview.toLocaleString()} tokens`
            : '留空表示未知'}
      </span>
    </Field>
  )
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '未知'
  return value
}

function formatPrice(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '未知'
  return `$${value}/1M`
}

function priceRows(cost: AiModelCatalogCost | null | undefined) {
  return [
    ['输入', cost?.input],
    ['输出', cost?.output],
    ['缓存命中', cost?.cacheRead],
    ['缓存写入', cost?.cacheWrite],
    ['音频输入', cost?.inputAudio],
    ['音频输出', cost?.outputAudio],
    ['推理', cost?.reasoning],
  ] as const
}

function hasKnownPrice(cost: AiModelCatalogCost | null | undefined): boolean {
  return priceRows(cost).some(([, price]) => typeof price === 'number' && Number.isFinite(price))
}

function recordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return (value as Record<string, unknown>)[key] ?? null
}

function catalogSourceHash(model: AiModelCatalogModelDto): string | undefined {
  const catalog = recordValue(model.rawModel, '_catalog')
  const sourceHash = recordValue(catalog, 'sourceHash')
  return typeof sourceHash === 'string' ? sourceHash : undefined
}

function catalogMetadata(
  model: AiModelCatalogModelDto,
): NonNullable<ModelInput['catalogMetadata']> {
  return {
    providerName: model.providerName,
    modelName: model.name,
    logoUrl: model.providerLogoUrl,
    docsUrl: model.providerDocsUrl,
    envKeys: model.providerEnvKeys,
    protocol: model.protocol,
    supportLevel: model.supportLevel,
    baseUrl: model.baseUrl,
    baseUrlNeedsManualEdit: model.baseUrlNeedsManualEdit,
    cost: model.cost,
    limit: model.limit,
    knowledgeCutoff: model.knowledgeCutoff,
    releaseDate: model.releaseDate,
    lastUpdated: model.lastUpdated,
    status: model.status,
    modalities: model.modalities,
    sourceHash: catalogSourceHash(model),
  }
}

function pricingId(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function toApiModel(model: ModelInput): AiConnectionModelInput {
  return {
    modelName: model.modelName.trim(),
    capabilities: model.capabilities,
    catalogProviderId: model.catalogProviderId,
    catalogModelId: model.catalogModelId,
    pricingSnapshotId: pricingId(model.pricingSnapshotId),
    catalogMetadata: model.catalogMetadata,
    contextWindowTokens: model.contextWindowTokens,
    maxInputTokens: model.maxInputTokens,
    maxOutputTokens: model.maxOutputTokens,
    tokenLimitSource: model.tokenLimitSource,
    rpmLimit: model.rpmLimit,
    tpmLimit: model.tpmLimit,
    isActive: model.isActive,
  }
}

function toModelInput(model: AiConnectionModelDto): ModelInput {
  return {
    modelName: model.modelName,
    capabilities: model.capabilities.length > 0 ? model.capabilities : DEFAULT_CAPABILITIES,
    catalogProviderId: model.catalogProviderId,
    catalogModelId: model.catalogModelId,
    pricingSnapshotId: model.pricingSnapshotId,
    catalogMetadata: model.catalogMetadata,
    contextWindowTokens: model.contextWindowTokens,
    maxInputTokens: model.maxInputTokens,
    maxOutputTokens: model.maxOutputTokens,
    tokenLimitSource: model.tokenLimitSource,
    rpmLimit: model.rpmLimit,
    tpmLimit: model.tpmLimit,
    isActive: model.isActive,
  }
}

export const capabilityLabels: Record<AiModelCapability, string> = {
  chat: '聊天/问答',
  project_draft: '项目草案',
  ocr: 'OCR',
  vision: '图片理解',
  document_understanding: '文件理解',
  audio_input: '语音输入',
  speech_output: '语音输出',
  video_input: '视频理解',
  image_generation: '图片生成',
  structured_output: '结构化输出',
  tool_calling: '工具调用',
  embeddings: '向量嵌入',
  rerank: '重排',
  moderation: '内容安全',
  realtime_voice: '实时语音',
}

const DEFAULT_CAPABILITIES: AiModelCapability[] = [
  'chat',
  'project_draft',
  'structured_output',
  'tool_calling',
]

const QUERY_KEY = ['ai-connections'] as const
const INP = 'w-full rounded border border-slate-300 p-2 text-sm disabled:bg-slate-50'
const ENABLE_BEFORE_TEST_MESSAGE = '请你先启用之后才可以测试'

export interface ConnectionsManagerProps {
  /** 只读模式(无 manage 权限时):隐藏新增/编辑/删除/启停,仅展示+测试。 */
  readOnly?: boolean
}

export function ConnectionsManager({ readOnly = false }: ConnectionsManagerProps) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: QUERY_KEY, queryFn: aiConnectionsApi.list })
  const [editing, setEditing] = useState<AiConnectionDto | 'new' | null>(null)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testResult, setTestResult] = useState<Record<number, AiConnectionTestResult | undefined>>(
    {},
  )

  const invalidate = () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  const create = useMutation({
    mutationFn: aiConnectionsApi.create,
    onSuccess: () => {
      invalidate()
      setEditing(null)
    },
  })
  const update = useMutation({
    mutationFn: (a: { id: number; input: ConnectionInput }) =>
      aiConnectionsApi.update(a.id, a.input),
    onSuccess: () => {
      invalidate()
      setEditing(null)
    },
  })
  const remove = useMutation({ mutationFn: aiConnectionsApi.delete, onSuccess: invalidate })
  const toggle = useMutation({
    mutationFn: (a: { id: number; isActive: boolean }) =>
      aiConnectionsApi.update(a.id, { isActive: a.isActive }),
    onSuccess: invalidate,
  })

  async function onTest(connection: AiConnectionDto) {
    const id = Number(connection.id)
    const modelName = connection.models[0]?.modelName ?? connection.model
    if (!connection.isActive) {
      setTestResult((p) => ({
        ...p,
        [id]: {
          ok: false,
          latencyMs: 0,
          model: modelName,
          detectedCapabilities: {},
          errorKind: 'VALIDATION_ERROR',
          errorMessage: ENABLE_BEFORE_TEST_MESSAGE,
        },
      }))
      return
    }
    setTestingId(id)
    try {
      const r = await aiConnectionsApi.test(id)
      setTestResult((p) => ({ ...p, [id]: r }))
    } catch (e) {
      setTestResult((p) => ({
        ...p,
        [id]: {
          ok: false,
          latencyMs: 0,
          model: null,
          detectedCapabilities: {},
          errorKind: 'AI_SERVICE_ERROR',
          errorMessage: errMsg(e, '测试失败'),
        },
      }))
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">AI 模型连接</h2>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="inline-flex items-center gap-1.5 rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-900"
          >
            <Plus className="h-4 w-4" />
            新增连接
          </button>
        )}
      </div>

      {list.isLoading && <p className="text-sm text-slate-500">加载中…</p>}
      {list.error && (
        <p className="text-sm text-rose-600">加载失败:{errMsg(list.error, '未知错误')}</p>
      )}

      <ul className="space-y-2">
        {list.data?.map((c) => (
          <li key={c.id} className="rounded border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-2">
                <div className="flex items-center gap-2">
                  {c.catalogProviderLogoUrl && (
                    <img
                      src={c.catalogProviderLogoUrl}
                      alt={c.catalogProviderName ?? c.displayName}
                      className="h-5 w-5 shrink-0 rounded-sm"
                    />
                  )}
                  <div className="font-medium text-slate-800">
                    {c.displayName}{' '}
                    {!c.isActive && <span className="text-xs text-slate-400">(已停用)</span>}
                  </div>
                </div>
                <div className="truncate text-xs text-slate-500">
                  {protocolLabel(c.protocol)} · {c.catalogProviderName ?? '未绑定目录'} ·{' '}
                  {c.baseUrl ?? '默认端点'} · {c.hasKey ? '已设 key' : '未设 key'}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(c.models.length > 0
                    ? c.models
                    : [
                        {
                          id: `${c.id}-legacy`,
                          modelName: c.model,
                          capabilities: DEFAULT_CAPABILITIES,
                          catalogProviderId: null,
                          catalogModelId: null,
                          pricingSnapshotId: null,
                          catalogMetadata: null,
                          contextWindowTokens: null,
                          maxInputTokens: null,
                          maxOutputTokens: null,
                          tokenLimitSource: null,
                          rpmLimit: null,
                          tpmLimit: null,
                          isActive: c.isActive,
                        },
                      ]
                  ).map((model) => (
                    <span
                      key={model.id}
                      className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600"
                    >
                      {model.modelName}
                      {model.catalogProviderId ? ` · ${model.catalogProviderId}` : ''}
                      {model.contextWindowTokens
                        ? ` · 上下文 ${formatTokens(model.contextWindowTokens)}`
                        : ''}
                      {model.pricingSnapshotId ? ' · 已快照价格' : ''}
                      {!model.isActive ? ' · 停用' : ''}
                      {model.rpmLimit ? ` · RPM ${model.rpmLimit}` : ''}
                      {model.tpmLimit ? ` · TPM ${model.tpmLimit}` : ''}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => onTest(c)}
                  disabled={testingId === Number(c.id)}
                  className="rounded border px-2 py-1 hover:bg-slate-50 disabled:opacity-50"
                >
                  {testingId === Number(c.id) ? '测试中...' : '测试'}
                </button>
                {!readOnly && (
                  <>
                    <button
                      type="button"
                      onClick={() => toggle.mutate({ id: Number(c.id), isActive: !c.isActive })}
                      className="rounded border px-2 py-1 hover:bg-slate-50"
                    >
                      {c.isActive ? '停用' : '启用'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(c)}
                      className="rounded border px-2 py-1 hover:bg-slate-50"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm('删除该连接?')) remove.mutate(Number(c.id))
                      }}
                      className="rounded border px-2 py-1 text-rose-600 hover:bg-rose-50"
                    >
                      删除
                    </button>
                  </>
                )}
              </div>
            </div>
            {testResult[Number(c.id)] && (
              <div
                className={`mt-2 rounded p-2 text-xs ${
                  testResult[Number(c.id)]!.ok
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-rose-50 text-rose-700'
                }`}
              >
                {testResult[Number(c.id)]!.ok
                  ? `已连通 · ${testResult[Number(c.id)]!.latencyMs}ms · ${testResult[Number(c.id)]!.model}${formatUsage(testResult[Number(c.id)]!)}`
                  : `${testResult[Number(c.id)]!.errorMessage ?? testResult[Number(c.id)]!.errorKind}`}
              </div>
            )}
          </li>
        ))}
        {list.data?.length === 0 && (
          <li className="rounded border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            尚无连接,点「新增连接」添加你的第一个 AI 模型。
          </li>
        )}
      </ul>

      {editing && !readOnly && (
        <ConnectionForm
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={(input) => {
            if (editing === 'new') create.mutate(input)
            else update.mutate({ id: Number(editing.id), input })
          }}
          submitting={create.isPending || update.isPending}
          error={errMsg(create.error, '') || errMsg(update.error, '')}
        />
      )}

      <OcrPreviewPanel connections={list.data ?? []} />
    </div>
  )
}

type OcrModelOption = {
  key: string
  connectionId: string
  modelId: string
  label: string
  model: AiConnectionModelDto
}

export function getOcrModelOptions(connections: AiConnectionDto[]): OcrModelOption[] {
  return connections.flatMap((connection) => {
    if (!connection.isActive || !connection.hasKey) return []
    return connection.models
      .filter((model) => model.isActive && modelHasOcrCapability(model.capabilities))
      .map((model) => ({
        key: `${connection.id}:${model.id}`,
        connectionId: connection.id,
        modelId: model.id,
        label: `${connection.displayName} / ${model.modelName}`,
        model,
      }))
  })
}

function OcrPreviewPanel({ connections }: { connections: AiConnectionDto[] }) {
  const options = useMemo(() => getOcrModelOptions(connections), [connections])
  const [selectedKey, setSelectedKey] = useState('')
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<OcrPreviewResult | null>(null)
  const selected = options.find((option) => option.key === (selectedKey || options[0]?.key))
  const preview = useMutation({
    mutationFn: () => {
      if (!selected || !dataUrl) throw new Error('请选择 OCR 模型和图片')
      return aiConnectionsApi.previewOcr({
        connectionId: selected.connectionId,
        modelId: selected.modelId,
        image: { dataUrl, fileName },
      })
    },
    onSuccess: (next) => {
      setResult(next)
      setError(null)
    },
    onError: (e) => {
      setError(errMsg(e, 'OCR 预览失败'))
      setResult(null)
    },
  })

  function onFile(file: File | undefined) {
    setResult(null)
    setError(null)
    setDataUrl(null)
    setFileName(null)
    if (!file) return
    if (file.size > OCR_PREVIEW_MAX_IMAGE_BYTES) {
      setError('图片过大，请选择 2MB 以内的 PNG、JPG 或 WebP')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const nextDataUrl = String(reader.result ?? '')
      const validation = validateOcrDataUrl(nextDataUrl)
      if (!validation.ok) {
        setError('图片格式无效，请选择 PNG、JPG 或 WebP')
        return
      }
      setDataUrl(nextDataUrl)
      setFileName(file.name)
    }
    reader.onerror = () => setError('图片读取失败')
    reader.readAsDataURL(file)
  }

  return (
    <section className="space-y-3 border-t border-slate-200 pt-4">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-slate-600" />
        <h3 className="text-sm font-semibold text-slate-800">OCR 预览候选</h3>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <Field label="OCR 模型">
          <select
            className={INP}
            value={selected?.key ?? ''}
            onChange={(e) => setSelectedKey(e.target.value)}
            disabled={options.length === 0}
          >
            {options.length === 0 ? (
              <option value="">没有可用 OCR 模型</option>
            ) : (
              options.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))
            )}
          </select>
        </Field>
        <Field label="图片">
          <input
            className={INP}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => onFile(event.target.files?.[0])}
          />
        </Field>
        <button
          type="button"
          onClick={() => preview.mutate()}
          disabled={!selected || !dataUrl || preview.isPending}
          className="mt-5 h-9 rounded bg-slate-800 px-3 text-sm text-white disabled:bg-slate-400"
        >
          {preview.isPending ? '识别中...' : '运行 OCR'}
        </button>
      </div>
      {fileName && <p className="text-xs text-slate-500">已选择：{fileName}</p>}
      {error && <div className="rounded bg-rose-50 p-2 text-xs text-rose-700">{error}</div>}
      {result && (
        <div className="rounded border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 text-xs text-slate-500">
            {result.provider.provider} · {result.provider.model} · {result.provider.latencyMs}ms
            {result.provider.usage?.totalTokens
              ? ` · Token ${result.provider.usage.totalTokens}`
              : ''}
          </div>
          <pre className="max-h-48 whitespace-pre-wrap rounded bg-white p-3 text-sm text-slate-800">
            {result.extractedText}
          </pre>
        </div>
      )}
    </section>
  )
}

function blankModel(): ModelInput {
  return {
    modelName: '',
    capabilities: DEFAULT_CAPABILITIES,
    catalogProviderId: null,
    catalogModelId: null,
    pricingSnapshotId: null,
    catalogMetadata: null,
    contextWindowTokens: DEFAULT_AI_MODEL_CONTEXT_LIMITS.contextWindowTokens,
    maxInputTokens: DEFAULT_AI_MODEL_CONTEXT_LIMITS.maxInputTokens,
    maxOutputTokens: DEFAULT_AI_MODEL_CONTEXT_LIMITS.maxOutputTokens,
    tokenLimitSource: null,
    rpmLimit: null,
    tpmLimit: null,
    isActive: true,
  }
}

function ConnectionForm({
  initial,
  onClose,
  onSubmit,
  submitting,
  error,
}: {
  initial: AiConnectionDto | null
  onClose: () => void
  onSubmit: (input: ConnectionInput) => void
  submitting: boolean
  error?: string
}) {
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '')
  const [protocol, setProtocol] = useState<AiConnectionProtocol>(
    initial?.protocol ?? 'openai_compatible',
  )
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<ModelInput[]>(
    initial
      ? initial.models.length > 0
        ? initial.models.map(toModelInput)
        : [{ ...blankModel(), modelName: initial.model }]
      : [blankModel()],
  )
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  const [catalogQuery, setCatalogQuery] = useState(
    initial?.catalogProviderName ?? initial?.models[0]?.catalogProviderId ?? '',
  )
  const [catalogProviderId, setCatalogProviderId] = useState(initial?.catalogProviderId ?? '')
  const [catalogResults, setCatalogResults] = useState<AiModelCatalogModelDto[]>([])
  const [catalogMeta, setCatalogMeta] = useState<AiModelCatalogSearchResponse['meta'] | null>(null)
  const [catalogNotice, setCatalogNotice] = useState<string | null>(null)

  const validModels = models.filter((model) => model.modelName.trim().length > 0)
  const requiresManualConfig = validModels.some(
    (model) =>
      model.catalogMetadata?.supportLevel && model.catalogMetadata.supportLevel !== 'one_click',
  )
  const canSave =
    Boolean(displayName.trim()) &&
    validModels.length > 0 &&
    (!requiresManualConfig || Boolean(baseUrl.trim()))

  const catalogSearch = useMutation({
    mutationFn: () =>
      aiModelCatalogApi.search({
        q: catalogQuery.trim(),
        providerId: catalogProviderId.trim() || null,
        limit: 18,
      }),
    onSuccess: (result) => {
      setCatalogResults(result.data)
      setCatalogMeta(result.meta)
      setCatalogNotice(
        result.meta.stale ? '目前使用的是过期目录快照，仍可选择，建议有权限时手动刷新。' : null,
      )
    },
    onError: (e) => {
      setCatalogResults([])
      setCatalogMeta(null)
      setCatalogNotice(errMsg(e, '目录搜索失败'))
    },
  })

  const catalogMatch = useMutation({
    mutationFn: ({ index }: { index: number; automatic: boolean }) =>
      aiModelCatalogApi.match({
        baseUrl: baseUrl.trim() || null,
        modelName: models[index]?.modelName.trim() || null,
        limit: 8,
      }),
    onSuccess: (result, request) => {
      setCatalogResults(result.candidates)
      setCatalogMeta(null)
      if (result.model) {
        applyCatalogModel(result.model, request.index)
        setCatalogNotice('已按供应商端点和模型 ID 精确匹配，并预填目录限制。')
      } else {
        setCatalogNotice(
          result.candidates.length > 0
            ? '找到相似候选，但供应商端点与模型 ID 未同时精确命中，请手动确认。'
            : request.automatic
              ? 'models.dev 没有精确记录，继续使用 1M 通用预设。'
              : '没有找到足够可靠的匹配。',
        )
      }
    },
    onError: (e) => {
      setCatalogResults([])
      setCatalogMeta(null)
      setCatalogNotice(errMsg(e, '自动匹配失败'))
    },
  })

  const catalogRefresh = useMutation({
    mutationFn: () => aiModelCatalogApi.refresh(true),
    onSuccess: (result) => {
      setCatalogNotice(
        `目录已刷新：${result.providerCount} 个供应商，${result.modelCount} 个模型。`,
      )
      catalogSearch.mutate()
    },
    onError: (e) => setCatalogNotice(errMsg(e, '刷新目录失败')),
  })

  function applyCatalogModel(catalogModel: AiModelCatalogModelDto, index = 0) {
    setDisplayName((current) => current.trim() || catalogModel.providerName)
    if (catalogModel.protocol && catalogModel.supportLevel === 'one_click') {
      setProtocol(catalogModel.protocol)
    }
    if (catalogModel.baseUrl && catalogModel.supportLevel === 'one_click') {
      setBaseUrl(catalogModel.baseUrl)
    }
    setCatalogQuery(`${catalogModel.providerName} ${catalogModel.name}`)
    setCatalogProviderId(catalogModel.providerId)
    setCatalogNotice(
      catalogModel.supportLevel === 'one_click'
        ? '已预填供应商、Base URL、模型、价格和上下文限制。'
        : '已载入目录资料；这个供应商需要手动确认协议与 Base URL 后再保存。',
    )
    setModels((current) => {
      const next = current.length > 0 ? [...current] : [blankModel()]
      const existing = next[index] ?? blankModel()
      const resolvedLimits = resolveAiModelContextLimits(catalogModel.limit)
      next[index] = {
        ...existing,
        modelName: catalogModel.id,
        capabilities:
          catalogModel.capabilities.length > 0 ? catalogModel.capabilities : existing.capabilities,
        catalogProviderId: catalogModel.providerId,
        catalogModelId: catalogModel.id,
        pricingSnapshotId: catalogModel.pricingSnapshotId,
        catalogMetadata: catalogMetadata(catalogModel),
        contextWindowTokens: resolvedLimits.contextWindowTokens,
        maxInputTokens: resolvedLimits.maxInputTokens,
        maxOutputTokens: resolvedLimits.maxOutputTokens,
        tokenLimitSource: 'catalog',
      }
      return next
    })
  }

  const submit = () => {
    if (validModels.length === 0) return
    const firstModel = validModels[0]
    if (!firstModel) return
    const input: ConnectionInput = {
      displayName: displayName.trim(),
      protocol,
      model: firstModel.modelName.trim(),
      models: validModels.map((model) =>
        toApiModel({
          ...model,
          capabilities: model.capabilities.length > 0 ? model.capabilities : DEFAULT_CAPABILITIES,
        }),
      ),
      isActive,
      baseUrl: baseUrl.trim() ? baseUrl.trim() : null,
      catalogProviderId: firstModel.catalogProviderId,
      catalogProviderName: firstModel.catalogMetadata?.providerName ?? null,
      catalogProviderLogoUrl: firstModel.catalogMetadata?.logoUrl ?? null,
      catalogProviderDocUrl: firstModel.catalogMetadata?.docsUrl ?? null,
      catalogProviderEnvKeys: firstModel.catalogMetadata?.envKeys ?? [],
    }
    if (apiKey.trim()) input.apiKey = apiKey.trim()
    onSubmit(input)
  }

  const updateModel = (index: number, patch: Partial<ModelInput>) => {
    setModels((current) =>
      current.map((model, i) => (i === index ? { ...model, ...patch } : model)),
    )
  }

  const updateTokenLimit = (
    index: number,
    field: 'contextWindowTokens' | 'maxInputTokens' | 'maxOutputTokens',
    value: number | null,
  ) => {
    updateModel(index, {
      [field]: value,
      tokenLimitSource: 'manual',
    })
  }

  const setTokenLimitSource = (index: number, source: AiModelTokenLimitSource | null) => {
    const model = models[index]
    if (!model) return
    const limit = model.catalogMetadata?.limit
    const resolvedLimits = source === 'catalog' ? resolveAiModelContextLimits(limit) : null
    updateModel(index, {
      tokenLimitSource: source,
      contextWindowTokens:
        source === 'catalog'
          ? (resolvedLimits?.contextWindowTokens ?? null)
          : model.contextWindowTokens,
      maxInputTokens:
        source === 'catalog' ? (resolvedLimits?.maxInputTokens ?? null) : model.maxInputTokens,
      maxOutputTokens:
        source === 'catalog' ? (resolvedLimits?.maxOutputTokens ?? null) : model.maxOutputTokens,
    })
  }

  const toggleCapability = (index: number, capability: AiModelCapability) => {
    const model = models[index]
    if (!model) return
    const has = model.capabilities.includes(capability)
    updateModel(index, {
      capabilities: has
        ? model.capabilities.filter((item) => item !== capability)
        : [...model.capabilities, capability],
    })
  }

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--overlay)] p-2 sm:p-4"
      role="presentation"
    >
      <div
        className="max-h-[calc(100dvh-1rem)] w-full max-w-3xl space-y-4 overflow-y-auto overscroll-contain rounded bg-white p-4 shadow-lg sm:max-h-[calc(100dvh-2rem)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-connection-form-title"
      >
        <h3 id="ai-connection-form-title" className="font-medium text-slate-800">
          {initial ? '编辑连接' : '新增连接'}
        </h3>

        <section className="space-y-3 rounded border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium text-slate-700">models.dev 目录</h4>
            <button
              type="button"
              onClick={() => catalogRefresh.mutate()}
              disabled={catalogRefresh.isPending}
              className="inline-flex h-8 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              title="刷新目录"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {catalogRefresh.isPending ? '刷新中' : '刷新'}
            </button>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_150px_auto_auto]">
            <Field label="搜寻供应商 / 模型">
              <input
                className={INP}
                placeholder="OpenAI、火山引擎、腾讯云、DeepSeek..."
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    catalogSearch.mutate()
                  }
                }}
              />
            </Field>
            <Field label="供应商 ID">
              <input
                className={INP}
                placeholder="可选"
                value={catalogProviderId}
                onChange={(e) => setCatalogProviderId(e.target.value)}
              />
            </Field>
            <button
              type="button"
              onClick={() => catalogSearch.mutate()}
              disabled={catalogSearch.isPending}
              className="mt-5 inline-flex h-9 items-center justify-center gap-1 rounded bg-slate-800 px-3 text-sm text-white disabled:bg-slate-400"
            >
              <Search className="h-4 w-4" />
              {catalogSearch.isPending ? '搜寻中' : '搜寻'}
            </button>
            <button
              type="button"
              onClick={() => catalogMatch.mutate({ index: 0, automatic: false })}
              disabled={catalogMatch.isPending || (!baseUrl.trim() && !models[0]?.modelName.trim())}
              className="mt-5 inline-flex h-9 items-center justify-center gap-1 rounded border bg-white px-3 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              <Search className="h-4 w-4" />
              匹配现有
            </button>
          </div>
          {catalogNotice && (
            <div className="rounded bg-white px-2 py-1.5 text-xs text-slate-600">
              {catalogNotice}
            </div>
          )}
          {catalogMeta && (
            <div className="text-xs text-slate-500">
              结果 {catalogMeta.total} · 快照 {catalogMeta.fetchedAt ?? '未知'}
              {catalogMeta.stale ? ' · 已过期' : ''}
            </div>
          )}
          {catalogResults.length > 0 && (
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {catalogResults.map((catalogModel) => (
                <div
                  key={`${catalogModel.providerId}:${catalogModel.id}`}
                  className="rounded border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <img
                          src={catalogModel.providerLogoUrl}
                          alt={catalogModel.providerName}
                          className="h-5 w-5 shrink-0 rounded-sm"
                        />
                        <div className="min-w-0 truncate text-sm font-medium text-slate-800">
                          {catalogModel.providerName} / {catalogModel.name}
                        </div>
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                          {supportLabel(catalogModel)}
                        </span>
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {catalogModel.id} · {protocolLabel(catalogModel.protocol)} ·{' '}
                        {catalogModel.baseUrl ?? 'Base URL 需手动填写'}
                      </div>
                      <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-600">
                        <span className="rounded bg-slate-50 px-1.5 py-0.5">
                          上下文 {formatTokens(catalogModel.limit.context)}
                        </span>
                        <span className="rounded bg-slate-50 px-1.5 py-0.5">
                          输入 {formatTokens(catalogModel.limit.input)}
                        </span>
                        <span className="rounded bg-slate-50 px-1.5 py-0.5">
                          输出 {formatTokens(catalogModel.limit.output)}
                        </span>
                        <span className="rounded bg-slate-50 px-1.5 py-0.5">
                          知识截止 {formatDate(catalogModel.knowledgeCutoff)}
                        </span>
                        <span className="rounded bg-slate-50 px-1.5 py-0.5">
                          更新 {formatDate(catalogModel.lastUpdated)}
                        </span>
                        {catalogModel.status && (
                          <span className="rounded bg-slate-50 px-1.5 py-0.5">
                            {catalogModel.status}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                        {priceRows(catalogModel.cost).map(([label, value]) => (
                          <span key={label} className="rounded bg-slate-50 px-1.5 py-0.5">
                            {label} {formatPrice(value)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      {catalogModel.providerDocsUrl && (
                        <a
                          href={catalogModel.providerDocsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
                        >
                          文档
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => applyCatalogModel(catalogModel)}
                        className="rounded bg-slate-800 px-2.5 py-1 text-xs text-white hover:bg-slate-900"
                      >
                        选用
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="显示名称">
            <input
              className={INP}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
          <Field label="协议">
            <select
              className={INP}
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as AiConnectionProtocol)}
            >
              {AI_CONNECTION_PROTOCOLS.map((p) => (
                <option key={p} value={p}>
                  {p === 'openai_compatible' ? 'OpenAI 兼容' : 'Anthropic 兼容'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Base URL(留空 = 该协议默认端点)">
            <input
              className={INP}
              placeholder={
                protocol === 'openai_compatible'
                  ? 'https://api.openai.com/v1'
                  : 'https://api.anthropic.com'
              }
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </Field>
          <Field label={`API Key${initial ? '(留空 = 不变)' : ''}`}>
            <input
              type="password"
              className={INP}
              placeholder={initial ? '留空不改' : 'sk-...'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
          </Field>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-slate-700">模型</h4>
            <button
              type="button"
              onClick={() => setModels((current) => [...current, blankModel()])}
              className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" />
              添加模型
            </button>
          </div>

          {models.map((model, index) => (
            <div key={index} className="rounded border border-slate-200 p-3">
              <div className="grid gap-3 md:grid-cols-[1fr_110px_110px_auto_auto]">
                <Field label="Model Name">
                  <input
                    className={INP}
                    placeholder={
                      protocol === 'openai_compatible'
                        ? 'gpt-4o-2024-08-06'
                        : 'claude-haiku-4-5-20251001'
                    }
                    value={model.modelName}
                    onChange={(e) => updateModel(index, { modelName: e.target.value })}
                    onBlur={() => {
                      if (
                        model.modelName.trim() &&
                        baseUrl.trim() &&
                        model.tokenLimitSource !== 'manual'
                      ) {
                        catalogMatch.mutate({ index, automatic: true })
                      }
                    }}
                  />
                </Field>
                <Field label="RPM">
                  <input
                    type="number"
                    min={1}
                    className={INP}
                    placeholder="不限"
                    value={model.rpmLimit ?? ''}
                    onChange={(e) =>
                      updateModel(index, {
                        rpmLimit: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                </Field>
                <Field label="TPM">
                  <input
                    type="number"
                    min={1}
                    className={INP}
                    placeholder="不限"
                    value={model.tpmLimit ?? ''}
                    onChange={(e) =>
                      updateModel(index, {
                        tpmLimit: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                </Field>
                <label className="mt-6 flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={model.isActive}
                    onChange={(e) => updateModel(index, { isActive: e.target.checked })}
                  />
                  启用
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setModels((current) =>
                      current.length === 1 ? current : current.filter((_, i) => i !== index),
                    )
                  }
                  disabled={models.length === 1}
                  className="mt-5 inline-flex h-9 items-center justify-center rounded border px-2 text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                  title="删除模型"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {model.catalogMetadata && (
                <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {model.catalogMetadata.logoUrl && (
                      <img
                        src={model.catalogMetadata.logoUrl}
                        alt={model.catalogMetadata.providerName ?? model.catalogProviderId ?? ''}
                        className="h-5 w-5 rounded-sm"
                      />
                    )}
                    <span className="text-sm font-medium text-slate-700">
                      {model.catalogMetadata.providerName ?? model.catalogProviderId} /{' '}
                      {model.catalogMetadata.modelName ?? model.catalogModelId}
                    </span>
                    {model.catalogMetadata.supportLevel && (
                      <span className="rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-600">
                        {supportLabel({
                          supportLevel: model.catalogMetadata.supportLevel,
                          baseUrlNeedsManualEdit:
                            model.catalogMetadata.baseUrlNeedsManualEdit ?? false,
                        })}
                      </span>
                    )}
                    {model.catalogMetadata.docsUrl && (
                      <a
                        href={model.catalogMetadata.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
                      >
                        文档
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-600">
                    <span className="rounded bg-white px-1.5 py-0.5">
                      知识截止 {formatDate(model.catalogMetadata.knowledgeCutoff)}
                    </span>
                    <span className="rounded bg-white px-1.5 py-0.5">
                      发布 {formatDate(model.catalogMetadata.releaseDate)}
                    </span>
                    <span className="rounded bg-white px-1.5 py-0.5">
                      更新 {formatDate(model.catalogMetadata.lastUpdated)}
                    </span>
                    {model.catalogMetadata.status && (
                      <span className="rounded bg-white px-1.5 py-0.5">
                        {model.catalogMetadata.status}
                      </span>
                    )}
                    {model.catalogMetadata.modalities && (
                      <span className="rounded bg-white px-1.5 py-0.5">
                        输入 {model.catalogMetadata.modalities.input.join(', ') || '未知'} · 输出{' '}
                        {model.catalogMetadata.modalities.output.join(', ') || '未知'}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                    {priceRows(model.catalogMetadata.cost).map(([label, value]) => (
                      <span key={label} className="rounded bg-white px-1.5 py-0.5">
                        {label} {formatPrice(value)}
                      </span>
                    ))}
                    {!hasKnownPrice(model.catalogMetadata.cost) && (
                      <span className="rounded bg-white px-1.5 py-0.5">价格未知</span>
                    )}
                  </div>
                </div>
              )}
              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_1fr_140px]">
                <TokenLimitField
                  label="上下文窗口 token"
                  value={model.contextWindowTokens}
                  onCommit={(value) => updateTokenLimit(index, 'contextWindowTokens', value)}
                />
                <TokenLimitField
                  label="最大输入 token"
                  value={model.maxInputTokens}
                  onCommit={(value) => updateTokenLimit(index, 'maxInputTokens', value)}
                />
                <TokenLimitField
                  label="最大输出 token"
                  value={model.maxOutputTokens}
                  onCommit={(value) => updateTokenLimit(index, 'maxOutputTokens', value)}
                />
                <Field label="限制来源">
                  <select
                    className={INP}
                    value={model.tokenLimitSource ?? ''}
                    onChange={(e) =>
                      setTokenLimitSource(
                        index,
                        e.target.value ? (e.target.value as AiModelTokenLimitSource) : null,
                      )
                    }
                  >
                    <option value="">默认</option>
                    <option value="catalog" disabled={!model.catalogMetadata?.limit}>
                      目录
                    </option>
                    <option value="manual">手动</option>
                  </select>
                </Field>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
                {AI_MODEL_CAPABILITIES.map((capability) => (
                  <label
                    key={capability}
                    className="flex items-center gap-2 text-xs text-slate-600"
                  >
                    <input
                      type="checkbox"
                      checked={model.capabilities.includes(capability)}
                      onChange={() => toggleCapability(index, capability)}
                    />
                    {capabilityLabels[capability]}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          启用供应商连接
        </label>
        {error && <div className="rounded bg-rose-50 p-2 text-xs text-rose-700">{error}</div>}
        {requiresManualConfig && !baseUrl.trim() && (
          <div className="rounded bg-amber-50 p-2 text-xs text-amber-700">
            当前目录模型需要手动填写 Base URL 后再保存。
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded border px-3 py-1 text-sm">
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !canSave}
            className="rounded bg-slate-800 px-3 py-1 text-sm text-white disabled:bg-slate-400"
          >
            {submitting ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-600">{label}</span>
      {children}
    </label>
  )
}
