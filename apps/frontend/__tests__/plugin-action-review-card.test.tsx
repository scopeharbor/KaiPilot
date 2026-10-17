/**
 * v3-plugin-action-preview-boundary —— PluginActionReviewCard 前端测试（任务 4.4，P1）。
 *
 * 覆盖：
 * - 最多三个主操作 + 「丢弃」折叠进更多；
 * - 按钮 loading/success/failure 明确反馈（禁止无反馈态）；
 * - dry-run blocking → 确认禁用 + 可读阻断原因；
 * - 无 plugin_action:confirm 权限的动作不渲染（非泄露）；
 * - 可见措辞禁止自动执行类表述（复用声明清单校验）；
 * - 插件来源/assumptions/findings/diff 呈现完整。
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PluginActionReviewCard } from '@/components/plugin-actions/PluginActionReviewCard'
import type { PluginActionPreview } from '@aiproj/types'
import { COPILOT_ACTION_FORBIDDEN_WORDING } from '@aiproj/types'

function fixturePreview(overrides?: Partial<PluginActionPreview>): PluginActionPreview {
  return {
    previewDigest: 'abcd1234',
    proposalDigest: 'efef5678',
    actionKind: 'plugin.pilot.item.create',
    scope: { organizationId: 1, projectId: null },
    pluginRef: {
      pluginId: 'com.aiproj.pilot.actions',
      pluginVersion: '1.0.0',
      installationId: 101,
    },
    diffEntries: [
      { targetRef: 'plugin_pilot_item:new', field: 'title', before: null, after: '试点标题' },
      { targetRef: 'plugin_pilot_item:new', field: 'content', before: null, after: '试点内容' },
    ],
    assumptions: ['标题与内容按提案原样创建'],
    permissionSummary: { requiredPermissions: ['plugin_action:confirm'], granted: true },
    compatibilitySummary: null,
    dryRun: { canApply: true, findings: [] },
    reversibility: 'reversible',
    affectedItemRefs: ['plugin_pilot_item:org1:next'],
    batchPolicy: 'per-item',
    issuedAt: '2026-08-24T08:00:00.000Z',
    expiresAt: '2026-08-24T08:10:00.000Z',
    ...overrides,
  }
}

function renderCard(preview = fixturePreview(), props: Record<string, unknown> = {}) {
  return render(
    React.createElement(PluginActionReviewCard, {
      proposalUid: 'pact-test-001',
      preview,
      actorPermissions: ['plugin_action:view', 'plugin_action:confirm'],
      onConfirm: vi.fn().mockResolvedValue(undefined),
      onDecision: vi.fn().mockResolvedValue(undefined),
      ...props,
    }),
  )
}

describe('主操作上限与折叠', () => {
  it('最多三个主操作；丢弃折叠在「更多」下', () => {
    renderCard()
    expect(screen.getByRole('button', { name: '确认执行' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '拒绝' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '修改' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '丢弃' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    expect(screen.getByRole('button', { name: '丢弃' })).toBeTruthy()
  })
})

describe('按钮状态反馈', () => {
  it('确认成功后给出明确 success 反馈', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    renderCard(fixturePreview(), { onConfirm })
    fireEvent.click(screen.getByRole('button', { name: /确认执行/ }))
    await waitFor(() => {
      expect(screen.getByTestId('feedback-confirm')).toBeTruthy()
      expect(screen.getByTestId('feedback-confirm').textContent).toContain('完成')
    })
  })

  it('失败时显示明确失败提示（不静默完成）', async () => {
    renderCard(fixturePreview(), { onConfirm: vi.fn().mockRejectedValue(new Error('boom')) })
    fireEvent.click(screen.getByRole('button', { name: /确认执行/ }))
    await waitFor(() => {
      expect(screen.getByTestId('feedback-confirm').textContent).toContain('失败')
    })
  })
})

describe('dry-run blocking 阻断确认', () => {
  it('存在 blocking finding 时确认禁用且提示可读', () => {
    renderCard(
      fixturePreview({
        dryRun: {
          canApply: true,
          findings: [{ code: 'dep-cycle', severity: 'blocking', message: '依赖环阻断' }],
        },
      }),
    )
    const confirmBtn = screen.getByRole('button', { name: /确认执行/ }) as HTMLButtonElement
    expect(confirmBtn.disabled).toBe(true)
    expect(screen.getByTestId('confirm-block-reason').textContent).toContain('阻断')
    expect(screen.getByTestId('dry-run-blocked-badge')).toBeTruthy()
  })
})

describe('无权限动作不渲染（非泄露）', () => {
  it('缺少 plugin_action:confirm 的 actor 看不到任何决策操作', () => {
    renderCard(fixturePreview(), { actorPermissions: [] })
    expect(screen.queryByRole('button', { name: '确认执行' })).toBeNull()
    expect(screen.queryByRole('button', { name: '拒绝' })).toBeNull()
    expect(screen.queryByRole('button', { name: '修改' })).toBeNull()
    // 只读内容仍然可见
    expect(screen.getByTestId('action-diff')).toBeTruthy()
  })

  it('仅相差一项权限的两个 actor：无权限者看不到确认动作存在', () => {
    const { container: allowed } = renderCard()
    const { container: denied } = renderCard(fixturePreview(), { actorPermissions: [] })
    expect(allowed.querySelector('[aria-label="确认执行"]')).toBeTruthy()
    expect(denied.querySelector('[aria-label="确认执行"]')).toBeNull()
  })
})

describe('审查导向中文措辞', () => {
  it('卡片可见文案不含禁止的自动执行措辞（按声明清单校验）', () => {
    renderCard()
    const text = screen.getByTestId('plugin-action-card-pact-test-001').textContent ?? ''
    for (const word of COPILOT_ACTION_FORBIDDEN_WORDING) {
      expect(text).not.toContain(word)
    }
  })
})

describe('插件来源与预览要素呈现', () => {
  it('呈现插件来源徽标、assumptions、findings 与 before/after diff', () => {
    renderCard(
      fixturePreview({
        assumptions: ['按提案原样创建到试点清单'],
        dryRun: {
          canApply: true,
          findings: [{ code: 'note', severity: 'warning', message: '目标清单为空' }],
        },
      }),
    )
    expect(screen.getByTestId('plugin-source').textContent).toContain('com.aiproj.pilot.actions')
    expect(screen.getByTestId('assumption-list').textContent).toContain('按提案原样创建')
    expect(screen.getByTestId('finding-list').textContent).toContain(
      '依赖环'.replace('依赖环', '目标清单为空'),
    )
    expect(screen.getByTestId('action-diff').textContent).toContain('试点标题')
    expect(screen.getByTestId('meta-line').textContent).toContain('可回退')
  })

  it('不复制 Copilot 假设插槽逻辑：无 assumptionSlot/置信度档位概念', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(
      resolve(process.cwd(), 'components/plugin-actions/PluginActionReviewCard.tsx'),
      'utf-8',
    )
    expect(source).not.toContain('assumptionSlot')
    expect(source).not.toContain('CopilotConfidenceBand')
    expect(source).not.toContain('mapConfidenceToBand')
  })
})
