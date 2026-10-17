'use client'

import * as React from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, X } from 'lucide-react'
import {
  DEPENDENCY_CATEGORIES,
  DEPENDENCY_RISK_LEVELS,
  DEPENDENCY_STATUSES,
  DEPENDENCY_TYPES,
  ENDPOINT_TYPES,
  SOURCE_MODES,
} from '@aiproj/types'
import { cn } from '@/lib/utils'
import {
  categoryLabel,
  dependencyTypeLabel,
  endpointTypeLabel,
  formatMpdDateTime,
  sourceModeLabel,
  type MpdPreviewView,
  type MpdRowView,
} from './mpd-adapter'
import { MpdWarningChips } from './MpdBadges'

/**
 * 跨项目依赖写操作对话框（v3-ui-next-pmo-domain W7 · tasks 7.3）。
 *
 * 五组写操作（create / update / archive / restore / delete）全部「预览 → 确认」
 * 双步（RL-06 / Decision 4）：
 * - 表单步（create/update）仅收集输入，无任何网络请求；
 * - 提交后先经 preview 端点产出 Diff 快照 → 弹「确认执行」对话框展示变更前后对照、
 *   受影响端点与警告码，人工点击「确认执行」才落库（confirm 端点）；
 * - 确认对话框内展示幂等键指引/过期时间；失败保留输入并回显服务端错误；
 * - 本组件零业务查询，全部为受控写流程。
 */

export type MpdWriteKind = 'create' | 'update' | 'archive' | 'restore' | 'delete'

export type MpdWriteFlow =
  | { step: 'idle' }
  | { step: 'form'; kind: 'create' }
  | { step: 'form'; kind: 'update'; row: MpdRowView }
  | { step: 'confirm'; kind: MpdWriteKind; preview: MpdPreviewView }

const OPERATION_LABELS: Record<MpdWriteKind, string> = {
  create: '新建依赖',
  update: '更新依赖',
  archive: '归档依赖',
  restore: '恢复依赖',
  delete: '删除依赖',
}

// ─── 统一浮层骨架 ──────────────────────────────────────────────────────────────

