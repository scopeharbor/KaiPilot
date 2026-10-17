/**
 * v3-ui-next-theater-generation tasks 3.5 —— 草案落定态视图与生成错误卡片。
 *
 * 覆盖：落定态 UID 短码 / 版本号 / 9/9 模块完备绿标 / 初始五维评分与风险徽章、
 * B2c 对接按钮回调（onEnterReview）、重新生成入口；生成失败标准错误码呈现、已确认
 * 上下文保留、重试生成回调触发与二次确认重新开始；RL-01 零自动转正与禁措辞断言。
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { DraftValidationReport, ProjectDraftFailureDetail } from '@aiproj/types'
import {
  DIMENSION_LABELS,
  formatDraftShortCode,
  TheaterSettledView,
} from '@/components/next/theater/TheaterSettledView'
import {
  describeGenerationError,
  GENERATION_ERROR_COPY,
  isGenerationFailure,
  resolveGenerationErrorCode,
  TheaterErrorCard,
} from '@/components/next/theater/TheaterErrorCard'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

/** 禁措辞审查清单（spec「绝对禁止暗示项目已创建」）。 */
const FORBIDDEN_COPY = [
  '项目已创建',
  '项目已完成',
  '创建成功',
  '项目创建完毕',
  '正式项目已入库',
  '已写入数据库',
]

const validation: DraftValidationReport = {
  overallRiskLevel: 'low',
  confidenceScore: 94,
  dimensionScores: {
    factualAccuracy: 92,
    logicalConsistency: 90,
    assumptionClarity: 88,
    completeness: 96,
    numericPlausibility: 91,
  },
  blocking: [],
  warning: [],
  info: [],
  ruleResults: [],
  autoFixDiffs: [],
  canConfirm: true,
}

function generationFailure(
  errorCode: string = 'MODEL_PROVIDER_CALL_FAILED',
): ProjectDraftFailureDetail {
  return {
    errorCode,
    message: '模型供应商调用失败',
    consistency: 'failed',
    sequence: 12,
    stage: 'wbs_tasks',
    reasonCode: 'STREAM_UPSTREAM_FAILED',
  }
}

function resetDraft() {
  sessionStorage.clear()
  useAiProjectDraftStore.setState({
    schemaVersion: '1.0',
    userId: null,
    organizationId: null,
    status: 'ready',
    rawInput: '',
    cards: [],
    answers: {},
    parsedIntent: null,
    context: null,
    error: null,
    draftStatus: null,
    draftId: null,
    draftVersion: 0,
    draft: null,
    draftMeta: null,
    draftFailure: null,
    validation: null,
  })
}

beforeEach(() => {
  resetDraft()
})

