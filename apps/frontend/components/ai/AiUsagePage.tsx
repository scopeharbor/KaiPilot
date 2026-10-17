'use client'

import { ShieldAlert } from 'lucide-react'
import PermissionGuard from '@/components/PermissionGuard'
import { CompilerObservabilitySummary } from '@/components/compiler/compiler-observability-summary'

/**
 * AI 用量页面 —— 挂载既有的 Compiler 可观测摘要组件。
 *
 * 此前该组件生产引用为 0（孤儿组件）。
 * 本页面将其接进设置入口，复用既有聚合服务与看板组件。
 *
 * RBAC: `ai:usage:view` 权限（org_admin / project_manager 可见）。
 * 纯只读：不产生任何动作入口。
 */
export function AiUsagePage() {
  return (
    <PermissionGuard
      require="ai:usage:view"
      fallback={
        <div className="flex items-start gap-3 rounded-lg bg-warning-bg p-5 text-warning">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div>
            <h2 className="font-medium">没有 AI 用量查看权限</h2>
            <p className="mt-1 text-sm leading-6">
              请切换到有权限的组织，或联系组织管理员、项目经理为你授权。
            </p>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">AI 用量与额度</h2>
          <p className="text-sm text-muted-foreground mt-1">
            查看组织的 AI 调用用量、成本估算与额度余量。
            <span className="text-xs text-muted-foreground/60 ml-2">
              所有成本数字均为估算，以实际账单为准。
            </span>
          </p>
        </div>

        {/* 挂载既有的 Compiler 可观测摘要组件。
            未接入具体 run（runId=0）时组件显示「暂无可观测数据」空态，不发 runs/0 请求 */}
        <CompilerObservabilitySummary runId={0} />
      </div>
    </PermissionGuard>
  )
}
