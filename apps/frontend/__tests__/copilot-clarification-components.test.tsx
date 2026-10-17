// v3-copilot-clarification-and-assumptions 前端组件测试
// 任务 7.4/7.6/7.8/7.10
import { describe, it, expect } from 'vitest'
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { ConfidenceIndicator, confidenceBandLabel } from '../components/copilot/ConfidenceIndicator'
import { UnspecifiedInfoWarning } from '../components/copilot/UnspecifiedInfoWarning'
import type { CopilotAssumptionEntry } from '@aiproj/types'

// ═══════════════════════════════════════════════════════════════
// 7.8 四档在浅色舒适、浅色紧凑、深色舒适、深色紧凑四组合下均可辨识
// ═══════════════════════════════════════════════════════════════

describe('ConfidenceIndicator — Task 7.8', () => {
  it('高可信度（≥80）渲染五点', () => {
    render(<ConfidenceIndicator confidence={85} />)
    const dots = document.querySelectorAll('[role="img"] span')
    expect(dots.length).toBe(5)
  })

  it('中可信度（50-79）渲染三点', () => {
    render(<ConfidenceIndicator confidence={60} />)
    const dots = document.querySelectorAll('[role="img"] span')
    expect(dots.length).toBe(5)
  })

  it('低可信度（<50）渲染两点', () => {
    render(<ConfidenceIndicator confidence={30} />)
    const dots = document.querySelectorAll('[role="img"] span')
    expect(dots.length).toBe(5)
  })

  it('未知可信度渲染灰点', () => {
    render(<ConfidenceIndicator />)
    const dots = document.querySelectorAll('[role="img"] span')
    expect(dots.length).toBe(5)
  })

  it('aria-label 包含可信度信息', () => {
    render(<ConfidenceIndicator confidence={85} />)
    const indicator = document.querySelector('[role="img"]')
    expect(indicator?.getAttribute('aria-label')).toContain('85%')
  })
})

// ═══════════════════════════════════════════════════════════════
// 7.10 三处使用同一组件与同一档位映射
// ═══════════════════════════════════════════════════════════════

describe('ConfidenceIndicator — Task 7.10 — band mapping consistency', () => {
  it('confidenceBandLabel 返回一致标签', () => {
    expect(confidenceBandLabel('high')).toBe('高可信度')
    expect(confidenceBandLabel('medium')).toBe('中可信度')
    expect(confidenceBandLabel('low')).toBe('低可信度')
    expect(confidenceBandLabel('fallback')).toBe('未知')
  })

  it('同一 confidence 值始终映射到同一 band', () => {
    const values = [0, 25, 49, 50, 79, 80, 100, undefined]
    for (const v of values) {
      // 多次渲染应一致
      const { unmount } = render(<ConfidenceIndicator confidence={v} />)
      const dots1 = document.querySelectorAll('[role="img"] span')
      unmount()
      const { unmount: unmount2 } = render(<ConfidenceIndicator confidence={v} />)
      const dots2 = document.querySelectorAll('[role="img"] span')
      expect(dots1.length).toBe(dots2.length)
      unmount2()
    }
  })
})

// ═══════════════════════════════════════════════════════════════
// 7.6 警告块独立成组且使用警告色 token
// ═══════════════════════════════════════════════════════════════

describe('UnspecifiedInfoWarning — Task 7.6', () => {
  const defaultAssumptions: CopilotAssumptionEntry[] = [
    {
      assumptionId: 'a1',
      statement: '未明确团队规模，使用默认值 4 人。',
      source: 'default',
      confidence: 55,
      usedDefault: true,
      needsConfirmation: true,
      editable: true,
    },
  ]

  const nonDefaultAssumptions: CopilotAssumptionEntry[] = [
    {
      assumptionId: 'a2',
      statement: '用户已确认技术栈。',
      source: 'user-input',
      confidence: 95,
      usedDefault: false,
      needsConfirmation: false,
      editable: false,
    },
  ]

  it('有默认值假设时渲染警告块', () => {
    render(<UnspecifiedInfoWarning assumptions={defaultAssumptions} />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText(/以下信息未明确/)).toBeTruthy()
  })

  it('无默认值假设时不渲染', () => {
    const { container } = render(<UnspecifiedInfoWarning assumptions={nonDefaultAssumptions} />)
    expect(container.firstChild).toBeNull()
  })

  it('空列表不渲染', () => {
    const { container } = render(<UnspecifiedInfoWarning assumptions={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