describe('components/next/theater/TheaterSettledView（tasks 3.3）', () => {
  test('结构化呈现草案 UID 短码 / 版本号 / 9/9 完备绿标 / 置信度评分与低风险徽章', () => {
    useAiProjectDraftStore.setState({ draftId: 'draft-7E3F1A90', draftVersion: 1, validation })
    const { container } = render(
      <TheaterSettledView
        draftId="draft-7E3F1A90"
        version={1}
        onEnterReview={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    )

    expect(screen.getByRole('region', { name: '草案落定视图' })).toBeInTheDocument()
    expect(screen.getByText('#DRAFT-7E3F1A90')).toBeInTheDocument()
    expect(screen.getByText('v1')).toBeInTheDocument()
    expect(screen.getByText('9/9 模块已就绪')).toBeInTheDocument()
    expect(screen.getByText('置信度评分')).toBeInTheDocument()
    expect(screen.getByText('94')).toBeInTheDocument()
    expect(screen.getByText('低风险')).toBeInTheDocument()
    expect(screen.getByText('可进入审查')).toBeInTheDocument()

    // 五维初评：全部维度标签与分值
    for (const [dimension, label] of Object.entries(DIMENSION_LABELS)) {
      expect(screen.getByText(label)).toBeInTheDocument()
      expect(container.querySelector(`[data-dimension="${dimension}"] dd`)).toHaveTextContent(
        String(validation.dimensionScores[dimension as keyof typeof validation.dimensionScores]),
      )
    }

    // 风险徽章双通道：低风险 → 绿色令牌
    const riskBadge = container.querySelector('[data-theater-settled-risk]') as HTMLElement
    expect(riskBadge.style.color).toBe('var(--nx-status-success)')
  })

  test('版本号与短码可独立注入（设计 D8 移交契约字段）', () => {
    useAiProjectDraftStore.setState({ draftId: 'ab12cd34ef56', draftVersion: 2, validation })
    render(<TheaterSettledView draftId="ab12cd34ef56" version={2} onEnterReview={vi.fn()} />)

    expect(screen.getByText('#DRAFT-CD34EF56')).toBeInTheDocument()
    expect(screen.getByText('v2')).toBeInTheDocument()
  })

  test('「进入草案审查（Review Draft）」触发 onEnterReview 回调（B2c 对接锚点）', () => {
    useAiProjectDraftStore.setState({ draftId: 'draft-7E3F1A90', draftVersion: 1, validation })
    const onEnterReview = vi.fn()
    render(
      <TheaterSettledView draftId="draft-7E3F1A90" version={1} onEnterReview={onEnterReview} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /进入草案审查/ }))
    expect(onEnterReview).toHaveBeenCalledTimes(1)
  })

  test('「重新生成（Regenerate）」可选入口：提供时渲染并触发回调', () => {
    useAiProjectDraftStore.setState({ draftId: 'draft-7E3F1A90', draftVersion: 1, validation })
    const onRegenerate = vi.fn()
    render(
      <TheaterSettledView
        draftId="draft-7E3F1A90"
        version={1}
        onEnterReview={vi.fn()}
        onRegenerate={onRegenerate}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /重新生成/ }))
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  test('未提供 onRegenerate 时不渲染重新生成入口', () => {
    useAiProjectDraftStore.setState({ draftId: 'draft-7E3F1A90', draftVersion: 1, validation })
    render(<TheaterSettledView draftId="draft-7E3F1A90" version={1} onEnterReview={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /重新生成/ })).toBeNull()
  })

  test('RL-01 零自动转正：渲染与点击全程零网络请求、无违规措辞', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    useAiProjectDraftStore.setState({ draftId: 'draft-7E3F1A90', draftVersion: 1, validation })
    render(
      <TheaterSettledView
        draftId="draft-7E3F1A90"
        version={1}
        onEnterReview={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    )

    expect(fetchSpy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /进入草案审查/ }))

    const bodyText = document.body.textContent ?? ''
    for (const forbidden of FORBIDDEN_COPY) {
      expect(bodyText).not.toContain(forbidden)
    }
    expect(bodyText).toContain('项目草案已建造就绪')
    fetchSpy.mockRestore()
  })

  test('store 中无校验报告（validation 为空）时渲染为空', () => {
    const { container } = render(
      <TheaterSettledView draftId="draft-7E3F1A90" version={1} onEnterReview={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  test('formatDraftShortCode 确定性截短：取字母数字末 8 位并大写', () => {
    expect(formatDraftShortCode('draft-7E3F1A90')).toBe('7E3F1A90')
    expect(formatDraftShortCode('ab12cd34ef56')).toBe('CD34EF56')
    expect(formatDraftShortCode('draft_uuid_0000aaaa')).toBe('0000AAAA')
    expect(formatDraftShortCode('')).toBe('PENDING')
  })
})

describe('components/next/theater/TheaterErrorCard 生成态变体（tasks 3.4）', () => {
  test('生成失败：标准错误码 + 中文释义 + 已确认上下文保留回显', () => {
    useAiProjectDraftStore.setState({
      status: 'ready',
      draftStatus: 'error',
      error: '[MODEL_PROVIDER_CALL_FAILED] 模型供应商调用失败',
      draftFailure: generationFailure('MODEL_PROVIDER_CALL_FAILED'),
      rawInput: '搭建一个企业级跨部门敏捷项目协作系统，包含任务看板与工时统计',
      answers: {
        projectGoal: { field: 'projectGoal', action: 'answer', value: '核心目标', marker: null },
      },
    })
    render(<TheaterErrorCard onRetryGeneration={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveAttribute('aria-label', '草案生成错误')
    expect(screen.getByText('草案生成未能完成')).toBeInTheDocument()
    expect(screen.getByText('[MODEL_PROVIDER_CALL_FAILED]')).toBeInTheDocument()
    expect(screen.getByText(/模型供应商调用失败，请检查连接状态后重试/)).toBeInTheDocument()
    // 现场保留：原始输入与已确认澄清记录
    expect(screen.getByText(/原始输入已保留（30 字符）/)).toBeInTheDocument()
    expect(
      screen.getByText('已确认的意图与澄清回答上下文完整保留，重试生成时将原样沿用'),
    ).toBeInTheDocument()
  })

  test('点击「重试生成」触发 onRetryGeneration 回调（带原上下文由装配层重发）', () => {
    useAiProjectDraftStore.setState({
      status: 'ready',
      draftStatus: 'error',
      error: '[MODEL_PROVIDER_CALL_FAILED] 模型供应商调用失败',
      draftFailure: generationFailure('MODEL_PROVIDER_CALL_FAILED'),
      rawInput: '搭建一个企业级跨部门敏捷项目协作系统',
    })
    const onRetryGeneration = vi.fn()
    render(<TheaterErrorCard onRetryGeneration={onRetryGeneration} />)

    expect(screen.queryByRole('button', { name: /重新分析/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /重试生成/ }))
    expect(onRetryGeneration).toHaveBeenCalledTimes(1)
    // 错误现场在装配层重置前保持（本卡片不自行清空）
    expect(useAiProjectDraftStore.getState().draftFailure?.errorCode).toBe(
      'MODEL_PROVIDER_CALL_FAILED',
    )
  })

  test('生成态未提供 onRetryGeneration 时隐藏重试按钮，仅保留重新开始', () => {
    useAiProjectDraftStore.setState({
      status: 'ready',
      draftStatus: 'error',
      error: '[AI_SERVICE_BUSY] AI 生成服务繁忙',
      draftFailure: generationFailure('AI_SERVICE_BUSY'),
    })
    render(<TheaterErrorCard />)

    expect(screen.queryByRole('button', { name: /重试生成/ })).toBeNull()
    expect(screen.getByRole('button', { name: /重新开始/ })).toBeInTheDocument()
  })

  test('生成态重新开始需二次确认：确认后 store.restart() 清空草案现场', () => {
    useAiProjectDraftStore.setState({
      organizationId: 101,
      userId: 1,
      status: 'ready',
      draftStatus: 'error',
      error: '[GENERATION_BUDGET_EXHAUSTED] 生成预算已耗尽',
      draftFailure: generationFailure('GENERATION_BUDGET_EXHAUSTED'),
      rawInput: '搭建一个企业级跨部门敏捷项目协作系统',
    })
    render(<TheaterErrorCard onRetryGeneration={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /确认重新开始/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /重新开始/ }))
    // 未确认前状态不变（防误触）
    expect(useAiProjectDraftStore.getState().draftFailure?.errorCode).toBe(
      'GENERATION_BUDGET_EXHAUSTED',
    )

    fireEvent.click(screen.getByRole('button', { name: /确认重新开始/ }))
    const state = useAiProjectDraftStore.getState()
    expect(state.status).toBe('idle')
    expect(state.draftFailure).toBeNull()
    expect(state.draftStatus).toBeNull()
    expect(state.rawInput).toBe('')
    // 组织作用域保留
    expect(state.organizationId).toBe(101)
  })

  test('生成态错误卡片全程无违规措辞', () => {
    useAiProjectDraftStore.setState({
      status: 'ready',
      draftStatus: 'error',
      error: '[AI_SERVICE_ERROR] AI 生成服务异常',
      draftFailure: generationFailure('AI_SERVICE_ERROR'),
    })
    render(<TheaterErrorCard onRetryGeneration={vi.fn()} />)

    const bodyText = document.body.textContent ?? ''
    for (const forbidden of FORBIDDEN_COPY) {
      expect(bodyText).not.toContain(forbidden)
    }
    expect(bodyText).toContain('草案生成未能完成')
  })

  test('意图解析错误模式回归：无需 draftFailure，仍走重新分析通道', () => {
    useAiProjectDraftStore.setState({
      status: 'error',
      error: '请求超时（20 秒无响应）',
      rawInput: '搭建一个企业级跨部门敏捷项目协作系统',
    })
    render(<TheaterErrorCard />)

    expect(screen.getByRole('alert')).toHaveAttribute('aria-label', '意图解析错误')
    expect(screen.getByRole('button', { name: /重新分析/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /重试生成/ })).toBeNull()
  })

  test('describeGenerationError：已知错误码映射与未知码回退通用文案', () => {
    for (const code of [
      'GENERATION_BUDGET_EXHAUSTED',
      'MODEL_PROVIDER_CALL_FAILED',
      'MODEL_RESPONSE_JSON_INVALID',
      'AI_SERVICE_BUSY',
      'AI_SERVICE_ERROR',
    ]) {
      expect(describeGenerationError(code)).toBe(GENERATION_ERROR_COPY[code])
    }
    expect(describeGenerationError('UNKNOWN_CODE')).toBe('草案生成未能完成，请重试生成。')
  })

  test('resolveGenerationErrorCode：detail 优先 / error 文本括号解析 / 通用回退', () => {
    expect(resolveGenerationErrorCode(generationFailure('AI_SERVICE_ERROR'), null)).toBe(
      'AI_SERVICE_ERROR',
    )
    expect(resolveGenerationErrorCode(null, '[MODEL_RESPONSE_JSON_INVALID] 输出无效')).toBe(
      'MODEL_RESPONSE_JSON_INVALID',
    )
    expect(resolveGenerationErrorCode(null, '无错误码文本')).toBe('AI_SERVICE_ERROR')
  })

  test('isGenerationFailure 以 draftFailure 是否沉淀判定生成态', () => {
    expect(isGenerationFailure(generationFailure())).toBe(true)
    expect(isGenerationFailure(null)).toBe(false)
  })
})

describe('没有可用 AI 连接时的提示（个人版导出 4.6）', () => {
  test('生成态 AI_CONNECTION_REQUIRED：显示提示与前往设置的入口', () => {
    useAiProjectDraftStore.setState({
      status: 'error',
      error: '请先在设置中添加 AI 连接',
      draftFailure: {
        ...generationFailure('AI_CONNECTION_REQUIRED'),
        message: '请先在设置中添加 AI 连接',
      },
    })
    const { container } = render(<TheaterErrorCard onRetryGeneration={vi.fn()} />)

    const action = container.querySelector('[data-ai-connection-required-action]')
    expect(action).not.toBeNull()
    expect(action).toHaveAttribute('href', '/next/settings/ai-connections')
    expect(screen.getAllByText(/请先在设置中添加 AI 连接/).length).toBeGreaterThan(0)
  })

  test('意图分析阶段的同一提示文案也给出设置入口', () => {
    useAiProjectDraftStore.setState({ status: 'error', error: '请先在设置中添加 AI 连接' })
    const { container } = render(<TheaterErrorCard />)
    expect(container.querySelector('[data-ai-connection-required-action]')).not.toBeNull()
  })

  test('其它生成错误不显示设置入口', () => {
    useAiProjectDraftStore.setState({
      status: 'error',
      error: '模型供应商调用失败',
      draftFailure: generationFailure(),
    })
    const { container } = render(<TheaterErrorCard onRetryGeneration={vi.fn()} />)
    expect(container.querySelector('[data-ai-connection-required-action]')).toBeNull()
  })
})
