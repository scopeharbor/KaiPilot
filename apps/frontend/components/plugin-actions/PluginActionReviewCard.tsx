'use client'

/**
 * v3-plugin-action-preview-boundary —— PluginActionReviewCard（任务 4.3/4.4，P1）。
 *
 * 复用动作卡交互范式呈现插件来源动作的标准预览：
 * - 插件来源徽标（pluginId@version + surface）、before/after diff、
 *   assumptions（纯文本原样渲染，不复制 Copilot 假设插槽/置信度逻辑）、
 *   dry-run findings（blocking 高亮）、可逆性与批量策略；
 * - 最多三个主操作（确认执行 / 拒绝 / 修改），丢弃折叠进「更多」；
 * - 按钮 idle→loading→success/failure 明确反馈，禁止无反馈态；
 * - 无权限动作**不渲染**（非禁用可见）；
 * - dry-run blocking finding → 确认禁用并给出可读中文原因；
 * - 全部措辞审查导向中文，禁止自动执行类表述。
 */
import React, { useCallback, useState } from 'react'
import type { PluginActionPreview } from '@aiproj/types'
import { findCopilotActionForbiddenWording } from '@aiproj/types'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card'

export interface PluginActionReviewCardProps {
  proposalUid: string
  preview: PluginActionPreview
  /** actor 拥有的权限集；无权限的动作不渲染。 */
  actorPermissions?: readonly string[]
  /** 确认执行（父层持一次性句柄并发起 confirm）。 */
  onConfirm?: () => Promise<void>
  /** 拒绝 / 丢弃 / 修改决策入口。 */
  onDecision?: (decision: 'reject' | 'discard' | 'modify') => Promise<void>
}

type FeedbackState = 'idle' | 'loading' | 'success' | 'failure'

interface ControlFeedback {
  state: FeedbackState
  message: string | null
}

const PRIMARY_MAX = 3

function wordingOf(text: string): readonly string[] {
  return findCopilotActionForbiddenWording(text)
}

