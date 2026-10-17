'use client'

import { CopyableCode } from '@/components/next/common/CopyableCode'
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Search, ExternalLink, FolderGit2, CheckSquare, Users, FileText } from 'lucide-react'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { RuleMatchBadge } from './RuleMatchBadge'
import { resolveEntityDirectUrl } from '@/components/next/navigation/SpaceMapGlobalSearchLens'
import type { SearchResultItem } from '@aiproj/types'

export interface AiGlobalSearchResultCardData {
  keyword?: string
  results?: SearchResultItem[]
  total?: number
}

export interface AiGlobalSearchResultCardProps {
  /** 检索结果数据（支持包装对象或直接条目数组） */
  data: AiGlobalSearchResultCardData | SearchResultItem[]
  /** 命中工具名（默认 search_global_entities） */
  toolName?: string
  /** 任务下钻回调（打开抽屉并联动路由） */
  onOpenTask?: (taskId: number, projectId?: number) => void
  /** 自定义导航回调 */
  onNavigate?: (path: string) => void
  className?: string
}

const TYPE_CONFIG: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }
> = {
  project: {
    label: '项目',
    icon: FolderGit2,
    tone: 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-primary)]',
  },
  task: {
    label: '任务',
    icon: CheckSquare,
    tone: 'border-[var(--nx-status-success)]/40 bg-[var(--nx-status-success)]/10 text-[var(--nx-status-success)]',
  },
  member: {
    label: '成员',
    icon: Users,
    tone: 'border-[var(--nx-space-cyan)]/40 bg-[var(--nx-space-cyan)]/10 text-[var(--nx-space-cyan)]',
  },
  file: {
    label: '文件',
    icon: FileText,
    tone: 'border-[var(--nx-accent)]/40 bg-[var(--nx-accent)]/10 text-[var(--nx-accent)]',
  },
}

/** 与空间地图搜索共用：只跳新版 /next 下真实存在的页面（后端 target 是旧版路径）。 */
function resolveItemUrl(item: SearchResultItem): string {
  return resolveEntityDirectUrl(item)
}

/**
 * AI 同事跨实体搜索结果只读卡片组件（v3-ui-next-batch3-global-convergence W1 · tasks 1.7）。
 *
 * 核心设计（RL-01 / RL-07 / design Decision 1 & spec「AI 同事自然语言跨实体查找与深度直达卡片规范」）：
 * - 暗黑仪器风高密度卡片；
 * - 顶部恒展示「⚡ 快捷规则匹配 · search_global_entities」诚实徽标（RL-07）；
 * - 聚合展示 Top 3 ~ 5 项匹配实体的结构化摘要与高对比度实体类型微标；
 * - 提供只读「查看详情」直达下钻链接；
 * - 严格纯只读，零表单、零一键修改、零批量变更动作，交互全周期写网络请求严格为 0（RL-01）。
 */
