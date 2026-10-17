'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertCircle,
  Bot,
  CheckCircle2,
  Coins,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react'
import { aiConnectionsApi } from '@/lib/api/ai-connections'
import { WebSearchConnectionCard } from './WebSearchConnectionCard'
import { ModelPricingDialog } from './ModelPricingDialog'
import { ConnectionFormDialog, type ConnectionInput } from './ConnectionFormDialog'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { cn } from '@/lib/utils'
import type {
  AiConnectionDto,
  AiConnectionModelDto,
  AiConnectionTestResult,
  AiToolCallingMode,
} from '@aiproj/types'
import { AI_CONNECTION_PROTOCOL_VARIANTS, findProtocolVariant } from '@aiproj/types'

/**
 * AI 连接管理工作区（/next/settings/ai-connections，
 * v3-ui-next-settings-admin-domains W5 · tasks 5.1，spec「AI 模型连接与用量」）。
 *
 * - 准入 `ai:connection:manage`（RBAC 事实源 `start/rbac/permissions.ts`）：
 *   无权限时渲染受限横幅且底层接口 0 请求（RL-06）；
 * - 列表呈现模型通道、提供商协议、状态与密钥配置情况；
 * - 新建/编辑连接对话框（ConnectionFormDialog）：models.dev 目录、多模型、RPM/TPM、
 *   token 上限与能力勾选；API Key 字段为密码态，保存后由服务端加密存储，**前端永不回显明文**；
 * - 连通性测试：调用 `POST /ai/connections/:id/test`，回显延迟与检测状态；
 *   未启用连接先行提示「请你先启用之后才可以测试」，不发请求；
 * - 删除连接：强二次确认弹窗（说明对模型路由与任务的影响），不静默失败；
 * - 暗黑仪器感 `--nx-*` 令牌，1px 发丝线，精确档（precise）动效归零，三态闭环。
 */

export interface AiConnectionsWorkspaceProps {
  className?: string
}

const AI_CONNECTIONS_QUERY_KEY = ['ai', 'connections'] as const

/** 未启用连接点击测试时的本地拦截文案（不发请求）。 */
const ENABLE_BEFORE_TEST_MESSAGE = '请你先启用之后才可以测试'

