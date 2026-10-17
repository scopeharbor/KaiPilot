/**
 * OKR AI Draft Preview UI 测试（v3-okr-hierarchy-management tasks 6.10）。
 *
 * @aiproj/frontend
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { OkrAiDraftPreview } from '@/components/views/okr-ai-draft-preview'
import type { OkrAiDraftResponse } from '@aiproj/types'

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderWithClient(ui: React.ReactElement) {
  const qc = makeQueryClient()
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const mockDraft: OkrAiDraftResponse = {
  objectives: [
    {
      title: '提升用户留存',
      description: '聚焦用户留存率提升',
      scope: 'organization',
      confidence: 'high',
      keyResults: [
        {
          title: '7日留存60%',
          description: '优化onboarding',
          measurementType: 'percent',
          unitLabel: '%',
          baselineValue: 45,
          targetValue: 60,
          confidence: 'medium',
        },
        {
          title: '30日留存40%',
          description: '个性化推荐',
          measurementType: 'percent',
          unitLabel: '%',
          baselineValue: 25,
          targetValue: 40,
          confidence: 'low',
        },
      ],
      alignment: { parentObjectiveTitle: '战略目标', rationale: '留存是核心指标' },
    },
    {
      title: '提升用户满意度',
      description: 'NPS 从 30 提升到 50',
      scope: 'team',
      confidence: 'medium',
      keyResults: [
        {
          title: 'NPS 50',
          description: '',
          measurementType: 'number',
          baselineValue: 30,
          targetValue: 50,
          confidence: 'medium',
        },
      ],
    },
  ],
  risks: [
    {
      code: 'AI_CONTEXT_RESTRICTED',
      message: '部分数据不可见',
      severity: 'medium',
      suggestion: '确认数据范围',
    },
  ],
  assumptions: ['基于当前项目数据', '资源不变'],
  sourceRefs: ['项目列表', '资源池'],
  confidence: 'medium',
  warnings: [{ code: 'AI_CONTEXT_RESTRICTED', message: '部分项目数据因权限不可见' }],
}

describe('OkrAiDraftPreview', () => {
  test('loading 状态显示加载文字', () => {
    renderWithClient(<OkrAiDraftPreview draft={mockDraft} loading={true} organizationId={1} />)
    expect(screen.getByText(/AI 正在生成/)).toBeDefined()
  })

  test('error 状态显示错误信息', () => {
    renderWithClient(<OkrAiDraftPreview draft={mockDraft} error="服务不可用" organizationId={1} />)
    expect(screen.getByText(/服务不可用/)).toBeDefined()
  })

  test('渲染草案 objectives', () => {
    renderWithClient(<OkrAiDraftPreview draft={mockDraft} organizationId={1} />)
    expect(screen.getByText('提升用户留存')).toBeDefined()
    expect(screen.getByText('提升用户满意度')).toBeDefined()
  })

  test('渲染假设和来源', () => {
    renderWithClient(<OkrAiDraftPreview draft={mockDraft} organizationId={1} />)
    expect(screen.getByText(/基于当前项目数据/)).toBeDefined()
    expect(screen.getByText('项目列表')).toBeDefined()
  })

  test('渲染风险提示', () => {
    renderWithClient(<OkrAiDraftPreview draft={mockDraft} organizationId={1} />)
    expect(screen.getByText(/部分数据不可见/)).toBeDefined()
  })

  test('渲染 warnings', () => {
    renderWithClient(<OkrAiDraftPreview draft={mockDraft} organizationId={1} />)
    expect(screen.getByText(/部分项目数据因权限不可见/)).toBeDefined()
  })

  test('显示确认按钮且初始禁用', () => {
    renderWithClient(<OkrAiDraftPreview draft={mockDraft} organizationId={1} onConfirm={vi.fn()} />)
    const btn = screen.getByText(/确认接受/)
    expect(btn).toBeDefined()
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  test('选择 objective 后确认按钮启用', () => {
    renderWithClient(<OkrAiDraftPreview draft={mockDraft} organizationId={1} onConfirm={vi.fn()} />)
    // 点击第一个 objective 选中
    const obj1 = screen.getByText('提升用户留存')
    fireEvent.click(obj1)
    const btn = screen.getByText(/确认接受 \(1\)/)
    expect((btn as HTMLButtonElement).disabled).toBe(false)
  })

  test('取消按钮触发 onCancel', () => {
    const onCancel = vi.fn()
    renderWithClient(<OkrAiDraftPreview draft={mockDraft} organizationId={1} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('取消'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  test('确认按钮触发 onConfirm', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    renderWithClient(
      <OkrAiDraftPreview draft={mockDraft} organizationId={1} onConfirm={onConfirm} />,
    )
    // 选择第一个 objective
    fireEvent.click(screen.getByText('提升用户留存'))
    fireEvent.click(screen.getByText(/确认接受 \(1\)/))

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1)
      const call = onConfirm!.mock.calls[0]![0]!
      expect(call.accepted.length).toBeGreaterThan(0)
      expect(call.draftId).toContain('draft-')
    })
  })

  test('不传 onConfirm 时不显示确认按钮', () => {
    renderWithClient(<OkrAiDraftPreview draft={mockDraft} organizationId={1} />)
    expect(screen.queryByText(/确认接受/)).toBeNull()
  })

  test('显示 confidence 标签', () => {
    renderWithClient(<OkrAiDraftPreview draft={mockDraft} organizationId={1} />)
    expect(screen.getByText(/置信度: 中/)).toBeDefined()
  })

  test('alignment 信息正确显示', () => {
    renderWithClient(<OkrAiDraftPreview draft={mockDraft} organizationId={1} />)
    expect(screen.getByText(/对齐到: 战略目标/)).toBeDefined()
  })
})
