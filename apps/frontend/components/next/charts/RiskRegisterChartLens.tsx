'use client'

import * as React from 'react'
import { ShieldAlert } from 'lucide-react'
import { usePermissions } from '@/hooks/use-permissions'
import { RiskMatrixHeatmap } from './risk/RiskMatrixHeatmap'
import { RiskRegisterTable } from './risk/RiskRegisterTable'
import { RiskCreateDrawer } from './risk/RiskCreateDrawer'
import type { RiskCellRef } from './risk/risk-meta'

/**
 * 风险登记表 + 5×5 矩阵双重视图镜头（v3-ui-next-chart-gallery tasks 4.3）。
 *
 * - 上部 5×5 风险概率-影响度矩阵热力图（RiskMatrixHeatmap，GET /risks/matrix）；
 * - 下部结构化风险登记底册（RiskRegisterTable，GET /risks + 受控增删改）；
 * - 双向联动：本层持有选中单元格状态 `selectedCell: {p, i} | null`，矩阵点击写入、
 *   底册收敛过滤并展示「清除筛选」胶囊；同一格再次点击即取消；
 * - RBAC：未获 `risk:view` 物理阻断并零数据请求（W5 断言点）；行内编辑权限由
 *   底册按 risk:manage / risk:update_own 二次判定，编辑入口物理隐藏；
 * - 受控新建经 RiskCreateDrawer（POST /risks），成功后矩阵计数与底册联动刷新。
 */
export interface RiskRegisterChartLensProps {
  projectId: number
}

export function RiskRegisterChartLens({ projectId }: RiskRegisterChartLensProps) {
  const { can } = usePermissions()
  const [selectedCell, setSelectedCell] = React.useState<RiskCellRef | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)

  // 严格只读 / 无权视角：零数据请求（matrix 与 register 均不挂载）
  if (!can('risk:view')) {
    return (
      <div
        data-risk-lens
        data-risk-view-fallback
        className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-6 py-12 text-center"
      >
        <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
        <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">
          你没有查看该项目风险数据的权限
        </h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          风险登记表与矩阵需要 risk:view 权限，请联系组织管理员或项目负责人授权。
        </p>
      </div>
    )
  }

  return (
    <div data-risk-lens className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <RiskMatrixHeatmap
        projectId={projectId}
        selectedCell={selectedCell}
        onSelectCell={setSelectedCell}
      />
      <RiskRegisterTable
        projectId={projectId}
        cellFilter={selectedCell}
        onClearCellFilter={() => setSelectedCell(null)}
        onCreateRiskRequest={() => setCreateOpen(true)}
      />
      <RiskCreateDrawer
        projectId={projectId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  )
}

export default RiskRegisterChartLens
