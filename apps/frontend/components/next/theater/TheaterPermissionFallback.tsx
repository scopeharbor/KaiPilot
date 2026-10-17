'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Home, ShieldAlert } from 'lucide-react'
import { usePermissions } from '@/hooks/use-permissions'

/** 生成剧场所需权限（与后端 RBAC 对 `/ai/project-intents/*` 的路由门一致）。 */
export const THEATER_REQUIRED_PERMISSION = 'ai:trigger'

export interface TheaterPermissionFallbackProps {
  /** 需要校验的权限；缺省 `ai:trigger`。 */
  requirePermission?: string
  /** 具备权限时渲染的内容（页面以 PermissionGuard 组合时为二次保障）。 */
  children?: React.ReactNode
}

/**
 * 生成剧场只读权限拦截卡片（v3-ui-next-theater-intent-clarify D7 / 任务 1.2）。
 *
 * - 基于 auth-store 的权限声明自行判定（可与 PermissionGuard 组合使用）；
 * - 无 `ai:trigger` 时渲染暗黑仪器风只读面板：说明原因、返回首页与申请权限引导，
 *   物理上不渲染任何输入控件，杜绝触发后端请求（RL-01）；
 * - 「申请权限」仅展示联系管理员的静态指引，零网络副作用。
 */
export function TheaterPermissionFallback({
  requirePermission = THEATER_REQUIRED_PERMISSION,
  children,
}: TheaterPermissionFallbackProps) {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const [showApplyHint, setShowApplyHint] = React.useState(false)

  if (hasPermission(requirePermission)) {
    return <>{children}</>
  }

  return (
    <section
      data-theater-permission-fallback
      role="alert"
      className="nx-space-atmosphere fixed inset-0 z-0 flex items-center justify-center bg-[var(--nx-space-bg)] p-6 text-[var(--nx-text-primary)]"
    >
      <div className="relative z-10 w-full max-w-md rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]/90 p-8 shadow-none">
        <div className="flex items-start gap-4">
          <ShieldAlert
            className="mt-1 h-9 w-9 shrink-0 text-[var(--nx-status-warning)]"
            aria-hidden
          />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[var(--nx-text-primary)]">仅审查模式</h1>
            <p
              data-theater-permission-message
              className="mt-3 text-sm leading-relaxed text-[var(--nx-text-secondary)]"
            >
              当前角色仅供审查，需要项目经理或管理员权限方可发起 AI 项目创建。
            </p>
          </div>
        </div>

        <p className="mt-4 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 font-mono text-xs text-[var(--nx-text-muted)]">
          所需权限：{requirePermission}
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            data-theater-back-home
            onClick={() => router.push('/next')}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 text-sm text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <Home className="h-4 w-4" aria-hidden />
            返回首页
          </button>
          <button
            type="button"
            data-theater-apply-permission
            onClick={() => setShowApplyHint(true)}
            className="flex h-10 flex-1 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 text-sm text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            申请权限
          </button>
        </div>

        {showApplyHint ? (
          <p
            data-theater-apply-hint
            className="mt-4 text-xs leading-relaxed text-[var(--nx-text-muted)]"
          >
            请联系组织管理员为当前角色开通 {requirePermission} 权限后重试。
          </p>
        ) : null}
      </div>
    </section>
  )
}

export default TheaterPermissionFallback
