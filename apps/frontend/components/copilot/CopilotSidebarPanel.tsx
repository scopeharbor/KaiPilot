'use client'

import * as React from 'react'
import { Maximize2, Minus, Minimize2, Sparkles, X } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useCopilotStore } from '@/stores/copilot-store'
import { resolveUserMode } from '@/stores/copilot-store'
import { completeCopilotDemo } from '@/lib/copilot/demo'
import { readCopilotDemoCursor, writeCopilotDemoCursor } from '@/lib/copilot/demo-cursor'
import { focusCopilotTrigger } from '@/lib/copilot/trigger-focus'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'
import { CopilotPanelContext } from './CopilotPanelContext'
import { CopilotFullscreenPanels } from './CopilotFullscreenPanels'
import { CopilotModeSwitch } from './CopilotModeSwitch'
import { CopilotMessageList } from './CopilotMessageList'
import { CopilotPanelInput } from './CopilotPanelInput'
import {
  CopilotAssumptionsSlot,
  CopilotChipsSlot,
  CopilotClarificationSlot,
  CopilotModeIndicatorSlot,
  CopilotUnspecifiedInfoSlot,
  CopilotSuggestionInboxSlot,
  CopilotMemoryViewSlot,
  CopilotTurnActions,
} from './CopilotPanelSlots'

/**
 * Copilot 全局侧栏壳（spec copilot-sidebar-shell）。
 *
 * - 右侧固定抽屉：默认 400px、可拖拽 360–560px、100vh、z 值由既有 token 派生（任务 3.2/3.3）；
 * - 宽度变化**无过渡动画**，拖拽更新节流到动画帧（任务 3.4，布局属性动画会重排内容列）；
 * - 三态形态：抽屉 / 最小化悬浮 / 全屏专注（3.6/3.7）；最小化**不取消**进行中的生成、
 *   保留草稿与滚动位置（3.8/3.9——最小化时面板 DOM 保持挂载，仅 display:none）；
 * - 焦点陷阱 + Esc 关闭 + 关闭后焦点回归触发按钮（6.1–6.3）；流式 aria-live 节流播报（6.4–6.6）；
 * - 移动端全宽 + 底部输入（6.8）；浏览器返回手势可关闭（6.9）；
 * - 面板本阶段不发起任何业务写入（红线任务组 7），并显式标注无后端（7.5）。
 */

const DRAWER_Z = 'z-[calc(var(--z-sticky)+1)]'
const FULLSCREEN_Z = 'z-[var(--z-modal)]'
const MINIMIZED_Z = 'z-[calc(var(--z-sticky)+1)]'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** 流式 aria-live 节流：两次播报至少间隔 800ms，避免 token 级更新刷屏（6.4）。 */
const LIVE_ANNOUNCE_THROTTLE_MS = 800

