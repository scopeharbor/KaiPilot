'use client'

// 稀疏关系矩阵视图（v3-okr-cascade-and-alignment §5.4）。
// 以列表/表格形式展示目标间的对齐关系，含健康徽标、警告状态、受限数据指示。

import type {
  OkrAlignmentMatrixRow,
  OkrObjectiveRelation,
  OkrHealthLevel,
  OkrRelationCreateRequest,
  OkrRelationUpdateRequest,
  OkrScope,
} from '@aiproj/types'
import { cn } from '@/lib/utils'

export interface AlignmentMatrixViewProps {
  organizationId: number
  rows: OkrAlignmentMatrixRow[]
  meta?: { totalRelations?: number; total?: number; page?: number; perPage?: number }
  relations: OkrObjectiveRelation[]
  loading: boolean
  selectedCycleId?: number
  scopeFilter?: OkrScope
  // 这三个回调的返回值调用方不消费，声明成 Promise<unknown> 即可
  onCreateRelation: (input: OkrRelationCreateRequest) => Promise<unknown>
  onUpdateRelation: (relationId: number, input: OkrRelationUpdateRequest) => Promise<unknown>
  onArchiveRelation: (relationId: number) => Promise<unknown>
}

const healthLevelLabels: Record<OkrHealthLevel | string, string> = {
  healthy: '健康',
  needs_attention: '需关注',
  at_risk: '风险',
  unavailable: '不可用',
}

const healthLevelColors: Record<string, string> = {
  healthy: 'bg-green-100 text-green-700',
  needs_attention: 'bg-amber-100 text-amber-700',
  at_risk: 'bg-red-100 text-red-700',
  unavailable: 'bg-gray-100 text-gray-500',
}

const relationTypeLabels: Record<string, string> = {
  depends_on: '依赖',
  contributes_to: '贡献',
  supports: '支持',
  conflicts_with: '冲突',
  duplicates: '重复',
}

export function AlignmentMatrixView({
  rows,
  meta,
  relations,
  loading,
  selectedCycleId,
}: AlignmentMatrixViewProps) {
  // ── 加载态 ──
  if (loading) {
    return (
      <div className="text-center py-8 text-muted-foreground" data-testid="matrix-loading">
        加载关系矩阵...
      </div>
    )
  }

  // ── 空态 ──
  if (rows.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground" data-testid="matrix-empty">
        {selectedCycleId
          ? '暂无对齐关系数据。请确保周期中存在目标并已建立关系。'
          : '请先选择一个 OKR 周期以查看关系矩阵。'}
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="alignment-matrix">
      {/* Meta info */}
      <div className="flex justify-between items-center text-xs text-muted-foreground">
        <span>
          共 {meta?.totalRelations ?? meta?.total ?? rows.length} 条关系
          {meta?.page !== undefined &&
            ` · 第 ${meta.page}/${Math.ceil((meta?.total ?? 0) / (meta?.perPage ?? 50))} 页`}
        </span>
      </div>

      {/* 表格视图 */}
      <div className="border rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-2 font-medium">目标</th>
              <th className="text-left p-2 font-medium">范围</th>
              <th className="text-left p-2 font-medium">状态</th>
              <th className="text-left p-2 font-medium">健康度</th>
              <th className="text-left p-2 font-medium">关系</th>
              <th className="text-left p-2 font-medium">父对齐</th>
              <th className="text-left p-2 font-medium">子数量</th>
              <th className="text-right p-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => {
              const rowRelations = relations.filter(
                (r) =>
                  r.sourceObjectiveId === row.objectiveId ||
                  r.targetObjectiveId === row.objectiveId,
              )
              return (
                <tr
                  key={row.objectiveId}
                  className={cn(
                    'hover:bg-muted/30 transition-colors',
                    row.restricted && 'opacity-70',
                  )}
                >
                  <td className="p-2">
                    <div className="flex items-center gap-1">
                      {row.restricted && (
                        <span title="受限可见" className="text-xs">
                          🔒
                        </span>
                      )}
                      <span className="truncate max-w-[200px]">{row.objectiveTitle}</span>
                    </div>
                  </td>
                  <td className="p-2">
                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {row.scope ?? '-'}
                    </span>
                  </td>
                  <td className="p-2">
                    <span
                      className={cn('text-xs px-1.5 py-0.5 rounded', {
                        'bg-green-100 text-green-700': row.status === 'active',
                        'bg-gray-100 text-gray-700': row.status === 'draft',
                        'bg-amber-100 text-amber-700': row.status === 'paused',
                        'bg-blue-100 text-blue-700': row.status === 'completed',
                      })}
                    >
                      {row.status ?? '-'}
                    </span>
                  </td>
                  <td className="p-2">
                    {row.health ? (
                      <span
                        className={cn(
                          'text-xs px-1.5 py-0.5 rounded',
                          healthLevelColors[row.health.level] ?? 'bg-gray-100',
                        )}
                      >
                        {healthLevelLabels[row.health.level] ?? row.health.level}
                        {row.health.score !== undefined && ` (${row.health.score})`}
                        {row.health.warnings && row.health.warnings.length > 0 && (
                          <span
                            className="text-amber-600 ml-1"
                            title={row.health.warnings.map((w) => w.message).join('; ')}
                          >
                            ⚠
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="p-2">
                    {rowRelations.length > 0 ? (
                      <div className="flex flex-col gap-0.5">
                        {rowRelations.slice(0, 3).map((r) => (
                          <span key={r.id} className="text-xs text-muted-foreground">
                            {relationTypeLabels[r.relationType] ?? r.relationType}
                            {' → '}
                            {r.sourceObjectiveId === row.objectiveId
                              ? `#${r.targetObjectiveId}`
                              : `#${r.sourceObjectiveId}`}
                          </span>
                        ))}
                        {rowRelations.length > 3 && (
                          <span className="text-xs text-muted-foreground">
                            ...共 {rowRelations.length} 个
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">无关系</span>
                    )}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {row.parentAlignmentId ? `#${row.parentAlignmentId}` : '-'}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">{row.childCount ?? 0}</td>
                  <td className="p-2 text-right">
                    <button
                      className="text-xs text-primary hover:underline"
                      onClick={() => {
                        // 导航到目标详情
                      }}
                    >
                      详情
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 受限数据提示 */}
      {rows.some((r) => r.restricted) && (
        <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
          🔒 部分数据因权限限制不可见，已在表中标记。
        </div>
      )}
    </div>
  )
}
