'use client'

import * as React from 'react'
import { ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { CompilerSkillsWorkspace } from '@/components/next/settings/ai/CompilerSkillsWorkspace'

/**
 * 编译器技能注册表页入口（/next/settings/compiler-skills，
 * v3-ui-next-settings-admin-domains W5 · tasks 5.10，spec「编译器技能注册表」）。
 *
 * - 准入 `ai:compiler:skill:view`（体验层守卫；后端 Policy 为最终安全边界）：
 *   无权限时渲染受限横幅，工作区不挂载，底层 `/ai/compiler/skills` 接口零请求（RL-06）；
 * - 写门控 `ai:compiler:skill:manage` / `author` / `eval`：只读态隐藏写按钮；
 * - 启停操作二次确认，写失败展示服务端错误。
 */
export function NextSettingsCompilerSkillsPage() {
  return (
    <PermissionGuard
      require="ai:compiler:skill:view"
      fallback={
        <div
          data-permission-fallback
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            没有查看编译器技能的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            查看编译器技能注册表需要 ai:compiler:skill:view 权限。请联系组织管理员为你授权。
          </p>
        </div>
      }
    >
      <CompilerSkillsWorkspace />
    </PermissionGuard>
  )
}

export default NextSettingsCompilerSkillsPage
