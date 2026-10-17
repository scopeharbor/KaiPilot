import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { DraftErrorPanel, draftStageLabels } from '@/components/ai-copilot/DraftErrorPanel'
import type { ProjectDraftFailureDetail, ProjectDraftGenerationStage } from '@aiproj/types'

describe('任务 3.2 - 前端草案错误面板组件测试 (DraftErrorPanel)', () => {
  const onRetry = vi.fn()
  const onBack = vi.fn()

  const allStages: ProjectDraftGenerationStage[] = [
    'charter_scope',
    'wbs_tasks',
    'schedule_dependencies',
    'resources_risks_acceptance',
    'reconcile_review',
  ]

  test.each(allStages)('渲染阶段失败标签：%s -> %s', (stage) => {
    const failure: ProjectDraftFailureDetail = {
      errorCode: 'STAGE_GENERATION_FAILED',
      message: '阶段生成超时，请检查模型连接后重试。',
      consistency: 'failed',
      sequence: 3,
      stage,
      reasonCode: 'STAGE_TIMEOUT',
    }

    render(
      <DraftErrorPanel
        error={`[${failure.errorCode}] ${failure.message}`}
        failure={failure}
        onRetry={onRetry}
        onBack={onBack}
      />,
    )

    const expectedLabel = draftStageLabels[stage]
    expect(screen.getByTestId('draft-failure-stage')).toHaveTextContent(
      `失败阶段：${expectedLabel}`,
    )
    expect(screen.getByTestId('draft-failure-reason-code')).toHaveTextContent(
      '原因码：STAGE_TIMEOUT',
    )
    expect(screen.getByTestId('draft-failure-message')).toHaveTextContent(
      '阶段生成超时，请检查模型连接后重试。',
    )
    expect(screen.getByText('草案生成失败')).toBeInTheDocument()
  })

  test('渲染脱敏错误列表与字段路径', () => {
    const failure: ProjectDraftFailureDetail = {
      errorCode: 'GROUNDING_VALIDATION_FAILED',
      message: '草案生成内容未通过已确认事实校验。',
      consistency: 'failed',
      sequence: 4,
      stage: 'wbs_tasks',
      reasonCode: 'GROUNDING_FACT_MISSING',
      errors: [
        {
          path: 'tasks[1].name',
          message: '任务名称缺失已确认的关键交付物「Web 端」',
          code: 'FACT_MISSING',
        },
        {
          path: 'dependencies[0].lagDays',
          message: '依赖滞后天数超出合理范围',
          code: 'RANGE_OVERFLOW',
        },
        {
          message: '全局预算约束未满足',
        },
      ],
    }

    render(
      <DraftErrorPanel
        error={`[${failure.errorCode}] ${failure.message}`}
        failure={failure}
        onRetry={onRetry}
        onBack={onBack}
      />,
    )

    expect(screen.getByTestId('draft-failure-stage')).toHaveTextContent('失败阶段：WBS 与任务')
    expect(screen.getByTestId('draft-failure-reason-code')).toHaveTextContent(
      '原因码：GROUNDING_FACT_MISSING',
    )
    expect(screen.getByTestId('draft-failure-errors')).toBeInTheDocument()
    expect(screen.getByText('脱敏错误摘要')).toBeInTheDocument()
    expect(screen.getByText('tasks[1].name')).toBeInTheDocument()
    expect(screen.getByText(/任务名称缺失已确认的关键交付物「Web 端」/)).toBeInTheDocument()
    expect(screen.getByText('[FACT_MISSING]')).toBeInTheDocument()
    expect(screen.getByText('dependencies[0].lagDays')).toBeInTheDocument()
    expect(screen.getByText(/依赖滞后天数超出合理范围/)).toBeInTheDocument()
    expect(screen.getByText(/全局预算约束未满足/)).toBeInTheDocument()
  })

  test('缺失 stage/reasonCode/errors 时优雅降级为泛化展示', () => {
    render(
      <DraftErrorPanel
        error="网络连接超时，请检查网络后重试"
        failure={null}
        onRetry={onRetry}
        onBack={onBack}
      />,
    )

    expect(screen.getByText('草案生成失败')).toBeInTheDocument()
    expect(screen.getByTestId('draft-failure-message')).toHaveTextContent(
      '网络连接超时，请检查网络后重试',
    )
    expect(screen.queryByTestId('draft-failure-stage')).not.toBeInTheDocument()
    expect(screen.queryByTestId('draft-failure-reason-code')).not.toBeInTheDocument()
    expect(screen.queryByTestId('draft-failure-errors')).not.toBeInTheDocument()
    expect(screen.queryByTestId('draft-failure-tags')).not.toBeInTheDocument()
  })

  test('部分字段缺失时只展示已有信息', () => {
    const failure: ProjectDraftFailureDetail = {
      errorCode: 'AI_SERVICE_ERROR',
      message: '模型生成失败',
      consistency: 'failed',
      sequence: 1,
      reasonCode: 'PROVIDER_RATE_LIMIT',
    }

    render(
      <DraftErrorPanel
        error="[AI_SERVICE_ERROR] 模型生成失败"
        failure={failure}
        onRetry={onRetry}
        onBack={onBack}
      />,
    )

    expect(screen.queryByTestId('draft-failure-stage')).not.toBeInTheDocument()
    expect(screen.getByTestId('draft-failure-reason-code')).toHaveTextContent(
      '原因码：PROVIDER_RATE_LIMIT',
    )
    expect(screen.queryByTestId('draft-failure-errors')).not.toBeInTheDocument()
  })

  test('交互：点击「重试」与「返回上下文」触发相应回调', () => {
    onRetry.mockReset()
    onBack.mockReset()

    render(<DraftErrorPanel error="测试错误" failure={null} onRetry={onRetry} onBack={onBack} />)

    const retryBtn = screen.getByRole('button', { name: /重试/ })
    const backBtn = screen.getByRole('button', { name: /返回上下文/ })

    fireEvent.click(retryBtn)
    expect(onRetry).toHaveBeenCalledTimes(1)

    fireEvent.click(backBtn)
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
