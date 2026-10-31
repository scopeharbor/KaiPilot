'use client'

import { useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ProjectOverview } from '@/components/layout/ProjectHeader'
import { resolveDefaultEntry } from '@/lib/navigation'
import { useDefaultCustomViewId } from '@/hooks/use-custom-views'

/**
 * 项目详情页（build-app-shell-layout / spec project-view-tabs 「默认视图重定向」场景）：
 *
 * - 访问 `/projects/:id`（未带视图段）时，客户端立即 replace 到默认视图；
 * - V2 扩展（v2-custom-views-view-config）：若用户设置了默认自定义视图，优先携带 `?customView=ID`
 *   跳转到对应基础视图路由；否则回退到系统默认视图（看板）。
 * - 项目头由父级 layout 承载；重定向完成前此处渲染项目概览（`ProjectOverview`）兜底，
 *   首帧让用户看到项目信息与关键指标，不闪空白（v3-classic-ui-openproject-views）。
 */
export default function ProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = String(params?.id ?? '')
  const projectId = Number(params?.id)
  const hasRedirected = useRef(false)

  const {
    data: defaultCustomViewId,
    isLoading,
    isError,
  } = useDefaultCustomViewId(Number.isFinite(projectId) ? projectId : 0)

  useEffect(() => {
    if (!id) return
    if (!Number.isFinite(projectId)) return
    // 等待自定义视图默认值加载完成后再重定向
    if (isLoading) return
    if (hasRedirected.current) return
    hasRedirected.current = true

    const url = resolveDefaultEntry(projectId, isError ? null : defaultCustomViewId)
    router.replace(url)
  }, [id, projectId, router, defaultCustomViewId, isLoading, isError])

  return <ProjectOverview />
}
