/**
 * 矛盾求解卡组组件测试（v3-triz-contradiction-copilot W5 · tasks 5.1/5.3/5.4/5.5）。
 *
 * 分两层取证：
 * 1. **卡片层**（受控纯展示）：受理头 / 澄清胶囊 / 触顶中间成果 / Top 3 / 原则释义展开 /
 *    降级说明 / 权限中性提示 / 落库类型选择 / 差异预览与回执；
 * 2. **端到端装配层**：渲染真实 `AiColleagueMessageList` + 真实 store + `vi.stubGlobal('fetch')`
 *    伪后端，验证「受理 → Top3 → 选定 → 预览零写入 → 显式确认单次提交」全链路，
 *    以及对「未确认前无写请求」的网络计数断言。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AiColleagueMessageList } from '@/components/next/ai/AiColleagueMessageList'
import { TrizContradictionCard } from '@/components/next/ai/cards/TrizContradictionCard'
import { TrizEvidenceDrawer } from '@/components/next/ai/cards/TrizEvidenceDrawer'
import * as TrizCopy from '@/components/next/ai/cards/triz-copilot-copy'
import {
  TRIZ_CLARIFICATION_OPTIONS,
  TRIZ_PATH_BADGES,
} from '@/components/next/ai/cards/triz-copilot-copy'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { COLLEAGUE_QUICK_ENTRIES } from '@/lib/next/ai-colleague-intent'
import {
  installTrizFakeBackend,
  makeCommitEnvelope,
  makeContext,
  makeInterventionDiff,
  makePreviewEnvelope,
  makeRun,
  makeSolveResponse,
  TRIZ_PROJECT_ID,
  type TrizFakeBackend,
} from './_next-triz-copilot-fixtures'

const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}))

let backend: TrizFakeBackend

beforeEach(() => {
  backend = installTrizFakeBackend()
  pushMock.mockReset()
  useNextAiColleagueStore.setState({
    isOpen: true,
    executionState: 'idle',
    messages: [],
    pendingAction: null,
    pendingTriz: null,
    context: null,
  })
})

afterEach(() => {
  backend.restore()
})

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
}

function renderWithClient(ui: React.ReactElement, client = createTestQueryClient()) {
  return {
    client,
    ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
  }
}

type CardProps = React.ComponentProps<typeof TrizContradictionCard>

function renderCard(
  overrides: Partial<CardProps> = {},
  runOverrides: Parameters<typeof makeRun>[0] = {},
  queryClient = createTestQueryClient(),
) {
  const handlers = {
    onAnswerClarification: vi.fn(),
    onSelectSolution: vi.fn(),
    onChooseTarget: vi.fn(),
    onConfirmIntervention: vi.fn(),
    onCancelIntervention: vi.fn(),
    onRepreview: vi.fn(),
    onOverride: vi.fn(),
    onRetrySolve: vi.fn(),
  }
  render(
    <QueryClientProvider client={queryClient}>
      <TrizContradictionCard run={makeRun(runOverrides)} {...handlers} {...overrides} />
    </QueryClientProvider>,
  )
  return handlers
}

describe('矛盾求解卡组（task 5.1：受理 / 澄清 / Top 3）', () => {
  test('受理渲染：矛盾类型、改善/恶化参数、路径徽标、置信度、分析记录编号', () => {
    renderCard()

    expect(screen.getByText('技术矛盾')).toBeInTheDocument()
    expect(screen.getByText(/改善：工期延误（#25）/)).toBeInTheDocument()
    expect(screen.getByText(/变差：交付可靠性（#27）/)).toBeInTheDocument()
    expect(screen.getByText('置信度 80%')).toBeInTheDocument()
    expect(screen.getByText('记录 #501')).toBeInTheDocument()
    const badge = document.querySelector('[data-triz-path-badge="rule"]')
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toBe(TRIZ_PATH_BADGES.rule.label)
  })

  test('Top 3 方案渲染：恰好三条，含来源原则编号与动作要点', () => {
    renderCard()

    const cards = document.querySelectorAll('[data-triz-solution]')
    expect(cards).toHaveLength(3)
    expect(cards[0]?.getAttribute('data-triz-solution')).toBe('1')
    expect(screen.getAllByText(/依据：原则 #10 原则10呈现名/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/预操作：提前建立自动化测试套件/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/动作要点 1/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/好处：正向影响 1；代价：负向代价 1/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/前置条件：前置条件 1/).length).toBeGreaterThan(0)
  })

  test('方案原则释义可展开（定义 / 软件实例 / PM 释义 / 来源）', () => {
    renderCard()

    expect(document.querySelector('[data-triz-principle-detail]')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: /原则释义/ })[0] as Element)

    const detail = document.querySelector('[data-triz-principle-detail]')
    expect(detail?.textContent).toContain('原则10定义')
    expect(detail?.textContent).toContain('原则10软件实例')
    expect(detail?.textContent).toContain('原则10PM 释义')
    expect(detail?.textContent).toContain('triz-fundamentals.md §二 · 原则 10')
  })

  test('澄清卡：追问文案 + 快捷选项胶囊（点击即作为一次澄清回答提交）', () => {
    const handlers = renderCard(
      {},
      {
        phase: 'clarifying',
        clarificationRound: 1,
        clarificationPrompt: '请补充：你希望改善的那一项',
      },
    )

    const block = document.querySelector('[data-triz-clarification]')
    expect(block).not.toBeNull()
    expect(block?.getAttribute('data-round')).toBe('1')
    expect(screen.getByText('请补充：你希望改善的那一项')).toBeInTheDocument()
    expect(screen.getByText(/最多再问 1 次/)).toBeInTheDocument()

    const capsules = document.querySelectorAll('[data-triz-clarification-option]')
    expect(capsules).toHaveLength(TRIZ_CLARIFICATION_OPTIONS.length)
    fireEvent.click(capsules[1] as Element)
    expect(handlers.onAnswerClarification).toHaveBeenCalledWith(TRIZ_CLARIFICATION_OPTIONS[1])
  })

  test('第 3 轮触顶：澄清预算用尽提示可见，中间成果（Top 3）照常可选定', () => {
    const handlers = renderCard(
      {},
      {
        phase: 'exhausted',
        clarificationRound: 2,
        budgetState: 'exhausted',
        clarificationReason: '澄清追问已达上限（2 轮）',
      },
    )

    const notice = document.querySelector('[data-triz-exhausted]')
    expect(notice?.textContent).toContain('不再继续追问')
    expect(notice?.textContent).toContain('澄清追问已达上限（2 轮）')
    expect(document.querySelectorAll('[data-triz-clarification]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-triz-solution]')).toHaveLength(3)

    fireEvent.click(screen.getAllByRole('button', { name: '用这个' })[0] as Element)
    expect(handlers.onSelectSolution).toHaveBeenCalledWith(1)
  })
})

describe('确定性回退与权限呈现（task 5.5）', () => {
  test('规则路径徽标 + 降级说明：明确「未调用模型」，不冒充推理', () => {
    renderCard({}, { path: 'rule' })

    expect(screen.getByText('规则匹配')).toBeInTheDocument()
    const degradation = document.querySelector('[data-triz-degradation]')
    expect(degradation?.textContent).toContain('真实模型未启用，已走确定性规则底座（零 Token）')
  })

  test('模型路径徽标与规则路径严格区分', () => {
    renderCard({}, { path: 'ai' })

    expect(document.querySelector('[data-triz-path-badge="ai"]')?.textContent).toBe(
      TRIZ_PATH_BADGES.ai.label,
    )
    expect(document.querySelector('[data-triz-degradation]')).toBeNull()
  })

  test('权限不足：中性提示可见且不出现可点击的落库入口', () => {
    renderCard(
      {},
      {
        phase: 'solved',
        error: { code: 'PERMISSION_DENIED', message: '当前账号没有把方案落库为该类型实体的权限' },
      },
    )

    const notice = document.querySelector('[data-triz-permission-notice]')
    expect(notice?.textContent).toContain('当前账号没有把方案落库为该类型实体的权限')
    expect(document.querySelector('[data-triz-intervention-preview]')).toBeNull()
  })
})

describe('落库差异预览与显式确认（task 5.4）', () => {
  test('选定方案后才出现落库类型选择（三类），点击即请求差异预览', () => {
    const handlers = renderCard({}, { selectedSolutionIndex: 2 })

    const chooser = document.querySelector('[data-triz-target-chooser]')
    expect(chooser).not.toBeNull()
    const targets = document.querySelectorAll('[data-triz-target]')
    expect(targets).toHaveLength(3)
    expect([...targets].map((node) => node.getAttribute('data-triz-target'))).toEqual([
      'task',
      'risk',
      'change_request',
    ])

    fireEvent.click(document.querySelector('[data-triz-target="risk"]') as Element)
    expect(handlers.onChooseTarget).toHaveBeenCalledWith('risk')
  })

  test('差异预览卡：字段草案、来源标注、确认 / 放弃双按钮', () => {
    const handlers = renderCard(
      {},
      {
        phase: 'preview_ready',
        selectedSolutionIndex: 2,
        targetKind: 'risk',
        previewToken: 'a'.repeat(64),
        diff: makeInterventionDiff('risk'),
      },
    )

    const preview = document.querySelector('[data-triz-intervention-preview]')
    expect(preview?.getAttribute('data-phase')).toBe('preview_ready')
    expect(preview?.getAttribute('data-target')).toBe('risk')
    expect(document.querySelector('[data-triz-provenance]')?.textContent).toContain('分析记录 #501')
    expect(document.querySelector('[data-triz-provenance]')?.textContent).toContain('原则 #28')
    expect(screen.getByText('预操作：提前建立自动化测试套件')).toBeInTheDocument()
    expect(document.querySelector('[data-triz-links]')?.textContent).toContain('测试用例补充')

    fireEvent.click(screen.getByRole('button', { name: '确认落库' }))
    expect(handlers.onConfirmIntervention).toHaveBeenCalledWith('a'.repeat(64))
    fireEvent.click(screen.getByRole('button', { name: '放弃落库' }))
    expect(handlers.onCancelIntervention).toHaveBeenCalledTimes(1)
  })

  test('成功回执：分析记录 ID / 方案序号 / 原则编号 / 实体 ID 全部可见', () => {
    renderCard(
      {},
      {
        phase: 'committed',
        targetKind: 'risk',
        receipt: {
          target: 'risk',
          entityId: 9001,
          analysisId: 501,
          solutionIndex: 2,
          principleNumber: 28,
          confirmedByUserId: 7,
        },
      },
    )

    expect(document.querySelector('[data-receipt-analysis-id]')?.textContent).toBe('#501')
    expect(document.querySelector('[data-receipt-solution-index]')?.textContent).toBe('第 2 条')
    expect(document.querySelector('[data-receipt-principle-number]')?.textContent).toBe('原则 #28')
    expect(document.querySelector('[data-receipt-entity-id]')?.textContent).toBe('#9001')
    expect(screen.getByText(/已确认落库：风险登记条目/)).toBeInTheDocument()
  })

  test('409 过期：冲突提示 + 重新预览入口（无假成功）', () => {
    const handlers = renderCard(
      {},
      {
        phase: 'conflict',
        targetKind: 'task',
        error: {
          code: 'SCHEDULE_STALE',
          message: '排程数据已被他人并发修改或预览已过期',
          status: 409,
        },
      },
    )

    const preview = document.querySelector('[data-triz-intervention-preview]')
    expect(preview?.getAttribute('data-phase')).toBe('conflict')
    expect(screen.getByText(/预览已过期（SCHEDULE_STALE）/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新预览/ }))
    expect(handlers.onRepreview).toHaveBeenCalledTimes(1)
  })

  test('放弃态：明确「未发起任何写请求」', () => {
    renderCard({}, { phase: 'cancelled', targetKind: 'task' })

    expect(document.querySelector('[data-triz-intervention-preview]')?.textContent).toContain(
      '未发起任何写请求',
    )
  })
})

describe('映射依据抽屉（task 5.3 / 9.1 / 9.2）', () => {
  test('抽屉呈现参数 / 候选原则（含未进 Top 3 编号）/ path 徽标 / 置信度 / 来源章节', () => {
    const onOverride = vi.fn()
    renderWithClient(<TrizEvidenceDrawer run={makeRun()} onOverride={onOverride} />)

    fireEvent.click(document.querySelector('[data-triz-evidence-trigger]') as Element)

    const drawer = screen.getByRole('dialog', { name: '映射依据' })
    expect(drawer.getAttribute('data-triz-path')).toBe('rule')
    expect(document.querySelector('[data-triz-path-badge="rule"]')?.textContent).toContain(
      '规则匹配',
    )
    expect(document.querySelector('[data-triz-path-detail]')?.textContent).toContain(
      '未调用任何模型',
    )
    expect(screen.getByText('置信度 80%')).toBeInTheDocument()
    const parameters = document.querySelector('[data-triz-evidence-parameters]')?.textContent ?? ''
    expect(parameters).toContain('工期延误（#25）')
    expect(parameters).toContain('交付可靠性（#27）')
    expect(document.querySelectorAll('[data-triz-candidate-principle]')).toHaveLength(3)
    expect(document.querySelector('[data-triz-excluded-principles]')?.textContent).toContain('#31')
    expect(document.querySelector('[data-triz-evidence-source]')?.textContent).toContain(
      'triz-application-ai-pm.md §三 · 矛盾对 1',
    )
  })

  test('改判：改选恶化参数后确认重算，回调携带新编号', async () => {
    const onOverride = vi.fn()
    renderWithClient(<TrizEvidenceDrawer run={makeRun()} onOverride={onOverride} />)
    fireEvent.click(document.querySelector('[data-triz-evidence-trigger]') as Element)

    const worsening = document.querySelector(
      '[data-triz-override-param="worsening"]',
    ) as HTMLSelectElement
    await waitFor(() => expect(worsening.querySelector('option[value="36"]')).not.toBeNull())
    fireEvent.change(worsening, { target: { value: '36' } })
    fireEvent.click(document.querySelector('[data-triz-override-submit]') as Element)

    expect(onOverride).toHaveBeenCalledWith({ improvingParameter: 25, worseningParameter: 36 })
  })

  test('跳转图表馆矛盾矩阵：href 带入当前参数对', () => {
    renderWithClient(<TrizEvidenceDrawer run={makeRun()} onOverride={vi.fn()} />)
    fireEvent.click(document.querySelector('[data-triz-evidence-trigger]') as Element)

    const link = document.querySelector('[data-triz-matrix-link]') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(
      `/next/projects/${TRIZ_PROJECT_ID}/charts/triz-contradiction-matrix?improving=25&worsening=27`,
    )
  })

  test('参数未识别时跳转入口降级为中性提示（不拼假链接）', () => {
    const run = makeRun({ mapping: null })
    renderWithClient(<TrizEvidenceDrawer run={run} onOverride={vi.fn()} />)

    expect(document.querySelector('[data-triz-evidence-trigger]')).toBeNull()
  })

  test('task 9.1/9.2 成功响应：下拉框动态渲染 39 项参数', async () => {
    renderWithClient(<TrizEvidenceDrawer run={makeRun()} onOverride={vi.fn()} />)
    fireEvent.click(document.querySelector('[data-triz-evidence-trigger]') as Element)

    const improvingSelect = document.querySelector(
      '[data-triz-override-param="improving"]',
    ) as HTMLSelectElement
    expect(improvingSelect).not.toBeNull()

    await waitFor(() => {
      // 包含 1 个空项「（未识别）」+ 39 个动态拉取的标准参数
      const options = improvingSelect.querySelectorAll('option')
      expect(options.length).toBeGreaterThanOrEqual(40)
    })
    expect(improvingSelect.querySelector('option[value="9"]')?.textContent).toContain(
      '交付速度（#9）',
    )
    expect(improvingSelect.querySelector('option[value="39"]')?.textContent).toContain(
      '团队产出效率（#39）',
    )
  })

  test('task 9.1/9.2 接口 500 失败：下拉框禁用并展示中性降级提示「改判候选不可用（仅供查看）」，抽屉正常展示不崩溃', async () => {
    backend.enqueueParameters({ error: { code: 'INTERNAL_ERROR', message: '服务异常' } }, 500)
    renderWithClient(<TrizEvidenceDrawer run={makeRun()} onOverride={vi.fn()} />)
    fireEvent.click(document.querySelector('[data-triz-evidence-trigger]') as Element)

    await waitFor(() => {
      expect(screen.getByText('改判候选不可用（仅供查看）')).toBeInTheDocument()
    })

    const improving = document.querySelector(
      '[data-triz-override-param="improving"]',
    ) as HTMLSelectElement
    const worsening = document.querySelector(
      '[data-triz-override-param="worsening"]',
    ) as HTMLSelectElement
    const submitBtn = document.querySelector('[data-triz-override-submit]') as HTMLButtonElement

    expect(improving.disabled).toBe(true)
    expect(worsening.disabled).toBe(true)
    expect(submitBtn.disabled).toBe(true)

    // 抽屉与既有映射依据正常展示，不白屏、不抛未捕获异常
    expect(screen.getByRole('dialog', { name: '映射依据' })).toBeInTheDocument()
    expect(screen.getByText('置信度 80%')).toBeInTheDocument()
    expect(screen.getAllByText('改善参数').length).toBeGreaterThan(0)
    expect(screen.getByText('工期延误（#25）')).toBeInTheDocument()
  })

  test('task 9.1/9.2 静态断言：triz-copilot-copy.ts 彻底删除 TRIZ_OVERRIDE_PARAMETER_OPTIONS 符号', () => {
    expect('TRIZ_OVERRIDE_PARAMETER_OPTIONS' in TrizCopy).toBe(false)
    const copyPath = path.resolve(process.cwd(), 'components/next/ai/cards/triz-copilot-copy.ts')
    const fileContent = fs.readFileSync(copyPath, 'utf-8')
    expect(fileContent).not.toContain('TRIZ_OVERRIDE_PARAMETER_OPTIONS')
    expect(fileContent).not.toContain('TrizOverrideParameterOption')
  })
})

describe('端到端装配（消息列表 + store + 伪后端）', () => {
  function renderTimeline(queryClient = createTestQueryClient()) {
    render(
      <QueryClientProvider client={queryClient}>
        <AiColleagueMessageList
          onQuickAction={(text) => {
            void useNextAiColleagueStore.getState().submitUserMessage(text, makeContext())
          }}
        />
      </QueryClientProvider>,
    )
  }

  test('受理到落库全链路：预览零写入 → 显式确认单次提交 → 回执可见', async () => {
    backend.enqueueSolve(makeSolveResponse())
    backend.enqueueExecute(makePreviewEnvelope('task'))
    backend.enqueueConfirm(makeCommitEnvelope('task'))
    renderTimeline()

    const quickEntry = COLLEAGUE_QUICK_ENTRIES.find((entry) => entry.id === 'quick-triz-solve')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(quickEntry!.label) }))
    })

    await waitFor(() => expect(document.querySelector('[data-triz-card]')).not.toBeNull())
    expect(document.querySelectorAll('[data-triz-solution]')).toHaveLength(3)
    // 受理阶段只有一个写工具以外的请求；确认前零 confirm
    expect(backend.count('/triz-copilot/analyses')).toBe(1)
    expect(backend.count('/ai/tools/confirm')).toBe(0)
    expect(backend.count('/ai/tools/execute')).toBe(0)

    // 选定方案 → 选择落库类型（任务）→ 生成差异预览
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '用这个' })[0] as Element)
    })
    await act(async () => {
      fireEvent.click(document.querySelector('[data-triz-target="task"]') as Element)
    })
    await waitFor(() =>
      expect(
        document.querySelector('[data-triz-intervention-preview]')?.getAttribute('data-phase'),
      ).toBe('preview_ready'),
    )
    expect(backend.count('/ai/tools/execute')).toBe(1)
    expect(backend.count('/ai/tools/confirm')).toBe(0)

    // 显式确认 → 单次 confirm + 回执
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认落库' }))
    })
    await waitFor(() =>
      expect(
        document.querySelector('[data-triz-intervention-preview]')?.getAttribute('data-phase'),
      ).toBe('committed'),
    )
    expect(backend.count('/ai/tools/confirm')).toBe(1)
    expect(document.querySelector('[data-receipt-principle-number]')?.textContent).toBe('原则 #28')
  })

  test('澄清卡胶囊点击：直接作为澄清回答发起续轮求解（无需再猜意图）', async () => {
    backend.enqueueSolve(
      makeSolveResponse({
        id: 501,
        clarification: {
          needed: true,
          asked: true,
          round: 1,
          prompt: '请补充：你希望改善的那一项',
        },
      }),
    )
    backend.enqueueSolve(makeSolveResponse({ id: 502, parentAnalysisId: 501 }))
    renderTimeline()

    const quickEntry = COLLEAGUE_QUICK_ENTRIES.find((entry) => entry.id === 'quick-triz-solve')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(quickEntry!.label) }))
    })
    await waitFor(() => expect(document.querySelector('[data-triz-clarification]')).not.toBeNull())

    await act(async () => {
      fireEvent.click(document.querySelectorAll('[data-triz-clarification-option]')[0] as Element)
    })

    await waitFor(() => expect(backend.count('/triz-copilot/analyses')).toBe(2))
    expect(backend.calls.at(-1)?.body).toEqual({
      statement: TRIZ_CLARIFICATION_OPTIONS[0],
      parentAnalysisId: 501,
    })
    await waitFor(() =>
      expect(document.querySelectorAll('[data-triz-solution]').length).toBeGreaterThan(0),
    )
    // 全程零写请求：澄清链路不产生任何落库动作
    expect(backend.count('/ai/tools/execute')).toBe(0)
    expect(backend.count('/ai/tools/confirm')).toBe(0)
  })
})

describe('没有可用 AI 连接（个人版导出 4.6）', () => {
  test('求解因无连接失败：不出结果，只显示提示与设置入口', () => {
    renderCard(
      {},
      {
        phase: 'error',
        diff: null,
        error: { code: 'AI_CONNECTION_REQUIRED', message: '请先在设置中添加 AI 连接' },
      },
    )

    expect(screen.getByText('请先在设置中添加 AI 连接')).toBeInTheDocument()
    const action = document.querySelector('[data-ai-connection-required-action]')
    expect(action).toHaveAttribute('href', '/next/settings/ai-connections')
  })

  test('其它求解错误不显示设置入口', () => {
    renderCard(
      {},
      {
        phase: 'error',
        diff: null,
        error: { code: 'INTERNAL_ERROR', message: '服务异常' },
      },
    )

    expect(document.querySelector('[data-ai-connection-required-action]')).toBeNull()
  })
})
