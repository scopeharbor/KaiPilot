/**
 * v2-5-compiler-dynamic-routing-management-ui —— Compiler Routing 管理 API 客户端。
 *
 * 切片 A：只读注册表快照 + per-run 决策证据
 * 切片 C：只读路由模拟
 * 切片 B：受控规则编排（预览→确认两步）
 */
import { apiFetch } from '@/lib/api-client'
import type {
  RoutingRegistrySnapshotView,
  RoutingDecisionSummaryView,
  RoutingSimulateRequest,
  RoutingSimulateResponse,
  RoutingRuleAuthoringRequest,
  RoutingRulePreviewResponse,
  RoutingRuleCommittedView,
} from '@aiproj/types/compiler-dynamic-routing'

export const compilerRoutingApi = {
  /** 切片 A：获取路由规则注册表快照。 */
  getRules: () => apiFetch<{ data: RoutingRegistrySnapshotView }>('/ai/compiler/routing/rules'),

  /** 切片 A：获取 per-run 路由决策证据。 */
  getRunRoutingDecision: (runId: number) =>
    apiFetch<{ data: RoutingDecisionSummaryView }>(`/ai/compiler/runs/${runId}/routing-decision`),

  /** 切片 C：只读路由模拟（dry-run）。 */
  simulate: (input: RoutingSimulateRequest) =>
    apiFetch<{ data: RoutingSimulateResponse }>('/ai/compiler/routing/simulate', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** 切片 B：预览规则变更（确认前不落库）。 */
  previewRule: (request: RoutingRuleAuthoringRequest) =>
    apiFetch<{ data: RoutingRulePreviewResponse }>('/ai/compiler/routing/rules', {
      method: 'POST',
      body: JSON.stringify(request),
    }),

  /** 切片 B：确认并落库规则变更。 */
  confirmRule: (confirmToken: string) =>
    apiFetch<{ data: RoutingRuleCommittedView }>('/ai/compiler/routing/rules', {
      method: 'PATCH',
      body: JSON.stringify({ confirmToken }),
    }),
}
