'use client'

// OKR 级联与对齐管理工作台（v3-okr-cascade-and-alignment §5.2）。
// 提供三个标签页：级联计划、关系矩阵、健康仪表盘。
// 使用现有 app shell 和密集管理布局。

import { useState, useCallback } from 'react'
import { useOkrCycles } from '@/hooks/use-okr'
import {
  useCascadePlans,
  useCreateCascadePlan,
  useRelations,
  useCreateRelation,
  useUpdateRelation,
  useArchiveRelation,
  useHealthList,
  useMatrix,
  useAiCascadeSuggestions,
} from '@/hooks/use-okr-cascade-alignment'
import type {
  OkrScope,
  OkrCascadePlanCreateRequest,
  OkrRelationCreateRequest,
  OkrRelationUpdateRequest,
  OkrHealthQuery,
  OkrAlignmentMatrixQuery,
} from '@aiproj/types'
import { cn } from '@/lib/utils'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { Alert } from '@/components/ui/Alert'
import { CascadePlanDetailDrawer } from '@/components/views/okr/cascade-plan-detail-drawer'
import { AiCascadeSuggestionPanel } from '@/components/views/okr/ai-cascade-suggestion-panel'
import { AlignmentMatrixView } from '@/components/views/okr/alignment-matrix-view'
import { HealthDashboard } from '@/components/views/okr/health-dashboard'

type WorkbenchTab = 'cascade-plans' | 'matrix' | 'health'

export default function OkrAlignmentWorkbenchPage() {
  // 路由 `/okr-alignment` 没有 :organizationId 参数（幽灵参数修复）：
  // 组织 id 一律从 auth store 的有效租户上下文取，取不到（未选择组织）时不发任何查询。
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  if (organizationId === null) {
    return <Alert className="my-8">请先选择组织</Alert>
  }
  return <OkrAlignmentWorkbench organizationId={organizationId} />
}

