'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, Gavel, Plus } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { useCreateDecisionCase, useDecisionCases } from '@/hooks/use-decision-workbench'
import { parseDecisionUrlFilters, serializeDecisionUrlFilters } from '@/lib/api/decision-workbench'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'
import { usePermissions } from '@/hooks/use-permissions'
import type { PmoDecisionCaseStatus } from '@aiproj/types'

/**
 * /pmo/decisions —— PMO 决策工作台队列页（task 10.2）。
 *
 * - 状态筛选 + 分页；筛选态保存在 URL（导航/刷新后保持）
 * - loading / empty / error / forbidden 状态分离
 * - 创建入口（pmo_decision:manage 权限可见）
 * - 键盘可操作；状态文本非 color-only
 */

const STATUS_FILTERS: Array<{ value: PmoDecisionCaseStatus | ''; label: string }> = [
  { value: '', label: '全部' },
  { value: 'draft', label: '草稿' },
  { value: 'collecting-evidence', label: '收集证据' },
  { value: 'ready-for-review', label: '待审查' },
  { value: 'under-review', label: '审查中' },
  { value: 'decided', label: '已决定' },
  { value: 'deferred', label: '已延后' },
  { value: 'superseded', label: '已被取代' },
]

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  STATUS_FILTERS.filter((entry) => entry.value !== '').map((entry) => [entry.value, entry.label]),
)

export default function PmoDecisionQueuePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const organizationId = useCurrentOrganizationId()
  const { canAny } = usePermissions()
  const canManage = canAny(['pmo_decision:manage'])

  const filters = useMemo(
    () => parseDecisionUrlFilters(Object.fromEntries(searchParams.entries())),
    [searchParams],
  )
  const [page, setPage] = useState<number>(filters.page ?? 1)
  const activeFilters = useMemo(() => ({ ...filters, page }), [filters, page])

  const query = useDecisionCases(activeFilters)
  const createCase = useCreateDecisionCase()
  const [createOpen, setCreateOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftQuestion, setDraftQuestion] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  function updateFilters(next: Record<string, string | undefined>): void {
    const sp = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === '') sp.delete(key)
      else sp.set(key, value)
    }
    setPage(1)
    const qs = sp.toString()
    router.replace('/pmo/decisions' + (qs ? '?' + qs : ''), { scroll: false })
  }

  if (!canAny(['pmo_decision:view'])) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-8">
        <Alert variant="danger" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>您没有 PMO 决策工作台访问权限。</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (query.isError) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-8">
        <Alert variant="danger" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>加载决策议题失败，请稍后重试。</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6" aria-label="PMO 决策工作台队列">
      {/* 标题 */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Gavel className="h-7 w-7 text-teal-600" aria-hidden />
          <h1 className="text-2xl font-bold tracking-tight">决策工作台</h1>
          <span className="text-sm text-gray-500">决策 ≠ 执行：结论仅生成受控下游交接</span>
        </div>
        {canManage && organizationId !== null && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            新建议题
          </Button>
        )}
      </div>

      {/* 状态筛选 */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="按状态筛选">
        {STATUS_FILTERS.map((entry) => {
          const active = (filters.status ?? '') === entry.value
          return (
            <button
              key={entry.value || 'all'}
              role="tab"
              aria-selected={active}
              className={`rounded-md border px-3 py-1 text-sm ${
                active ? 'border-teal-600 bg-teal-50 font-medium' : 'border-gray-200 bg-white'
              }`}
              onClick={() => updateFilters({ status: entry.value || undefined })}
            >
              {entry.label}
            </button>
          )
        })}
      </div>

      {/* 列表体 */}
      {query.isLoading ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : (query.data?.data.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-gray-500">
            当前筛选下没有决策议题。
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3" aria-label="决策议题列表">
          {query.data!.data.map((decision) => (
            <li key={decision.id}>
              <button
                className="block w-full rounded-lg border border-gray-200 bg-white p-4 text-left hover:border-teal-400"
                onClick={() =>
                  router.push(
                    `/pmo/decisions/${decision.id}${serializeDecisionUrlFilters(filters)}`,
                  )
                }
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{decision.title}</span>
                  <span
                    className="rounded-full border border-gray-300 px-2 py-0.5 text-xs"
                    data-status={decision.status}
                  >
                    {STATUS_LABELS[decision.status] ?? decision.status}
                  </span>
                </div>
                <p className="mt-1 line-clamp-1 text-sm text-gray-500">
                  {decision.decisionQuestion}
                </p>
                <div className="mt-2 flex gap-4 text-xs text-gray-400">
                  <span>修订 r{decision.revision}</span>
                  {decision.dueDate && <span>截止 {decision.dueDate.slice(0, 10)}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 分页 */}
      {(query.data?.meta.totalPages ?? 0) > 1 && (
        <nav className="flex items-center justify-end gap-2" aria-label="分页">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            上一页
          </Button>
          <span className="text-sm text-gray-500">
            第 {query.data?.meta.page} / {query.data?.meta.totalPages} 页
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= (query.data?.meta.totalPages ?? 1)}
            onClick={() => setPage((current) => current + 1)}
          >
            下一页
          </Button>
        </nav>
      )}

      {/* 创建对话框（显式用户动作） */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent aria-label="新建议题">
          <DialogHeader>
            <DialogTitle>新建议题</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {createError && (
              <Alert variant="danger">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{createError}</AlertDescription>
              </Alert>
            )}
            <Input
              placeholder="议题标题（必填，≤200 字）"
              maxLength={200}
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
            />
            <Input
              placeholder="决策问题（必填，≤500 字）"
              maxLength={500}
              value={draftQuestion}
              onChange={(event) => setDraftQuestion(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!draftTitle.trim() || !draftQuestion.trim() || createCase.isPending}
              onClick={async () => {
                setCreateError(null)
                try {
                  const created = await createCase.mutateAsync({
                    title: draftTitle.trim(),
                    decisionQuestion: draftQuestion.trim(),
                  })
                  setCreateOpen(false)
                  setDraftTitle('')
                  setDraftQuestion('')
                  router.push(`/pmo/decisions/${created.id}`)
                } catch (error) {
                  setCreateError(error instanceof Error ? error.message : '创建失败')
                }
              }}
            >
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
