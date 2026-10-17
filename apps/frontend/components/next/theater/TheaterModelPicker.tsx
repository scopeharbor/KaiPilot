'use client'

import * as React from 'react'
import { Cpu } from 'lucide-react'
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query'
import type { AiConnectionModelDto } from '@aiproj/types'
import { aiConnectionsApi } from '@/lib/api/ai-connections'
import { useAuthStore } from '@/stores/auth-store'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

function canGenerateDraft(model: AiConnectionModelDto) {
  return (
    model.isActive &&
    (model.capabilities.includes('project_draft') || model.capabilities.includes('chat'))
  )
}

/** 与旧版生成工作台共用同一个存储键：两边切换时沿用同一个模型选择。 */
export function modelSelectionStorageKey(
  userId: string | number | null | undefined,
  organizationId: string | number | null,
) {
  return `ai-draft:model-selection:v1:${organizationId ?? 'none'}:${userId ?? 'anonymous'}`
}

let fallbackClient: QueryClient | null = null

/**
 * 生成剧场的模型选择（新版原先没有：澄清因此退回固定问卷、生成用服务端默认模型）。
 * 所选模型同时用于澄清对话、项目理解与草案生成；上次选择按用户 + 组织记住。
 */
export function TheaterModelPicker() {
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const organizationId = useAiProjectDraftStore((state) => state.organizationId)
  const selection = useAiProjectDraftStore((state) => state.modelSelection)
  const provided = React.useContext(QueryClientContext)
  const client = provided ?? (fallbackClient ??= new QueryClient())
  const { data, isLoading } = useQuery(
    {
      queryKey: ['ai-connections', 'draft-selector'],
      queryFn: aiConnectionsApi.list,
      retry: false,
    },
    client,
  )
  const options = React.useMemo(
    () =>
      (data ?? [])
        .filter((connection) => connection.isActive)
        .flatMap((connection) =>
          connection.models.filter(canGenerateDraft).map((model) => ({
            key: `${connection.id}:${model.id}`,
            connectionId: Number(connection.id),
            modelId: Number(model.id),
            label: `${connection.displayName} · ${model.catalogMetadata?.modelName ?? model.modelName}`,
          })),
        ),
    [data],
  )

  // 首次载入：恢复上次选择；无记录或已失效则默认第一个可用模型。
  React.useEffect(() => {
    if (isLoading || options.length === 0) return
    const current = options.find(
      (option) =>
        option.connectionId === selection?.connectionId && option.modelId === selection?.modelId,
    )
    if (current) return
    let restored = options[0]!
    try {
      const saved = window.localStorage.getItem(modelSelectionStorageKey(userId, organizationId))
      if (saved) {
        const parsed = JSON.parse(saved) as { connectionId?: string; modelId?: string }
        restored =
          options.find(
            (option) =>
              option.connectionId === Number(parsed.connectionId) &&
              option.modelId === Number(parsed.modelId),
          ) ?? restored
      }
    } catch {
      // 读不到本地记录不影响使用，按默认模型继续。
    }
    useAiProjectDraftStore
      .getState()
      .setModelSelection({ connectionId: restored.connectionId, modelId: restored.modelId })
  }, [isLoading, options, selection, userId, organizationId])

  if (options.length === 0) return null
  const value = selection ? `${selection.connectionId}:${selection.modelId}` : ''

  return (
    <label
      className="flex items-center gap-1.5 text-xs text-[var(--nx-text-muted)]"
      data-model-picker
    >
      <Cpu className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only">生成使用的模型</span>
      <select
        aria-label="生成使用的模型"
        value={value}
        onChange={(event) => {
          const option = options.find((item) => item.key === event.target.value)
          if (!option) return
          useAiProjectDraftStore
            .getState()
            .setModelSelection({ connectionId: option.connectionId, modelId: option.modelId })
          try {
            window.localStorage.setItem(
              modelSelectionStorageKey(userId, organizationId),
              JSON.stringify({
                connectionId: String(option.connectionId),
                modelId: String(option.modelId),
              }),
            )
          } catch {
            // 存储不可用时本次选择仍然生效。
          }
        }}
        className="max-w-[260px] truncate rounded border border-[var(--nx-border-hairline)] bg-transparent px-1.5 py-0.5 text-xs text-[var(--nx-text-secondary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
