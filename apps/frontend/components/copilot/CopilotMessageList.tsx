'use client'

import * as React from 'react'
import type {
  CopilotAssumptionEntry,
  CopilotMessage,
  CopilotRecommendedAction,
} from '@aiproj/types'
import { mapCopilotConfidenceToBand } from '@aiproj/types'
import { Sparkles, Lock } from 'lucide-react'
import { useCopilotStore } from '@/stores/copilot-store'
import { cn } from '@/lib/utils'
import { retryCopilotTurn, retryCopilotTurnWithCurrentPage } from '@/lib/copilot/submit'
import { CopilotEmptyState } from './CopilotEmptyState'
import { CopilotStreamingProgress } from './CopilotStreamingProgress'
import { PageContextDisclosure } from './PageContextDisclosure'
import type { CopilotSlotsProps } from './copilot-slots'

/** 时间戳展示（右对齐）：HH:MM。 */
export function formatCopilotTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function AssistantAvatar() {
  return (
    <span
      aria-hidden
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--ai-accent),var(--primary-500))] animate-pulse motion-reduce:animate-none"
    >
      <Sparkles className="h-3.5 w-3.5 text-white" />
    </span>
  )
}

function AssistantBubble({ message }: { message: CopilotMessage }) {
  return (
    <div className="flex items-start gap-2" data-copilot-message data-role="assistant">
      <AssistantAvatar />
      <div className="min-w-0 max-w-[85%]">
        <div
          data-copilot-bubble
          className="break-words rounded-[var(--radius-lg)] border-l-[3px] border-[var(--ai-accent)] bg-surface px-3 py-2 text-sm text-gray-800"
        >
          {message.messageSummary}
        </div>
        <div className="mt-1 text-right text-[10px] text-gray-400" data-copilot-timestamp>
          {formatCopilotTimestamp(message.createdAt)}
        </div>
      </div>
    </div>
  )
}

function UserBubble({ message }: { message: CopilotMessage }) {
  return (
    <div className="flex justify-end" data-copilot-message data-role="user">
      <div className="min-w-0 max-w-[85%]">
        <div
          data-copilot-bubble
          className="break-words rounded-[var(--radius-lg)] bg-[var(--primary-500)] px-3 py-2 text-sm text-white"
        >
          {message.messageSummary}
        </div>
        <div className="mt-1 text-right text-[10px] text-gray-400" data-copilot-timestamp>
          {formatCopilotTimestamp(message.createdAt)}
        </div>
      </div>
    </div>
  )
}

/** 动作卡片：动作通道未接入 → 一律禁用预览态（红线任务组 7）。 */
function DisabledActionCard({ action }: { action: CopilotRecommendedAction }) {
  return (
    <div
      data-copilot-action-card
      className="rounded-[var(--radius-lg)] border border-border bg-surface-2 p-3 opacity-80"
      aria-disabled="true"
    >
      <div className="flex items-start gap-2">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-gray-700">{action.label}</p>
          <p className="mt-0.5 text-[11px] text-gray-500">{action.description}</p>
          <p className="mt-1.5 text-[10px] text-gray-400">
            预览不可用：动作通道尚未接入，不会自动执行任何修改。
          </p>
        </div>
      </div>
    </div>
  )
}

