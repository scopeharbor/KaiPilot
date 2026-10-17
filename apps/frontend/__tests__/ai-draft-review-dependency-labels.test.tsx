/**
 * 回归：草案审查页「任务依赖」曾用 id.slice(0, 6) 显示端点，task-10…task-16 都被截成
 * task-1，大型项目（>9 个任务）的依赖看起来像一堆自环。现改为显示任务名。
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { ProjectDraft, ProjectDraftMeta } from '@aiproj/types'
import { DraftReviewPanel } from '@/components/ai-copilot/DraftReviewPanel'

const marker = {
  confidence: 0.8,
  source: 'inferred',
  reason: '推断',
  needsConfirmation: false,
} as const

function field<T>(value: T) {
  return { value, marker }
}

function makeTask(index: number) {
  return {
    id: `task-${index}`,
    wbsNodeId: 'w1',
    status: 'not_started' as const,
    name: field(`任务${index}`),
    description: field(`任务${index}说明`),
    durationDays: field(5),
    startDate: field('2026-10-12'),
    endDate: field('2026-10-16'),
    assigneeHint: field('开发'),
  }
}

function makeDraft(): ProjectDraft {
  return {
    schemaVersion: '1.0',
    projectType: 'software',
    charter: {
      title: field('支付清算中台'),
      vision: field('愿景'),
      scope: field('范围'),
      objectives: field(['目标']),
      successCriteria: field(['标准']),
      startDate: field('2026-10-12'),
      endDate: field('2027-04-15'),
    },
    wbs: [
      {
        id: 'w1',
        parentId: null,
        outlineCode: '1',
        isLeaf: true,
        isNote: false,
        children: [],
        name: field('微服务建设'),
        description: field('说明'),
      },
    ],
    tasks: Array.from({ length: 12 }, (_, i) => makeTask(i + 1)),
    dependencies: [
      { id: 'd1', predecessorId: 'task-10', successorId: 'task-11', type: 'FS', lagDays: field(5) },
      { id: 'd2', predecessorId: 'task-2', successorId: 'task-12', type: 'FS', lagDays: field(0) },
      { id: 'd3', predecessorId: 'task-99', successorId: 'task-1', type: 'FS', lagDays: field(0) },
    ],
    acceptanceCriteria: [],
    resourceHints: [],
    riskHints: [],
    milestoneHints: [],
    ganttPreview: {
      startDate: field('2026-10-12'),
      endDate: field('2027-04-15'),
      totalDurationDays: field(185),
      criticalPathTaskIds: [],
      phaseCount: 4,
    },
  } as unknown as ProjectDraft
}

function makeMeta(): ProjectDraftMeta {
  return {
    schemaVersion: '1.0',
    projectType: 'software',
    structuredStrategy: 'native',
    consistency: 'strict',
    fallbackUsed: false,
    provider: 'mock',
    model: 'mock-model',
    usingRealAdapter: false,
    appliedFixes: [],
    moduleCounts: {
      wbsNodes: 1,
      tasks: 12,
      dependencies: 3,
      acceptanceCriteria: 0,
      resourceHints: 0,
      riskHints: 0,
      milestoneHints: 0,
    },
  } as ProjectDraftMeta
}

describe('DraftReviewPanel 任务依赖标签', () => {
  test('两位数任务 id 显示为任务名，不再被截成 task-1 的假自环', () => {
    render(
      <DraftReviewPanel
        draft={makeDraft()}
        meta={makeMeta()}
        validation={null}
        onAcceptAll={vi.fn()}
        onAcceptPartial={vi.fn()}
        onApplyEdit={vi.fn()}
        onRejectRetry={vi.fn()}
        onSaveDraft={vi.fn()}
        onBack={vi.fn()}
      />,
    )

    const tenToEleven = screen.getByTitle('task-10 → task-11')
    expect(tenToEleven.textContent).toBe('任务10 → 任务11 +5d')
    expect(screen.getByTitle('task-2 → task-12').textContent).toBe('任务2 → 任务12')
    expect(screen.queryByText(/task-1 → task-1/)).toBeNull()
  })

  test('悬空引用回退显示完整 id', () => {
    render(
      <DraftReviewPanel
        draft={makeDraft()}
        meta={makeMeta()}
        validation={null}
        onAcceptAll={vi.fn()}
        onAcceptPartial={vi.fn()}
        onApplyEdit={vi.fn()}
        onRejectRetry={vi.fn()}
        onSaveDraft={vi.fn()}
        onBack={vi.fn()}
      />,
    )

    expect(screen.getByTitle('task-99 → task-1').textContent).toBe('task-99 → 任务1')
  })
})
