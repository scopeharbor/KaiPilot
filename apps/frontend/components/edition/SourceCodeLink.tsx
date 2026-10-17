import { Code2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 源代码地址（AGPL-3.0 第 13 条，v3-personal-edition-open-source-export design D16）。
 *
 * 构建期内联 `NEXT_PUBLIC_AIPROJ_SOURCE_URL`；留空时不显示，私有版界面保持不变。
 * 修改并公开提供服务的部署者，必须把它指向自己修改后的源码。导出供单测。
 */
export function resolveSourceCodeUrl(
  value: string | undefined = process.env.NEXT_PUBLIC_AIPROJ_SOURCE_URL,
): string | null {
  const url = value?.trim()
  if (!url || !/^https?:\/\//i.test(url)) return null
  return url
}

/** 「源代码」链接：设置门户底部与登录页页脚共用；没有配置地址时不渲染。 */
export function SourceCodeLink({ url, className }: { url?: string | null; className?: string }) {
  const href = url === undefined ? resolveSourceCodeUrl() : url
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-source-code-link
      className={cn(
        'inline-flex items-center gap-1 text-[11px] text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
        className,
      )}
    >
      <Code2 className="h-3 w-3" aria-hidden />
      源代码
    </a>
  )
}
