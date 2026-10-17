/**
 * v3-copilot-action-and-preview-boundary —— CopilotActionCard 前端测试（任务 6.x）。
 *
 * 覆盖：
 * - 6.1 最多三个主操作 + 其余折叠进「更多」
 * - 6.2 按钮 idle→loading→success/failure 明确反馈（禁止无反馈态）
 * - 6.3 假设/可信度插槽原样渲染归属能力内容
 * - 6.4/6.5 「依赖替代默认值但插槽未接入」阻断确认，提示可读
 * - 6.6 本组件不含假设编辑逻辑与置信度档位映射（源码断言）
 * - 6.7 插槽未接入时布局无空白与错位
 * - 6.8/6.9 无权限动作**不渲染**（非禁用可见）；仅相差一项权限的两个 actor 无权限者看不到动作
 * - 6.10/6.11 可见措辞为审查导向中文；禁止自动执行措辞（按声明清单校验）
 * - 6.12 stale 动作视觉标记与刷新入口
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CopilotActionCard } from '@/components/ai-copilot/CopilotActionCard'
import {
  COPILOT_ACTION_FIXTURE_CARD_CONFIRMABLE,
  COPILOT_ACTION_FIXTURE_CARD_STALE,
  COPILOT_ACTION_FIXTURE_CARD_UNSEEN_DEFAULT,
  COPILOT_ACTION_FIXTURE_SUPPLIED_SLOT,
} from '@aiproj/types'
import { COPILOT_ACTION_FORBIDDEN_WORDING } from '@aiproj/types'

function renderCard(
  card = COPILOT_ACTION_FIXTURE_CARD_CONFIRMABLE,
  props: Record<string, unknown> = {},
) {
  return render(
    React.createElement(CopilotActionCard, {
      card,
      actorPermissions: ['task:update', 'task:create'],
      onAction: vi.fn().mockResolvedValue(undefined),
      ...props,
    }),
  )
}

describe('6.1 主操作上限与折叠', () => {
  it('主操作最多三个，其余动作折叠在「更多」下', () => {
    renderCard()
    // 三个主操作可见
    expect(screen.getByRole('button', { name: '应用此方案' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '调整' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '放弃' })).toBeTruthy()
    // 次级操作默认折叠
    expect(screen.queryByRole('button', { name: '添加到任务' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    expect(screen.getByRole('button', { name: '添加到任务' })).toBeTruthy()
  })
})

describe('6.2 按钮状态反馈', () => {
  it('点击后进入 loading，成功后显示明确成功提示', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: /应用此方案/ }))
    await waitFor(() => {
      expect(screen.getByText(/操作已完成/)).toBeTruthy()
    })
  })

  it('失败时显示明确失败提示（不静默完成）', async () => {
    renderCard(COPILOT_ACTION_FIXTURE_CARD_CONFIRMABLE, {
      onAction: vi.fn().mockRejectedValue(new Error('boom')),
    })
    fireEvent.click(screen.getByRole('button', { name: /应用此方案/ }))
    await waitFor(() => {
      expect(screen.getByText(/操作失败，请重试/)).toBeTruthy()
    })
  })
})

describe('6.3 假设与可信度插槽', () => {
  it('插槽已接入时原样渲染归属能力内容', () => {
    renderCard()
    expect(screen.getByTestId('assumption-slot')).toBeTruthy()
    expect(screen.getByText(/假设每周 5 个工作日/)).toBeTruthy()
    expect(screen.getByText(/可信度 95/)).toBeTruthy()
  })

  it('插槽内容不做转换：直接显示 statement 与 confidence 数字，无档位标签', () => {
    renderCard()
    expect(screen.queryByText(/高可信度|中可信度|低可信度/)).toBeNull()
    expect(COPILOT_ACTION_FIXTURE_SUPPLIED_SLOT.assumptions.length).toBeGreaterThan(0)
  })
})

describe('6.4/6.5 未见默认值不得确认', () => {
  it('依赖替代默认值但插槽未接入 → 阻断且提示可读', () => {
    renderCard(COPILOT_ACTION_FIXTURE_CARD_UNSEEN_DEFAULT)
    expect(screen.getByTestId('confirm-block-reason')).toBeTruthy()
    const reason = screen.getByTestId('confirm-block-reason').textContent ?? ''
    expect(reason).toContain('假设')
    expect(reason).toContain('确认')
    // 主操作被禁用（不可确认）
    const apply = screen.getByRole('button', { name: /应用此方案/ }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
  })
})

describe('6.6 不含假设编辑逻辑与置信度档位映射', () => {
  it('源码不包含假设编辑输入与档位映射逻辑', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(
      resolve(process.cwd(), 'components/ai-copilot/CopilotActionCard.tsx'),
      'utf-8',
    )
    expect(source).not.toContain('onEditAssumption')
    expect(source).not.toContain('mapConfidenceToBand')
    expect(source).not.toContain('high/medium/low')
  })
})

describe('6.7 插槽未接入时布局无空白与错位', () => {
  it('插槽空态渲染为隐藏占位，不产生可见空白或错位', () => {
    renderCard(COPILOT_ACTION_FIXTURE_CARD_UNSEEN_DEFAULT)
    const empty = screen.getByTestId('assumption-slot-empty')
    expect(empty.className).toContain('hidden')
    // 卡片结构完整：标题与操作仍渲染
    expect(screen.getByText('任务 1201 工期调整为 5 天')).toBeTruthy()
    expect(screen.getByRole('button', { name: /应用此方案/ })).toBeTruthy()
  })
})

describe('6.8/6.9 无权限动作不渲染（非泄露）', () => {
  it('缺少 task:update 的 actor 看不到应用/调整动作（不渲染，非禁用可见）', () => {
    renderCard(COPILOT_ACTION_FIXTURE_CARD_CONFIRMABLE, { actorPermissions: ['project:view'] })
    expect(screen.queryByRole('button', { name: /应用此方案/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /调整/ })).toBeNull()
    // 无权限要求的动作仍可见
    expect(screen.getByRole('button', { name: '放弃' })).toBeTruthy()
  })

  it('仅相差一项权限的两个 actor：无权限者看不到该动作存在', () => {
    const { container: allowed } = renderCard(COPILOT_ACTION_FIXTURE_CARD_CONFIRMABLE, {
      actorPermissions: ['task:update', 'task:create'],
    })
    const { container: denied } = renderCard(COPILOT_ACTION_FIXTURE_CARD_CONFIRMABLE, {
      actorPermissions: ['task:create'],
    })
    expect(allowed.querySelector('[aria-label="应用此方案"]')).toBeTruthy()
    expect(denied.querySelector('[aria-label="应用此方案"]')).toBeNull()
  })
})

describe('6.10/6.11 审查导向中文措辞', () => {
  it('可见文案不含禁止的自动执行措辞（按声明清单校验）', () => {
    renderCard()
    const text = screen.getByTestId('copilot-action-card-card-fix-001').textContent ?? ''
    for (const word of COPILOT_ACTION_FORBIDDEN_WORDING) {
      expect(text).not.toContain(word)
    }
  })

  it('stale 卡片文案同样干净且标记来源已过期', () => {
    renderCard(COPILOT_ACTION_FIXTURE_CARD_STALE)
    expect(screen.getByTestId('stale-badge')).toBeTruthy()
    const text = screen.getByTestId('copilot-action-card-card-fix-003').textContent ?? ''
    for (const word of COPILOT_ACTION_FORBIDDEN_WORDING) {
      expect(text).not.toContain(word)
    }
  })
})

describe('6.12 stale 动作的视觉标记与刷新入口', () => {
  it('stale 卡片显示标记与刷新入口', () => {
    const onRefresh = vi.fn()
    renderCard(COPILOT_ACTION_FIXTURE_CARD_STALE, { onRefresh })
    expect(screen.getByText('来源已过期')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /刷新来源后重新审查/ }))
    expect(onRefresh).toHaveBeenCalled()
  })
})
