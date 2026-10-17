import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  RationaleDetailResponse,
  RationaleFeedbackRequest,
  RationaleFeedbackSubmitResponse,
  RationaleHandoffRequest,
  RationaleHandoffResponse,
  DashboardRationaleSummary,
} from '@aiproj/types'

/**
 * v2-triz-recommendation-rationale-ui —— TRIZ 推荐理由前端 API 客户端。
 *
 * 只读 API + 反馈提交 + Draft Layer handoff 入口。
 * 读取操作绝不触发生成、刷新或 AIGateway 调用。
 */

// ---------------------------------------------------------------------------
// Query key 工厂
// ---------------------------------------------------------------------------

export const trizRationaleKeys = {
  all: ['triz-rationale'] as const,
  detail: (projectId: number, targetType: string, targetId: string) =>
    [...trizRationaleKeys.all, 'detail', projectId, targetType, targetId] as const,
  dashboardSummary: (projectId: number) =>
    [...trizRationaleKeys.all, 'dashboard', projectId] as const,
}

// ---------------------------------------------------------------------------
// API 路径
// ---------------------------------------------------------------------------

const rationalePath = (projectId: number, targetType: string, targetId: string) =>
  `/projects/${projectId}/triz-rationale/${targetType}/${targetId}`

// ---------------------------------------------------------------------------
// API 方法
// ---------------------------------------------------------------------------

export const trizRationaleApi = {
  /** 获取 TRIZ 推荐理由详情（只读）。 */
  detail: (projectId: number, targetType: string, targetId: string) =>
    apiFetchEnvelope<RationaleDetailResponse>(rationalePath(projectId, targetType, targetId)).then(
      (res) => res.data,
    ),

  /** 提交推荐理由反馈（非业务操作）。 */
  feedback: (
    projectId: number,
    targetType: string,
    targetId: string,
    payload: RationaleFeedbackRequest,
  ) =>
    apiFetchEnvelope<RationaleFeedbackSubmitResponse>(
      `${rationalePath(projectId, targetType, targetId)}/feedback`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      },
    ).then((res) => res.data),

  /** 从推荐理由面板进入 Draft Layer 审查（只创建待审上下文）。 */
  handoff: (
    projectId: number,
    targetType: string,
    targetId: string,
    payload?: RationaleHandoffRequest,
  ) =>
    apiFetchEnvelope<RationaleHandoffResponse>(
      `${rationalePath(projectId, targetType, targetId)}/handoff`,
      {
        method: 'POST',
        body: JSON.stringify(payload ?? {}),
        headers: { 'Content-Type': 'application/json' },
      },
    ).then((res) => res.data),

  /** 获取 Dashboard TRIZ 推荐理由摘要（只读）。 */
  dashboardSummary: (projectId: number) =>
    apiFetchEnvelope<{ data: DashboardRationaleSummary }>(
      `/projects/${projectId}/triz-rationale/dashboard-summary`,
    ).then((res) => res.data),
}

export default trizRationaleApi