function ModalShell({
  title,
  description,
  onClose,
  children,
  widthClass = 'max-w-lg',
}: {
  title: string
  description?: string
  onClose: () => void
  children: React.ReactNode
  widthClass?: string
}) {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div
        className={cn(
          'relative flex max-h-[85vh] w-full flex-col rounded-xl border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] shadow-2xl',
          widthClass,
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">{title}</h3>
            {description ? (
              <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="关闭对话框"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

function FieldError({ message }: { message: string }) {
  return (
    <p
      data-write-field-error
      role="alert"
      className="flex items-center gap-1.5 text-[10px] text-[var(--nx-status-danger)]"
    >
      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
      {message}
    </p>
  )
}

function ServerErrorNote({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div
      data-write-server-error
      role="alert"
      className="flex items-start gap-2 rounded-md border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]"
    >
      <AlertTriangle
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--nx-status-danger)]"
        aria-hidden
      />
      <span>{message}</span>
    </div>
  )
}

const inputClass =
  'h-8 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] transition-colors placeholder:text-[var(--nx-text-muted)] hover:border-[var(--nx-border-focus)] focus:border-[var(--nx-border-focus)] focus:outline-none'

function LabeledField({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline gap-1.5 text-[10px] font-medium text-[var(--nx-text-secondary)]">
        {label}
        {hint ? (
          <em className="font-mono text-[9px] not-italic text-[var(--nx-text-muted)]">{hint}</em>
        ) : null}
      </span>
      {children}
    </label>
  )
}

// ─── 端点输入（create 表单用） ────────────────────────────────────────────────

interface EndpointFormState {
  type: string
  /** 数值 ID（project/milestone/task）；external 用 key/label。 */
  idText: string
  externalKey: string
  externalLabel: string
}

const EMPTY_ENDPOINT: EndpointFormState = {
  type: 'project',
  idText: '',
  externalKey: '',
  externalLabel: '',
}

interface FlatCreateBody {
  providerEndpointType: string
  providerProjectId?: number | null
  providerMilestoneId?: number | null
  providerTaskId?: number | null
  providerExternalKey?: string | null
  providerExternalLabel?: string | null
  consumerEndpointType: string
  consumerProjectId?: number | null
  consumerMilestoneId?: number | null
  consumerTaskId?: number | null
  consumerExternalKey?: string | null
  consumerExternalLabel?: string | null
  category: string
  type?: string
  lagDays?: number
  strength?: string
  bufferDays?: number
  riskLevel?: string
  sourceMode?: string
}

function endpointToBody(
  prefix: 'provider' | 'consumer',
  endpoint: EndpointFormState,
): Record<string, number | string | null> {
  if (endpoint.type === 'external') {
    return {
      [`${prefix}EndpointType`]: 'external',
      [`${prefix}ExternalKey`]: endpoint.externalKey.trim() || null,
      [`${prefix}ExternalLabel`]: endpoint.externalLabel.trim() || null,
    }
  }
  const idColumn: Record<string, string> = {
    project: `${prefix}ProjectId`,
    milestone: `${prefix}MilestoneId`,
    task: `${prefix}TaskId`,
  }
  const parsed = Number(endpoint.idText)
  if (endpoint.type in idColumn && Number.isFinite(parsed) && parsed > 0) {
    return { [`${prefix}EndpointType`]: endpoint.type, [idColumn[endpoint.type]!]: parsed }
  }
  return { [`${prefix}EndpointType`]: endpoint.type }
}

function validateEndpoint(endpoint: EndpointFormState, label: string): string | null {
  if (endpoint.type === 'external') {
    if (endpoint.externalKey.trim() === '') return `请填写${label}外部引用标识（externalKey）`
    return null
  }
  const parsed = Number(endpoint.idText)
  if (!endpoint.idText.trim() || !Number.isFinite(parsed) || parsed <= 0) {
    return `请填写${label}端点 ID（正整数）`
  }
  return null
}

// ─── 创建表单对话框 ───────────────────────────────────────────────────────────

function CreateFormDialog({
  onSubmit,
  onClose,
}: {
  onSubmit: (body: unknown) => Promise<void>
  onClose: () => void
}) {
  const [provider, setProvider] = React.useState<EndpointFormState>(EMPTY_ENDPOINT)
  const [consumer, setConsumer] = React.useState<EndpointFormState>({
    ...EMPTY_ENDPOINT,
    type: 'project',
  })
  const [category, setCategory] = React.useState('deliverable')
  const [type, setType] = React.useState('fs')
  const [lagDays, setLagDays] = React.useState('')
  const [strength, setStrength] = React.useState('hard')
  const [bufferDays, setBufferDays] = React.useState('')
  const [riskLevel, setRiskLevel] = React.useState('none')
  const [sourceMode, setSourceMode] = React.useState('manual')
  const [fieldError, setFieldError] = React.useState<string | null>(null)
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const handleSubmit = async () => {
    const providerError = validateEndpoint(provider, '提供方')
    const consumerError = validateEndpoint(consumer, '消费方')
    if (providerError || consumerError) {
      setFieldError(
        [providerError, consumerError].filter((v): v is string => v !== null).join('；'),
      )
      return
    }
    setFieldError(null)
    setServerError(null)
    setSubmitting(true)
    try {
      const body: FlatCreateBody = {
        providerEndpointType: 'project',
        consumerEndpointType: 'project',
        ...endpointToBody('provider', provider),
        ...endpointToBody('consumer', consumer),
        category,
        type,
        riskLevel,
        sourceMode,
      }
      if (lagDays.trim() !== '') body.lagDays = Number(lagDays)
      if (bufferDays.trim() !== '') body.bufferDays = Number(bufferDays)
      body.strength = strength
      await onSubmit(body)
    } catch (error) {
      setServerError(error instanceof Error ? error.message : '预览生成失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell
      title="新建跨项目依赖"
      description="填写依赖两端与属性；提交后先预览变更快照（Diff），核对无误后人工确认落库。"
      onClose={onClose}
      widthClass="max-w-2xl"
    >
      <div className="flex flex-col gap-4">
        <div data-mpd-create-endpoints className="grid grid-cols-2 gap-4">
          <fieldset className="flex flex-col gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3">
            <legend className="px-1 font-mono text-[10px] uppercase tracking-wide text-[var(--nx-text-muted)]">
              提供方（上游）
            </legend>
            <LabeledField label="端点类型">
              <select
                data-mpd-create-provider-type
                value={provider.type}
                onChange={(event) => setProvider((prev) => ({ ...prev, type: event.target.value }))}
                className={inputClass}
              >
                {ENDPOINT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {endpointTypeLabel(value)}
                  </option>
                ))}
              </select>
            </LabeledField>
            {provider.type === 'external' ? (
              <>
                <LabeledField label="外部引用标识" hint="externalKey">
                  <input
                    data-mpd-create-provider-external-key
                    value={provider.externalKey}
                    onChange={(event) =>
                      setProvider((prev) => ({ ...prev, externalKey: event.target.value }))
                    }
                    placeholder="例如 CRM-API"
                    className={inputClass}
                  />
                </LabeledField>
                <LabeledField label="外部引用标签">
                  <input
                    data-mpd-create-provider-external-label
                    value={provider.externalLabel}
                    onChange={(event) =>
                      setProvider((prev) => ({ ...prev, externalLabel: event.target.value }))
                    }
                    placeholder="展示用名称（可选）"
                    className={inputClass}
                  />
                </LabeledField>
              </>
            ) : (
              <LabeledField label="端点 ID" hint={provider.type}>
                <input
                  data-mpd-create-provider-id
                  type="number"
                  min={1}
                  value={provider.idText}
                  onChange={(event) =>
                    setProvider((prev) => ({ ...prev, idText: event.target.value }))
                  }
                  placeholder={`${endpointTypeLabel(provider.type)} ID`}
                  className={inputClass}
                />
              </LabeledField>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3">
            <legend className="px-1 font-mono text-[10px] uppercase tracking-wide text-[var(--nx-text-muted)]">
              消费方（下游）
            </legend>
            <LabeledField label="端点类型">
              <select
                data-mpd-create-consumer-type
                value={consumer.type}
                onChange={(event) => setConsumer((prev) => ({ ...prev, type: event.target.value }))}
                className={inputClass}
              >
                {ENDPOINT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {endpointTypeLabel(value)}
                  </option>
                ))}
              </select>
            </LabeledField>
            {consumer.type === 'external' ? (
              <>
                <LabeledField label="外部引用标识" hint="externalKey">
                  <input
                    data-mpd-create-consumer-external-key
                    value={consumer.externalKey}
                    onChange={(event) =>
                      setConsumer((prev) => ({ ...prev, externalKey: event.target.value }))
                    }
                    placeholder="例如 CRM-API"
                    className={inputClass}
                  />
                </LabeledField>
                <LabeledField label="外部引用标签">
                  <input
                    data-mpd-create-consumer-external-label
                    value={consumer.externalLabel}
                    onChange={(event) =>
                      setConsumer((prev) => ({ ...prev, externalLabel: event.target.value }))
                    }
                    placeholder="展示用名称（可选）"
                    className={inputClass}
                  />
                </LabeledField>
              </>
            ) : (
              <LabeledField label="端点 ID" hint={consumer.type}>
                <input
                  data-mpd-create-consumer-id
                  type="number"
                  min={1}
                  value={consumer.idText}
                  onChange={(event) =>
                    setConsumer((prev) => ({ ...prev, idText: event.target.value }))
                  }
                  placeholder={`${endpointTypeLabel(consumer.type)} ID`}
                  className={inputClass}
                />
              </LabeledField>
            )}
          </fieldset>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <LabeledField label="分类">
            <select
              data-mpd-create-category
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className={inputClass}
            >
              {DEPENDENCY_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {categoryLabel(value)}
                </option>
              ))}
            </select>
          </LabeledField>
          <LabeledField label="依赖类型">
            <select
              data-mpd-create-type
              value={type}
              onChange={(event) => setType(event.target.value)}
              className={inputClass}
            >
              {DEPENDENCY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {dependencyTypeLabel(value)}
                </option>
              ))}
            </select>
          </LabeledField>
          <LabeledField label="强度">
            <select
              data-mpd-create-strength
              value={strength}
              onChange={(event) => setStrength(event.target.value)}
              className={inputClass}
            >
              <option value="hard">硬依赖</option>
              <option value="soft">软依赖</option>
              <option value="advisory">建议性</option>
            </select>
          </LabeledField>
          <LabeledField label="风险等级">
            <select
              data-mpd-create-risk
              value={riskLevel}
              onChange={(event) => setRiskLevel(event.target.value)}
              className={inputClass}
            >
              {DEPENDENCY_RISK_LEVELS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </LabeledField>
          <LabeledField label="来源模式">
            <select
              data-mpd-create-source-mode
              value={sourceMode}
              onChange={(event) => setSourceMode(event.target.value)}
              className={inputClass}
            >
              {SOURCE_MODES.map((value) => (
                <option key={value} value={value}>
                  {sourceModeLabel(value)}
                </option>
              ))}
            </select>
          </LabeledField>
          <div className="grid grid-cols-2 gap-2">
            <LabeledField label="延迟天数">
              <input
                data-mpd-create-lag
                type="number"
                min={0}
                value={lagDays}
                onChange={(event) => setLagDays(event.target.value)}
                className={inputClass}
              />
            </LabeledField>
            <LabeledField label="缓冲天数">
              <input
                data-mpd-create-buffer
                type="number"
                min={0}
                value={bufferDays}
                onChange={(event) => setBufferDays(event.target.value)}
                className={inputClass}
              />
            </LabeledField>
          </div>
        </div>

        {fieldError ? <FieldError message={fieldError} /> : null}
        <ServerErrorNote message={serverError} />

        <div className="flex items-center justify-between border-t border-[var(--nx-border-hairline)] pt-3">
          <p className="font-mono text-[9px] text-[var(--nx-text-muted)]">
            写操作需 org 管理员（服务端终裁）
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-mpd-create-cancel
              onClick={onClose}
              className="flex h-8 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
            >
              取消
            </button>
            <button
              type="button"
              data-mpd-create-preview
              disabled={submitting}
              onClick={() => void handleSubmit()}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? '预览生成中…' : '预览变更'}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  )
}

