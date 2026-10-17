import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  AiAttributionSummaryDrawer,
  AiAttributionButton,
} from '@/components/next/role-view/AiAttributionSummaryDrawer'
import type { AiAttributionTarget } from '@/components/next/role-view/ObjectiveExecutionMatrix'

describe('AiAttributionSummaryDrawer（AI 归因摘要操作点与只读抽屉，任务 1.7 / 1.8）', () => {
  const fetchRecords: Array<{ method: string; url: string }> = []

  const mockTarget: AiAttributionTarget = {
    id: 42,
    objectiveId: 42,
    title: '跨境支付网关升级',
    reason: '依赖上游清算通道延迟，整体排期偏离 30%',
    historyEvolution: [
      '第 1 周：项目立项，基线确立',
      '第 4 周：清算通道协议调整，出现 5 天技术对齐偏离',
      '第 8 周：跨组织联调测试未达预期，进入关注队列',
    ],
    bottleneckCause: '外部银行清算沙盒联调耗时超期，跨团队接口缺乏统一 Mock 工具。',
    riskCorrelation: '若未能在 10 月初完成投产，将直接影响海外双十一大促交易链路。',
    forecastAdvice: '建议启用备选支付通道并协调银企直连通道负责人进驻，预计可收回 35% 延误。',
  }

  beforeEach(() => {
    fetchRecords.length = 0
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      fetchRecords.push({ method, url })
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response
    })

    // Mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('点击操作点平滑展开归因抽屉，正确展示历史演进、偏差原因与预测推演', () => {
    const handleClose = vi.fn()
    const handleConsult = vi.fn()

    const { rerender } = render(
      <AiAttributionSummaryDrawer open={false} onClose={handleClose} target={null} />,
    )

    // 初始关闭，不渲染抽屉
    expect(screen.queryByRole('dialog')).toBeNull()

    // 展开抽屉
    rerender(
      <AiAttributionSummaryDrawer
        open={true}
        onClose={handleClose}
        target={mockTarget}
        onConsultAiColleague={handleConsult}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'AI 战略归因摘要' })).toBeInTheDocument()
    expect(screen.getByTestId('drawer-target-title')).toHaveTextContent('跨境支付网关升级')

    // 验证四大段落
    expect(screen.getByText('历史演进与关键偏离节点')).toBeInTheDocument()
    expect(screen.getByText(/清算通道协议调整/)).toBeInTheDocument()

    expect(screen.getByText('瓶颈资源归因分析')).toBeInTheDocument()
    expect(screen.getByText(/外部银行清算沙盒联调耗时超期/)).toBeInTheDocument()

    expect(screen.getByText('关联风险与上下游传导')).toBeInTheDocument()
    expect(screen.getByText(/影响海外双十一大促/)).toBeInTheDocument()

    expect(screen.getByText('未来周期推演建议')).toBeInTheDocument()
    expect(screen.getByText(/建议启用备选支付通道/)).toBeInTheDocument()
  })

  it('只有 reason 时：瓶颈段显示 reason，其余三段显示暂无数据，不出现写死的范例叙述', () => {
    render(
      <AiAttributionSummaryDrawer
        open={true}
        onClose={() => {}}
        target={{ id: 7, title: '仅有偏差原因的目标', reason: 'KR 落后于计划' }}
      />,
    )

    expect(screen.getAllByText('KR 落后于计划').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('attribution-no-data')).toHaveLength(3)
    expect(screen.queryByText(/偏离达 28%/)).toBeNull()
    expect(screen.queryByText(/预计可收回 40%/)).toBeNull()
    expect(screen.queryByText(/下游 2 个主力业务项目/)).toBeNull()
  })

  it('点击关闭按钮或遮罩背景触发 onClose 回调', () => {
    const handleClose = vi.fn()
    render(<AiAttributionSummaryDrawer open={true} onClose={handleClose} target={mockTarget} />)

    const closeBtn = screen.getByTestId('drawer-close-btn')
    fireEvent.click(closeBtn)
    expect(handleClose).toHaveBeenCalledTimes(1)

    const backdrop = screen.getByTestId('drawer-backdrop')
    fireEvent.click(backdrop)
    expect(handleClose).toHaveBeenCalledTimes(2)
  })

  it('按 Esc 键关闭抽屉', () => {
    const handleClose = vi.fn()
    render(<AiAttributionSummaryDrawer open={true} onClose={handleClose} target={mockTarget} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('支持复制归因报告全文到剪贴板', async () => {
    render(<AiAttributionSummaryDrawer open={true} onClose={() => {}} target={mockTarget} />)

    const copyBtn = screen.getByTestId('btn-copy-report')
    fireEvent.click(copyBtn)

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('战略归因推演报告：跨境支付网关升级'),
    )
    await waitFor(() => {
      expect(screen.getByText('已复制到剪贴板')).toBeInTheDocument()
    })
  })

  it('支持呼出 AI 同事深入追问（只读传递上下文）', () => {
    const handleConsult = vi.fn()
    render(
      <AiAttributionSummaryDrawer
        open={true}
        onClose={() => {}}
        target={mockTarget}
        onConsultAiColleague={handleConsult}
      />,
    )

    const consultBtn = screen.getByTestId('btn-consult-ai')
    fireEvent.click(consultBtn)

    expect(handleConsult).toHaveBeenCalledTimes(1)
    expect(handleConsult).toHaveBeenCalledWith(mockTarget)
  })

  it('纯只读铁律（RL-01）：零一键落库按钮，且交互全过程 HTTP 写请求严格为 0', async () => {
    render(
      <div>
        <AiAttributionButton onClick={() => {}} />
        <AiAttributionSummaryDrawer
          open={true}
          onClose={() => {}}
          target={mockTarget}
          onConsultAiColleague={() => {}}
        />
      </div>,
    )

    // 严苛验证：抽屉与操作点内杜绝任何写操作按钮文案（如创建任务、应用修改、确认变更、保存等）
    expect(screen.queryByText(/一键应用/i)).toBeNull()
    expect(screen.queryByText(/确认落库/i)).toBeNull()
    expect(screen.queryByText(/创建任务/i)).toBeNull()
    expect(screen.queryByText(/立即修改/i)).toBeNull()

    // 触发所有只读操作
    const copyBtn = screen.getByTestId('btn-copy-report')
    await waitFor(() => {
      fireEvent.click(copyBtn)
    })

    const consultBtn = screen.getByTestId('btn-consult-ai')
    fireEvent.click(consultBtn)

    // 严苛断言：所有写方法（POST/PATCH/PUT/DELETE）严格为 0
    const writeCalls = fetchRecords.filter((req) =>
      ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method),
    )
    expect(writeCalls).toHaveLength(0)
  })
})
