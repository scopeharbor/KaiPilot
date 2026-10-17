'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { CopilotInlineTrigger } from '@/components/copilot/CopilotInlineTrigger'
import { useRiskList, useDeleteRisk } from '@/hooks/use-risks'
import { useRiskViewStore } from '@/stores/risk-view-store'
import type { Risk, RiskCategory, RiskStatus } from '@/lib/api/risks'

const CATEGORY_LABELS: Record<RiskCategory, string> = {
  technical: '技术',
  schedule: '进度',
  cost: '成本',
  resource: '资源',
  external: '外部',
  organizational: '组织',
  legal: '法律',
  other: '其他',
}

const STATUS_LABELS: Record<RiskStatus, string> = {
  identified: '已识别',
  analyzing: '分析中',
  mitigating: '缓解中',
  resolved: '已解决',
  accepted: '已接受',
  closed: '已关闭',
}

const STATUS_VARIANT: Record<
  RiskStatus,
  'neutral' | 'info' | 'warning' | 'success' | 'primary' | 'danger'
> = {
  identified: 'neutral',
  analyzing: 'info',
  mitigating: 'warning',
  resolved: 'success',
  accepted: 'primary',
  closed: 'neutral',
}

function scoreColor(score: number): string {
  if (score >= 15) return 'text-danger font-bold'
  if (score >= 8) return 'text-warning font-semibold'
  return 'text-success'
}

interface RiskRegisterTableProps {
  projectId: number
  onRiskClick?: (risk: Risk) => void
}

export function RiskRegisterTable({ projectId, onRiskClick }: RiskRegisterTableProps) {
  const { categoryFilter, setCategoryFilter, statusFilter, setStatusFilter } = useRiskViewStore()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const filters = {
    ...(categoryFilter && { category: categoryFilter }),
    ...(statusFilter && { status: statusFilter }),
    ...(search && { search }),
    page,
    perPage: 20,
  }

  const { data, isLoading } = useRiskList(projectId, filters)
  const deleteMutation = useDeleteRisk(projectId)

  const risks = data?.data ?? []
  const meta = data?.meta

  return (
    <div className="space-y-4">
      {/* 筛选栏 */}
      <div className="flex items-center gap-3">
        <label htmlFor="risk-search" className="sr-only">
          搜索风险
        </label>
        <Input
          id="risk-search"
          placeholder="搜索风险..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          className="w-64"
        />
        <label htmlFor="risk-category-filter" className="sr-only">
          类别筛选
        </label>
        <Select
          value={categoryFilter ?? 'all'}
          onValueChange={(value) => {
            setCategoryFilter(value === 'all' ? null : (value as RiskCategory))
            setPage(1)
          }}
        >
          <SelectTrigger id="risk-category-filter" className="w-36">
            <SelectValue placeholder="所有类别" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有类别</SelectItem>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label htmlFor="risk-status-filter" className="sr-only">
          状态筛选
        </label>
        <Select
          value={statusFilter ?? 'all'}
          onValueChange={(value) => {
            setStatusFilter(value === 'all' ? null : (value as RiskStatus))
            setPage(1)
          }}
        >
          <SelectTrigger id="risk-status-filter" className="w-36">
            <SelectValue placeholder="所有状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有状态</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 表格 */}
      {isLoading ? (
        <div className="text-center py-8 text-gray-500">加载中...</div>
      ) : risks.length === 0 ? (
        <div className="text-center py-12 text-gray-400">暂无风险数据</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="风险登记册">
            <thead>
              <tr className="border-b border-border text-left text-gray-500">
                <th className="pb-2 font-medium">标题</th>
                <th className="pb-2 font-medium">类别</th>
                <th className="pb-2 font-medium">概率</th>
                <th className="pb-2 font-medium">影响</th>
                <th className="pb-2 font-medium">得分</th>
                <th className="pb-2 font-medium">状态</th>
                <th className="pb-2 font-medium">负责人</th>
                <th className="pb-2 font-medium">AI</th>
                <th className="pb-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {risks.map((risk) => (
                <tr
                  key={risk.id}
                  className="border-b border-border/50 hover:bg-gray-50 cursor-pointer"
                  onClick={() => onRiskClick?.(risk)}
                >
                  <td className="py-3 pr-4">
                    <div className="font-medium text-gray-900 truncate max-w-[300px]">
                      {risk.title}
                    </div>
                    {risk.description && (
                      <div className="text-gray-500 text-xs truncate max-w-[300px] mt-0.5">
                        {risk.description}
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <Badge variant="outline">{CATEGORY_LABELS[risk.category]}</Badge>
                  </td>
                  <td className="py-3 pr-4 text-center">{risk.probability}</td>
                  <td className="py-3 pr-4 text-center">{risk.impact}</td>
                  <td
                    className={`py-3 pr-4 text-center ${scoreColor(risk.score)}`}
                    aria-label={`风险得分 ${risk.score}${risk.score >= 15 ? '（高风险）' : risk.score >= 8 ? '（中风险）' : '（低风险）'}`}
                  >
                    {risk.score}
                  </td>
                  <td className="py-3 pr-4">
                    <Badge variant={STATUS_VARIANT[risk.status]}>
                      {STATUS_LABELS[risk.status]}
                    </Badge>
                  </td>
                  <td className="py-3 pr-4 text-gray-600">
                    {risk.ownerId ? `#${risk.ownerId}` : '-'}
                  </td>
                  <td className="py-3 pr-4">
                    {risk.aiMetadata?.aiMarker && <Badge variant="ai">AI</Badge>}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-1">
                      {/* v3-copilot-inline-triggers：风险登记册行内触发入口 */}
                      <CopilotInlineTrigger
                        entity={{
                          entityType: 'risk',
                          entityId: risk.id,
                          label: risk.title,
                          projectId,
                        }}
                        size="icon"
                        variant="ghost"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (confirm('确定删除此风险？')) {
                            deleteMutation.mutate(risk.id)
                          }
                        }}
                      >
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页 */}
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            共 {meta.total} 条，第 {meta.page}/{meta.totalPages} 页
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
