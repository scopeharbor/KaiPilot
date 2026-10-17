'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Bot, Cpu, Theater } from 'lucide-react'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'

/** 选了模式后顺便请求系统通知权限（用户手势内才会弹授权），用于离开页面后的提醒。 */
function requestNotificationPermission(): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
  void Notification.requestPermission().catch(() => undefined)
}

/**
 * 一键生成前的选择弹窗：AI 同事理解出「要生成项目」后弹出——
 * 全自动（AI 代答追问、生成、修正并转正）或带我到生成剧场（自己回答追问）。
 * 生成默认使用与 AI 同事相同的模型。对话里同时有同一个问题卡，答哪边都行。
 */
export function GenerationModeDialog() {
  const pending = useNextAiColleagueStore((state) => state.pendingGenerationChoice)
  const choose = (choice: 'auto' | 'manual' | 'cancel') => {
    if (choice !== 'cancel') requestNotificationPermission()
    void useNextAiColleagueStore.getState().chooseGenerationMode(choice)
  }
  const idea = pending?.idea ?? ''

  return (
    <DialogPrimitive.Root
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open && useNextAiColleagueStore.getState().pendingGenerationChoice) choose('cancel')
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[var(--z-modal-backdrop)] bg-black/50" />
        <DialogPrimitive.Content
          data-next-track
          data-generation-mode-dialog
          className="fixed left-1/2 top-1/2 z-[var(--z-modal)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] p-4 shadow-lg outline-none"
        >
          <DialogPrimitive.Title className="text-sm font-semibold text-[var(--nx-text-primary)]">
            要怎么生成这个项目？
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1 line-clamp-3 text-xs text-[var(--nx-text-secondary)]">
            「{idea.length > 80 ? `${idea.slice(0, 80)}…` : idea}」
          </DialogPrimitive.Description>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--nx-text-muted)]">
            <Cpu className="h-3.5 w-3.5" aria-hidden />
            使用模型：{pending?.modelLabel ?? '与 AI 同事相同（组织默认模型）'}
          </p>
          {pending && !pending.canConfirm ? (
            <p className="mt-2 rounded border border-[var(--nx-status-warning)]/60 px-2 py-1.5 text-[11px] text-[var(--nx-status-warning)]">
              当前账号没有转正权限（缺少
              ai:confirm）：全自动只能做到生成并修正草案，转为正式项目要请有权限的人确认。
            </p>
          ) : null}

          <div className="mt-3 space-y-2">
            <button
              type="button"
              data-generation-mode="auto"
              onClick={() => choose('auto')}
              className="flex w-full items-start gap-2.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 py-2.5 text-left transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
            >
              <Bot className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nx-accent)]" aria-hidden />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-[var(--nx-text-primary)]">
                  {pending?.canConfirm === false
                    ? '全自动（到草案为止）'
                    : '全自动（包括转为正式项目）'}
                </span>
                <span className="mt-0.5 block text-[11px] text-[var(--nx-text-secondary)]">
                  AI 同事审阅并回答追问、生成并修正草案
                  {pending?.canConfirm === false ? '' : '、转为正式项目'}
                  ，过程中不会再问你；可以离开页面，完成后通知你。
                </span>
              </span>
            </button>
            <button
              type="button"
              data-generation-mode="manual"
              onClick={() => choose('manual')}
              className="flex w-full items-start gap-2.5 rounded-md border border-[var(--nx-border-hairline)] px-3 py-2.5 text-left transition-colors hover:border-[var(--nx-border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
            >
              <Theater
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nx-text-secondary)]"
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-[var(--nx-text-primary)]">
                  带我到生成剧场
                </span>
                <span className="mt-0.5 block text-[11px] text-[var(--nx-text-secondary)]">
                  像以前一样在生成剧场自己回答追问、审查草案；生成中可以离开页面，需要你处理时会通知。
                </span>
              </span>
            </button>
          </div>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              data-generation-mode="cancel"
              onClick={() => choose('cancel')}
              className="rounded-sm px-2.5 py-1 text-[11px] text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]"
            >
              先不生成
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
