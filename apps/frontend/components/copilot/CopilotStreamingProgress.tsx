'use client'

import * as React from 'react'
import { CheckCircle2, Loader2, X } from 'lucide-react'
import { useCopilotStore, type CopilotStreamPhase } from '@/stores/copilot-store'
import { COPILOT_DEMO_ETA_TEXT, COPILOT_DEMO_STREAM_STEPS } from './copilot-fixtures'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'

/**
 * 流式生成过程展示（spec copilot-sidebar-shell / 任务 4.6、4.7）。
 *
 * 分步进度（理解需求 / 分析结构 / 生成方案）+ 预计剩余 + 取消，
 * 复用既有流式词汇（与 DraftGenerationProgress 同语义），本阶段为 fixture 演示。
 * 取消经既有 abort 语义中止：置 streaming=false 并标记 cancelled，
 * 不追加任何「完成态」消息（任务 4.8）。真实 SSE 通道归后续 change 接入。
 */

function stepIndex(phase: CopilotStreamPhase): number {
  if (phase === 'understanding') return 0
  if (phase === 'analyzing') return 1
  if (phase === 'generating') return 2
  return -1
}

export function CopilotStreamingProgress() {
  const phase = useCopilotStore((s) => s.streamPhase)

  const current = stepIndex(phase)

  return (
    <div
      data-copilot-streaming
      className="rounded-[var(--radius-lg)] border border-border bg-surface p-3"
      aria-busy="true"
    >
      <div className="mb-2 flex items-center gap-2">
        <Loader2
          className="h-3.5 w-3.5 animate-spin text-ai motion-reduce:animate-none"
          aria-hidden
        />
        {/* 窄屏/紧凑：阶段文案截断、ETA 不被挤压（6.10） */}
        <span className="min-w-0 truncate text-xs font-medium text-gray-700">
          {phase === 'understanding' && '正在理解需求…'}
          {phase === 'analyzing' && '正在分析结构…'}
          {phase === 'generating' && '正在生成方案…'}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-gray-400">{COPILOT_DEMO_ETA_TEXT}</span>
      </div>

      {/* 分步进度条 */}
      <div className="flex items-center gap-1.5" aria-hidden>
        {COPILOT_DEMO_STREAM_STEPS.map((step, i) => {
          const state =
            current < 0 ? 'pending' : i < current ? 'done' : i === current ? 'active' : 'pending'
          return (
            <React.Fragment key={step.key}>
              {i > 0 && <span className="h-px flex-1 bg-border" />}
              <span
                className={cn(
                  'flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[10px] font-medium',
                  state === 'done' && 'bg-primary-100 text-primary-700',
                  state === 'active' && 'bg-ai/10 text-ai',
                  state === 'pending' && 'bg-gray-100 text-gray-400',
                )}
              >
                {state === 'done' ? (
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                )}
                {step.label}
              </span>
            </React.Fragment>
          )
        })}
      </div>

      <div className="mt-2 flex items-center justify-end">
        <button
          type="button"
          data-copilot-cancel
          onClick={() => useCopilotStore.getState().setStreaming(false, 'cancelled')}
          className={cn(
            'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[11px] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700',
            focusRing,
          )}
        >
          <X className="h-3 w-3" aria-hidden />
          取消生成
        </button>
      </div>
    </div>
  )
}