/** 假设清单插槽默认提供内容（demo fixture，归属能力未接入时壳以演示数据填充；形状与契约一致）。 */
function DemoAssumptions({ assumptions }: { assumptions: readonly CopilotAssumptionEntry[] }) {
  return (
    <div
      data-copilot-assumptions
      className="rounded-[var(--radius-lg)] border border-border bg-surface p-3"
    >
      <p className="text-[11px] font-medium text-gray-500">假设（演示）</p>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {assumptions.map((a) => (
          <li key={a.assumptionId} className="flex items-start justify-between gap-2 text-[11px]">
            <span className="min-w-0 flex-1 break-words text-gray-600">{a.statement}</span>
            <span
              className={cn(
                'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                mapCopilotConfidenceToBand(a.confidence) === 'high' &&
                  'bg-primary-100 text-primary-700',
                mapCopilotConfidenceToBand(a.confidence) === 'medium' && 'bg-ai/10 text-ai',
                mapCopilotConfidenceToBand(a.confidence) === 'low' && 'bg-amber-100 text-amber-700',
              )}
              data-copilot-confidence
            >
              可信度 {a.confidence}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface CopilotMessageListProps extends CopilotSlotsProps {
  messages: readonly CopilotMessage[]
  /** 空状态示例点击：填入输入框。 */
  onPickExample: (text: string) => void
}

/**
 * 消息列表（任务 4.1：分段渲染，长会话不卡顿）。
 *
 * 插槽纪律（5.1–5.3）：chips / assumptions / confidence 三处插槽**原样渲染归属能力提供的内容**，
 * 壳不转换、不过滤、不二次派生；未提供时**干净折叠**（不留空白/错位/「加载失败」控件）。
 * 演示期组装 demo 数据的假设/动作展示属渲染职责，形状与共享契约一致；派生逻辑归各归属 change。
 */
export function CopilotMessageList({
  messages,
  onPickExample,
  quickActionChips,
  assumptions,
  confidenceIndicator,
}: CopilotMessageListProps) {
  const streaming = useCopilotStore((s) => s.streaming)
  const streamPhase = useCopilotStore((s) => s.streamPhase)
  const cancelled = streamPhase === 'cancelled'
  const demoActions = useCopilotStore((s) => s.demoActions)
  const demoAssumptions = useCopilotStore((s) => s.demoAssumptions)
  const streamingAssistant = useCopilotStore((s) => s.streamingAssistant)
  // 网页搜索门状态（v3-copilot-optional-web-search-configuration）：引用分区提示
  const webSearchStatus = useCopilotStore((s) => s.webSearchStatus)

  return (
    <div data-copilot-scroll className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {/* 页面语境披露（v3-copilot-authoritative-page-context；无披露时干净折叠）。
          「使用当前页面重试」用当前页面新派生 descriptor；默认走提交时快照。 */}
      <PageContextDisclosure
        onRetryCurrentPage={(descriptor) => {
          void retryCopilotTurnWithCurrentPage(descriptor)
        }}
        onRetrySnapshot={() => {
          void retryCopilotTurn()
        }}
      />
      {messages.length === 0 && !streaming && !cancelled && !streamingAssistant ? (
        <CopilotEmptyState onPick={onPickExample} />
      ) : (
        <div className="flex flex-col gap-3">
          {messages.map((m) =>
            m.role === 'user' ? (
              <UserBubble key={m.messageId} message={m} />
            ) : (
              <AssistantBubble key={m.messageId} message={m} />
            ),
          )}

          {/* 流式占位气泡（v3-copilot-live-streaming-output）：answer-delta 增量累积 */}
          {streamingAssistant ? (
            <div className="flex items-start gap-2" data-copilot-message data-role="assistant">
              <AssistantAvatar />
              <div className="min-w-0 max-w-[85%]">
                <div
                  data-copilot-bubble
                  data-copilot-streaming="live"
                  className="break-words rounded-[var(--radius-lg)] border-l-[3px] border-[var(--ai-accent)] bg-surface px-3 py-2 text-sm text-gray-800"
                >
                  {streamingAssistant.content}
                  {streamingAssistant.content.length === 0 ? '正在生成…' : '▍'}
                </div>
              </div>
            </div>
          ) : null}

          {streaming && <CopilotStreamingProgress />}
          {cancelled && (
            <p data-copilot-cancelled className="text-center text-[11px] text-gray-400">
              已取消生成——本次未生成任何答复。
            </p>
          )}

          {/* 网页搜索引用分区提示（v3-copilot-optional-web-search-configuration）：
              外部来源与项目内部事实分区展示；降级时如实说明外部资料缺失原因 */}
          {webSearchStatus ? (
            <div
              data-copilot-web-search-status
              className={cn(
                'rounded-[var(--radius-md)] border px-3 py-2 text-xs leading-5',
                webSearchStatus.code === 'web_search_called'
                  ? 'border-success/40 bg-success-bg text-success'
                  : 'border-warning/40 bg-warning-bg text-warning',
              )}
            >
              <p className="font-medium">
                {webSearchStatus.code === 'web_search_called'
                  ? '已使用外部网页搜索'
                  : '外部资料不可用'}
              </p>
              <p className="mt-0.5 opacity-90">
                {webSearchStatus.message}
                {webSearchStatus.code === 'web_search_called'
                  ? ' 外部来源带引用标记，仅供参考；项目内部事实仍以项目数据为准。'
                  : ''}
              </p>
            </div>
          ) : null}

          {/* 动作卡片（禁用预览态，红线 7.x）——归属能力提供时原样渲染 */}
          {demoActions.length > 0 && !streaming && (
            <div className="flex flex-col gap-2" data-copilot-actions-slot>
              {demoActions.map((a) => (
                <DisabledActionCard key={a.actionId} action={a} />
              ))}
            </div>
          )}

          {/* 三处插槽：原样渲染归属能力内容；未提供时干净折叠 */}
          {quickActionChips ? (
            <div data-copilot-chips-slot className="overflow-x-auto">
              <div className="flex w-max gap-1.5">{quickActionChips}</div>
            </div>
          ) : null}

          {assumptions ? <div data-copilot-assumptions-slot>{assumptions}</div> : null}

          {/* 演示期组装：假设 demo 展示与可信度（形状对齐契约；置信度映射只发生在壳内只读展示层） */}
          {demoAssumptions.length > 0 && !streaming && assumptions === undefined ? (
            <DemoAssumptions assumptions={demoAssumptions} />
          ) : null}

          {confidenceIndicator ? (
            <div data-copilot-confidence-slot>{confidenceIndicator}</div>
          ) : null}
        </div>
      )}
    </div>
  )
}
