'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWhatIfSessionStore } from '@/stores/what-if-store'
import { useBeforeUnload } from '@/hooks/use-before-unload'
import {
  LENS_SWITCHER_OPTIONS,
  type ProjectSpaceLensId,
} from '@/components/next/project-space/LensSwitcher'

/**
 * 双通道未保存离开拦截守卫（v3-ui-next-gantt-lens design D8 / spec「放弃试算回滚与
 * 未保存离开守卫拦截」）。
 *
 * **通道一（浏览器级）**：`hasUnsavedChanges === true` 且状态为 `active | stale` 时
 * 注册 `beforeunload`，刷新/关标签页触发浏览器原生确认框；
 *
 * **通道二（应用内路由）**——三层拦截：
 * 1. 空间内镜头切换：装配方在 LensSwitcher 的 onSelect 中调用 `requestLensSwitch(lensId)`，
 *    存在未保存变更时原位阻断并调起离开模态框（目标暂存为 pendingNavigation）；
 * 2. 全局链接捕获：`document` 捕获阶段监听 click，命中内部 `<a href>` 或外链时
 *    `preventDefault + stopPropagation`，暂存目标 href 后弹模态框（放行控制键多开标签页）；
 * 3. 浏览器后退/前进：`popstate` 时以 `history.pushState` 抵消回退并把目标暂存为 `back`。
 *
 * 模态框（`WorkspaceGanttLeaveDialog`）两选项：
 * - 「留在当前页面」（stay）：清空 pendingNavigation，沙盒内存数据原样保留；
 * - 「放弃并离开」（discardAndLeave）：`discardSession` 销毁内存 session 后排空放行路由。
 *
 * 装配（W4）：在 `WorkspaceGanttLens` 内挂载本 Hook，并把 `pendingNavigation` /
 * `stay` / `discardAndLeave` 接到 `WorkspaceGanttLeaveDialog`。
 */
export interface UseGanttNavigationGuardOptions {
  /** 「放弃并离开」放行镜头切换时执行的回调（由装配方决定实际切换方式）。 */
  onLensSelect?: (lensId: ProjectSpaceLensId) => void
}

export type GanttPendingNavigation =
  { type: 'lens'; lensId: ProjectSpaceLensId } | { type: 'url'; href: string } | { type: 'back' }

const UNLOAD_MESSAGE = '您有未保存的 What-if 变更，确定要离开吗？'

/** 排除不离开当前页面的 href（锚点/协议外链/空连接）。 */
function isNavigatingHref(href: string): boolean {
  if (!href) return false
  if (href === '#') return false
  if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
    return false
  }
  return true
}

export function useGanttNavigationGuard(options: UseGanttNavigationGuardOptions = {}) {
  const router = useRouter()
  const hasUnsavedChanges = useWhatIfSessionStore((s) => s.session.hasUnsavedChanges)
  const status = useWhatIfSessionStore((s) => s.session.status)
  const discardSession = useWhatIfSessionStore((s) => s.discardSession)
  const [pendingNavigation, setPendingNavigation] = useState<GanttPendingNavigation | null>(null)

  /** 存在需要拦截的未保存变更（active/stale 且 hasUnsavedChanges）。 */
  const isBlocking = hasUnsavedChanges && (status === 'active' || status === 'stale')
  const dialogOpen = pendingNavigation !== null

  // ── 通道一：浏览器级 beforeunload ─────────────────────────────
  const shouldBlock = useCallback(() => isBlocking, [isBlocking])
  useBeforeUnload(shouldBlock, UNLOAD_MESSAGE)

  // ── 通道二-2：全局捕获阶段 <a> 点击拦截 ───────────────────────
  useEffect(() => {
    if (!isBlocking) return
    const handleDocumentClick = (event: MouseEvent) => {
      if (pendingNavigation) return // 模态框已打开，不重复拦截
      if (event.defaultPrevented) return
      // 仅拦截普通左键单击；Ctrl/Cmd/Shift/Alt 组合为浏览器新标签页语义，放行
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return
      }
      const target = event.target as Element | null
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      if (anchor.target === '_blank') return // 新标签页打开不离开当前页面
      const href = anchor.getAttribute('href') ?? ''
      if (!isNavigatingHref(href)) return

      event.preventDefault()
      event.stopPropagation()
      setPendingNavigation({ type: 'url', href })
    }
    document.addEventListener('click', handleDocumentClick, true)
    return () => document.removeEventListener('click', handleDocumentClick, true)
  }, [isBlocking, pendingNavigation])

  // ── 通道二-3：popstate 历史回退拦截 ───────────────────────────
  useEffect(() => {
    if (!isBlocking) return
    const handlePopState = () => {
      if (pendingNavigation) return // 模态框已打开；继续回退会弹回我们 pushState 的抵消项
      // 抵消后退行为：把当前 URL 重新压入历史栈，再弹出离开模态框
      window.history.pushState(null, '', window.location.href)
      setPendingNavigation({ type: 'back' })
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [isBlocking, pendingNavigation])

  // ── 通道二-1：空间内镜头切换受控拦截 ──────────────────────────
  const requestLensSwitch = useCallback(
    (lensId: ProjectSpaceLensId): boolean => {
      if (!isBlocking) return true
      if (pendingNavigation) return false
      setPendingNavigation({ type: 'lens', lensId })
      return false
    },
    [isBlocking, pendingNavigation],
  )

  // ── 模态框选项 ────────────────────────────────────────────────
  const stay = useCallback(() => {
    setPendingNavigation(null) // 沙盒内存数据毫秒不差原样保留
  }, [])

  const discardAndLeave = useCallback(() => {
    const nav = pendingNavigation
    setPendingNavigation(null)
    discardSession() // 彻底销毁内存 session（RL-08）
    if (!nav) return
    if (nav.type === 'lens') {
      options.onLensSelect?.(nav.lensId)
      return
    }
    if (nav.type === 'url') {
      if (nav.href.startsWith('/')) {
        router.push(nav.href)
      } else {
        window.location.assign(nav.href) // 外链
      }
      return
    }
    // back：pushState 抵消后栈中仍有上一页，再次回退即真正放行
    window.history.back()
  }, [pendingNavigation, discardSession, router, options.onLensSelect])

  /** 模态框目标的人读描述（如「看板」「/next/projects/101」）。 */
  const pendingLabel = useCallback((): string | null => {
    if (!pendingNavigation) return null
    if (pendingNavigation.type === 'lens') {
      return (
        LENS_SWITCHER_OPTIONS.find((option) => option.id === pendingNavigation.lensId)?.label ??
        pendingNavigation.lensId
      )
    }
    if (pendingNavigation.type === 'url') return pendingNavigation.href
    return '上一页'
  }, [pendingNavigation])

  return {
    /** 是否存在需要拦截的未保存变更。 */
    hasBlockingChanges: isBlocking,
    /** 离开模态框是否打开。 */
    dialogOpen,
    /** 待放行导航目标（null 表示无）。 */
    pendingNavigation,
    /** 模态框文案用目标描述。 */
    pendingLabel: pendingLabel(),
    /** 镜头切换受控拦截：放行返回 true；存在未保存变更时原位阻断并弹模态框返回 false。 */
    requestLensSwitch,
    /** 留在当前页面：关闭模态框，保留沙盒。 */
    stay,
    /** 放弃并离开：销毁 session 后放行导航。 */
    discardAndLeave,
  }
}
