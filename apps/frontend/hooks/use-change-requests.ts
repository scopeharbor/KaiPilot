'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { projectMembersApi } from '@/lib/api/projects'
import {
  changeRequestKeys,
  listChangeRequests,
  getChangeRequest,
  createChangeRequest,
  updateChangeRequest,
  submitChangeRequest,
  approveChangeRequest,
  rejectChangeRequest,
  returnChangeRequest,
  markImplementedChangeRequest,
  closeChangeRequest,
  cancelChangeRequest,
  type ChangeRequestImpactSummary,
  type ChangeRequestListFilters,
  type ChangeRequestPriority,
  type ChangeRequestType,
} from '@/lib/api/change-requests'

/**
 * 变更请求域数据层 Hook（v3-ui-next-risk-change-domains W2 · tasks 2.1–2.10）。
 *
 * - 查询键完全复用 `changeRequestKeys`（lib/api/change-requests.ts），与设计
 *   Decision 3 的 QueryKey 拓扑一致（`['change-requests','list',projectId,filters]`
 *   与 `['change-requests','detail',id]`）；
 * - 每个变更写操作成功后按 design Decision 3 失效「列表 + 详情」两级缓存，
 *   详情页审批后列表徽标随之刷新（RL-04 一致性）；
 * - 纯数据层，零视觉依赖；供 W2 页面群与 W3 ProjectDomainMenu 徽标共用。
 */

/** 列表查询：变更主页多维筛选 + 分页（全部由服务端过滤）。 */
export function useChangeRequests(projectId: number, filters: ChangeRequestListFilters = {}) {
  return useQuery({
    queryKey: changeRequestKeys.list(projectId, filters),
    queryFn: () => listChangeRequests(projectId, filters),
    enabled: projectId > 0,
  })
}

/** 详情查询：单一变更请求（含 V2 影响分析引用字段）。 */
export function useChangeRequestDetail(changeRequestId: number) {
  return useQuery({
    queryKey: changeRequestKeys.detail(changeRequestId),
    queryFn: () => getChangeRequest(changeRequestId),
    enabled: changeRequestId > 0,
  })
}

export interface CreateChangeRequestInput {
  title: string
  description?: string
  changeType: ChangeRequestType
  priority: ChangeRequestPriority
  impactSummary?: ChangeRequestImpactSummary
}

function invalidateChangeRequestCaches(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['change-requests', 'list'] })
  queryClient.invalidateQueries({ queryKey: ['change-requests', 'detail'] })
}

/** 新建变更（草稿）：成功后失效全部变更列表缓存。 */
export function useCreateChangeRequest(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateChangeRequestInput) =>
      createChangeRequest(projectId, {
        title: input.title,
        description: input.description?.trim() === '' ? undefined : input.description?.trim(),
        changeType: input.changeType,
        priority: input.priority,
        impactSummary:
          input.impactSummary && Object.values(input.impactSummary).some(Boolean)
            ? input.impactSummary
            : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['change-requests'] })
    },
  })
}

/** 更新基本信息（草稿/退回态申请人编辑）：成功后失效列表 + 详情。 */
export function useUpdateChangeRequest(crId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateChangeRequestInput) =>
      updateChangeRequest(crId, {
        title: input.title,
        description: input.description?.trim() === '' ? undefined : input.description?.trim(),
        changeType: input.changeType,
        priority: input.priority,
        impactSummary:
          input.impactSummary && Object.values(input.impactSummary).some(Boolean)
            ? input.impactSummary
            : undefined,
      }),
    onSuccess: () => invalidateChangeRequestCaches(queryClient),
  })
}

/** 提交审批（草稿/退回态 → submitted）。 */
export function useSubmitChangeRequest(crId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => submitChangeRequest(crId),
    onSuccess: () => invalidateChangeRequestCaches(queryClient),
  })
}

export interface ApproveDecisionInput {
  decisionReason?: string
  conditions?: string
  impactAnalysisId?: number | null
  confirmStaleReason?: string | null
}

/** 批准：可携带决策理由、生效条件与影响分析快照引用（含过期确认理由）。 */
export function useApproveChangeRequest(crId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ApproveDecisionInput = {}) =>
      approveChangeRequest(crId, {
        decisionReason: input.decisionReason?.trim() ? input.decisionReason.trim() : undefined,
        conditions: input.conditions?.trim() ? input.conditions.trim() : undefined,
        impactAnalysisId: input.impactAnalysisId ?? null,
        confirmStaleReason: input.confirmStaleReason?.trim()
          ? input.confirmStaleReason.trim()
          : null,
      }),
    onSuccess: () => invalidateChangeRequestCaches(queryClient),
  })
}

/** 拒绝。 */
export function useRejectChangeRequest(crId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (
      input: Pick<
        ApproveDecisionInput,
        'decisionReason' | 'impactAnalysisId' | 'confirmStaleReason'
      > = {},
    ) =>
      rejectChangeRequest(crId, {
        decisionReason: input.decisionReason?.trim() ? input.decisionReason.trim() : undefined,
        impactAnalysisId: input.impactAnalysisId ?? null,
        confirmStaleReason: input.confirmStaleReason?.trim()
          ? input.confirmStaleReason.trim()
          : null,
      }),
    onSuccess: () => invalidateChangeRequestCaches(queryClient),
  })
}

/** 退回修改（审核中 → returned）。 */
export function useReturnChangeRequest(crId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { decisionReason?: string } = {}) =>
      returnChangeRequest(crId, {
        decisionReason: input.decisionReason?.trim() ? input.decisionReason.trim() : undefined,
      }),
    onSuccess: () => invalidateChangeRequestCaches(queryClient),
  })
}

/** 标记已实施（approved → implemented）。 */
export function useMarkImplementedChangeRequest(crId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => markImplementedChangeRequest(crId),
    onSuccess: () => invalidateChangeRequestCaches(queryClient),
  })
}

/** 关闭（implemented → closed）。 */
export function useCloseChangeRequest(crId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => closeChangeRequest(crId),
    onSuccess: () => invalidateChangeRequestCaches(queryClient),
  })
}

/** 取消（草稿/已提交/已批准/退回修改态）。 */
export function useCancelChangeRequest(crId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => cancelChangeRequest(crId),
    onSuccess: () => invalidateChangeRequestCaches(queryClient),
  })
}

export { changeRequestKeys }

// ---------------------------------------------------------------------------
// 项目成员（申请人/审批人名解析，低敏）
// ---------------------------------------------------------------------------

export interface CrActorNameMap {
  resolve: (userId: number | null) => string | null
}

/**
 * 项目成员名映射（申请人/审批人展示与筛选下拉共用）。
 *
 * - 数据源 `GET /projects/:projectId/members`（project:view，变更查看人必达）；
 * - 成员接口失败或加载中时静默降级：resolve 返回 null，调用方回退 '#id' 显示，
 *   绝不阻断变更列表/详情主流程（RL-06 副作用边界）。
 */
export function useProjectMembers(projectId: number) {
  return useQuery({
    queryKey: ['projects', 'detail', projectId, 'members'],
    queryFn: () => projectMembersApi.list(projectId),
    enabled: projectId > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

/** 从成员列表中构建 userId → fullName 映射（纯函数）。 */
export function buildMemberNameMap(
  members: Array<{ userId: number; user?: { fullName: string | null } | null }> | undefined,
): Map<number, string> {
  const map = new Map<number, string>()
  for (const member of members ?? []) {
    if (member.user?.fullName) map.set(member.userId, member.user.fullName)
  }
  return map
}
