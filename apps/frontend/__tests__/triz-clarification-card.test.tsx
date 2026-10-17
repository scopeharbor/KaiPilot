/**
 * v2-triz-ai-clarification-cards —— Frontend tests for TRIZ card rendering (tasks 8.6)
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TrizClarificationCard, TrizCardList } from '@/components/ai-copilot/TrizClarificationCard'
import type { TrizClarificationCardDTO } from '@aiproj/types'

const MOCK_TRIZ_CARD: TrizClarificationCardDTO = {
  cardId: 'triz-1.0|triz|schedulePriority|trade_off|tc-dur-vs-res|hash-001|trade_off_priority',
  field: 'schedulePriority',
  category: 'critical',
  trizCategory: 'trade_off',
  source: 'triz',
  title: '工期与资源负载取舍',
  description: '系统检测到「压缩工期会导致资源负载过高」的矛盾。请确认优先目标。',
  impactScope: [
    { domain: '工期/进度', severity: 'high' },
    { domain: '资源负载', severity: 'high' },
  ],
  questionType: 'single_choice',
  quickOptions: [
    {
      label: '优先保证工期',
      value: 'schedule_first',
      description: '适合关键里程碑不可延期的场景。',
    },
    {
      label: '优先控制负载',
      value: 'resource_first',
      description: '适合团队容量已经接近上限的场景。',
      recommended: true,
    },
  ],
  defaultValue: 'resource_first',
  defaultValueMarker: {
    confidence: 0.72,
    source: 'default',
    reason: '根据矛盾严重度',
    needsConfirmation: true,
  },
  confidence: 0.85,
  reasoning: '基于矛盾 snapshot',
  allowSkip: false,
  isRequired: true,
  sourceRefs: [
    {
      key: 'tc-dur-vs-res',
      type: 'technical',
      severity: 'critical',
      title: '压缩工期会导致资源负载过高',
    },
  ],
  analysisArtifactRef: 'triz-artifact-001',
  warningCodes: [],
  warnings: [],
  answerEffect: {
    type: 'schedule_priority',
    description: '工期与资源负载的取舍',
    severity: 'high',
  },
  sourceHash: 'hash-001',
}

const MOCK_TRIZ_CARD_WITH_WARNING: TrizClarificationCardDTO = {
  ...MOCK_TRIZ_CARD,
  cardId: 'triz-1.0|triz|schedulePriority|trade_off|tc-stale|hash-stale|trade_off_priority',
  warningCodes: ['TRIZ_SOURCE_CONTRADICTION_STALE'],
  warnings: [
    { code: 'TRIZ_SOURCE_CONTRADICTION_STALE', message: '来源矛盾已过期', source: 'test' },
  ],
}

describe('TrizClarificationCard', () => {
  it('renders card title and description', () => {
    render(<TrizClarificationCard card={MOCK_TRIZ_CARD} onAnswer={vi.fn()} />)
    expect(screen.getByText('工期与资源负载取舍')).toBeTruthy()
    expect(screen.getAllByText(/压缩工期会导致资源负载过高/).length).toBeGreaterThan(0)
  })

  it('shows category badge', () => {
    render(<TrizClarificationCard card={MOCK_TRIZ_CARD} onAnswer={vi.fn()} />)
    expect(screen.getByText('关键')).toBeTruthy()
    expect(screen.getByText('TRIZ')).toBeTruthy()
  })

  it('shows impact scope badges', () => {
    render(<TrizClarificationCard card={MOCK_TRIZ_CARD} onAnswer={vi.fn()} />)
    expect(screen.getByText('工期/进度')).toBeTruthy()
    expect(screen.getByText('资源负载')).toBeTruthy()
  })

  it('renders quick option buttons', () => {
    render(<TrizClarificationCard card={MOCK_TRIZ_CARD} onAnswer={vi.fn()} />)
    expect(screen.getByText('优先保证工期')).toBeTruthy()
    expect(screen.getByText('优先控制负载')).toBeTruthy()
  })

  it('calls onAnswer when option is clicked', async () => {
    const onAnswer = vi.fn()
    render(<TrizClarificationCard card={MOCK_TRIZ_CARD} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByText('优先保证工期'))
    expect(onAnswer).toHaveBeenCalledWith(MOCK_TRIZ_CARD.cardId, 'answer', 'schedule_first')
  })

  it('shows warning codes', () => {
    render(<TrizClarificationCard card={MOCK_TRIZ_CARD_WITH_WARNING} onAnswer={vi.fn()} />)
    expect(screen.getByText(/来源矛盾已过期/)).toBeTruthy()
  })

  it('shows answered state', () => {
    const existingAnswer = { action: 'answer', value: 'schedule_first' }
    render(
      <TrizClarificationCard
        card={MOCK_TRIZ_CARD}
        onAnswer={vi.fn()}
        existingAnswer={existingAnswer}
      />,
    )
    expect(screen.getByText(/已回答/)).toBeTruthy()
    expect(screen.getByText(/schedule_first/)).toBeTruthy()
  })

  it('shows source refs in details element', () => {
    render(<TrizClarificationCard card={MOCK_TRIZ_CARD} onAnswer={vi.fn()} />)
    expect(screen.getByText(/来源矛盾/)).toBeTruthy()
  })

  it('renders category with text label not only color', () => {
    render(<TrizClarificationCard card={MOCK_TRIZ_CARD} onAnswer={vi.fn()} />)
    // Category is exposed through text: "关键"
    expect(screen.getByText('关键')).toBeTruthy()
    // Also check aria-label
    expect(screen.getByRole('region')).toHaveAttribute('aria-label')
  })
})

describe('TrizCardList', () => {
  it('renders nothing when empty', () => {
    const { container } = render(<TrizCardList cards={[]} onAnswer={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders multiple cards', () => {
    render(
      <TrizCardList
        cards={[MOCK_TRIZ_CARD, { ...MOCK_TRIZ_CARD, cardId: 'card-2' }]}
        onAnswer={vi.fn()}
      />,
    )
    expect(screen.getAllByText('TRIZ').length).toBe(2)
    expect(screen.getByText('TRIZ 矛盾确认')).toBeTruthy()
  })
})
