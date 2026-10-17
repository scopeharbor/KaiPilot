'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import type { SearchResultItem } from '@/lib/api/search'

// ============================================================
// 常量
// ============================================================

/** 实体类型 → 简体中文标签（前端覆盖用） */
export const TYPE_LABELS: Record<string, string> = {
  project: '项目',
  task: '任务',
  file: '文件',
  risk: '风险',
  change_request: '变更请求',
  report: '报表',
  comment: '评论',
  activity: '活动',
  milestone: '里程碑',
  document: '文档',
}

/** 实体类型 → 颜色类 */
export const TYPE_COLORS: Record<string, string> = {
  project: 'text-blue-600 bg-blue-50',
  task: 'text-green-600 bg-green-50',
  file: 'text-purple-600 bg-purple-50',
  risk: 'text-red-600 bg-red-50',
  change_request: 'text-amber-600 bg-amber-50',
  report: 'text-indigo-600 bg-indigo-50',
  comment: 'text-gray-600 bg-gray-50',
  activity: 'text-slate-600 bg-slate-50',
  milestone: 'text-cyan-600 bg-cyan-50',
  document: 'text-teal-600 bg-teal-50',
}

// ============================================================
// SearchResultCard
// ============================================================

export function SearchResultCard({ item }: { item: SearchResultItem }) {
  const typeColor = TYPE_COLORS[item.entityType] ?? 'text-gray-600 bg-gray-50'
  const typeLabel = TYPE_LABELS[item.entityType] ?? item.entityType

  // 活动/审计日志与文档在项目内没有可承接的详情页或抽屉
  // （/projects/:id/activity 与后端 buildSafeTarget 生成的
  // /projects/:id/documents/:docId 路由均不存在），渲染为不可跳转的普通卡片，
  // 并用 title 提示避免用户误点进入 404
  if (item.entityType === 'activity' || item.entityType === 'document') {
    return (
      <div
        title={
          item.entityType === 'document'
            ? '文档详情请到项目文件库查看'
            : '活动记录暂无详情页可跳转，可在「审计日志」中查看'
        }
        className="block p-4 border rounded-lg cursor-default"
      >
        <SearchResultCardBody item={item} typeColor={typeColor} typeLabel={typeLabel} />
      </div>
    )
  }

  return (
    <Link
      href={item.target}
      className="block p-4 border rounded-lg hover:bg-gray-50 transition-colors group"
    >
      <SearchResultCardBody item={item} typeColor={typeColor} typeLabel={typeLabel} />
    </Link>
  )
}

/** 搜索结果卡主体：标题 / 摘要 / 元信息，供链接卡片与不可跳转卡片共用 */
function SearchResultCardBody({
  item,
  typeColor,
  typeLabel,
}: {
  item: SearchResultItem
  typeColor: string
  typeLabel: string
}) {
  return (
    <div className="flex items-start gap-3">
      {/* 实体类型徽章 */}
      <Badge className={cn('shrink-0', typeColor)}>{typeLabel}</Badge>

      <div className="flex-1 min-w-0">
        {/* 标题 */}
        <h3 className="font-medium text-gray-900 group-hover:text-blue-600 truncate">
          {item.title}
        </h3>

        {/* 摘要 */}
        {item.summary && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{item.summary}</p>}

        {/* 元信息 */}
        <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
          {/* 命中字段 */}
          {item.matchedFields.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="text-green-500">●</span>
              匹配: {item.matchedFields.join(', ')}
            </span>
          )}

          {/* 状态 */}
          {item.status && <span>{item.status}</span>}

          {/* 更新时间 */}
          {item.updatedAt && <span>{new Date(item.updatedAt).toLocaleDateString('zh-CN')}</span>}

          {/* 高亮 */}
          {item.highlights && item.highlights.length > 0 && (
            <span className="text-amber-500">{item.highlights.length} 处高亮</span>
          )}
        </div>
      </div>
    </div>
  )
}
