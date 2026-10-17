'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Target } from 'lucide-react'

/**
 * 旧版 OKR 对齐路由永久废退同化页（/next/okr-alignment，v3-ui-next-batch3-global-convergence W4/W5 · tasks 5.1）。
 *
 * 彻底淘汰旧轨未登记权限 `okr:view` 幽灵守卫缺陷，访问时永久 307/replace
 * 重定向至新轨统一的组织级 OKR 工作台（/next/organization/okrs）。
 */
export default function NextOkrAlignmentAssimilationPage() {
  const router = useRouter()

  React.useEffect(() => {
    router.replace('/next/organization/okrs')
  }, [router])

  return (
    <div
      data-next-okr-alignment-assimilation
      className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center p-6"
    >
      <Target className="h-8 w-8 text-[var(--nx-accent)] animate-pulse" aria-hidden />
      <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
        正在重定向至组织级 OKR 工作台…
      </h3>
      <p className="text-xs text-[var(--nx-text-muted)] font-mono">
        PERMANENT REDIRECT · /next/organization/okrs
      </p>
    </div>
  )
}
