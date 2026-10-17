'use client'

/**
 * v2-5-compiler-dynamic-routing-management-ui —— 路由管理控制台页面。
 *
 * 三切片：只读观测（规则/决策）→ 模拟 → 受控编排。
 * usePermissions 门控；feature flag 控制显隐。
 */
import { usePermissions } from '@/hooks/use-permissions'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { CompilerRoutingRulesViewer } from '@/components/compiler/compiler-routing-rules-viewer'
import { CompilerRoutingSimulatePanel } from '@/components/compiler/compiler-routing-simulate-panel'
import { CompilerRoutingRuleEditor } from '@/components/compiler/compiler-routing-rule-editor'

/** Feature flag：路由管理控制台（默认启用，可 env 关闭）。 */
const ROUTING_MANAGEMENT_ENABLED = process.env.NEXT_PUBLIC_COMPILER_ROUTING_MANAGEMENT !== 'false'

export default function CompilerRoutingPage() {
  const { can } = usePermissions()
  const canView = can('ai:compiler:routing:view')
  const canManage = can('ai:compiler:routing:manage')

  // Feature flag 或无权限 → 隐藏
  if (!ROUTING_MANAGEMENT_ENABLED || !canView) {
    return <EmptyState title="路由管理" description="您没有查看路由管理的权限，或该功能未启用。" />
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Compiler 路由管理</h1>
        <Badge variant="neutral">P1 增强</Badge>
      </div>

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">规则注册表</TabsTrigger>
          <TabsTrigger value="simulate">路由模拟</TabsTrigger>
          {canManage && <TabsTrigger value="editor">规则编排</TabsTrigger>}
        </TabsList>

        <TabsContent value="rules">
          <CompilerRoutingRulesViewer />
        </TabsContent>

        <TabsContent value="simulate">
          <CompilerRoutingSimulatePanel />
        </TabsContent>

        {canManage && (
          <TabsContent value="editor">
            <CompilerRoutingRuleEditor />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
