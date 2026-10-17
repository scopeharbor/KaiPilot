'use client'

import * as React from 'react'
import { useMobileWorkspace } from '@/hooks/use-mobile-workspace'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Bot, X } from 'lucide-react'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useAuthStore } from '@/stores/auth-store'
import {
  useNextAiColleagueStore,
  type ColleagueExecutionState,
  type ColleagueMessage,
} from '@/stores/next-ai-colleague-store'
import { preloadColleagueNormalizer } from '@/lib/next/ai-colleague-normalize'
import { useTheaterColleagueBridge } from '@/hooks/use-theater-colleague-bridge'
import { deriveColleagueContext, type ColleagueContext } from '@/lib/next/ai-colleague-intent'
import { AiColleagueInbox } from './AiColleagueInbox'
import { AiColleagueInput } from './AiColleagueInput'
import { AiColleagueMessageList } from './AiColleagueMessageList'
import {
  AiColleagueConversationTabs,
  AiColleagueModelAndSearchBar,
} from './AiColleagueChatControls'
import { useUnreadCount } from '@/hooks/use-suggestion-inbox'

/**
 * AI 同事主抽屉面板（v3-ui-next-ai-colleague W2 · tasks 2.5）。
 *
 * - 基于 Radix Dialog 原语，Portal 挂载至 document.body，不被外层
 *   overflow / 层叠上下文裁剪；深空 HUD 仪器感右吸附抽屉（440px）；
 * - Portal 逃逸了 `[data-next-track]` 令牌作用域 → 内容首层重新标注
 *   `data-next-track`（参照 SpaceMapOverlay 范式），`--nx-*` 变量全局生效；
 * - 情境感知（D-context）：W4 注入 `pathname` + 实体 Store 派生值，
 *   经 W1 `deriveColleagueContext` 合成 `ColleagueContext`，随每条消息提交；
 *   头部 HUD 常驻回显当前情境徽章（项目空间 / 全域首页 / 生成剧场），
 *   杜绝 AI 张冠李戴；v1 确定性规则路由以「⚡ 快捷规则直连」诚实披露（RL-07）；
 * - 焦点与模态纪律（D-a11y）：打开即聚焦输入框（onOpenAutoFocus）、关闭焦点
 *   回跳 `data-ai-colleague-trigger` 触发源；Esc / 遮罩 / 关闭按钮均收敛到
 *   Store `closePanel`；多层模态下 Radix 全局 dismissable 层栈保证
 *   「单次按键仅关闭最上层」（顶层 Overlay 独占 Esc，本面板不越权）；
 * - 沉浸阶梯（D-a11y §4）：精确档 `precise` 停用展开位移动画、遮罩毛玻璃、
 *   呼吸光影，纯黑曜石 `#0a0d12` 底色 + 纯色 1px 发丝线，交互 100% 等价；
 * - 零旧轨依赖：绝不 import `components/copilot/`。
 */

export interface AiColleaguePanelProps {
  /** 当前路由 pathname（W4 由 usePathname() 注入）。 */
  pathname: string
  /** 上下文实体空间项目 ID（W4 由 useProjectSpaceEntityStore 注入；缺省按 pathname 派生）。 */
  entityProjectId?: number | null
  /** 上下文实体标题（W4 由 useProjectSpaceEntityStore 注入；HUD 徽章回显用）。 */
  entityTitle?: string | null
}

/** 头部 HUD 情境徽章回显（design D-context §3）。 */
function headerBadgeText(context: ColleagueContext, entityTitle: string | null): string {
  switch (context.contextType) {
    case 'project_space':
      return `[● 观测中] 项目 #${context.currentProjectId} · ${
        entityTitle?.trim() ? entityTitle.trim() : '项目空间'
      }`
    case 'theater_create':
      return '[○ 生成剧场] 新剧生成工作台'
    case 'role_home':
      return '[○ 全域视图] 角色工作台'
    case 'unknown':
      return '[○ 全域视图] 空间探索'
  }
}

