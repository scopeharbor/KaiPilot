'use client'

import * as React from 'react'
import { ShieldAlert } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'

/**
 * 确认转正权限感知提示条（v3-ui-next-draft-review-panel tasks 3.3 / design D7）。
 *
 * - 依据 auth-store 权限声明的 `ai:confirm` 判定（仅展示层，安全边界在服务端 RBAC）；
 * - 普通成员（Member）或只读观察者（Observer）等无确认权限角色进入审查面板时，
 *   操作栏不渲染可交互的「确认并转正」按钮，改由本条提示条常驻说明；
 * - 纯展示组件：零请求、零副作用；读屏以 role="status" 播报。
 */
export function NextDraftPermissionNotice() {
  const hasConfirmPermission = useAuthStore((state) => state.hasPermission('ai:confirm'))

  // 具备确认权限（PM / Org Admin / Sys Admin）时无需展示提示条。
  if (hasConfirmPermission) return null

  return (
    <div
      data-next-draft-permission-notice
      role="status"
      className="flex items-start gap-2.5 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2.5"
    >
      <ShieldAlert
        className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nx-status-warning)]"
        aria-hidden
      />
      <p className="text-xs leading-relaxed text-[var(--nx-text-secondary)]">
        当前账号具备草案审查权限；项目转正入库需由项目经理或组织管理员操作确认
      </p>
    </div>
  )
}

export default NextDraftPermissionNotice
