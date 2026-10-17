'use client'

/**
 * v3-four-layer-knowledge-system —— KnowledgeReviewDrawer。
 *
 * 知识详情/审查抽屉：展示完整记录、SourceRef 溯源、reviewHistory、
 * SYNTHETIC 标注、人工确认/生命周期转移操作。
 *
 * 权限感知：knowledge:manage 控制确认/转移操作。
 */
import {
  useKnowledgeDetail,
  useConfirmKnowledge,
  useTransitionKnowledgeLifecycle,
} from '@/hooks/use-knowledge'
import { usePermissions } from '@/hooks/use-permissions'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/Sheet'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Separator } from '@/components/ui/Separator'
import { ScrollArea } from '@/components/ui/ScrollArea'

const LAYER_LABELS: Record<string, { label: string; color: string }> = {
  L1: { label: 'L1 规范', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  L2: {
    label: 'L2 观察',
    color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
  L3: {
    label: 'L3 合成',
    color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  },
  L4: {
    label: 'L4 现实',
    color: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  },
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

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['pending'],
  pending: ['active', 'draft'],
  active: ['deprecated', 'outdated'],
  deprecated: ['active'],
  outdated: ['active', 'deprecated'],
}

interface Props {
  knowledgeId: number
  open: boolean
  onClose: () => void
}

export function KnowledgeReviewDrawer({ knowledgeId, open, onClose }: Props) {
  const { can } = usePermissions()
  const canManage = can('knowledge:manage')

  const { data, isLoading, error } = useKnowledgeDetail(open ? knowledgeId : null)
  const confirmMutation = useConfirmKnowledge()
  const transitionMutation = useTransitionKnowledgeLifecycle()

  if (!open) return null

  // 详情端点契约是 `{ data: KnowledgeItem }` 信封（api-contract 冻结点）
  const item = data?.data

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <SheetContent className="w-[480px] sm:max-w-[480px]">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <LoadingSpinner />
          </div>
        ) : error ? (
          <div className="text-center py-20 text-red-500">加载失败：{(error as Error).message}</div>
        ) : !item ? (
          <div className="text-center py-20 text-muted-foreground">知识记录不存在。</div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 flex-wrap">
                {item.layer && (
                  <Badge className={LAYER_LABELS[item.layer]?.color}>
                    {LAYER_LABELS[item.layer]?.label ?? item.layer}
                  </Badge>
                )}
                {item.isSynthetic && (
                  <Badge className="bg-purple-200 text-purple-800 dark:bg-purple-800 dark:text-purple-200 font-bold">
                    SYNTHETIC
                  </Badge>
                )}
              </SheetTitle>
              <SheetDescription asChild>
                <div className="text-lg font-semibold text-foreground mt-1">{item.title}</div>
              </SheetDescription>
            </SheetHeader>

            <ScrollArea className="h-[calc(100vh-240px)] mt-4">
              <div className="space-y-4 pr-2">
                {/* 状态与操作 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">状态：</span>
                    <Badge className={STATUS_LABELS[item.status]?.color}>
                      {STATUS_LABELS[item.status]?.label ?? item.status}
                    </Badge>
                  </div>

                  {/* 操作按钮 */}
                  {canManage && (
                    <div className="flex gap-1">
                      {item.status === 'pending' && (
                        <Button
                          size="sm"
                          onClick={() => confirmMutation.mutate(item.id!)}
                          disabled={confirmMutation.isPending}
                        >
                          {confirmMutation.isPending ? '确认中…' : '确认转正'}
                        </Button>
                      )}
                      {ALLOWED_TRANSITIONS[item.status]?.map((target) =>
                        target === 'active' && item.status === 'pending' ? null : (
                          <Button
                            key={target}
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              transitionMutation.mutate({ id: item.id!, status: target })
                            }
                            disabled={transitionMutation.isPending}
                          >
                            {STATUS_LABELS[target]?.label ?? target}
                          </Button>
                        ),
                      )}
                    </div>
                  )}
                </div>

                <Separator />

                {/* 基本信息 */}
                <div>
                  <h4 className="text-sm font-medium">基本信息</h4>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">领域：</span>
                      {item.domain}
                    </div>
                    <div>
                      <span className="text-muted-foreground">用途：</span>
                      {item.purpose ?? '—'}
                    </div>
                    {item.complexity && (
                      <div>
                        <span className="text-muted-foreground">复杂度：</span>
                        {item.complexity}
                      </div>
                    )}
                    {item.retentionDays && (
                      <div>
                        <span className="text-muted-foreground">保留期：</span>
                        {item.retentionDays} 天
                      </div>
                    )}
                  </div>
                </div>

                <Separator />

                {/* 内容 */}
                <div>
                  <h4 className="text-sm font-medium">内容</h4>
                  <pre className="mt-2 text-sm whitespace-pre-wrap bg-muted rounded-lg p-3 max-h-[300px] overflow-y-auto">
                    {typeof item.content === 'string'
                      ? item.content
                      : JSON.stringify(item.content, null, 2)}
                  </pre>
                </div>

                {/* 合成方法 */}
                {item.isSynthetic && item.syntheticMethod && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-medium">合成方法</h4>
                      <p className="mt-1 text-sm text-muted-foreground font-mono">
                        {item.syntheticMethod}
                      </p>
                    </div>
                  </>
                )}

                <Separator />

                {/* 来源溯源 */}
                <div>
                  <h4 className="text-sm font-medium">来源（SourceRef）</h4>
                  {item.provenance?.sources && item.provenance.sources.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {item.provenance.sources.map((s, i) => (
                        <li key={i} className="text-xs text-muted-foreground">
                          <span className="font-mono">{s.layer}</span> · {s.title}
                          {s.sourceId && (
                            <span className="ml-1 text-muted-foreground/60">({s.sourceId})</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">无来源记录</p>
                  )}
                </div>

                <Separator />

                {/* 审核历史 */}
                <div>
                  <h4 className="text-sm font-medium">审核历史（ReviewRecord）</h4>
                  {item.provenance?.reviewHistory && item.provenance.reviewHistory.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      {item.provenance.reviewHistory.map(
                        (r: { note?: string; action: string; timestamp: string }, i: number) => (
                          <div
                            key={i}
                            className="text-xs bg-muted rounded p-2 flex items-start justify-between"
                          >
                            <span>{r.note ?? r.action}</span>
                            <span className="text-muted-foreground shrink-0 ml-2">
                              {new Date(r.timestamp).toLocaleDateString('zh-CN')}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">暂无审核记录</p>
                  )}
                </div>

                {/* 层级元数据 */}
                {item.layerMeta && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-medium">层级元数据</h4>
                      <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                        {Object.entries(item.layerMeta).map(([k, v]) => (
                          <div key={k}>
                            <span className="font-medium">{k}：</span>
                            {Array.isArray(v) ? v.join(', ') : String(v)}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