/** 底部发丝线呼吸状态指示器（thinking/executing/awaiting/error；idle 不渲染）。 */
function ColleagueStatusIndicator({
  executionState,
  messages,
  precise,
}: {
  executionState: ColleagueExecutionState
  messages: ColleagueMessage[]
  precise: boolean
}) {
  if (executionState === 'idle') return null

  const executingTool = [...messages]
    .reverse()
    .find((message) => message.toolExecution?.status === 'executing')?.toolExecution?.toolName

  let text: string
  let tone = 'text-[var(--nx-text-secondary)]'
  if (executionState === 'thinking') {
    text = 'AI 同事正在解析意图 …'
  } else if (executionState === 'executing') {
    text = `AI 同事正在执行工具 ${executingTool ?? ''} …`
  } else if (executionState === 'awaiting_confirmation') {
    text = '写操作变更待确认 · 请审查 Diff 后提交'
  } else {
    text = '工具执行失败 · 请调整指令后重试'
    tone = 'text-[var(--nx-status-danger)]'
  }

  return (
    <div
      role="status"
      data-testid="ai-colleague-status"
      data-status={executionState}
      className="pb-2"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`h-1 w-1 shrink-0 rounded-full bg-[var(--nx-space-cyan)] ${
            precise ? '' : 'animate-pulse'
          }`}
        />
        <span className={`text-[10px] ${tone}`}>{text}</span>
      </div>
      <div aria-hidden className="mt-1.5 h-px w-full overflow-hidden">
        <div
          className={`h-full w-1/3 ${
            precise ? 'bg-[var(--nx-space-cyan)]/50' : 'animate-pulse bg-[var(--nx-space-cyan)]/70'
          }`}
        />
      </div>
    </div>
  )
}