// ─── 更新表单对话框 ───────────────────────────────────────────────────────────

function UpdateFormDialog({
  row,
  onSubmit,
  onClose,
}: {
  row: MpdRowView
  onSubmit: (body: unknown) => Promise<void>
  onClose: () => void
}) {
  const [category, setCategory] = React.useState(row.category || 'deliverable')
  const [type, setType] = React.useState((row.type || 'fs').toLowerCase())
  const [lagDays, setLagDays] = React.useState(row.lagDays === null ? '' : String(row.lagDays))
  const [strength, setStrength] = React.useState(row.strength || 'hard')
  const [bufferDays, setBufferDays] = React.useState(
    row.bufferDays === null ? '' : String(row.bufferDays),
  )
  const [riskLevel, setRiskLevel] = React.useState(row.risk || 'none')
  const [status, setStatus] = React.useState(row.status || 'active')
  const [fieldError, setFieldError] = React.useState<string | null>(null)
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const handleSubmit = async () => {
    const dependencyId = Number(row.id)
    if (!Number.isFinite(dependencyId) || dependencyId <= 0) {
      setFieldError('该依赖记录的标识无法解析为数值 ID，暂不支持更新（请改用归档/恢复流程）。')
      return
    }
    setFieldError(null)
    setServerError(null)
    setSubmitting(true)
    try {
      const body: Record<string, number | string> = {
        dependencyId,
        category,
        type,
        strength,
        status,
        riskLevel,
      }
      if (lagDays.trim() !== '') body.lagDays = Number(lagDays)
      if (bufferDays.trim() !== '') body.bufferDays = Number(bufferDays)
      await onSubmit(body)
    } catch (error) {
      setServerError(error instanceof Error ? error.message : '预览生成失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell
      title="更新跨项目依赖"
      description={`#${row.id} · ${row.providerLabel} → ${row.consumerLabel}。修改先经预览 Diff，人工确认后落库。`}
      onClose={onClose}
      widthClass="max-w-xl"
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3">
          <LabeledField label="分类">
            <select
              data-mpd-update-category
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className={inputClass}
            >
              {DEPENDENCY_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {categoryLabel(value)}
                </option>
              ))}
            </select>
          </LabeledField>
          <LabeledField label="依赖类型">
            <select
              data-mpd-update-type
              value={type}
              onChange={(event) => setType(event.target.value)}
              className={inputClass}
            >
              {DEPENDENCY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {dependencyTypeLabel(value)}
                </option>
              ))}
            </select>
          </LabeledField>
          <LabeledField label="状态">
            <select
              data-mpd-update-status
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className={inputClass}
            >
              {DEPENDENCY_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </LabeledField>
          <LabeledField label="风险等级">
            <select
              data-mpd-update-risk
              value={riskLevel}
              onChange={(event) => setRiskLevel(event.target.value)}
              className={inputClass}
            >
              {DEPENDENCY_RISK_LEVELS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </LabeledField>
          <LabeledField label="强度">
            <select
              data-mpd-update-strength
              value={strength}
              onChange={(event) => setStrength(event.target.value)}
              className={inputClass}
            >
              <option value="hard">硬依赖</option>
              <option value="soft">软依赖</option>
              <option value="advisory">建议性</option>
            </select>
          </LabeledField>
          <div className="grid grid-cols-2 gap-2">
            <LabeledField label="延迟天数">
              <input
                data-mpd-update-lag
                type="number"
                min={0}
                value={lagDays}
                onChange={(event) => setLagDays(event.target.value)}
                className={inputClass}
              />
            </LabeledField>
            <LabeledField label="缓冲天数">
              <input
                data-mpd-update-buffer
                type="number"
                min={0}
                value={bufferDays}
                onChange={(event) => setBufferDays(event.target.value)}
                className={inputClass}
              />
            </LabeledField>
          </div>
        </div>

        {fieldError ? <FieldError message={fieldError} /> : null}
        <ServerErrorNote message={serverError} />

        <div className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] pt-3">
          <button
            type="button"
            data-mpd-update-cancel
            onClick={onClose}
            className="flex h-8 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            取消
          </button>
          <button
            type="button"
            data-mpd-update-preview
            disabled={submitting}
            onClick={() => void handleSubmit()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? '预览生成中…' : '预览变更'}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ─── 预览 → 确认对话框（五组操作共用） ───────────────────────────────────────

function ConfirmPreviewDialog({
  kind,
  preview,
  onConfirm,
  onClose,
}: {
  kind: MpdWriteKind
  preview: MpdPreviewView
  onConfirm: () => Promise<void>
  onClose: () => void
}) {
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const handleConfirm = async () => {
    setServerError(null)
    setSubmitting(true)
    try {
      await onConfirm()
    } catch (error) {
      setServerError(error instanceof Error ? error.message : '确认执行失败，请重试')
      setSubmitting(false)
    }
  }

  return (
    <ModalShell
      title={`确认执行 · ${OPERATION_LABELS[kind]}`}
      description="变更尚未落库。以下为预览快照（Diff），核对后点击「确认执行」才写入依赖底册。"
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2">
          <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">预览</span>
          <span className="font-mono text-[10px] text-[var(--nx-accent)]">{preview.previewId}</span>
          <span aria-hidden className="mx-1 h-3 w-px bg-[var(--nx-border-hairline)]" />
          <span className="text-xs text-[var(--nx-text-primary)]">
            {preview.providerLabel}
            <span className="mx-1.5 text-[var(--nx-text-muted)]" aria-hidden>
              →
            </span>
            {preview.consumerLabel}
          </span>
        </div>

        {preview.diffRows.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-[var(--nx-border-hairline)]">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]">
                  <th className="px-3 py-1.5 font-mono text-[9px] font-medium uppercase tracking-wide text-[var(--nx-text-muted)]">
                    变更字段
                  </th>
                  <th className="px-3 py-1.5 font-mono text-[9px] font-medium uppercase tracking-wide text-[var(--nx-text-muted)]">
                    当前
                  </th>
                  <th className="px-3 py-1.5 font-mono text-[9px] font-medium uppercase tracking-wide text-[var(--nx-text-muted)]">
                    变更后
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.diffRows.map((row) => (
                  <tr
                    key={row.field}
                    data-mpd-diff-row={row.field}
                    className="border-b border-[var(--nx-border-hairline)] last:border-b-0"
                  >
                    <td className="px-3 py-1.5 text-[10px] text-[var(--nx-text-secondary)]">
                      {row.field}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                      {row.from}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px] font-medium text-[var(--nx-accent)]">
                      {row.to}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-[var(--nx-border-hairline)] px-3 py-4 text-center text-[11px] text-[var(--nx-text-muted)]">
            该操作无可见字段变更（服务端语义裁决）。
          </p>
        )}

        {preview.warnings.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-wide text-[var(--nx-text-muted)]">
              服务端警告
            </span>
            <MpdWarningChips codes={preview.warnings} />
          </div>
        ) : null}

        {preview.idempotencyGuidance ? (
          <p className="text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
            幂等指引：{preview.idempotencyGuidance}
          </p>
        ) : null}
        <p className="text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
          预览过期时间：{preview.expiresAt ? formatMpdDateTime(preview.expiresAt) : '—'}
        </p>

        <ServerErrorNote message={serverError} />

        <div className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] pt-3">
          <button
            type="button"
            data-mpd-confirm-cancel
            onClick={onClose}
            className="flex h-8 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            取消（不落库）
          </button>
          <button
            type="button"
            data-mpd-confirm-execute
            disabled={submitting}
            onClick={() => void handleConfirm()}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              kind === 'delete'
                ? 'border-[rgba(239,68,68,0.5)] bg-[rgba(239,68,68,0.12)] text-[var(--nx-status-danger)] hover:bg-[rgba(239,68,68,0.2)]'
                : 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] text-[var(--nx-accent)] hover:border-[var(--nx-accent)]',
            )}
          >
            {submitting ? '执行中…' : kind === 'delete' ? '确认删除' : '确认执行'}
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ─── 总出口 ──────────────────────────────────────────────────────────────────

