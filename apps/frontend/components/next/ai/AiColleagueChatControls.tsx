'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Globe, History, MessageSquare, Plus, Trash2, X } from 'lucide-react'
import { aiConnectionsApi } from '@/lib/api/ai-connections'
import { copilotWebSearchApi } from '@/lib/api/copilot-web-search'
import { webSearchKeys } from '@/components/next/settings/ai/WebSearchConnectionCard'
import { MAX_OPEN_TABS, conversationTitleOf } from '@/lib/next/ai-colleague-conversations'
import {
  useNextAiColleagueStore,
  type ColleagueModelPreference,
} from '@/stores/next-ai-colleague-store'
import { cn } from '@/lib/utils'

/**
 * AI 同事 · 对话控件（2026-09-26）：
 * - 分页栏：像浏览器一样，一个对话一个分页；「+」开新分页，点分页切换，× 关闭（中键也可关闭）；
 *   关闭的对话进「历史」，随时重新打开；对话保存在本机浏览器，刷新后分页都还在；
 * - 输入框上方「模型」与「网页搜索」：模型来自组织已配置且有密钥的 AI 连接；
 *   网页搜索在超级管理员（平台）同意、团队 / 企业组织再经组织管理员同意后才可打开，
 *   每次提问按次同意；不可用时只显示「未开启」，不提示去找管理员（用户决策 2026-10-05）。
 */