export function AiColleaguePanel({
  pathname,
  entityProjectId,
  entityTitle,
}: AiColleaguePanelProps) {
  const isOpen = useNextAiColleagueStore((state) => state.isOpen)
  const executionState = useNextAiColleagueStore((state) => state.executionState)
  const messages = useNextAiColleagueStore((state) => state.messages)
  const theaterLink = useNextAiColleagueStore((state) => state.theaterLink)
  // 一键生成与生成剧场联动（代答 / 转发追问 / 进度播报），面板关着也生效
  useTheaterColleagueBridge()
  const suggestions = useNextAiColleagueStore((state) => state.suggestions)
  const pageVision = useNextAiColleagueStore((state) => state.pageVision)
  const pageAttached = Boolean(pageVision)
  const requestSuggestions = React.useCallback((draft: string) => {
    void useNextAiColleagueStore.getState().refreshSuggestions(draft)
  }, [])
  const captureCurrentPage = React.useCallback(() => {
    void useNextAiColleagueStore.getState().attachPageVision()
  }, [])

  // 一轮结束（AI 已回复、没有在思考 / 执行）后，按对话预测用户下一句，作为 Tab 预填建议
  const conversationId = useNextAiColleagueStore((state) => state.conversationId)
  const lastSuggestedKey = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!isOpen || messages.length === 0) return
    if (executionState === 'thinking' || executionState === 'executing') return
    const last = messages[messages.length - 1]!
    if (last.sender !== 'assistant' || last.liveAnswer?.status === 'streaming') return
    const key = `${conversationId}:${messages.length}`
    if (lastSuggestedKey.current === key) return
    const timer = setTimeout(() => {
      lastSuggestedKey.current = key
      void useNextAiColleagueStore.getState().refreshSuggestions()
    }, 500)
    return () => clearTimeout(timer)
  }, [isOpen, executionState, messages, conversationId])
  const openPanel = useNextAiColleagueStore((state) => state.openPanel)
  const closePanel = useNextAiColleagueStore((state) => state.closePanel)
  const submitUserMessage = useNextAiColleagueStore((state) => state.submitUserMessage)

  const tier = useImmersionTier()
  const precise = tier === 'precise'

  // 矛盾求解的前端物理阻断判据（无 ai:trigger / 无目标实体写权限 → 零请求）；
  // 权限码在登录与刷新时解析进 auth store，服务端仍逐请求重算（RL-05）。
  const permissions = useAuthStore((state) => state.permissions)
  const isSuperAdmin = useAuthStore((state) => state.user?.isSuperAdmin ?? false)

  const mobile = useMobileWorkspace()
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    if (!mobile) return
    const viewport = window.visualViewport
    const update = () => {
      panelRef.current?.style.setProperty(
        '--mobile-ai-height',
        `${viewport?.height ?? window.innerHeight}px`,
      )
      panelRef.current?.style.setProperty('--mobile-ai-top', `${viewport?.offsetTop ?? 0}px`)
    }
    update()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    return () => {
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
    }
  }, [mobile])
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)
  /** 关闭后焦点回跳目标快照：打开瞬间记录，避免关闭路径查询 DOM 的竞态。 */
  const returnFocusTargetRef = React.useRef<HTMLElement | null>(null)

  // 打开时快照焦点回跳目标：优先触发按钮（data-ai-colleague-trigger），
  // 次选打开瞬间的活动元素（快捷键唤起时聚焦即触发源）。
  React.useEffect(() => {
    if (!isOpen) return
    const trigger = document.querySelector<HTMLElement>('[data-ai-colleague-trigger]')
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    returnFocusTargetRef.current = trigger ?? active
    // 预热繁转简词典（路由判断用），第一句话不用多等
    preloadColleagueNormalizer()
  }, [isOpen])

  // 双 rAF 焦点回跳：延迟到 Radix 卸载清理（RemoveScroll/焦点守卫等）完全落定后执行；
  // jsdom 下 rAF 由测试 setup 以宏任务模拟，双重调度保证最终落点稳定（不依赖单一定时器时序）。
  const scheduleReturnFocus = React.useCallback(() => {
    const target = returnFocusTargetRef.current
    if (!target) return
    const frame =
      typeof window.requestAnimationFrame === 'function'
        ? (cb: () => void) => window.requestAnimationFrame(cb)
        : (cb: () => void) => window.setTimeout(cb, 0)
    frame(() => frame(() => target.focus()))
  }, [])

  const context = React.useMemo(
    () =>
      ({
        ...deriveColleagueContext(pathname, entityProjectId ?? null),
        permissions,
        isSuperAdmin,
      }) satisfies ColleagueContext,
    [pathname, entityProjectId, permissions, isSuperAdmin],
  )

  const handleSubmit = React.useCallback(
    (text: string) => {
      void submitUserMessage(text, context)
    },
    [submitUserMessage, context],
  )

  // 回答进行中（本分页或后台分页）输入框照常可打字；此时发出的消息先排队，这一轮结束后自动发送
  const answering = executionState === 'thinking' || executionState === 'executing'
  const backgroundRunId = useNextAiColleagueStore((state) => state.backgroundRunId)
  const queuedMessage = useNextAiColleagueStore((state) => state.queuedMessage)
  const activeConversationId = useNextAiColleagueStore((state) => state.conversationId)
  const queuedHere = queuedMessage?.conversationId === activeConversationId ? queuedMessage : null

  // 面板双页签：对话 / 建议收件箱（未读徽标）。收件箱数据与旧轨 Copilot 收件箱同源。
  const [panelTab, setPanelTab] = React.useState<'chat' | 'inbox'>('chat')
  const inboxProjectId =
    context.contextType === 'project_space' ? (context.currentProjectId ?? undefined) : undefined
  // 面板关闭时不查询未读数（零常驻请求；打开即查）
  const unreadQuery = useUnreadCount(inboxProjectId, isOpen)
  const unreadCount = unreadQuery.data ?? 0

  return (
    <DialogPrimitive.Root
      open={isOpen}
      onOpenChange={(next) => {
        if (next) openPanel()
        else closePanel()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-testid="ai-colleague-scrim"
          className={`fixed inset-0 z-[var(--z-modal-backdrop)] bg-black/40 ${
            precise ? '' : 'backdrop-blur-xs'
          }`}
        />
        <DialogPrimitive.Content
          ref={(node) => {
            panelRef.current = node
            if (node && mobile) {
              node.style.setProperty(
                '--mobile-ai-height',
                `${window.visualViewport?.height ?? window.innerHeight}px`,
              )
              node.style.setProperty(
                '--mobile-ai-top',
                `${window.visualViewport?.offsetTop ?? 0}px`,
              )
            }
          }}
          style={
            mobile
              ? {
                  top: 'var(--mobile-ai-top, 0px)',
                  height: 'var(--mobile-ai-height, 100dvh)',
                  bottom: 'auto',
                }
              : undefined
          }
          role="dialog"
          aria-modal="true"
          aria-label="AI 同事交互面板"
          data-ai-colleague-panel=""
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (!mobile) inputRef.current?.focus()
            else
              panelRef.current
                ?.querySelector<HTMLButtonElement>('[data-ai-colleague-close]')
                ?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            // 统一焦点回跳（Esc / 关闭按钮 / 遮罩三类关闭路径共用同一入口）
            scheduleReturnFocus()
          }}
          className={`fixed bottom-0 right-0 top-14 z-[var(--z-modal)] flex w-[440px] max-w-full flex-col outline-none transition-transform duration-200 ease-out data-[state=open]:translate-x-0 data-[state=closed]:translate-x-full xl:top-12 ${
            precise ? 'duration-0' : ''
          }`}
        >
          {/* Portal 逃逸令牌作用域 → 首层重挂 data-next-track（SpaceMapOverlay 同款范式） */}
          <div
            data-next-track
            className={`flex h-full min-h-0 flex-col border-l border-[var(--nx-border-hairline)] ${
              precise ? 'bg-[#0a0d12]' : 'bg-[var(--nx-workspace-surface)]'
            }`}
          >
            <header
              data-ai-colleague-header
              className="flex items-start justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-4 py-3"
            >
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-[var(--nx-text-primary)]">AI 同事</h2>
                <p
                  data-ai-colleague-context
                  className="mt-1 truncate font-mono text-[10px] tracking-wide text-[var(--nx-space-cyan)]"
                >
                  {headerBadgeText(context, entityTitle ?? null)}
                </p>
                <p
                  className="mt-1 flex items-center gap-1 text-[10px] text-[var(--nx-text-muted)]"
                  title="「去甘特图」「延期任务…」等快捷指令由确定性规则直接执行；其他提问交给所选模型回答"
                >
                  <span aria-hidden>⚡</span>
                  快捷规则直连 · 操作指令与提问由模型理解
                </p>
              </div>
              <div className="flex shrink-0 items-start gap-1">
                <DialogPrimitive.Close
                  aria-label="关闭 AI 同事面板"
                  data-ai-colleague-close
                  className="shrink-0 rounded-md p-1.5 text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                >
                  <X className="h-4 w-4" aria-hidden />
                </DialogPrimitive.Close>
              </div>
            </header>

            {theaterLink?.mode === 'auto' ? (
              <div
                role="status"
                data-ai-colleague-autopilot
                className="flex items-center gap-2 border-b border-[var(--nx-border-hairline)] bg-[var(--nx-space-surface)] px-4 py-2"
              >
                <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--nx-accent)]" aria-hidden />
                <p className="min-w-0 flex-1 text-[11px] leading-snug text-[var(--nx-text-primary)]">
                  <span className="font-semibold text-[var(--nx-accent)]">全自动</span>
                  {' · '}AI 同事自己回答追问、修正草案并转为正式项目，过程中不会再问你
                </p>
                <button
                  type="button"
                  data-ai-colleague-autopilot-stop
                  onClick={() => useNextAiColleagueStore.getState().stopAutopilot()}
                  className="shrink-0 rounded-sm border border-[var(--nx-border-hairline)] px-2 py-0.5 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                >
                  停止全自动
                </button>
              </div>
            ) : null}

            {/* 页签：对话 / 建议收件箱 */}
            <div
              role="tablist"
              aria-label="AI 同事面板视图"
              data-ai-colleague-tabs
              className="flex items-center gap-1 border-b border-[var(--nx-border-hairline)] px-4 py-1.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={panelTab === 'chat'}
                data-ai-colleague-tab="chat"
                onClick={() => setPanelTab('chat')}
                className={`h-6 rounded-sm px-2.5 text-[11px] transition-colors ${
                  panelTab === 'chat'
                    ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
                    : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]'
                }`}
              >
                对话
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={panelTab === 'inbox'}
                data-ai-colleague-tab="inbox"
                onClick={() => setPanelTab('inbox')}
                className={`flex h-6 items-center gap-1.5 rounded-sm px-2.5 text-[11px] transition-colors ${
                  panelTab === 'inbox'
                    ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
                    : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]'
                }`}
              >
                建议收件箱
                {unreadCount > 0 ? (
                  <span
                    data-ai-colleague-inbox-unread
                    aria-label={`${unreadCount} 条未读建议`}
                    className="inline-flex min-w-4 items-center justify-center rounded-full bg-[var(--nx-accent)] px-1 text-[9px] font-semibold text-[var(--nx-bg-0)]"
                  >
                    {unreadCount}
                  </span>
                ) : null}
              </button>
            </div>

            {panelTab === 'chat' ? (
              <>
                <AiColleagueConversationTabs />
                <AiColleagueMessageList onQuickAction={handleSubmit} />

                <div className="border-t border-[var(--nx-border-hairline)] px-3 pt-2">
                  <ColleagueStatusIndicator
                    executionState={executionState}
                    messages={messages}
                    precise={precise}
                  />
                </div>

                <div
                  data-ai-colleague-composer
                  className="shrink-0 p-3 pb-[max(12px,env(safe-area-inset-bottom))]"
                >
                  <AiColleagueModelAndSearchBar />
                  {queuedHere ? (
                    <div
                      data-ai-colleague-queued
                      role="status"
                      className="mb-2 flex items-start justify-between gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-text-secondary)]"
                    >
                      <span className="min-w-0 break-words">
                        已排队，{answering ? '这一轮' : '另一段对话'}回答完成后自动发送：「
                        {queuedHere.text.length > 60
                          ? `${queuedHere.text.slice(0, 60)}…`
                          : queuedHere.text}
                        」
                      </span>
                      <button
                        type="button"
                        data-ai-colleague-queued-cancel
                        onClick={() => useNextAiColleagueStore.getState().cancelQueuedMessage()}
                        className="shrink-0 text-[var(--nx-accent)] hover:underline"
                      >
                        取消
                      </button>
                    </div>
                  ) : null}
                  <AiColleagueInput
                    ref={inputRef}
                    onSubmit={handleSubmit}
                    placeholder={
                      answering
                        ? 'AI 正在回答，可以先输入；现在发送会排队，回答完成后自动发出'
                        : backgroundRunId
                          ? '另一段对话正在回答；现在发送会排队，完成后自动发出'
                          : '问任何问题，或直接吩咐：「把登录页任务标为完成，再打开甘特图」…'
                    }
                    suggestions={suggestions}
                    onRequestSuggestions={requestSuggestions}
                    onCapturePage={captureCurrentPage}
                    pageAttached={pageAttached}
                  />
                </div>
              </>
            ) : (
              <AiColleagueInbox projectId={inboxProjectId} />
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export default AiColleaguePanel
