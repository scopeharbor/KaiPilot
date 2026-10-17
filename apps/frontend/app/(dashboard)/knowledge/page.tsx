'use client'

/**
 * v3-four-layer-knowledge-system —— 知识库浏览与管理页面。
 *
 * 提供 L1-L4 知识记录的列表/检索/新建入口。
 * 权限感知：knowledge:view 权限控制，SYNTHETIC 标注。
 */
import { useEffect, useState } from 'react'
import { usePermissions } from '@/hooks/use-permissions'
import { KnowledgeOperationsView } from '@/components/knowledge/operating/KnowledgeOperationsView'
import { useKnowledgeList } from '@/hooks/use-knowledge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
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
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { ScrollArea } from '@/components/ui/ScrollArea'
import { KnowledgeCreateDialog } from '@/components/knowledge/knowledge-create-dialog'
import { KnowledgeReviewDrawer } from '@/components/knowledge/knowledge-review-drawer'
import type { KnowledgeItemLowSensitiveProjection } from '@aiproj/types'

const LAYER_LABELS: Record<string, { label: string; color: string }> = {
  L1: { label: '规范', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  L2: { label: '观察', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  L3: {
    label: '合成',
    color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  },
  L4: { label: '现实', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' },
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  pending: {
    label: '待审',
    color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200',
  },
  active: {
    label: '活跃',
    color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200',
  },
  deprecated: {
    label: '已弃用',
    color: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200',
  },
  outdated: { label: '已过时', color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200' },
}

/**
 * 读取 `?view=operations`，并跟随浏览器前进/后退。
 *
 * 只认这一个字面量：任何其它取值都回落到既有四层知识浏览页，
 * 因此 URL 无法把用户导向未声明的视图。
 */
function useKnowledgeViewParam(): boolean {
  const read = () =>
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('view') === 'operations'
  const [isOperations, setIsOperations] = useState(read)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const sync = () => setIsOperations(read())
    sync()
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  return isOperations
}

export default function KnowledgePage() {
  const { can } = usePermissions()
  const canView = can('knowledge:view')
  const operatingView = useKnowledgeViewParam()

  const [filters, setFilters] = useState<Record<string, string>>({})
  const [searchKeyword, setSearchKeyword] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const { data, isLoading, error } = useKnowledgeList(filters)

  // 运营视图是同一路由上的增量入口（design D6：`/knowledge?view=operations`）。
  // 无权限或 flag 关闭时由视图自身回落，这里不做二次判断。
  if (operatingView) {
    return <KnowledgeOperationsView />
  }

  if (!canView) {
    return (
      <EmptyState title="知识库" description="您没有查看知识库的权限（需要 knowledge:view）。" />
    )
  }

  const items = data?.data ?? []

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">知识库</h1>
          <p className="text-sm text-muted-foreground mt-1">
            四层知识底座：L1 规范 · L2 观察 · L3 合成（仅 Eval）· L4 现实
          </p>
        </div>
        <div className="flex items-center gap-2">
          {can('knowledge_memory_operating:view') && (
            <Button
              variant="outline"
              data-testid="knowledge-operations-toggle"
              onClick={() => {
                const url = new URL(window.location.href)
                url.searchParams.set('view', 'operations')
                window.history.pushState({}, '', url.toString())
                window.dispatchEvent(new PopStateEvent('popstate'))
              }}
            >
              运营视图
            </Button>
          )}
          {can('knowledge:author') && <Button onClick={() => setShowCreate(true)}>新建知识</Button>}
        </div>
      </div>

      {/* 检索栏 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">检索与过滤</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Input
              placeholder="关键词搜索…"
              value={searchKeyword}
              onChange={(e) => {
                setSearchKeyword(e.target.value)
                setFilters((f) => ({ ...f, keyword: e.target.value || '' }))
              }}
              className="max-w-xs"
            />
            <Select
              value={filters.layer ?? 'all'}
              onValueChange={(v) =>
                setFilters((f) => {
                  const next = { ...f }
                  if (v === 'all') {
                    delete next.layer
                  } else {
                    next.layer = v
                  }
                  return next
                })
              }
            >
              <SelectTrigger aria-label="层级筛选" className="w-32">
                <SelectValue placeholder="全部层级" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部层级</SelectItem>
                <SelectItem value="L1">L1 规范</SelectItem>
                <SelectItem value="L2">L2 观察</SelectItem>
                <SelectItem value="L3">L3 合成</SelectItem>
                <SelectItem value="L4">L4 现实</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filters.status ?? 'all'}
              onValueChange={(v) =>
                setFilters((f) => {
                  const next = { ...f }
                  if (v === 'all') {
                    // 重置为全部状态时移除 key，避免把空字符串发到后端触发枚举校验失败
                    delete next.status
                  } else {
                    next.status = v
                  }
                  return next
                })
              }
            >
              <SelectTrigger aria-label="状态筛选" className="w-32">
                <SelectValue placeholder="全部状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="active">活跃</SelectItem>
                <SelectItem value="pending">待审</SelectItem>
                <SelectItem value="draft">草稿</SelectItem>
                <SelectItem value="deprecated">已弃用</SelectItem>
                <SelectItem value="outdated">已过时</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="领域过滤（如：进度管理）…"
              value={filters.domain ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, domain: e.target.value || '' }))}
              className="max-w-[200px]"
            />
          </div>
        </CardContent>
      </Card>

      {/* 知识列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            知识条目
            {data?.meta && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                共 {data.meta.total} 条
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-500">
              加载失败：{(error as Error).message}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">暂无匹配的知识记录。</div>
          ) : (
            <ScrollArea className="h-[60vh]">
              <div className="space-y-2">
                {items.map((item) => (
                  <KnowledgeRow key={item.id} item={item} onClick={() => setSelectedId(item.id)} />
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* 新建弹窗 */}
      {showCreate && (
        <KnowledgeCreateDialog open={showCreate} onClose={() => setShowCreate(false)} />
      )}

      {/* 审查抽屉 */}
      {selectedId !== null && (
        <KnowledgeReviewDrawer
          knowledgeId={selectedId}
          open={selectedId !== null}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}

/** 单条知识行 */
function KnowledgeRow({
  item,
  onClick,
}: {
  item: KnowledgeItemLowSensitiveProjection
  onClick: () => void
}) {
  const layerInfo = LAYER_LABELS[item.layer] ?? { label: item.layer, color: 'bg-gray-100' }
  const statusInfo = STATUS_LABELS[item.status] ?? {
    label: item.status,
    color: 'bg-gray-100',
  }

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg border p-3 hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge className={layerInfo.color}>{layerInfo.label}</Badge>
            {item.isSynthetic && (
              <Badge className="bg-purple-200 text-purple-800 dark:bg-purple-800 dark:text-purple-200">
                SYNTHETIC
              </Badge>
            )}
            <span className="font-medium truncate">{item.title}</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
            <span>{item.domain}</span>
            {item.purpose && (
              <>
                <span>·</span>
                <span>{item.purpose}</span>
              </>
            )}
            {item.complexity && (
              <>
                <span>·</span>
                <span>复杂度：{item.complexity}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
        </div>
      </div>
      {/* 来源信息 */}
      {item.provenance?.sources && item.provenance.sources.length > 0 && (
        <div className="mt-1.5 text-xs text-muted-foreground">
          来源：{item.provenance.sources.map((s) => s.title).join(' · ')}
        </div>
      )}
    </button>
  )
}