export interface MpdWriteDialogsProps {
  flow: MpdWriteFlow
  onClose: () => void
  /** 表单步提交（create/update）：执行 preview → 成功后工作台转入 confirm 步；失败向表单回抛。 */
  onSubmitForm: (kind: 'create' | 'update', body: unknown, row?: MpdRowView) => Promise<void>
  /** 确认步执行：落库成功后工作台关闭并展示结果横幅；失败向确认框回抛。 */
  onRunConfirm: (kind: MpdWriteKind, preview: MpdPreviewView) => Promise<void>
}

export function MpdWriteDialogs({
  flow,
  onClose,
  onSubmitForm,
  onRunConfirm,
}: MpdWriteDialogsProps) {
  if (flow.step === 'idle') return null
  if (flow.step === 'form' && flow.kind === 'create') {
    return <CreateFormDialog onSubmit={(body) => onSubmitForm('create', body)} onClose={onClose} />
  }
  if (flow.step === 'form' && flow.kind === 'update') {
    return (
      <UpdateFormDialog
        row={flow.row}
        onSubmit={(body) => onSubmitForm('update', body, flow.row)}
        onClose={onClose}
      />
    )
  }
  if (flow.step === 'confirm') {
    return (
      <ConfirmPreviewDialog
        kind={flow.kind}
        preview={flow.preview}
        onConfirm={() => onRunConfirm(flow.kind, flow.preview)}
        onClose={onClose}
      />
    )
  }
  return null
}