export function CopilotSidebarPanel() {
  const pathname = usePathname()
  const open = useCopilotStore((s) => s.open)
  const form = useCopilotStore((s) => s.form)
  const width = useCopilotStore((s) => s.width)
  const setWidth = useCopilotStore((s) => s.setWidth)
  const streaming = useCopilotStore((s) => s.streaming)
  const streamPhase = useCopilotStore((s) => s.streamPhase)
  const messages = useCopilotStore((s) => s.messages)
  const streamError = useCopilotStore((s) => s.streamError)
  const mode = useCopilotStore((s) => s.mode)
  const degradeReason = useCopilotStore((s) => s.degradeReason)
  // 仅供插槽播报计数使用（7.12）；插槽自身的渲染各由 CopilotPanelSlots 内的组件订阅
  const turn = useCopilotStore((s) => s.turn)

  const panelRef = React.useRef<HTMLElement | null>(null)
  const rafRef = React.useRef(0)
  const pendingWidthRef = React.useRef<number | null>(null)

  // ── 关闭：焦点回归触发按钮（6.3）；下次打开回到抽屉态 ──
  function closePanel() {
    useCopilotStore.getState().setOpen(false)
    useCopilotStore.getState().setForm('drawer')
    focusCopilotTrigger()
  }

  // ── 打开后把焦点放入面板（焦点陷阱前提，6.2） ──
  React.useEffect(() => {
    if (!open || form === 'minimized') return
    const timer = window.setTimeout(() => {
      const input = panelRef.current?.querySelector<HTMLElement>('[data-copilot-input]')
      input?.focus()
    }, 60)
    return () => window.clearTimeout(timer)
  }, [open, form])

  // ── 焦点陷阱 + Esc 关闭（6.2） ──
  React.useEffect(() => {
    if (!open || form === 'minimized') return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (event.defaultPrevented) return // 不与其他浮层抢 Esc
        event.preventDefault()
        closePanel()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (focusables.length === 0) return
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, form])

  // ── 浏览器返回手势可关闭（6.9）：打开时压入历史，popstate 关闭面板 ──
  React.useEffect(() => {
    if (!open) return
    window.history.pushState({ copilotPanelOpen: true }, '')
    const onPop = () => {
      useCopilotStore.getState().setOpen(false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [open])

  // ── 演示流式推进（4.6/4.9）：理解 → 分析 → 生成 → 完成追加演示回复；取消即中止 ──
  // 阶段变化同步写游标（sessionStorage，低敏），刷新后经 mount 恢复续接（4.9）。
  //
  // 守卫（v3-copilot-live-submission-channel 修复）：
  // - 只在演示模式推进；live 模式由 submitCopilotTurn 的网络请求驱动 streaming/streamPhase，
  //   若也跑演示定时器会与真实回合竞态，并可能在 effect cleanup 时清掉 generating 阶段的
  //   完成定时器，导致 streaming 永远卡在 true、后续提交全被 `if (streaming) return` 拦截。
  // - 定时器用 ref 持有，避免依赖数组变化触发 cleanup 清掉正在推进的定时器。
  const demoTimersRef = React.useRef<number[]>([])
  React.useEffect(() => {
    if (!streaming) return
    if (mode !== 'demonstration') return
    if (streamPhase === 'cancelled' || streamPhase === 'done' || streamPhase === 'error') return
    const later = (ms: number, fn: () => void) => {
      demoTimersRef.current.push(window.setTimeout(fn, ms))
    }
    if (streamPhase === 'understanding') {
      later(1200, () => {
        useCopilotStore.getState().setStreaming(true, 'analyzing')
        writeCopilotDemoCursor(useCopilotStore.getState().sessionId, 'analyzing')
      })
    } else if (streamPhase === 'analyzing') {
      later(1200, () => {
        useCopilotStore.getState().setStreaming(true, 'generating')
        writeCopilotDemoCursor(useCopilotStore.getState().sessionId, 'generating')
      })
    } else if (streamPhase === 'generating') {
      later(1800, completeCopilotDemo)
    }
    return () => {
      demoTimersRef.current.forEach((t) => window.clearTimeout(t))
      demoTimersRef.current = []
    }
  }, [streaming, streamPhase, mode])

  // ── 刷新后续接进行中会话（4.9）：读取既有游标恢复流式阶段（游标低敏、TTL 24h） ──
  React.useEffect(() => {
    if (!open) return
    const cursor = readCopilotDemoCursor()
    if (!cursor) return
    const state = useCopilotStore.getState()
    if (
      !state.streaming &&
      (cursor.phase === 'understanding' ||
        cursor.phase === 'analyzing' ||
        cursor.phase === 'generating')
    ) {
      state.setStreaming(true, cursor.phase)
    }
  }, [open])

  // ── 流式 aria-live 节流播报（6.4）+ 完成态独立播报（6.5） ──
  const [liveText, setLiveText] = React.useState('')
  const lastAnnounceRef = React.useRef(0)
  React.useEffect(() => {
    if (!streaming) return
    const label =
      streamPhase === 'understanding'
        ? '正在理解需求'
        : streamPhase === 'analyzing'
          ? '正在分析结构'
          : streamPhase === 'generating'
            ? '正在生成方案'
            : ''
    if (!label) return
    const now = Date.now()
    const timer = window.setTimeout(() => {
      if (now - lastAnnounceRef.current >= LIVE_ANNOUNCE_THROTTLE_MS) {
        lastAnnounceRef.current = now
        setLiveText(label)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [streaming, streamPhase])
  const [doneText, setDoneText] = React.useState('')
  React.useEffect(() => {
    if (streamPhase === 'done' && !streaming) {
      setDoneText(
        turn?.result?.kind === 'clarify'
          ? 'AI Copilot 需要补充信息'
          : turn?.result?.kind === 'route'
            ? 'AI Copilot 已准备待确认操作'
            : 'AI Copilot 已完成回复',
      )
    }
  }, [streamPhase, streaming, turn?.result?.kind])

  // ── 插槽内容播报（7.12）──
  // 插槽是**视觉**上出现的，屏幕阅读器不会因为 DOM 里多了几个 div 而说什么。
  // 澄清项与「未指明信息」直接决定用户下一步该做什么，只靠视觉呈现等于对读屏用户隐藏。
  // 播报只给**计数**，不给澄清问题正文或假设正文：这一区是 sr-only 的常驻 live region，
  // 把回合内容灌进去等于开了第二条内容外泄面（与后端「只记 ref/hash/count」同一纪律）。
  const slotAnnouncement = React.useMemo(() => {
    if (!turn) return ''
    const parts: string[] = []
    if (turn.clarificationRequired && turn.clarificationItems.length > 0) {
      parts.push(`${turn.clarificationItems.length} 项待澄清`)
    }
    const unspecifiedCount = turn.assumptionEntries.filter(
      (entry) => entry.source === 'default',
    ).length
    if (turn.assumptionEntries.length > 0) {
      parts.push(`${turn.assumptionEntries.length} 条假设`)
    }
    if (unspecifiedCount > 0) {
      parts.push(`${unspecifiedCount} 条未指明信息提示`)
    }
    if (parts.length === 0) return ''
    return `本轮有 ${parts.join('、')}`
  }, [turn])

  // ── 拖拽调宽（3.3/3.4）：rAF 节流 + 无过渡动画；钳制在 store 内 ──
  // 一帧内的多次 pointermove 只提交一次宽度，且提交**最新**位置（帧内首次位置会让指针
  // 与面板边缘错位）；抬起时若仍有待提交帧，直接落最终位置，避免遗留一帧的陈旧宽度（3.11）。
  function startResize(event: React.PointerEvent) {
    if (form !== 'drawer') return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const handleMove = (ev: PointerEvent) => {
      pendingWidthRef.current = startWidth + (startX - ev.clientX) // 右锚定：左拖增宽
      if (rafRef.current === 0) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0
          const next = pendingWidthRef.current
          pendingWidthRef.current = null
          if (next !== null) setWidth(next)
        })
      }
    }
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      if (rafRef.current !== 0) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
      const next = pendingWidthRef.current
      pendingWidthRef.current = null
      if (next !== null) setWidth(next)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  // ── 空状态示例：填入输入框并聚焦（不自动执行） ──
  function pickExample(text: string) {
    useCopilotStore.getState().setDraft(text)
    panelRef.current?.querySelector<HTMLElement>('[data-copilot-input]')?.focus()
  }

  // ── 模式解析（D7）：显式选择 > pro 推断 > 默认新手 ──
  // 这个 hook 必须在 `if (!open) return null` **之前**：原先放在提前返回之后，
  // open 为 false 时少调一次 hook，React 直接抛
  // "Rendered fewer hooks than expected"——面板一关就崩，三个前端测试文件全红。
  const copilotUserMode = useCopilotStore((s) => s.copilotUserMode)

  // ── 完全关闭：不挂载任何内容（会话态在 store，重开恢复） ──
  if (!open) return null

  const isMinimized = form === 'minimized'
  const isFullscreen = form === 'fullscreen'

  const { mode: resolvedUserMode } = resolveUserMode({
    explicitSelection: copilotUserMode,
    // pro 推断来自导航项——当前面板不消费 NavItemConfig.pro，
    // 此处为占位；实际 proInferred 由上层传入或从路由推导。
    proInferred: false,
  })

  const positionCls = isFullscreen ? 'inset-0' : 'inset-y-0 right-0'
  const elevationCls = isFullscreen ? FULLSCREEN_Z : DRAWER_Z
  const widthCls =
    !isFullscreen && !isMinimized ? 'w-full md:w-[var(--copilot-panel-width)]' : undefined

  return (
    <CopilotPanelContext.Provider value={{ form, userMode: resolvedUserMode }}>
      <>
        <aside
          ref={panelRef}
          data-copilot-panel
          aria-label="AI Copilot 面板"
          className={cn(
            'fixed flex flex-col border-l border-border bg-gray-0',
            positionCls,
            elevationCls,
            widthCls,
            isMinimized && 'hidden',
          )}
          style={{ '--copilot-panel-width': `${width}px` } as React.CSSProperties}
        >
          {/* 拖拽调宽把手（仅抽屉态；任务 3.3/3.4） */}
          {!isFullscreen && !isMinimized && (
            <div
              data-copilot-resize-handle
              role="separator"
              aria-orientation="vertical"
              aria-label="调整 AI Copilot 面板宽度"
              onPointerDown={startResize}
              className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize touch-none hover:bg-primary-200"
            />
          )}

          {/* 标题栏（3.6）：最小化 / 最大化 / 关闭 */}
          <header
            data-copilot-titlebar
            className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--ai-accent),var(--primary-500))]">
              <Sparkles className="h-3 w-3 text-white" aria-hidden />
            </span>
            {/* 标题在窄屏/紧凑密度下截断而非挤压控件（6.10） */}
            <h2 className="min-w-0 truncate text-sm font-medium text-gray-800">AI Copilot</h2>
            {streaming && (
              <span
                data-copilot-streaming-dot
                className="h-2 w-2 animate-pulse rounded-full bg-ai motion-reduce:animate-none"
                aria-label="正在生成"
              />
            )}
            {/*
              模式切换入口（4.8）：新手/专业模式显式切换。
              放在窗口控件组**之外**——`data-copilot-titlebar-controls` 是「最小化 / 最大化 / 关闭」
              这一组窗口控件的身份标记，7.11 的焦点序回归守卫按这个容器的子元素判定顺序。
              把模式切换塞进组内会让该组变成四个元素、顺序断言直接失败，
              语义上也把一个业务开关混进了窗口控件。
            */}
            <div className="ml-auto flex shrink-0 items-center">
              <CopilotModeSwitch />
            </div>
            <div data-copilot-titlebar-controls className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                data-copilot-minimize
                aria-label="最小化面板"
                onClick={() => useCopilotStore.getState().setForm('minimized')}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700',
                  focusRing,
                )}
              >
                <Minus className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                data-copilot-maximize
                aria-label={isFullscreen ? '退出全屏' : '全屏专注'}
                onClick={() =>
                  useCopilotStore.getState().setForm(isFullscreen ? 'drawer' : 'fullscreen')
                }
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700',
                  focusRing,
                )}
              >
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" aria-hidden />
                ) : (
                  <Maximize2 className="h-4 w-4" aria-hidden />
                )}
              </button>
              <button
                type="button"
                data-copilot-close
                aria-label="关闭面板"
                onClick={closePanel}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700',
                  focusRing,
                )}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </header>

          {/* 无障碍播报区（sr-only，6.4/6.5） */}
          <div aria-live="polite" role="status" className="sr-only" data-copilot-live-region>
            {liveText}
          </div>
          <div aria-live="polite" role="status" className="sr-only" data-copilot-complete-region>
            {doneText}
          </div>
          {/* 插槽内容播报区（7.12）：只播计数，不播澄清问题或假设正文 */}
          <div aria-live="polite" role="status" className="sr-only" data-copilot-slots-live-region>
            {slotAnnouncement}
          </div>

          {pathname.startsWith('/ai-create') && (
            <p
              data-copilot-scope-limitation="draft-global-readonly"
              className="border-b border-border bg-gray-50 px-3 py-2 text-[11px] leading-4 text-gray-600"
            >
              当前为全局只读模式：不会读取未导入草案，也不能修改或确认草案。需要比较时请在问题中提供低敏摘要。
            </p>
          )}

          {/* 消息区（列表 + 空状态 + 插槽 + 动作禁用卡） */}
          <div className="flex min-h-0 flex-1 flex-col">
            {/* 模式标识插槽（7.2） */}
            <div className="shrink-0 px-3 pt-2">
              <CopilotModeIndicatorSlot />
            </div>
            <CopilotMessageList messages={messages} onPickExample={pickExample} />
            {/* 澄清 / 假设 / 未指明信息 / 快捷芯片插槽（7.3–7.6）；无内容时干净折叠。
                `max-h-[40vh] overflow-y-auto`（7.13）：插槽区原先 `shrink-0` 且无高度上界，
                澄清项多 + 收件箱与记忆同时展开时会把输入区顶出面板可视范围——紧凑密度下
                更早发生。改为自身滚动，输入区因此恒定可达。用 vh 而非百分比：百分比要求
                父容器有确定高度，flex 链上任一环没解析出来就退化为不生效。 */}
            <div
              className="flex max-h-[40vh] shrink-0 flex-col gap-2 overflow-y-auto px-3 pb-2"
              data-copilot-slots
            >
              <CopilotClarificationSlot />
              <CopilotTurnActions />
              <CopilotAssumptionsSlot />
              <CopilotUnspecifiedInfoSlot />
              <CopilotChipsSlot />
              <CopilotSuggestionInboxSlot />
              <CopilotMemoryViewSlot />
            </div>

            {/* 全屏专注态扩展面板（3.1–3.3）：证据/澄清历史/差异对比 */}
            <CopilotFullscreenPanels />
            {streamError && (
              <p data-copilot-error className="px-3 pb-2 text-[11px] text-red-600">
                {streamError}
              </p>
            )}
          </div>

          {/* 输入区（移动端贴底，6.8） */}
          <CopilotPanelInput />

          {/* 模式显式标注：生产态与演示态不可混淆（v3-copilot-live-submission-channel D5） */}
          {mode === 'demonstration' ? (
            <p
              data-copilot-no-backend
              data-copilot-mode="demonstration"
              className="border-t border-border px-3 py-1.5 text-center text-[10px] text-gray-400"
            >
              演示模式：{degradeReason ?? '回合通道未接入'}；对话不会保存或修改任何项目数据。
            </p>
          ) : (
            <p
              data-copilot-mode="live"
              className="border-t border-border px-3 py-1.5 text-center text-[10px] text-gray-400"
            >
              可以聊天、查询项目或发起创建；保存修改前会请你确认。
            </p>
          )}
        </aside>

        {/* 最小化悬浮（3.7/3.9）：面板 DOM 保持挂载（hidden），此处仅渲染恢复入口 */}
        {isMinimized && (
          <div
            data-copilot-minimized
            className={cn('fixed bottom-6 right-6 flex items-center gap-1', MINIMIZED_Z)}
          >
            <button
              type="button"
              data-copilot-restore
              aria-label="恢复 AI Copilot 面板"
              onClick={() => useCopilotStore.getState().setForm('drawer')}
              className={cn(
                'relative flex h-11 w-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--ai-accent),var(--primary-500))] text-white shadow-lg transition-transform hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100',
                focusRing,
              )}
            >
              <Sparkles className="h-5 w-5" aria-hidden />
              {streaming && (
                <span
                  className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-pulse rounded-full border-2 border-white bg-ai motion-reduce:animate-none"
                  aria-label="生成中"
                />
              )}
            </button>
            <button
              type="button"
              data-copilot-minimized-close
              aria-label="关闭 AI Copilot"
              onClick={closePanel}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full border border-border bg-gray-0 text-gray-400 transition-colors hover:text-gray-600',
                focusRing,
              )}
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>
        )}
      </>
    </CopilotPanelContext.Provider>
  )
}
