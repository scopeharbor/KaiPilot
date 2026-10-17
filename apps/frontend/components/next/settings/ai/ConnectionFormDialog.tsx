'use client'

/**
 * AI 模型连接表单对话框（新建 / 编辑共用，新版 UI `--nx-*` 设计语言）。
 *
 * 字段能力对齐旧版 `components/ai/ConnectionsManager.tsx` 的 ConnectionForm：
 * models.dev 目录搜寻/匹配/刷新、多模型编辑、RPM/TPM、token 上限（K/M 语法）、
 * 能力勾选、目录元资料预填、启用开关；编辑模式 API Key 留空 = 不变。
 *
 * 红线：API Key 密码态输入，前端永不回显明文。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  AlertCircle,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { aiModelCatalogApi, type AiConnectionModelInput } from '@/lib/api/ai-connections'
import {
  AI_CONNECTION_PROTOCOL_VARIANTS,
  AI_MODEL_CAPABILITIES,
  DEFAULT_AI_MODEL_CONTEXT_LIMITS,
  findProtocolVariant,
  resolveAiModelContextLimits,
  type AiConnectionDto,
  type AiConnectionModelDto,
  type AiConnectionProtocol,
  type AiModelCatalogCost,
  type AiModelCatalogModelDto,
  type AiModelCatalogSearchResponse,
  type AiModelCapability,
  type AiModelTokenLimitSource,
  type AiToolCallingMode,
} from '@aiproj/types'
import {
  capabilityLabels,
  formatTokenLimitInput,
  parseTokenLimitInput,
} from '@/components/ai/ConnectionsManager'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { cn } from '@/lib/utils'

/** 连接写入输入（对应后端 create/update validator）。 */
export type ConnectionInput = {
  displayName: string
  protocol: AiConnectionProtocol
  toolCallingMode?: AiToolCallingMode
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

const DEFAULT_CAPABILITIES: AiModelCapability[] = [
  'chat',
  'project_draft',
  'structured_output',
  'tool_calling',
]

const PROTOCOL_HINT =
  '「提示词 JSON」适用于任何模型；原生工具方式让 AI 同事用供应商原生的工具调用理解「把任务勾掉、移到进行中、打开甘特图」这类指令，调用失败会自动改用提示词 JSON。'

const INP =
  'w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-1.5 text-xs text-[var(--nx-text-primary)] placeholder-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:opacity-50'

const BTN_SECONDARY =
  'flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-50'

const BTN_PRIMARY =
  'flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-accent)] bg-[var(--nx-accent)] px-4 text-xs font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50'

function formatTokens(value: number | null | undefined): string {
  if (!value) return '未知'
  if (value >= 1_000_000) return `${value / 1_000_000}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(value)
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

function supportLabel(
  model: Pick<AiModelCatalogModelDto, 'supportLevel' | 'baseUrlNeedsManualEdit'>,
) {
  if (model.supportLevel === 'one_click') return '可一键保存'
  if (model.supportLevel === 'manual' || model.baseUrlNeedsManualEdit) return '需处理 Base URL'
  return '仅浏览资料'
}

function protocolLabel(protocol: AiConnectionProtocol | null): string {
  if (protocol === 'openai_compatible') return 'OpenAI 兼容'
  if (protocol === 'anthropic_compatible') return 'Anthropic 兼容'
  return '需手动配置'
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--nx-text-secondary)]">
        {label}
      </span>
      {children}
    </label>
  )
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
        aria-invalid={invalid}
        placeholder="例如 1M、900K、65536"
        value={draft}
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
        className={cn(INP, invalid && 'border-[rgba(239,68,68,0.5)]')}
      />
      <span
        className={cn(
          'mt-1 block text-[11px]',
          invalid ? 'text-[var(--nx-status-danger)]' : 'text-[var(--nx-text-muted)]',
        )}
      >
        {invalid
          ? '请输入正整数，或使用 K / M，例如 64K、1M。'
          : preview
            ? `= ${preview.toLocaleString()} tokens`
            : '留空表示未知'}
      </span>
    </Field>
  )
}

export interface ConnectionFormDialogProps {
  /** null = 新建；否则为编辑该连接。 */
  initial: AiConnectionDto | null
  submitting: boolean
  error: string | null
  onClose: () => void
  onSubmit: (input: ConnectionInput) => void
  /**
   * 可选：把外层（工作区）的弹层容器 ref 桥接到 role="dialog" 覆盖层上，
   * 让外层 useDialogA11y 的焦点落点 / Escape 注册与内层一致（同一元素）。
   */
  containerRef?: React.RefObject<HTMLDivElement | null>
}

export function ConnectionFormDialog({
  initial,
  submitting,
  error,
  onClose,
  onSubmit,
  containerRef,
}: ConnectionFormDialogProps) {
  const isEdit = initial !== null

  const [displayName, setDisplayName] = useState(initial?.displayName ?? '')
  const [variantKey, setVariantKey] = useState<string>(
    initial
      ? findProtocolVariant(initial.protocol, initial.toolCallingMode).key
      : AI_CONNECTION_PROTOCOL_VARIANTS[0]!.key,
  )
  const variant =
    AI_CONNECTION_PROTOCOL_VARIANTS.find((item) => item.key === variantKey) ??
    AI_CONNECTION_PROTOCOL_VARIANTS[0]!
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const validModels = models.filter((model) => model.modelName.trim().length > 0)
  const requiresManualConfig = validModels.some(
    (model) =>
      model.catalogMetadata?.supportLevel && model.catalogMetadata.supportLevel !== 'one_click',
  )

  const dialogRef = useRef<HTMLDivElement | null>(null)
  const setOverlayRef = (node: HTMLDivElement | null) => {
    dialogRef.current = node
    if (containerRef) containerRef.current = node
  }

  useDialogA11y({
    ref: dialogRef,
    open: true,
    onClose,
    canClose: () => !submitting,
  })

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
      setCatalogNotice((e as { message?: string })?.message ?? '目录搜索失败')
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
      setCatalogNotice((e as { message?: string })?.message ?? '自动匹配失败')
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
    onError: (e) => setCatalogNotice((e as { message?: string })?.message ?? '刷新目录失败'),
  })

  function applyCatalogModel(catalogModel: AiModelCatalogModelDto, index = 0) {
    setDisplayName((current) => current.trim() || catalogModel.providerName)
    if (catalogModel.protocol) {
      setVariantKey(findProtocolVariant(catalogModel.protocol, null).key)
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

  const submit = () => {
    const errors: Record<string, string> = {}
    if (!displayName.trim()) {
      errors.displayName = '请输入连接名称'
    }
    if (validModels.length === 0) {
      errors.model = '请输入模型标识'
    }
    if (!isEdit && !apiKey.trim()) {
      errors.apiKey = '请输入 API Key'
    }
    if (requiresManualConfig && !baseUrl.trim()) {
      errors.baseUrl = '当前目录模型需要手动填写 Base URL 后再保存。'
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})

    const firstModel = validModels[0]!
    const input: ConnectionInput = {
      displayName: displayName.trim(),
      protocol: variant.protocol,
      toolCallingMode: variant.toolCallingMode,
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

  return (
    <div
      data-testid="create-connection-dialog"
      data-editing={isEdit ? 'true' : 'false'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-connection-title"
      ref={setOverlayRef}
      tabIndex={-1}
    >
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto overscroll-contain rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--nx-border-hairline)] pb-3">
          <h2
            id="create-connection-title"
            className="text-base font-semibold text-[var(--nx-text-primary)]"
          >
            {isEdit ? `编辑 AI 模型连接` : '新建 AI 模型连接'}
          </h2>
          <button
            type="button"
            data-testid="close-create-dialog"
            onClick={onClose}
            disabled={submitting}
            className="rounded p-1 text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          {error ? (
            <div
              role="alert"
              className="flex items-center gap-2 rounded border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] p-2.5 text-xs text-[var(--nx-status-danger)]"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {/* 基本资料 */}
          <section className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-[var(--nx-text-secondary)]">
                连接名称 <span className="text-[var(--nx-status-danger)]">*</span>
              </label>
              <input
                type="text"
                data-testid="input-display-name"
                placeholder="如：生产 OpenAI 网关 / 研发 Claude"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={cn(INP, 'mt-1')}
              />
              {fieldErrors.displayName ? (
                <p className="mt-1 text-[11px] text-[var(--nx-status-danger)]">
                  {fieldErrors.displayName}
                </p>
              ) : null}
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--nx-text-secondary)]">
                连接协议 <span className="text-[var(--nx-status-danger)]">*</span>
              </label>
              <select
                data-testid="select-protocol"
                value={variantKey}
                onChange={(e) => setVariantKey(e.target.value)}
                className={cn(INP, 'mt-1')}
              >
                {AI_CONNECTION_PROTOCOL_VARIANTS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] leading-4 text-[var(--nx-text-muted)]">
                {PROTOCOL_HINT}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--nx-text-secondary)]">
                自定义 Base URL（可选）
              </label>
              <input
                type="text"
                data-testid="input-base-url"
                placeholder="如：https://api.openai.com/v1（留空使用官方默认地址）"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className={cn(INP, 'mt-1')}
              />
              {fieldErrors.baseUrl ? (
                <p className="mt-1 text-[11px] text-[var(--nx-status-danger)]">
                  {fieldErrors.baseUrl}
                </p>
              ) : null}
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--nx-text-secondary)]">
                API Key{' '}
                {isEdit ? (
                  <span className="text-[var(--nx-text-muted)]">（留空 = 不变）</span>
                ) : (
                  <span className="text-[var(--nx-status-danger)]">*</span>
                )}
              </label>
              <input
                type="password"
                autoComplete="off"
                data-testid="input-api-key"
                placeholder={isEdit ? '留空不改' : 'sk-...'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className={cn(INP, 'mt-1 font-mono')}
              />
              <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
                提示：API Key 保存后将由服务端加密存储，前端界面永不回显明文。
              </p>
              {fieldErrors.apiKey ? (
                <p className="mt-1 text-[11px] text-[var(--nx-status-danger)]">
                  {fieldErrors.apiKey}
                </p>
              ) : null}
            </div>

            <label className="flex items-center gap-2 text-xs text-[var(--nx-text-secondary)]">
              <input
                type="checkbox"
                data-testid="input-is-active"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="accent-[var(--nx-accent)]"
              />
              启用供应商连接
            </label>
          </section>

          {/* models.dev 目录 */}
          <section className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-[var(--nx-text-primary)]">
                models.dev 目录
              </h4>
              <button
                type="button"
                onClick={() => catalogRefresh.mutate()}
                disabled={catalogRefresh.isPending}
                className={BTN_SECONDARY}
                title="刷新目录"
              >
                <RefreshCw
                  className={cn('h-3.5 w-3.5', catalogRefresh.isPending && 'animate-spin')}
                />
                {catalogRefresh.isPending ? '刷新中' : '刷新目录'}
              </button>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-[1fr_150px_auto_auto]">
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
                className={cn(BTN_SECONDARY, 'mt-5')}
              >
                <Search className="h-3.5 w-3.5" />
                {catalogSearch.isPending ? '搜寻中' : '搜寻'}
              </button>
              <button
                type="button"
                onClick={() => catalogMatch.mutate({ index: 0, automatic: false })}
                disabled={
                  catalogMatch.isPending || (!baseUrl.trim() && !models[0]?.modelName.trim())
                }
                className={cn(BTN_SECONDARY, 'mt-5')}
              >
                <Search className="h-3.5 w-3.5" />
                匹配现有
              </button>
            </div>
            {catalogNotice ? (
              <div className="mt-2 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1.5 text-xs text-[var(--nx-text-secondary)]">
                {catalogNotice}
              </div>
            ) : null}
            {catalogMeta ? (
              <div className="mt-2 text-[11px] text-[var(--nx-text-muted)]">
                结果 {catalogMeta.total} · 快照 {catalogMeta.fetchedAt ?? '未知'}
                {catalogMeta.stale ? ' · 已过期' : ''}
              </div>
            ) : null}
            {catalogResults.length > 0 ? (
              <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
                {catalogResults.map((catalogModel) => (
                  <div
                    key={`${catalogModel.providerId}:${catalogModel.id}`}
                    className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <img
                            src={catalogModel.providerLogoUrl}
                            alt={catalogModel.providerName}
                            className="h-5 w-5 shrink-0 rounded-sm"
                          />
                          <div className="min-w-0 truncate text-xs font-medium text-[var(--nx-text-primary)]">
                            {catalogModel.providerName} / {catalogModel.name}
                          </div>
                          <span className="shrink-0 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]">
                            {supportLabel(catalogModel)}
                          </span>
                        </div>
                        <div className="truncate text-[11px] text-[var(--nx-text-muted)]">
                          {catalogModel.id} · {protocolLabel(catalogModel.protocol)} ·{' '}
                          {catalogModel.baseUrl ?? 'Base URL 需手动填写'}
                        </div>
                        <div className="flex flex-wrap gap-1.5 text-[10px] text-[var(--nx-text-secondary)]">
                          <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5">
                            上下文 {formatTokens(catalogModel.limit.context)}
                          </span>
                          <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5">
                            输入 {formatTokens(catalogModel.limit.input)}
                          </span>
                          <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5">
                            输出 {formatTokens(catalogModel.limit.output)}
                          </span>
                          <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5">
                            知识截止 {formatDate(catalogModel.knowledgeCutoff)}
                          </span>
                          <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5">
                            更新 {formatDate(catalogModel.lastUpdated)}
                          </span>
                          {catalogModel.status ? (
                            <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5">
                              {catalogModel.status}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-1.5 text-[10px] text-[var(--nx-text-muted)]">
                          {priceRows(catalogModel.cost).map(([label, value]) => (
                            <span
                              key={label}
                              className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5"
                            >
                              {label} {formatPrice(value)}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {catalogModel.providerDocsUrl ? (
                          <a
                            href={catalogModel.providerDocsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)]"
                          >
                            文档
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => applyCatalogModel(catalogModel)}
                          className={BTN_PRIMARY}
                        >
                          选用
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {/* 模型清单 */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-[var(--nx-text-primary)]">模型</h4>
              <button
                type="button"
                onClick={() => setModels((current) => [...current, blankModel()])}
                className={BTN_SECONDARY}
              >
                <Plus className="h-3.5 w-3.5" />
                添加模型
              </button>
            </div>

            {models.map((model, index) => (
              <div
                key={index}
                className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3"
              >
                <div className="grid gap-3 md:grid-cols-[1fr_110px_110px_auto_auto]">
                  <Field label="Model Name">
                    <input
                      className={INP}
                      data-testid={index === 0 ? 'input-model' : `input-model-${index}`}
                      placeholder={
                        variant.protocol === 'openai_compatible'
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
                    {index === 0 && fieldErrors.model ? (
                      <p className="mt-1 text-[11px] text-[var(--nx-status-danger)]">
                        {fieldErrors.model}
                      </p>
                    ) : null}
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
                  <label className="mt-5 flex items-center gap-2 text-xs text-[var(--nx-text-secondary)]">
                    <input
                      type="checkbox"
                      data-testid={`model-active-${index}`}
                      checked={model.isActive}
                      onChange={(e) => updateModel(index, { isActive: e.target.checked })}
                      className="accent-[var(--nx-accent)]"
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
                    className="mt-4 inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-status-danger)] transition-colors hover:border-[rgba(239,68,68,0.4)] hover:bg-[rgba(239,68,68,0.1)] disabled:opacity-40"
                    title="删除模型"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {model.catalogMetadata ? (
                  <div className="mt-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {model.catalogMetadata.logoUrl ? (
                        <img
                          src={model.catalogMetadata.logoUrl}
                          alt={model.catalogMetadata.providerName ?? model.catalogProviderId ?? ''}
                          className="h-5 w-5 rounded-sm"
                        />
                      ) : null}
                      <span className="text-xs font-medium text-[var(--nx-text-primary)]">
                        {model.catalogMetadata.providerName ?? model.catalogProviderId} /{' '}
                        {model.catalogMetadata.modelName ?? model.catalogModelId}
                      </span>
                      {model.catalogMetadata.supportLevel ? (
                        <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]">
                          {supportLabel({
                            supportLevel: model.catalogMetadata.supportLevel,
                            baseUrlNeedsManualEdit:
                              model.catalogMetadata.baseUrlNeedsManualEdit ?? false,
                          })}
                        </span>
                      ) : null}
                      {model.catalogMetadata.docsUrl ? (
                        <a
                          href={model.catalogMetadata.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)]"
                        >
                          文档
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[var(--nx-text-secondary)]">
                      <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5">
                        知识截止 {formatDate(model.catalogMetadata.knowledgeCutoff)}
                      </span>
                      <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5">
                        发布 {formatDate(model.catalogMetadata.releaseDate)}
                      </span>
                      <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5">
                        更新 {formatDate(model.catalogMetadata.lastUpdated)}
                      </span>
                      {model.catalogMetadata.status ? (
                        <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5">
                          {model.catalogMetadata.status}
                        </span>
                      ) : null}
                      {model.catalogMetadata.modalities ? (
                        <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5">
                          输入 {model.catalogMetadata.modalities.input.join(', ') || '未知'} · 输出{' '}
                          {model.catalogMetadata.modalities.output.join(', ') || '未知'}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[var(--nx-text-muted)]">
                      {priceRows(model.catalogMetadata.cost).map(([label, value]) => (
                        <span
                          key={label}
                          className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5"
                        >
                          {label} {formatPrice(value)}
                        </span>
                      ))}
                      {!hasKnownPrice(model.catalogMetadata.cost) ? (
                        <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5">
                          价格未知
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}

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
                      className="flex items-center gap-2 text-[11px] text-[var(--nx-text-secondary)]"
                    >
                      <input
                        type="checkbox"
                        checked={model.capabilities.includes(capability)}
                        onChange={() => toggleCapability(index, capability)}
                        className="accent-[var(--nx-accent)]"
                      />
                      {capabilityLabels[capability]}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </section>

          {requiresManualConfig && !baseUrl.trim() ? (
            <div className="rounded border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] p-2.5 text-xs text-[var(--nx-status-warning)]">
              当前目录模型需要手动填写 Base URL 后再保存。
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] pt-3">
            <button
              type="button"
              data-testid="cancel-create-button"
              onClick={onClose}
              disabled={submitting}
              className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              data-testid="submit-create-button"
              onClick={submit}
              disabled={submitting}
              className={BTN_PRIMARY}
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {isEdit ? '保存修改' : '保存连接'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ConnectionFormDialog
