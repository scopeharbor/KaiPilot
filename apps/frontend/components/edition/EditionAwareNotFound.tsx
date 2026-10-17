'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FileQuestion } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { EnterpriseOnlyNotice } from '@/components/edition/EnterpriseOnlyNotice'
import { isEditionExcludedRoute } from '@/lib/workspace-edition'

/**
 * 根 404（v3-personal-edition-open-source-export §D12）：
 * 命中企业或平台路由时显示企业版说明，其余显示普通 404。
 *
 * 私有部署里企业页面文件都在，永远不会走到这里的企业分支；个人版导出删掉了这些页面，
 * 直链访问自然落到根 `not-found`，不需要导出时生成桩页面。
 */
export function EditionAwareNotFound() {
  const pathname = usePathname() ?? '/'
  const homeHref = pathname === '/next' || pathname.startsWith('/next/') ? '/next' : '/'

  if (isEditionExcludedRoute(pathname)) {
    return <EnterpriseOnlyNotice homeHref={homeHref} />
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6" data-not-found>
      <EmptyState
        icon={FileQuestion}
        title="页面不存在"
        description="链接可能有误，或页面已被移动。"
        action={
          <Link
            href={homeHref}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            返回首页
          </Link>
        }
      />
    </main>
  )
}
