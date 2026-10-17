'use client'

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from '@/components/ui/Toast'
import { startTheaterRunner } from '@/lib/next/theater-runner'
import { describeTheaterRun, type TheaterRunStatus } from '@/lib/next/theater-run-status'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { GenerationModeDialog } from './GenerationModeDialog'

/** 生成剧场相关页面（在这些页面上不发通知，页面本身就在显示）。 */
function isTheaterPath(pathname: string): boolean {
  return pathname.startsWith('/next/create') || pathname.startsWith('/next/draft')
}

/** 浏览器系统通知（用户授权过且页面不在前台时）；点通知回到应用并导航。 */
function systemNotify(status: TheaterRunStatus, navigate: (href: string) => void): void {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted' || !document.hidden) return
  try {
    const notification = new Notification(status.title, { body: status.detail, tag: status.key })
    notification.onclick = () => {
      window.focus()
      navigate(status.href)
      notification.close()
    }
  } catch {
    // 部分浏览器（如移动端）不支持页面内构造通知：只用应用内提醒
  }
}

/**
 * 生成剧场后台运行器（新版外壳常驻）：
 * - 启动 `startTheaterRunner`：分析 / 项目理解 / 全自动开始生成 / 生成流离开剧场页也继续；
 * - 需要用户处理时（手动模式等回答、等开始生成、草案待审查；失败；全自动转正完成）且不在
 *   生成剧场页：发应用内提醒（带「前往生成剧场 / 打开项目」按钮），页面在后台时另发系统通知，
 *   点通知同样导航过去；
 * - 不做跨页面常驻进度条：全自动的状态与「停止全自动」在 AI 同事面板顶部提示条里看；
 * - 承载一键生成前的「全自动 / 带我到生成剧场」弹窗。
 */
export function TheaterBackgroundRunner() {
  const pathname = usePathname() ?? '/'
  const router = useRouter()
  const user = useAuthStore((state) => state.user)
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)

  React.useEffect(() => startTheaterRunner(), [])

  // 绑定租户隔离域（与剧场页同一调用；离开剧场页时后台运行也在正确的作用域里）
  React.useEffect(() => {
    useAiProjectDraftStore.getState().initializeScope({
      userId: user?.id ?? null,
      organizationId: selectEffectiveOrganizationId({ currentOrganizationId, user }),
    })
  }, [user, currentOrganizationId])

  const draftState = useAiProjectDraftStore()
  const autoLinked = useNextAiColleagueStore((state) => state.theaterLink?.mode === 'auto')
  const status = describeTheaterRun(draftState, autoLinked)
  const onTheater = isTheaterPath(pathname)

  const navigate = React.useCallback((href: string) => router.push(href), [router])

  // 需要处理的事：同一件只提醒一次；在剧场页上不提醒（页面本身就在显示）
  const notifiedRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!status.attention || onTheater) return
    if (notifiedRef.current === status.key) return
    notifiedRef.current = status.key
    toast({
      variant:
        status.phase === 'error' ? 'error' : status.phase === 'confirmed' ? 'success' : 'warning',
      title: status.title,
      description: status.detail,
      duration: 15000,
      action: { label: status.actionLabel, onClick: () => navigate(status.href) },
    })
    systemNotify(status, navigate)
  }, [status, onTheater, navigate])

  return <GenerationModeDialog />
}
