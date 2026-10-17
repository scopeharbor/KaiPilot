import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * 帮助中心左侧导航树（design E：左树/移动端 drawer）。
 * 纯展示组件，服务端/客户端均可使用（无 hooks）。
 */
export interface HelpTreeItem {
  areaId: string
  areaLabel: string
  articles: Array<{ id: string; title: string }>
}

export interface HelpNavigationTreeProps {
  items: HelpTreeItem[]
  currentId?: string
  className?: string
}

export function HelpNavigationTree({ items, currentId, className }: HelpNavigationTreeProps) {
  return (
    <nav
      aria-label="帮助文档目录"
      className={cn('space-y-5', className)}
      data-testid="help-nav-tree"
    >
      <Link
        href="/help"
        className="block text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        ← 帮助首页
      </Link>
      {items.map((group) => (
        <div key={group.areaId}>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.areaLabel}
          </h3>
          <ul className="space-y-0.5 border-l pl-3">
            {group.articles.map((a) => {
              const active = a.id === currentId
              return (
                <li key={a.id}>
                  <Link
                    href={`/help/articles/${encodeURIComponent(a.id)}`}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      '-ml-px block border-l py-1 pl-3 text-sm hover:text-foreground',
                      active
                        ? 'border-l-primary font-medium text-primary'
                        : 'border-l-transparent text-muted-foreground hover:border-l-muted-foreground/30',
                    )}
                  >
                    {a.title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
