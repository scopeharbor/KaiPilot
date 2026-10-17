'use client'

import { ShieldAlert, Sparkles } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { PmoAiPriorityWorkspace } from '@/components/next/pmo/ai-priority/PmoAiPriorityWorkspace'

/**
 * PMO AI 优先级推荐路由（/next/pmo/ai-priority-recommendations，
 * v3-ui-next-pmo-domain W5 · tasks 5.1，spec「PMO AI 优先级推荐建议-审阅-采纳闭环」）。
 *
 * - 页面级读门禁：`portfolio:view`（与后端 PmoAiPriorityRecommendationPolicy 降级链
 *   view → portfolio:view 一致）；无权限渲染受限横幅且工作台不挂载、数据接口零请求
 *   （RL-06）；
 * - 组织级页面（无 projectId）：组织 ID 只取自 JWT 有效租户上下文，未选择组织渲染
 *   「请先选择组织」引导态且零查询（RL-05）；推荐端点按 tenant middleware 解析组织，
 *   URL 不含 organizationId；
 * - 审阅动作显隐以 `recommendation:manage` 或 PMO 专用管理权限任一为准（design D5
 *   降级链 UI 镜像），服务端终裁；
 * - 后端 AI 优先级推荐路由尚未注册（缺口 G1，接线组 W9 补齐）前，端点运行期 404：
 *   工作台渲染错误卡 + 重试，诚实降级不伪造队列数据。
 */
export default function PmoAiPriorityRecommendationsPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)

  return (
    <PermissionGuard
      require={['portfolio:view']}
      fallback={
        <div
          data-permission-fallback
          className="flex min-h-[60vh] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看 AI 优先级推荐的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            需要 portfolio:view 权限方可查看 PMO AI 优先级推荐队列。请联系组织管理员授予权限。
          </p>
        </div>
      }
    >
      {organizationId === null ? (
        <div
          data-org-no-organization
          className="flex min-h-[60vh] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 text-center"
        >
          <Sparkles className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">请先选择组织</h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            AI 优先级推荐队列需要有效租户上下文。请先切换到组织工作区后重试。
          </p>
        </div>
      ) : (
        <PmoAiPriorityWorkspace />
      )}
    </PermissionGuard>
  )
}
