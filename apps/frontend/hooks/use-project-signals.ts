'use client'

import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  PROJECT_SIGNAL_CARD_FILTERS,
  ROLE_SIGNAL_QUEUE_FILTERS,
  organizationSignalKeys,
  organizationSignalsApi,
  projectSignalKeys,
  projectSignalsApi,
  type ProjectSignal,
  type ProjectSignalAdoptInput,
  type ProjectSignalListFilters,
  type ProjectSignalSeverity,
} from '@/lib/api/project-signals'
import { useAuthStore } from '@/stores/auth-store'

/**
 * 被动雷达信号 TanStack Query hooks（v3-triz-copilot-followups · tasks 6.1）。
 *
 * - `useProjectSignals`：单项目信号列表（项目空间信号卡与任意项目维度视图共用）；
 * - `useRoleSignalQueue`：角色首页建议队列——单次请求调用组织级端点
 *   （`GET /api/v1/organizations/:organizationId/signals`），全量拉取当前组织低置信信号；
 * - `useDismissProjectSignal` / `useAdoptProjectSignal`：状态流转（只有用户显式点击才会
 *   触发，RL-01：本模块无任何自动流转路径），成功后失效全部信号列表缓存。
 *
 * 契约与裁剪口径全部来自 `lib/api/project-signals.ts` 一份实现（design D10）。
 */

/** 严重度排序权重（颜色之外的第二通道；仅用于同窗内排序，不构成个人维度度量）。 */
const SEVERITY_RANK: Record<ProjectSignalSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
}

function severityRank(severity: ProjectSignalSeverity): number {
  return SEVERITY_RANK[severity] ?? 0
}

/** 单项目信号列表（`projectId <= 0` 或未认证时不发请求）。 */
export function useProjectSignals(
  projectId: number,
  filters: ProjectSignalListFilters = PROJECT_SIGNAL_CARD_FILTERS,
) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)

  return useQuery({
    queryKey: projectSignalKeys.list(projectId, filters),
    queryFn: () => projectSignalsApi.list(projectId, filters),
    enabled: isAuthenticated && Number.isFinite(projectId) && projectId > 0,
    retry: false,
    staleTime: 30_000,
  })
}

export interface RoleSignalQueueItem {
  signal: ProjectSignal
  projectId: number
  projectName: string
}

export interface RoleSignalQueueState {
  /** 已认证且组织上下文就绪时才为 true（否则组件不渲染任何信号痕迹）。 */
  enabled: boolean
  items: RoleSignalQueueItem[]
  isLoading: boolean
  isError: boolean
  error: unknown
  refetch: () => void
}

/**
 * 角色首页低置信信号建议队列数据源。
 *
 * 路由口径：`status=open` + `confidenceTier=low`（单次请求组织级端点，全量拉取）。
 */
export function useRoleSignalQueue(): RoleSignalQueueState {
  const hasHydrated = useAuthStore((state) => state.hasHydrated)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const orgId =
    currentOrganizationId !== null &&
    Number.isFinite(Number(currentOrganizationId)) &&
    Number(currentOrganizationId) > 0
      ? Number(currentOrganizationId)
      : null

  const enabled = hasHydrated && isAuthenticated && orgId !== null

  const signalsQuery = useQuery({
    queryKey: organizationSignalKeys.list(orgId ?? 0, ROLE_SIGNAL_QUEUE_FILTERS),
    queryFn: () => organizationSignalsApi.list(orgId ?? 0, ROLE_SIGNAL_QUEUE_FILTERS),
    enabled,
    retry: false,
    staleTime: 30_000,
  })

  const items = useMemo<RoleSignalQueueItem[]>(() => {
    const rawList = signalsQuery.data?.data ?? []
    return rawList
      .filter((signal) => signal.confidenceTier === 'low')
      .sort((left, right) => {
        const bySeverity = severityRank(right.severity) - severityRank(left.severity)
        if (bySeverity !== 0) return bySeverity
        return (right.createdAt ?? '').localeCompare(left.createdAt ?? '')
      })
      .map((signal) => ({
        signal,
        projectId: signal.projectId,
        projectName: signal.projectName ?? `项目 #${signal.projectId}`,
      }))
  }, [signalsQuery.data])

  const refetch = useCallback(() => {
    void signalsQuery.refetch()
  }, [signalsQuery])

  return {
    enabled,
    items,
    isLoading: enabled && signalsQuery.isPending,
    isError: signalsQuery.isError,
    error: signalsQuery.error,
    refetch,
  }
}

export interface DismissProjectSignalInput {
  projectId: number
  signalId: number
  note?: string | null
}

/** 忽略信号（`open → dismissed`）；同观测窗不复发由后端保证。 */
export function useDismissProjectSignal() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: (input: DismissProjectSignalInput) =>
      projectSignalsApi.dismiss(input.projectId, input.signalId, input.note),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: projectSignalKeys.all })
      void client.invalidateQueries({ queryKey: organizationSignalKeys.all })
    },
  })
}

export interface AdoptProjectSignalInput extends DismissProjectSignalInput {
  analysisId?: number | null
}

/**
 * 采纳信号（`open → adopted`）。
 *
 * 承接方为矛盾求解链：用户在对话流完成一次落库确认后，由该链路携带
 * `analysisId` 调用，形成「信号 ↔ 分析」双向可追溯（spec「信号到矛盾求解流的跳转」第 4/5 条）。
 * 本组件（建议队列 / 信号卡）**不**直接发 adopt——无分析记录的提前采纳会抢占后续
 * 带 `analysisId` 的采纳（后端只允许 `open → adopted` 一次）。
 */
export function useAdoptProjectSignal() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: (input: AdoptProjectSignalInput) =>
      projectSignalsApi.adopt(input.projectId, input.signalId, {
        analysisId: input.analysisId ?? null,
        note: input.note ?? null,
      } satisfies ProjectSignalAdoptInput),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: projectSignalKeys.all })
      void client.invalidateQueries({ queryKey: organizationSignalKeys.all })
    },
  })
}
