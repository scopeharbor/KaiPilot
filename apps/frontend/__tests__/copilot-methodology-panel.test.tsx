/**
 * v3-copilot-skill-injection — §5.5/§5.6 方法论分区面板测试。
 *
 * §5.5 方法论在面板中标注为「方法论参考」而非事实。
 * §5.6 方法论分区与事实分区视觉可区分且标注可读。
 *
 * @aiproj/frontend
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CopilotMethodologyFacet } from '@aiproj/types'
import { CopilotMethodologyPanel } from '@/components/copilot/CopilotMethodologyPanel'

const METHODOLOGY_FACET: CopilotMethodologyFacet = {
  facetKind: 'methodology',
  isMethodologyGuidance: true,
  isProjectFact: false,
  skillKeys: ['agile-delivery', 'data-project'],
  guidanceItems: [
    {
      itemId: 'meth-001',
      skillKey: 'agile-delivery',
      label: '敏捷交付方法论',
      summary: '迭代式交付、每日站会与看板节奏（方法论指引，非本项目事实）',
      sourceRef: 'skill:agile-delivery/knowledge:iteration-rhythm',
      activationRuleId: 'rule-agile-delivery-default',
      activationReason: '项目采用迭代交付节奏，命中敏捷方法论默认激活规则',
    },
    {
      itemId: 'meth-002',
      skillKey: 'data-project',
      label: '数据项目方法论',
      summary: '数据质量门禁与 ETL 管线验证（方法论指引，非本项目事实）',
      sourceRef: 'skill:data-project/knowledge:etl-validation',
      activationRuleId: 'rule-data-project-default',
      activationReason: '项目类型为数据项目，命中数据方法论默认激活规则',
    },
  ],
  capturedAt: '2026-08-16T00:00:00.000Z',
  methodologyVersionHash: 'mvh-test-v1',
}

describe('CopilotMethodologyPanel — §5.5 方法论参考标注', () => {
  it('标注为「方法论参考」而非事实', () => {
    render(<CopilotMethodologyPanel facet={METHODOLOGY_FACET} />)
    const badge = screen.getByText('方法论参考')
    expect(badge).toBeDefined()
    expect(badge.closest('[data-partition="methodology"]')).toBeDefined()
  })

  it('显示 Skill 数量', () => {
    render(<CopilotMethodologyPanel facet={METHODOLOGY_FACET} />)
    expect(screen.getByText('2 个 Skill')).toBeDefined()
  })

  it('渲染所有方法论条目', () => {
    render(<CopilotMethodologyPanel facet={METHODOLOGY_FACET} />)
    expect(screen.getByText('敏捷交付方法论')).toBeDefined()
    expect(screen.getByText('数据项目方法论')).toBeDefined()
  })

  it('每个条目带 Provenance 来源引用（§5.7）', () => {
    render(<CopilotMethodologyPanel facet={METHODOLOGY_FACET} />)
    const sourceRefs = screen.getAllByText(/来源:/)
    expect(sourceRefs.length).toBe(2)
    expect(sourceRefs[0]!.textContent).toContain('agile-delivery')
    expect(sourceRefs[1]!.textContent).toContain('data-project')
  })

  it('region role 标记为方法论参考区域', () => {
    render(<CopilotMethodologyPanel facet={METHODOLOGY_FACET} />)
    const region = screen.getByRole('region', { name: '方法论参考' })
    expect(region).toBeDefined()
    expect(region.getAttribute('data-partition')).toBe('methodology')
  })
})

describe('CopilotMethodologyPanel — §5.6 视觉可区分', () => {
  it('所有方法论条目带 data-partition="methodology" 标记', () => {
    render(<CopilotMethodologyPanel facet={METHODOLOGY_FACET} />)
    const items = document.querySelectorAll('[data-partition="methodology"]')
    // 1 section + 2 items = 3 elements with data-partition
    expect(items.length).toBeGreaterThanOrEqual(3)
  })

  it('空方法论不渲染面板', () => {
    const emptyFacet: CopilotMethodologyFacet = {
      ...METHODOLOGY_FACET,
      guidanceItems: [],
    }
    const { container } = render(<CopilotMethodologyPanel facet={emptyFacet} />)
    expect(container.innerHTML).toBe('')
  })

  it('undefined facet 不渲染面板', () => {
    const { container } = render(<CopilotMethodologyPanel facet={undefined} />)
    expect(container.innerHTML).toBe('')
  })
})
