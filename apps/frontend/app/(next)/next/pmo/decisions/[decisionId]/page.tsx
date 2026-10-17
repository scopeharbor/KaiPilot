'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { PmoDecisionDetailWorkspace } from '@/components/next/pmo/decisions/PmoDecisionDetailWorkspace'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'

/**
 * PMO 决策议题详情路由（/next/pmo/decisions/[decisionId]，
 * v3-ui-next-pmo-domain W6 · tasks 6.3，spec「决策工作台详情与人工结论闭环」）。
 *
 * - 页面级门禁：`pmo_decision:view`（与后端 DecisionWorkbenchPolicy 同串）——
 *   无权渲染受限横幅且全部决策接口零请求（RL-06）；
 * - 组织上下文未水合 → 中性引导态（零请求）；
 * - **非数字/非正整数 decisionId：前端零发包渲染中性 404**（RL-05）——解析非法即
 *   渲染中性空态，不挂载工作台（全部 useDecision* 查询随之不发起）；
 *   跨组织/接口 404 的中性 404 由工作台内 caseQuery 判定后同态呈现；
 * - 该页不读 useSearchParams，无需 Suspense 边界。
 */
export default function PmoDecisionDetailPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  const params = useParams<{ decisionId: string }>()
  const raw = params?.decisionId
  const parsed = raw === undefined ? NaN : Number(raw)
  const isValidId = raw !== undefined && /^\d+$/.test(raw) && Number.isInteger(parsed) && parsed > 0

  return (
    <PermissionGuard
      require={['pmo_decision:view']}
      fallback={
        <div
          data-permission-fallback
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看 PMO 决策工作台的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            需要 pmo_decision:view 权限。请联系组织管理员授予权限。
          </p>
        </div>
      }
    >
      {organizationId === null ? (
        <div
          data-org-no-organization
          className="flex min-h-[60vh] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">请先选择组织</h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            决策工作台需要有效租户上下文。请先切换到组织工作区后重试。
          </p>
        </div>
      ) : isValidId ? (
        <PmoDecisionDetailWorkspace decisionId={parsed} />
      ) : (
        <NeutralNotFound />
      )}
    </PermissionGuard>
  )
}

/** 中性 404 空态（RL-05）：文案不泄露「不存在/跨组织/无权」等区分线索。 */
export function NeutralNotFound() {
  return (
    <div
      data-pmo-decision-not-found
      role="status"
      aria-label="议题不存在"
      className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-10 text-center"
    >
      <ShieldAlert className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
      <h3 className="text-base font-medium text-[var(--nx-text-primary)]">议题不存在</h3>
      <p className="text-xs leading-relaxed text-[var(--nx-text-muted)]">
        该决策议题不存在或已下线。
      </p>
      <a
        href="/next/pmo/decisions"
        data-pmo-decision-not-found-back
        className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-4 text-sm text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)]"
      >
        返回决策队列
      </a>
    </div>
  )
}
