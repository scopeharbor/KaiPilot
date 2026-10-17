'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'

/**
 * 功能域通用页头（v3-ui-next-resource-team-domains W4 · tasks 4.3，
 * design §5.2「统一页头 DomainPageHeader 与快捷返回」）。
 *
 * 供新轨各功能域页面（资源工作台 / 成员管理 / 项目文件库等）复用：
 * - 左侧「← 返回项目工作面」快捷返回：router.push 回 `/next/projects/:id`，
 *   主工作面随路由恢复此前激活镜头；
 * - 标题区 `<项目名> · <领域名>`（项目名加载中降级为仅领域名）+ description 弱文案；
 * - 右侧 actions 领域全局操作插槽（新建资源 / 邀请成员 / 上传文件等，由调用方注入）；
 * - 面包屑联动：projectName 就绪后经 entity store 上报 `<项目名> · <领域名>`，
 *   宿主 NextAppShell 回显 `/next/projects/:id · …`；卸载时按本项目 id 安全清理
 *   （store 内部 projectId 守卫，不会误清新注册的其它项目空间标题）。
 */

export interface DomainPageHeaderProps {
  projectId: number
  /** 项目名称；数据加载中可空——此时标题降级为仅领域名且不注册面包屑。 */
  projectName?: string | null
  /** 功能域标签，如「资源工作台」。 */
  domainLabel: string
  /** 领域职责弱文案（可选）。 */
  description?: string
  /** 领域操作插槽（渲染在右侧）。 */
  actions?: React.ReactNode
}

export function DomainPageHeader({
  projectId,
  projectName,
  domainLabel,
  description,
  actions,
}: DomainPageHeaderProps) {
  const router = useRouter()

  // 顶栏坐标联动：仅当项目名就绪后注册；卸载清理交由 store 守卫按 projectId 匹配。
  React.useEffect(() => {
    if (projectName) {
      useProjectSpaceEntityStore.getState().register(projectId, `${projectName} · ${domainLabel}`)
    }
    return () => {
      useProjectSpaceEntityStore.getState().clear(projectId)
    }
  }, [projectName, projectId, domainLabel])

  const title = projectName ? `${projectName} · ${domainLabel}` : domainLabel

  return (
    <header data-domain-header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          data-domain-back
          aria-label="返回项目工作面"
          onClick={() => router.push(`/next/projects/${projectId}`)}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          返回项目工作面
        </button>
        <span aria-hidden className="h-6 w-px bg-[var(--nx-border-hairline)]" />
        <div className="min-w-0">
          <h2
            data-domain-title
            className="truncate text-lg font-semibold text-[var(--nx-text-primary)]"
          >
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 truncate text-[11px] text-[var(--nx-text-muted)]">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export default DomainPageHeader