/** 卡片模型 chip 的 token 规格格式化（1M / 128K）。 */
function formatTokens(value: number | null | undefined): string {
  if (!value) return ''
  if (value >= 1_000_000) return `${value / 1_000_000}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(value)
}

/** 列表为空时以主模型字段回退展示（兼容未拆模型行的旧数据）。 */
function fallbackModels(
  conn: AiConnectionDto,
): Pick<
  AiConnectionModelDto,
  | 'id'
  | 'modelName'
  | 'capabilities'
  | 'contextWindowTokens'
  | 'rpmLimit'
  | 'tpmLimit'
  | 'isActive'
  | 'pricingSnapshotId'
>[] {
  if (conn.models.length > 0) return conn.models
  return [
    {
      id: `${conn.id}-legacy`,
      modelName: conn.model,
      capabilities: [],
      contextWindowTokens: null,
      rpmLimit: null,
      tpmLimit: null,
      isActive: conn.isActive,
      pricingSnapshotId: null,
    },
  ]
}

export function AiConnectionsWorkspace({ className }: AiConnectionsWorkspaceProps) {
  const tier = useImmersionTier()
  const { can } = usePermissions()
  const queryClient = useQueryClient()

  const hasManagePermission = can('ai:connection:manage')

  // 数据列表查询
  const listQuery = useQuery({
    queryKey: AI_CONNECTIONS_QUERY_KEY,
    queryFn: () => aiConnectionsApi.list(),
    enabled: hasManagePermission,
  })

  // 新建/编辑对话框状态：editing 为 null 表示新建
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<AiConnectionDto | null>(null)

  // 连通性测试状态映射 connectionId -> AiConnectionTestResult
  const [testResults, setTestResults] = React.useState<Record<string, AiConnectionTestResult>>({})
  const [testingId, setTestingId] = React.useState<string | null>(null)

  // 模型定价弹层（2026-10-01）：第三方中转/私有模型的价格在这里自动预填或人工填写。
  const [pricingTarget, setPricingTarget] = React.useState<AiConnectionDto | null>(null)

  // 删除二次确认状态
  const [deleteTarget, setDeleteTarget] = React.useState<AiConnectionDto | null>(null)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  function closeFormDialog() {
    setFormOpen(false)
    setEditing(null)
  }

  // 创建 Mutation
  const createMutation = useMutation({
    mutationFn: (input: ConnectionInput) => aiConnectionsApi.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AI_CONNECTIONS_QUERY_KEY })
      closeFormDialog()
    },
  })

  // 编辑 Mutation
  const updateMutation = useMutation({
    mutationFn: (args: { id: number; input: ConnectionInput }) =>
      aiConnectionsApi.update(args.id, args.input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AI_CONNECTIONS_QUERY_KEY })
      closeFormDialog()
    },
  })

  const formSubmitting = createMutation.isPending || updateMutation.isPending
  const formError =
    (createMutation.error as { message?: string } | null)?.message ||
    (updateMutation.error as { message?: string } | null)?.message ||
    null

  function handleFormSubmit(input: ConnectionInput) {
    if (editing) {
      updateMutation.mutate({ id: Number(editing.id), input })
    } else {
      createMutation.mutate(input)
    }
  }

  // 同协议内切换调用方式（协议下拉）
  const [protocolError, setProtocolError] = React.useState<Record<string, string>>({})
  const protocolMutation = useMutation({
    mutationFn: (input: { id: string; toolCallingMode: AiToolCallingMode }) =>
      aiConnectionsApi.update(Number(input.id), { toolCallingMode: input.toolCallingMode }),
    onSuccess: (_result, input) => {
      setProtocolError((prev) => ({ ...prev, [input.id]: '' }))
      void queryClient.invalidateQueries({ queryKey: AI_CONNECTIONS_QUERY_KEY })
    },
    onError: (err: unknown, input) => {
      const msg = (err as { message?: string })?.message || '切换连接协议失败'
      setProtocolError((prev) => ({ ...prev, [input.id]: msg }))
    },
  })

  // 启用 / 停用 Mutation
  const toggleMutation = useMutation({
    mutationFn: (input: { id: number; isActive: boolean }) =>
      aiConnectionsApi.update(input.id, { isActive: input.isActive }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AI_CONNECTIONS_QUERY_KEY })
    },
  })

  // 删除 Mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) => aiConnectionsApi.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AI_CONNECTIONS_QUERY_KEY })
      setDeleteTarget(null)
      setDeleteError(null)
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message || '删除连接失败'
      setDeleteError(msg)
    },
  })

  // 连通性测试 Mutation
  const testMutation = useMutation({
    mutationFn: (id: number) => aiConnectionsApi.test(id),
    onSuccess: (result, id) => {
      setTestResults((prev) => ({ ...prev, [String(id)]: result }))
      setTestingId(null)
    },
    onError: (err: unknown, id) => {
      const msg = (err as { message?: string })?.message || '连通性测试异常'
      setTestResults((prev) => ({
        ...prev,
        [String(id)]: {
          ok: false,
          latencyMs: 0,
          model: null,
          detectedCapabilities: {},
          errorMessage: msg,
        },
      }))
      setTestingId(null)
    },
  })

  function handleTestConnection(conn: AiConnectionDto) {
    const numericId = Number(conn.id)
    // 未启用连接：本地拦截并提示，不发请求（与旧版口径一致）
    if (!conn.isActive) {
      setTestResults((prev) => ({
        ...prev,
        [conn.id]: {
          ok: false,
          latencyMs: 0,
          model: null,
          detectedCapabilities: {},
          errorKind: 'VALIDATION_ERROR',
          errorMessage: ENABLE_BEFORE_TEST_MESSAGE,
        },
      }))
      return
    }
    setTestingId(conn.id)
    testMutation.mutate(numericId)
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return
    deleteMutation.mutate(Number(deleteTarget.id))
  }

  // 新建/编辑连接弹层：在途提交拒绝 Escape 关闭，与「取消」按钮禁用同口径。
  const formDialogRef = React.useRef<HTMLDivElement | null>(null)
  useDialogA11y({
    ref: formDialogRef,
    open: formOpen,
    onClose: closeFormDialog,
    canClose: () => !createMutation.isPending && !updateMutation.isPending,
  })

  // 删除二次确认弹层（role="alertdialog"）：在途删除拒绝 Escape 关闭
  const deleteDialogRef = React.useRef<HTMLDivElement | null>(null)
  const closeDeleteDialog = React.useCallback(() => {
    setDeleteTarget(null)
    setDeleteError(null)
  }, [])
  useDialogA11y({
    ref: deleteDialogRef,
    open: deleteTarget !== null,
    onClose: closeDeleteDialog,
    canClose: () => !deleteMutation.isPending,
  })

  // 无查看/管理权限阻断：受限横幅且 0 请求（RL-06）
  if (!hasManagePermission) {
    return (
      <div
        data-permission-fallback
        className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
      >
        <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
        <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
          没有 AI 连接管理权限
        </h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          管理 AI 模型网关连接需要 ai:connection:manage 权限。请联系组织管理员为你授权。
        </p>
      </div>
    )
  }

  const connections = listQuery.data ?? []

  return (
    <div
      data-ai-connections-workspace
      data-immersion={tier}
      className={cn('flex flex-col gap-6', className)}
    >
      {/* 头部标题与操作区 */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <Bot className="h-5 w-5 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-[var(--nx-text-primary)]">AI 模型连接</h1>
            <p className="mt-0.5 text-xs text-[var(--nx-text-muted)]">
              配置并管理组织的 AI 模型网关与外部连接通道。API Key
              由服务端加密存储，前端永不回显明文。
            </p>
          </div>
        </div>

        <div className="flex max-w-full flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="refresh-connections-button"
            onClick={() => void listQuery.refetch()}
            disabled={listQuery.isFetching}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-50"
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', listQuery.isFetching && 'animate-spin')}
              aria-hidden
            />
            刷新
          </button>
          <button
            type="button"
            data-testid="create-connection-button"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-accent)] bg-[var(--nx-accent)] px-3 text-xs font-medium text-black transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            新建连接
          </button>
        </div>
      </header>

      {/* 主视图三态处理 */}
      {listQuery.isLoading ? (
        <div
          data-ai-connections-skeleton
          aria-busy="true"
          className="flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-6"
        >
          <div className="h-5 w-48 animate-pulse rounded bg-[var(--nx-border-hairline)]" />
          <div className="h-16 w-full animate-pulse rounded bg-[var(--nx-border-hairline)]" />
          <div className="h-16 w-full animate-pulse rounded bg-[var(--nx-border-hairline)]" />
        </div>
      ) : listQuery.isError ? (
        <div
          data-ai-connections-error
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-12 text-center"
        >
          <ShieldAlert className="h-7 w-7 text-[var(--nx-status-warning)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-secondary)]">无法载入 AI 模型连接列表</p>
          <button
            type="button"
            data-testid="retry-connections-button"
            onClick={() => void listQuery.refetch()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重新载入
          </button>
        </div>
      ) : connections.length === 0 ? (
        <div
          data-ai-connections-empty
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-14 text-center"
        >
          <KeyRound className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-sm font-medium text-[var(--nx-text-secondary)]">暂无 AI 模型连接</h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            添加你的第一个模型通道连接后，系统将能够通过该连接驱动大模型编译、路由与生成任务。
          </p>
          <button
            type="button"
            data-testid="empty-create-button"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
            className="mt-2 flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-accent)] bg-[var(--nx-accent)] px-3.5 text-xs font-medium text-black transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            新建第一个连接
          </button>
        </div>
      ) : (
        <div data-ai-connections-list className="grid gap-4">
          {connections.map((conn) => {
            const testResult = testResults[conn.id]
            const isTesting = testingId === conn.id
            const modelChips = fallbackModels(conn)
            const testedModelCount = testResult?.results?.length ?? 0
            const failedModelCount = testResult?.results?.filter((result) => !result.ok).length ?? 0

            return (
              <div
                key={conn.id}
                data-ai-connection-card={conn.id}
                className="flex flex-col gap-3.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4 transition-colors hover:border-[rgba(255,255,255,0.15)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] pb-3">
                  <div className="flex w-full min-w-0 flex-wrap items-center gap-2.5 sm:w-auto">
                    {conn.catalogProviderLogoUrl ? (
                      <img
                        src={conn.catalogProviderLogoUrl}
                        alt={conn.catalogProviderName ?? conn.displayName}
                        className="h-5 w-5 shrink-0 rounded-sm"
                      />
                    ) : null}
                    <span className="text-sm font-semibold text-[var(--nx-text-primary)]">
                      {conn.displayName}
                    </span>
                    {/* 连接协议（含调用方式）：同协议内可直接切换，跨协议需新建连接 */}
                    <select
                      aria-label="连接协议"
                      title="「提示词 JSON」适用于任何模型；原生工具方式让 AI 同事用供应商原生的工具调用理解操作指令，调用失败会自动改用提示词 JSON。"
                      data-testid={`protocol-variant-${conn.id}`}
                      value={findProtocolVariant(conn.protocol, conn.toolCallingMode).key}
                      disabled={protocolMutation.isPending}
                      onChange={(e) => {
                        const variant = AI_CONNECTION_PROTOCOL_VARIANTS.find(
                          (item) => item.key === e.target.value,
                        )
                        if (variant) {
                          protocolMutation.mutate({
                            id: conn.id,
                            toolCallingMode: variant.toolCallingMode,
                          })
                        }
                      }}
                      className="w-full min-w-0 max-w-full rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:opacity-50"
                    >
                      {AI_CONNECTION_PROTOCOL_VARIANTS.filter(
                        (variant) => variant.protocol === conn.protocol,
                      ).map((variant) => (
                        <option key={variant.key} value={variant.key}>
                          {variant.label}
                        </option>
                      ))}
                    </select>
                    {protocolError[conn.id] ? (
                      <span className="text-[10px] text-[var(--nx-status-danger)]">
                        {protocolError[conn.id]}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                        conn.isActive
                          ? 'border border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.1)] text-[var(--nx-status-success)]'
                          : 'border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-muted)]',
                      )}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          conn.isActive
                            ? 'bg-[var(--nx-status-success)]'
                            : 'bg-[var(--nx-text-muted)]',
                        )}
                      />
                      {conn.isActive ? '已激活' : '未激活'}
                    </span>
                  </div>

                  <div className="flex max-w-full flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid={`pricing-connection-${conn.id}`}
                      onClick={() => setPricingTarget(conn)}
                      className="flex h-7 items-center gap-1.5 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
                    >
                      <Coins className="h-3 w-3 text-[var(--nx-accent)]" aria-hidden />
                      模型定价
                    </button>

                    <button
                      type="button"
                      data-testid={`test-connection-${conn.id}`}
                      onClick={() => handleTestConnection(conn)}
                      disabled={isTesting}
                      className="flex h-7 items-center gap-1.5 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-50"
                    >
                      {isTesting ? (
                        <Loader2 className="h-3 w-3 animate-spin text-[var(--nx-accent)]" />
                      ) : (
                        <Activity className="h-3 w-3 text-[var(--nx-accent)]" />
                      )}
                      {isTesting ? '测试中…' : '测试连通性'}
                    </button>

                    <button
                      type="button"
                      data-testid={`edit-connection-${conn.id}`}
                      onClick={() => {
                        setEditing(conn)
                        setFormOpen(true)
                      }}
                      className="flex h-7 items-center gap-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
                      title="编辑连接"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      编辑
                    </button>

                    <button
                      type="button"
                      data-testid={`toggle-connection-${conn.id}`}
                      onClick={() =>
                        toggleMutation.mutate({ id: Number(conn.id), isActive: !conn.isActive })
                      }
                      disabled={toggleMutation.isPending}
                      className={cn(
                        'flex h-7 items-center gap-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs transition-colors disabled:opacity-50',
                        conn.isActive
                          ? 'text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]'
                          : 'text-[var(--nx-status-success)] hover:border-[rgba(16,185,129,0.4)] hover:bg-[rgba(16,185,129,0.1)]',
                      )}
                      title={conn.isActive ? '停用连接' : '启用连接'}
                    >
                      <Power className="h-3.5 w-3.5" aria-hidden />
                      {conn.isActive ? '停用' : '启用'}
                    </button>

                    <button
                      type="button"
                      data-testid={`delete-connection-${conn.id}`}
                      onClick={() => setDeleteTarget(conn)}
                      className="flex h-7 items-center gap-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-status-danger)] transition-colors hover:border-[rgba(239,68,68,0.4)] hover:bg-[rgba(239,68,68,0.1)]"
                      title="删除连接"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      删除
                    </button>
                  </div>
                </div>

                {/* 连接元数据详情 */}
                <div className="grid grid-cols-1 gap-2 text-xs text-[var(--nx-text-secondary)] sm:grid-cols-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[var(--nx-text-muted)]">供应商:</span>
                    <span className="truncate text-[var(--nx-text-primary)]">
                      {conn.catalogProviderName ?? '未绑定目录'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[var(--nx-text-muted)]">接口地址:</span>
                    <span
                      className="truncate font-mono text-[var(--nx-text-primary)]"
                      title={conn.baseUrl ?? '系统默认'}
                    >
                      {conn.baseUrl ?? '默认网关地址'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Lock className="h-3 w-3 text-[var(--nx-text-muted)]" />
                    <span className="text-[var(--nx-text-muted)]">密钥状态:</span>
                    <span
                      data-testid={`key-hint-${conn.id}`}
                      className="font-mono text-[var(--nx-text-primary)]"
                    >
                      {conn.hasKey
                        ? conn.keyHint
                          ? `已加密 (${conn.keyHint})`
                          : '已加密存储'
                        : '未配置密钥'}
                    </span>
                  </div>
                </div>

                {/* 模型清单（chip）：名称 · 上下文 · RPM/TPM · 快照价格 · 停用 */}
                <div className="flex flex-wrap gap-1.5">
                  {modelChips.map((model) => (
                    <span
                      key={model.id}
                      className="inline-flex items-center gap-1.5 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1 text-[11px] text-[var(--nx-text-secondary)]"
                    >
                      <span className="font-mono text-[var(--nx-text-primary)]">
                        {model.modelName}
                      </span>
                      {formatTokens(model.contextWindowTokens) ? (
                        <span className="text-[10px] text-[var(--nx-text-muted)]">
                          上下文 {formatTokens(model.contextWindowTokens)}
                        </span>
                      ) : null}
                      {model.rpmLimit ? (
                        <span className="text-[10px] text-[var(--nx-text-muted)]">
                          RPM {model.rpmLimit}
                        </span>
                      ) : null}
                      {model.tpmLimit ? (
                        <span className="text-[10px] text-[var(--nx-text-muted)]">
                          TPM {model.tpmLimit}
                        </span>
                      ) : null}
                      {model.pricingSnapshotId ? (
                        <span className="text-[10px] text-[var(--nx-status-success)]">
                          已快照价格
                        </span>
                      ) : null}
                      {!model.isActive ? (
                        <span className="text-[10px] text-[var(--nx-status-warning)]">停用</span>
                      ) : null}
                    </span>
                  ))}
                </div>

                {/* 连通性测试结果展示（多模型连接附逐模型明细） */}
                {testResult ? (
                  <div
                    data-testid={`test-result-${conn.id}`}
                    className={cn(
                      'mt-1 flex flex-col gap-2 rounded border p-2.5 text-xs',
                      testResult.ok
                        ? 'border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.06)] text-[var(--nx-status-success)]'
                        : 'border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.06)] text-[var(--nx-status-danger)]',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex max-w-full flex-wrap items-center gap-2">
                        {testResult.ok ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 shrink-0" />
                        )}
                        <span>
                          {testResult.ok
                            ? `连通测试通过 · 往返延迟 ${testResult.latencyMs}ms`
                            : testedModelCount > 1
                              ? `连通失败: ${failedModelCount}/${testedModelCount} 个模型未通过 · ${testResult.errorMessage || testResult.errorKind || '网关响应超时'}`
                              : `连通失败: ${testResult.errorMessage || testResult.errorKind || '网关响应超时'}`}
                        </span>
                      </div>
                      {testResult.usage?.totalTokens ? (
                        <span className="text-[10px] text-[var(--nx-text-muted)]">
                          消耗 Token: {testResult.usage.totalTokens}
                        </span>
                      ) : null}
                    </div>
                    {testResult.results && testResult.results.length > 1 ? (
                      <div className="flex flex-col gap-1 border-t border-[var(--nx-border-hairline)] pt-2">
                        {testResult.results.map((item) => (
                          <div
                            key={item.modelId}
                            data-testid={`test-result-model-${conn.id}-${item.modelId}`}
                            className="flex max-w-full flex-wrap items-center gap-2"
                          >
                            {item.ok ? (
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            )}
                            <span
                              className={cn(
                                'font-mono',
                                item.ok
                                  ? 'text-[var(--nx-status-success)]'
                                  : 'text-[var(--nx-status-danger)]',
                              )}
                            >
                              {item.modelName}
                            </span>
                            <span
                              className={cn(
                                'min-w-0 truncate text-[10px]',
                                item.ok
                                  ? 'text-[var(--nx-text-muted)]'
                                  : 'text-[var(--nx-status-danger)]',
                              )}
                            >
                              {item.ok
                                ? `通过 · ${item.latencyMs}ms`
                                : item.errorMessage || item.errorKind || '测试失败'}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {/* 网页搜索连接方式（AI 同事联网搜索的提供方与开关） */}
      <WebSearchConnectionCard />

      {/* 新建/编辑连接对话框（表单本体见 ConnectionFormDialog） */}
      {formOpen ? (
        <ConnectionFormDialog
          initial={editing}
          submitting={formSubmitting}
          error={formError}
          onClose={closeFormDialog}
          onSubmit={handleFormSubmit}
          containerRef={formDialogRef}
        />
      ) : null}

      {/* 删除二次确认对话框 */}
      {deleteTarget ? (
        <div
          ref={deleteDialogRef}
          tabIndex={-1}
          data-testid="delete-confirm-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-confirm-title"
        >
          <div className="w-full max-w-md rounded-lg border border-[rgba(239,68,68,0.3)] bg-[var(--nx-workspace-surface)] p-6 shadow-2xl">
            <div className="flex items-center gap-2.5 text-[var(--nx-status-danger)]">
              <ShieldAlert className="h-5 w-5" aria-hidden />
              <h3 id="delete-confirm-title" className="text-base font-semibold">
                删除 AI 模型连接确认
              </h3>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-[var(--nx-text-secondary)]">
              确定要删除 AI 连接「
              <strong className="text-[var(--nx-text-primary)]">{deleteTarget.displayName}</strong>
              」吗？ 删除后，依赖此连接的模型路由与自动化任务将无法调用该模型。此操作无法撤销。
            </p>

            {deleteError ? (
              <div
                role="alert"
                className="mt-3 flex items-center gap-2 rounded border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] p-2.5 text-xs text-[var(--nx-status-danger)]"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{deleteError}</span>
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                data-testid="cancel-delete-button"
                onClick={() => {
                  setDeleteTarget(null)
                  setDeleteError(null)
                }}
                disabled={deleteMutation.isPending}
                className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="confirm-delete-button"
                onClick={handleDeleteConfirm}
                disabled={deleteMutation.isPending}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-status-danger)] bg-[var(--nx-status-danger)] px-3.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {deleteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pricingTarget ? (
        <ModelPricingDialog connection={pricingTarget} onClose={() => setPricingTarget(null)} />
      ) : null}
    </div>
  )
}

export default AiConnectionsWorkspace