function OkrAlignmentWorkbench({ organizationId }: { organizationId: number }) {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>('cascade-plans')
  const [selectedCycleId, setSelectedCycleId] = useState<number | undefined>()
  const [scopeFilter, setScopeFilter] = useState<OkrScope | undefined>()

  // ── 周期数据 ──
  const { data: cyclesData, isLoading: cyclesLoading } = useOkrCycles(organizationId, {})
  const cycles = cyclesData?.data ?? []

  // ── 级联计划 ──
  const { data: plansData, isLoading: plansLoading } = useCascadePlans(organizationId, {})
  const plans = plansData?.data ?? []

  const createPlanMutation = useCreateCascadePlan(organizationId)

  // ── 关系 ──
  const { data: relationsData, isLoading: relationsLoading } = useRelations(organizationId, {
    page: 1,
    perPage: 100,
  })
  const relations = relationsData?.data ?? []

  const createRelationMutation = useCreateRelation(organizationId)
  const updateRelationMutation = useUpdateRelation(organizationId)
  const archiveRelationMutation = useArchiveRelation(organizationId)

  // ── 健康 ──
  const healthQuery: OkrHealthQuery = {
    cycleId: selectedCycleId,
    scope: scopeFilter,
  }
  const { data: healthData, isLoading: healthLoading } = useHealthList(organizationId, healthQuery)
  const healthItems = healthData?.data ?? []

  // ── 矩阵 ──
  const matrixQuery: OkrAlignmentMatrixQuery = {
    cycleId: selectedCycleId,
    scope: scopeFilter,
    depth: 5,
    page: 1,
    perPage: 50,
  }
  const { data: matrixData, isLoading: matrixLoading } = useMatrix(organizationId, matrixQuery)
  const matrixRows = matrixData?.data ?? []
  const matrixMeta = matrixData?.meta

  // ── AI 建议 ──
  const aiSuggestionMutation = useAiCascadeSuggestions(organizationId)

  // ── 状态：选中的级联计划 ──
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null)
  const [showAiPanel, setShowAiPanel] = useState(false)

  // ── 创建级联计划 ──
  const handleCreatePlan = useCallback(async () => {
    if (!selectedCycleId) return
    // 后端契约只收 sourceObjectiveId（且要求为正数），没有 cycleId 这个入参。
    // 原实现传 `sourceObjectiveId: 0` + `cycleId`，运行时必被校验拒绝；
    // 这里改为取当前周期对齐矩阵的首个目标作为级联源，取不到就不发起请求。
    const sourceObjectiveId = matrixRows[0]?.objectiveId
    if (!sourceObjectiveId) return
    const input: OkrCascadePlanCreateRequest = {
      sourceObjectiveId,
      title: `级联计划 - ${cycles.find((c) => c.id === selectedCycleId)?.title ?? selectedCycleId}`,
    }
    try {
      await createPlanMutation.mutateAsync(input)
    } catch {
      // 错误由 mutation state 处理
    }
  }, [selectedCycleId, cycles, matrixRows, createPlanMutation])

  // ── 加载态 ──
  const isLoading =
    cyclesLoading || plansLoading || relationsLoading || healthLoading || matrixLoading

  if (isLoading) {
    return (
      <div className="p-6 text-muted-foreground" data-testid="okr-alignment-workbench-loading">
        加载中...
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4" data-testid="okr-alignment-workbench">
      {/* 头部 */}
      <div className="flex items-center gap-4 flex-wrap">
        <h1 className="text-2xl font-bold">OKR 级联与对齐</h1>

        {/* 周期选择 */}
        <select
          className="border rounded px-3 py-1.5 text-sm"
          value={selectedCycleId ?? ''}
          onChange={(e) => setSelectedCycleId(e.target.value ? Number(e.target.value) : undefined)}
          aria-label="选择 OKR 周期"
        >
          <option value="">全部周期</option>
          {cycles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>

        {/* 范围筛选 */}
        <select
          className="border rounded px-3 py-1.5 text-sm"
          value={scopeFilter ?? ''}
          onChange={(e) => setScopeFilter((e.target.value || undefined) as OkrScope | undefined)}
          aria-label="按范围筛选"
        >
          <option value="">全部范围</option>
          <option value="organization">组织</option>
          <option value="team">团队</option>
          <option value="project">项目</option>
        </select>

        {/* AI 建议按钮 */}
        <button
          className="px-3 py-1.5 bg-primary/10 text-primary rounded text-sm hover:bg-primary/20"
          onClick={() => setShowAiPanel(true)}
          disabled={!selectedCycleId}
        >
          AI 级联建议
        </button>
      </div>

      {/* 错误态 */}
      {createPlanMutation.isError && (
        <div className="bg-destructive/10 text-destructive p-3 rounded text-sm">
          创建级联计划失败：{(createPlanMutation.error as Error).message}
        </div>
      )}
      {createRelationMutation.isError && (
        <div className="bg-destructive/10 text-destructive p-3 rounded text-sm">
          创建关系失败：{(createRelationMutation.error as Error).message}
        </div>
      )}

      {/* 标签页导航 */}
      <div className="flex border-b gap-0">
        {(
          [
            ['cascade-plans', '级联计划'],
            ['matrix', '关系矩阵'],
            ['health', '健康仪表盘'],
          ] as [WorkbenchTab, string][]
        ).map(([tab, label]) => (
          <button
            key={tab}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setActiveTab(tab)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── 级联计划 Tab ── */}
      {activeTab === 'cascade-plans' && (
        <div className="space-y-4">
          {/* 新建按钮 */}
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50"
              onClick={handleCreatePlan}
              disabled={!selectedCycleId || createPlanMutation.isPending}
            >
              {createPlanMutation.isPending ? '创建中...' : '新建级联计划'}
            </button>
          </div>

          {/* 空态 */}
          {plans.length === 0 ? (
            <div
              className="text-center py-12 text-muted-foreground"
              data-testid="cascade-plans-empty"
            >
              {selectedCycleId
                ? '暂无级联计划。点击"新建级联计划"开始。'
                : '请先选择一个 OKR 周期。'}
            </div>
          ) : (
            <div className="border rounded divide-y">
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className="p-3 flex items-center justify-between hover:bg-muted/50 cursor-pointer"
                  onClick={() => setSelectedPlanId(plan.id)}
                >
                  <div>
                    <div className="text-sm font-medium">{plan.title}</div>
                    <div className="text-xs text-muted-foreground">
                      状态: {plan.status} · 覆盖: {plan.coverage ?? 0} 项
                      {plan.warnings && plan.warnings.length > 0 && (
                        <span className="text-amber-600 ml-2">{plan.warnings.length} 个警告</span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {plan.createdAt ? new Date(plan.createdAt).toLocaleDateString('zh-CN') : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 关系矩阵 Tab ── */}
      {activeTab === 'matrix' && (
        <AlignmentMatrixView
          organizationId={organizationId}
          rows={matrixRows}
          meta={matrixMeta}
          relations={relations}
          loading={matrixLoading}
          selectedCycleId={selectedCycleId}
          scopeFilter={scopeFilter}
          onCreateRelation={(input: OkrRelationCreateRequest) =>
            createRelationMutation.mutateAsync(input)
          }
          onUpdateRelation={(relationId: number, input: OkrRelationUpdateRequest) =>
            updateRelationMutation.mutateAsync({ relationId, input })
          }
          onArchiveRelation={(relationId: number) =>
            archiveRelationMutation.mutateAsync(relationId)
          }
        />
      )}

      {/* ── 健康仪表盘 Tab ── */}
      {activeTab === 'health' && (
        <HealthDashboard
          organizationId={organizationId}
          items={healthItems}
          loading={healthLoading}
          selectedCycleId={selectedCycleId}
          scopeFilter={scopeFilter}
        />
      )}

      {/* ── 级联计划详情抽屉 ── */}
      {selectedPlanId !== null && (
        <CascadePlanDetailDrawer
          organizationId={organizationId}
          planId={selectedPlanId}
          open={selectedPlanId !== null}
          onClose={() => setSelectedPlanId(null)}
        />
      )}

      {/* ── AI 建议面板 ── */}
      {showAiPanel && selectedCycleId && (
        <AiCascadeSuggestionPanel
          organizationId={organizationId}
          cycleId={selectedCycleId}
          open={showAiPanel}
          onClose={() => setShowAiPanel(false)}
          onApplySuggestion={() => {
            // 将 AI 建议转为级联计划确认流程
            setShowAiPanel(false)
          }}
          mutation={aiSuggestionMutation}
        />
      )}
    </div>
  )
}
