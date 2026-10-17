'use client'

/**
 * v3-copilot-live-submission-channel —— 面板补全数据源（任务 6.1 / 6.7）。
 *
 * 此前 `CopilotPanelInput` 把 `slashCommands` 硬编码成空数组、`queryMentions`
 * 直接 `return []`，导致 `/` 与 `@` 弹出的列表**永远为空**，且路由规则管线的
 * 最高优先级「显式斜杠命令」永远走不到。本 hook 把两者接到真实来源：
 *
 * - 斜杠命令：既有 `deriveCommands`（与上下文芯片同一派生函数，故两处可用性一致）；
 * - 提及候选：既有 `GET /api/v1/search/suggestions`（12 类 adapter，权限与
 *   组织过滤留在 `search_service` 内，不新建索引也不做二次过滤放宽）。
 */

import * as React from 'react'
import { usePathname, useParams, useSearchParams } from 'next/navigation'
import type { CommandDescriptor, CompletionMentionCandidate } from '@aiproj/types'
import type { CopilotPageContextDescriptorV1 } from '@aiproj/types'
import { COPILOT_SUB_INTENT_REGISTRY, DEFAULT_MAX_CANDIDATES } from '@aiproj/types'
import { usePermissions } from '@/hooks/use-permissions'
import { useCommandRegistryStore } from '@/lib/command-registry/store'
import type { RegisteredCommand } from '@/lib/command-registry/types'
import { deriveCommands } from '@/lib/copilot/completion-derivation'
import { toMentionCandidates } from '@/lib/copilot/mention-candidates'
import { derivePageContextDescriptor } from '@/lib/copilot/page-context'
import { searchApi } from '@/lib/api/search'

export interface CopilotCompletions {
  /** 当前上下文下可用的斜杠命令（已排序、过滤、去重）。 */
  readonly slashCommands: readonly CommandDescriptor[]
  /** 提及候选查询函数（供 MentionCompletion 消费）。 */
  readonly queryMentions: (prefix: string) => Promise<CompletionMentionCandidate[]>
  /** 当前路由（回合请求的规则强度输入）。 */
  readonly currentRoute: string
  /**
   * 版本化页面语境描述符（v3-copilot-authoritative-page-context）。
   *
   * 由 pathname/params/searchParams 确定性派生，只含结构化可见状态；
   * 不读取 DOM。随回合提交作**候选**，授权由服务端重新解析。
   */
  readonly pageContext: CopilotPageContextDescriptorV1 | null
}

/**
 * 当前上下文的补全数据源。
 *
 * 能力开关与授权门登记暂为空对象/空数组——缺席即「可用」，与路由侧
 * 非泄露语义一致；组织级开关落地后由其 change 填充，此处不另建并行表。
 */
export function useCopilotCompletions(): CopilotCompletions {
  const pathname = usePathname()
  const params = useParams()
  const searchParams = useSearchParams()
  const { permissions } = usePermissions()
  const commandsMap = useCommandRegistryStore((s) => s.commands)

  const currentRoute = pathname ?? '/'

  const allCommands = React.useMemo<RegisteredCommand[]>(
    () => Array.from(commandsMap.values()),
    [commandsMap],
  )

  const commandContext = React.useMemo(
    () => ({
      pathname: currentRoute,
      params: (params ?? {}) as Record<string, string | string[]>,
      searchParams: searchParams ?? new URLSearchParams(),
    }),
    [currentRoute, params, searchParams],
  )

  const permissionList = React.useMemo(() => [...(permissions ?? [])], [permissions])

  const scope = React.useMemo(
    () => (currentRoute.startsWith('/projects/') ? 'project' : 'global'),
    [currentRoute],
  )

  // v3-copilot-authoritative-page-context：结构化页面语境（确定性派生，不读 DOM）。
  const pageContext = React.useMemo(
    () =>
      derivePageContextDescriptor({
        pathname: currentRoute,
        params: (params ?? {}) as Record<string, string | string[]>,
        searchParams: searchParams ?? new URLSearchParams(),
      }),
    [currentRoute, params, searchParams],
  )

  const slashCommands = React.useMemo(
    () =>
      deriveCommands(allCommands, COPILOT_SUB_INTENT_REGISTRY, {
        commandContext,
        permissions: permissionList,
        scope,
        enabledDestinations: {},
        authorizationGatedDestinations: [],
      }),
    [allCommands, commandContext, permissionList, scope],
  )

  const queryMentions = React.useCallback(
    async (prefix: string): Promise<CompletionMentionCandidate[]> => {
      const keyword = prefix.trim()
      if (keyword.length === 0) return []
      try {
        const response = await searchApi.suggestions(keyword, DEFAULT_MAX_CANDIDATES)
        const suggestions = Array.isArray(response?.data) ? response.data : []
        return [...toMentionCandidates(suggestions, DEFAULT_MAX_CANDIDATES)]
      } catch {
        // 建议查询失败按零结果处理：空态文案不声称「不存在该实体」（任务 6.6）
        return []
      }
    },
    [],
  )

  return { slashCommands, queryMentions, currentRoute, pageContext }
}