export function PluginActionReviewCard({
  proposalUid,
  preview,
  actorPermissions = [],
  onConfirm,
  onDecision,
}: PluginActionReviewCardProps) {
  const [feedback, setFeedback] = useState<Record<string, ControlFeedback>>({})
  const [moreOpen, setMoreOpen] = useState(false)

  const blockingFinding = preview.dryRun.findings.find((f) => f.severity === 'blocking')
  const canConfirm =
    !blockingFinding && preview.dryRun.canApply && preview.permissionSummary.granted
  const hasConfirmPermission = actorPermissions.includes('plugin_action:confirm')

  const runControl = useCallback(async (key: string, label: string, run: () => Promise<void>) => {
    setFeedback((prev) => ({ ...prev, [key]: { state: 'loading', message: null } }))
    try {
      await run()
      setFeedback((prev) => ({
        ...prev,
        [key]: { state: 'success', message: `${label}完成` },
      }))
    } catch {
      setFeedback((prev) => ({
        ...prev,
        [key]: { state: 'failure', message: `${label}失败，请重试` },
      }))
    }
  }, [])

  // 主操作最多三个；「丢弃」折叠进更多
  const primary: {
    key: string
    label: string
    visible: boolean
    disabled: boolean
    run: () => Promise<void>
    variant: 'primary' | 'secondary'
  }[] = [
    {
      key: 'confirm',
      label: '确认执行',
      visible: hasConfirmPermission,
      disabled: !canConfirm || !!blockingFinding,
      variant: 'primary',
      run: () => (onConfirm ? onConfirm() : Promise.resolve()),
    },
    {
      key: 'reject',
      label: '拒绝',
      visible: hasConfirmPermission,
      disabled: false,
      variant: 'secondary',
      run: () => (onDecision ? onDecision('reject') : Promise.resolve()),
    },
    {
      key: 'modify',
      label: '修改',
      visible: hasConfirmPermission,
      disabled: false,
      variant: 'secondary',
      run: () => (onDecision ? onDecision('modify') : Promise.resolve()),
    },
  ]
  const secondaryVisible = hasConfirmPermission ? [{ key: 'discard', label: '丢弃' as const }] : []

  const renderButton = (ctrl: {
    key: string
    label: string
    disabled: boolean
    run: () => Promise<void>
    variant: 'primary' | 'secondary'
  }) => {
    const fb = feedback[ctrl.key]
    const state = fb?.state ?? 'idle'
    const forbidden = wordingOf(ctrl.label)
    if (forbidden.length > 0) {
      // 防御性：任何自动执行措辞一律不渲染该操作
      return null
    }
    return (
      <Button
        key={ctrl.key}
        variant={ctrl.variant}
        size="sm"
        disabled={state === 'loading' || ctrl.disabled}
        loading={state === 'loading'}
        data-state={state}
        aria-label={ctrl.label}
        onClick={() => void runControl(ctrl.key, ctrl.label, ctrl.run)}
      >
        {state === 'loading' ? '处理中…' : ctrl.label}
        {state === 'success' ? ' ✓' : ''}
        {state === 'failure' ? ' ✗' : ''}
      </Button>
    )
  }

  const visiblePrimary = primary.filter((p) => p.visible).slice(0, PRIMARY_MAX)

  return (
    <Card data-testid={`plugin-action-card-${proposalUid}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="text-sm">插件动作提案 · 待人工确认</CardTitle>
          <p className="mt-1 text-xs text-gray-500" data-testid="plugin-source">
            来源插件 {preview.pluginRef.pluginId}@{preview.pluginRef.pluginVersion} · 动作{' '}
            {preview.actionKind}
          </p>
        </div>
        {!preview.dryRun.canApply || blockingFinding ? (
          <Badge variant="warning" data-testid="dry-run-blocked-badge">
            试运行存在阻断项
          </Badge>
        ) : (
          <Badge variant="neutral" data-testid="dry-run-ok-badge">
            试运行通过
          </Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {/* before/after diff */}
        <div
          className="rounded-md border p-2 text-xs"
          data-testid="action-diff"
          role="table"
          aria-label="变更预览"
        >
          {preview.diffEntries.map((entry) => (
            <div key={`${entry.targetRef}:${entry.field}`} className="flex gap-2 py-0.5">
              <span className="w-24 shrink-0 text-gray-400">{entry.field}</span>
              <span className="text-red-600 line-through">{String(entry.before ?? '空')}</span>
              <span aria-hidden>→</span>
              <span className="text-green-700">{String(entry.after)}</span>
            </div>
          ))}
        </div>

        {/* assumptions：纯文本原样渲染，不做编辑/映射 */}
        {preview.assumptions.length > 0 ? (
          <ul className="space-y-1 rounded-md border p-2 text-xs" data-testid="assumption-list">
            {preview.assumptions.map((a) => (
              <li key={a} className="text-gray-700">
                {a}
              </li>
            ))}
          </ul>
        ) : null}

        {/* findings */}
        {preview.dryRun.findings.length > 0 ? (
          <ul className="space-y-1 rounded-md border p-2 text-xs" data-testid="finding-list">
            {preview.dryRun.findings.map((f) => (
              <li
                key={f.code}
                className={f.severity === 'blocking' ? 'text-amber-700' : 'text-gray-500'}
              >
                [{f.severity === 'blocking' ? '阻断' : '提示'}] {f.message}
              </li>
            ))}
          </ul>
        ) : null}

        {blockingFinding ? (
          <p className="text-xs text-amber-600" data-testid="confirm-block-reason">
            存在阻断项，暂不可确认；请先处理上方提示后重新预览
          </p>
        ) : null}

        <p className="text-xs text-gray-400" data-testid="meta-line">
          受影响项 {preview.affectedItemRefs.length} 条 · 可逆性{' '}
          {preview.reversibility === 'reversible'
            ? '可回退'
            : preview.reversibility === 'irreversible'
              ? '不可回退'
              : '部分可回退'}{' '}
          · 批量策略 {preview.batchPolicy === 'per-item' ? '逐项独立' : '全部成功或全部不执行'}
        </p>
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-2">
        {visiblePrimary.map(renderButton)}
        {secondaryVisible.length > 0 ? (
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              aria-label="更多"
              onClick={() => setMoreOpen((v) => !v)}
            >
              更多
            </Button>
            {moreOpen ? (
              <div className="absolute right-0 z-10 mt-1 flex flex-col gap-1 rounded border bg-white p-1 shadow">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="丢弃"
                  onClick={() =>
                    void runControl('discard', '丢弃', () =>
                      onDecision ? onDecision('discard') : Promise.resolve(),
                    )
                  }
                >
                  {(feedback['discard']?.state === 'loading' ? '处理中…' : null) ?? '丢弃'}
                  {feedback['discard']?.state === 'success' ? ' ✓' : ''}
                  {feedback['discard']?.state === 'failure' ? ' ✗' : ''}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {Object.entries(feedback).map(([key, fb]) =>
          fb.state === 'success' || fb.state === 'failure' ? (
            <span
              key={key}
              data-testid={`feedback-${key}`}
              className={fb.state === 'success' ? 'text-xs text-green-600' : 'text-xs text-red-600'}
              role="status"
            >
              {fb.message}
            </span>
          ) : null,
        )}
      </CardFooter>
    </Card>
  )
}