function formatWhen(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${d.getMonth() + 1}-${pad(d.getDate())}`
}

const useBusy = () =>
  useNextAiColleagueStore(
    (s) => s.executionState === 'thinking' || s.executionState === 'executing',
  )

/**
 * 回答进行中也能新建 / 切换 / 关闭分页（2026-10-06）：正在跑的那一轮绑定发起它的对话，
 * 切走后在后台继续，输出写回原对话；分页上用呼吸点标出正在回答的对话。
 */
/** 分页栏：当前分页高亮，标题取首条提问；正在回答的分页显示呼吸点。 */
export function AiColleagueConversationTabs() {
  const openTabIds = useNextAiColleagueStore((s) => s.openTabIds)
  const activeId = useNextAiColleagueStore((s) => s.conversationId)
  const messages = useNextAiColleagueStore((s) => s.messages)
  const conversations = useNextAiColleagueStore((s) => s.conversations)
  const newConversation = useNextAiColleagueStore((s) => s.newConversation)
  const switchConversation = useNextAiColleagueStore((s) => s.switchConversation)
  const closeTab = useNextAiColleagueStore((s) => s.closeConversationTab)
  const busy = useBusy()
  const backgroundRunId = useNextAiColleagueStore((s) => s.backgroundRunId)
  const stripRef = React.useRef<HTMLDivElement | null>(null)

  const titleOf = (id: string): string => {
    if (id === activeId) return messages.length > 0 ? conversationTitleOf(messages) : '新对话'
    return conversations.find((c) => c.id === id)?.title ?? '新对话'
  }

  // 切换/新建后把当前分页滚进可视范围
  React.useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeId, openTabIds.length])

  const canAdd = messages.length > 0 && openTabIds.length < MAX_OPEN_TABS

  return (
    <div
      data-ai-colleague-conversation-tabs
      className="flex items-end gap-1 border-b border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 pt-1.5"
    >
      <div
        ref={stripRef}
        role="tablist"
        aria-label="对话分页"
        className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto [scrollbar-width:none]"
        onWheel={(e) => {
          // 纵向滚轮横向滚动分页栏（分页多时）
          if (e.deltaY !== 0 && stripRef.current) stripRef.current.scrollLeft += e.deltaY
        }}
      >
        {openTabIds.map((id) => {
          const active = id === activeId
          const title = titleOf(id)
          const answering = active ? busy : id === backgroundRunId
          return (
            <div
              key={id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              data-ai-colleague-tab-id={id}
              title={title}
              onClick={() => switchConversation(id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  closeTab(id)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  switchConversation(id)
                }
              }}
              className={cn(
                'group relative flex h-7 max-w-[150px] min-w-[84px] shrink-0 cursor-pointer select-none items-center gap-1 rounded-t-md border border-b-0 px-2 text-[11px] transition-colors',
                active
                  ? 'border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] text-[var(--nx-text-primary)]'
                  : 'border-transparent text-[var(--nx-text-muted)] hover:bg-[var(--nx-bg-2)] hover:text-[var(--nx-text-secondary)]',
              )}
            >
              {answering ? (
                <span
                  data-ai-colleague-tab-answering
                  aria-label="正在回答"
                  className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--nx-accent)]"
                />
              ) : (
                <MessageSquare className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate">{title}</span>
              <button
                type="button"
                aria-label={`关闭对话「${title}」`}
                data-ai-colleague-tab-close={id}
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(id)
                }}
                className={cn(
                  'shrink-0 rounded p-0.5 text-[var(--nx-text-muted)] hover:bg-[var(--nx-bg-2)] hover:text-[var(--nx-text-primary)] disabled:opacity-40',
                  active
                    ? 'opacity-100'
                    : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                )}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        data-ai-colleague-new-conversation
        aria-label="新对话分页"
        disabled={!canAdd}
        title={
          openTabIds.length >= MAX_OPEN_TABS
            ? `最多同时打开 ${MAX_OPEN_TABS} 个对话，请先关闭一些`
            : messages.length === 0
              ? '当前已是新对话'
              : '新对话分页'
        }
        onClick={() => newConversation()}
        className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-2)] hover:text-[var(--nx-text-primary)] disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
      </button>
      <AiColleagueHistoryMenu />
    </div>
  )
}

/** 历史：已关闭分页的对话，点一下重新打开成分页。 */
export function AiColleagueHistoryMenu() {
  const switchConversation = useNextAiColleagueStore((s) => s.switchConversation)
  const deleteConversation = useNextAiColleagueStore((s) => s.deleteConversation)
  const openTabIds = useNextAiColleagueStore((s) => s.openTabIds)
  const conversations = useNextAiColleagueStore((s) => s.conversations)
  const closed = conversations.filter((c) => !openTabIds.includes(c.id) && c.messages.length > 0)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const menuRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!historyOpen) return
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setHistoryOpen(false)
    }
    // Esc 先收起历史下拉，不连带关闭整个面板（window 捕获阶段早于 Radix 的 document 监听）
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      event.preventDefault()
      setHistoryOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [historyOpen])

  return (
    <div className="relative mb-0.5 shrink-0" ref={menuRef}>
      <button
        type="button"
        data-ai-colleague-history-toggle
        aria-expanded={historyOpen}
        title="已关闭的对话"
        className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-2)] hover:text-[var(--nx-text-primary)]"
        onClick={() => setHistoryOpen((v) => !v)}
      >
        <History className="h-3.5 w-3.5" aria-hidden />
        历史
        {closed.length > 0 ? <span className="font-mono text-[10px]">{closed.length}</span> : null}
      </button>
      {historyOpen ? (
        <div
          data-ai-colleague-history
          role="menu"
          className="absolute right-0 top-7 z-20 w-72 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-1 shadow-lg"
        >
          {closed.length === 0 ? (
            <p className="px-2 py-3 text-center text-[11px] text-[var(--nx-text-muted)]">
              没有已关闭的对话
            </p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {closed.map((c) => (
                <li key={c.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    role="menuitem"
                    data-ai-colleague-history-item={c.id}
                    onClick={() => {
                      switchConversation(c.id)
                      setHistoryOpen(false)
                    }}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)] disabled:opacity-50"
                  >
                    <span className="truncate">{c.title}</span>
                    <span className="shrink-0 font-mono text-[10px] text-[var(--nx-text-muted)]">
                      {formatWhen(c.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`删除对话「${c.title}」`}
                    onClick={() => deleteConversation(c.id)}
                    className="shrink-0 rounded p-1 text-[var(--nx-text-muted)] opacity-0 transition-opacity hover:text-[var(--nx-status-danger)] group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}

interface ModelOption extends ColleagueModelPreference {
  key: string
}

export function AiColleagueModelAndSearchBar() {
  const modelPreference = useNextAiColleagueStore((s) => s.modelPreference)
  const setModelPreference = useNextAiColleagueStore((s) => s.setModelPreference)
  const webSearchEnabled = useNextAiColleagueStore((s) => s.webSearchEnabled)
  const setWebSearchEnabled = useNextAiColleagueStore((s) => s.setWebSearchEnabled)

  const connectionsQuery = useQuery({
    queryKey: ['ai-colleague', 'model-options'],
    queryFn: () => aiConnectionsApi.list(),
    staleTime: 60_000,
  })
  const webSearchQuery = useQuery({
    queryKey: webSearchKeys.settings(),
    queryFn: () => copilotWebSearchApi.getSettings(),
    staleTime: 60_000,
  })

  const options: ModelOption[] = React.useMemo(
    () =>
      (connectionsQuery.data ?? [])
        .filter((c) => c.isActive && c.hasKey)
        .flatMap((c) =>
          (c.models ?? []).map((m) => ({
            key: `${c.id}:${m.id}`,
            connectionId: Number(c.id),
            modelId: Number(m.id),
            label:
              c.displayName && c.displayName !== m.modelName
                ? `${m.modelName}（${c.displayName}）`
                : m.modelName,
          })),
        ),
    [connectionsQuery.data],
  )

  // 已选模型被删除/停用时回到组织默认
  React.useEffect(() => {
    if (!modelPreference || !connectionsQuery.data) return
    const stillThere = options.some(
      (o) =>
        o.connectionId === modelPreference.connectionId && o.modelId === modelPreference.modelId,
    )
    if (!stillThere) setModelPreference(null)
  }, [options, modelPreference, connectionsQuery.data, setModelPreference])

  const ws = webSearchQuery.data
  // 以服务端双层同意后的生效状态为准；旧服务端没有 governance 时退回本组织开关
  const webSearchAvailable = ws?.governance
    ? ws.governance.effectiveEnabled
    : !!ws?.enabled && !!ws.allowForGeneralCopilot
  const selectedKey = modelPreference
    ? `${modelPreference.connectionId}:${modelPreference.modelId}`
    : ''

  return (
    <div className="flex flex-wrap items-center gap-2 pb-2" data-ai-colleague-model-bar>
      <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-[var(--nx-text-muted)]">
        模型
        <select
          data-ai-colleague-model-select
          aria-label="选择回答所用的模型"
          value={selectedKey}
          onChange={(e) => {
            const option = options.find((o) => o.key === e.target.value)
            setModelPreference(
              option
                ? {
                    connectionId: option.connectionId,
                    modelId: option.modelId,
                    label: option.label,
                  }
                : null,
            )
          }}
          className="h-7 min-w-0 flex-1 truncate rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 text-[11px] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
        >
          <option value="">组织默认模型</option>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        role="switch"
        aria-checked={webSearchEnabled && webSearchAvailable}
        data-ai-colleague-web-search
        disabled={!webSearchAvailable}
        title={
          webSearchAvailable
            ? '开启后，本对话的提问会先搜索网页资料再回答，并标注来源'
            : '网页搜索未开启'
        }
        onClick={() => setWebSearchEnabled(!webSearchEnabled)}
        className={cn(
          'flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          webSearchEnabled && webSearchAvailable
            ? 'border-[var(--nx-accent)] bg-[var(--nx-space-surface)] text-[var(--nx-accent)]'
            : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
        )}
      >
        <Globe className="h-3.5 w-3.5" aria-hidden />
        网页搜索
      </button>
    </div>
  )
}