export function AiGlobalSearchResultCard({
  data,
  toolName = 'search_global_entities',
  onOpenTask,
  onNavigate,
  className = '',
}: AiGlobalSearchResultCardProps) {
  const router = useRouter()
  const immersionTier = useImmersionTier()
  const isPrecise = immersionTier === 'precise'

  // 归一化输入载荷
  const { results, keyword, total } = React.useMemo(() => {
    if (Array.isArray(data)) {
      return { results: data, keyword: undefined, total: data.length }
    }
    const res = Array.isArray(data?.results) ? data.results : []
    return {
      results: res,
      keyword: data?.keyword,
      total: data?.total ?? res.length,
    }
  }, [data])

  // 取 Top 5 结果项
  const topItems = React.useMemo(() => results.slice(0, 5), [results])

  const handleDetailClick = (item: SearchResultItem) => {
    const url = resolveItemUrl(item)
    if (item.entityType.toLowerCase() === 'task' && onOpenTask) {
      onOpenTask(item.entityId, item.projectId ?? undefined)
      return
    }
    if (onNavigate) {
      onNavigate(url)
      return
    }
    router.push(url)
  }

  return (
    <article
      data-card="ai-global-search-result"
      data-testid="ai-global-search-result-card"
      data-immersion={isPrecise ? 'precise' : immersionTier}
      className={`overflow-hidden rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] shadow-[var(--shadow-sm)] ${
        isPrecise ? 'bg-black border-neutral-800 shadow-none' : ''
      } ${className}`}
    >
      {/* 卡片顶部：标题与诚实披露徽标 */}
      <header className="flex items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--nx-text-primary)]">
          <Search className="h-3.5 w-3.5 text-[var(--nx-space-cyan)]" aria-hidden />
          <span>全域检索结果</span>
          {Boolean(keyword) && (
            <span className="font-mono text-[11px] text-[var(--nx-text-secondary)]">
              「{keyword}」
            </span>
          )}
        </div>
        <RuleMatchBadge toolName={toolName} />
      </header>

      {/* 内容区域：统计摘要与条目列表 */}
      <div className="space-y-2.5 p-3">
        <div className="flex items-center justify-between text-[11px] text-[var(--nx-text-muted)]">
          <span>共找到 {total} 条匹配实体</span>
          <span>展示前 {topItems.length} 项</span>
        </div>

        {topItems.length === 0 ? (
          <div
            data-testid="ai-search-empty"
            className="flex flex-col items-center justify-center py-6 text-center text-xs text-[var(--nx-text-secondary)]"
          >
            未检索到相关实体，可尝试缩短或更换关键词。
          </div>
        ) : (
          <div className="space-y-2" role="list">
            {topItems.map((item) => {
              const typeKey = item.entityType.toLowerCase()
              const config = TYPE_CONFIG[typeKey] ?? TYPE_CONFIG['file']!
              const Icon = config.icon

              return (
                <div
                  key={`${item.entityType}-${item.entityId}`}
                  role="listitem"
                  data-search-result-item=""
                  data-entity-type={item.entityType}
                  className={`flex items-start justify-between gap-3 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2.5 transition-colors ${
                    isPrecise ? 'border-neutral-800 bg-neutral-950' : ''
                  }`}
                >
                  {/* 左侧信息 */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        data-testid="type-badge"
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] border leading-none ${config.tone}`}
                      >
                        <Icon className="h-2.5 w-2.5" aria-hidden />
                        {config.label}
                      </span>
                      <h4
                        data-testid="item-title"
                        className="truncate text-xs font-medium text-[var(--nx-text-primary)]"
                        title={item.title}
                      >
                        {item.title}
                      </h4>
                    </div>

                    {/* 摘要与元数据说明 */}
                    {Boolean(item.summary) && (
                      <p className="line-clamp-2 text-[11px] text-[var(--nx-text-secondary)]">
                        {item.summary}
                      </p>
                    )}

                    {/* 实体特定元数据 */}
                    <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[10px] text-[var(--nx-text-muted)]">
                      {Boolean(item.metadata?.projectName) && (
                        <span className="rounded bg-[var(--nx-bg-1)] px-1 py-0.2">
                          {String(item.metadata?.projectName)}
                        </span>
                      )}
                      {Boolean(item.metadata?.code) && (
                        <CopyableCode
                          code={String(item.metadata?.code)}
                          className="px-1 py-0 text-[10px]"
                        />
                      )}
                      {Boolean(item.metadata?.role) && (
                        <span className="text-[var(--nx-space-cyan)]">
                          {String(item.metadata?.role)}
                        </span>
                      )}
                      {Boolean(item.metadata?.extension) && (
                        <span className="font-mono text-[var(--nx-accent)]">
                          {String(item.metadata?.extension)}
                        </span>
                      )}
                      {Boolean(item.status || item.metadata?.status) && (
                        <span>状态: {String(item.status || item.metadata?.status)}</span>
                      )}
                      {Boolean(item.metadata?.dueDate) && (
                        <span>截止: {String(item.metadata?.dueDate)}</span>
                      )}
                    </div>
                  </div>

                  {/* 右侧：纯只读跳转链接 */}
                  <button
                    type="button"
                    data-testid="view-detail-btn"
                    onClick={() => handleDetailClick(item)}
                    className="shrink-0 inline-flex items-center gap-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-1 text-[11px] font-medium text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
                  >
                    <span>查看详情</span>
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </article>
  )
}

export default AiGlobalSearchResultCard
