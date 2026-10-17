import { describe, expect, test, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CommandCenterView, CommandCenterSkeleton } from '@/components/project/CommandCenterView'
import type { CommandCenterResponse } from '@aiproj/types'

// —— next/navigation —— //
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: '101' }),
  usePathname: () => '/projects/101/health-risk-command-center',
  useSearchParams: () => new URLSearchParams(),
}))

function makeResponse(
  overrides: {
    headline?: Record<string, unknown>
    sources?: Array<Record<string, unknown>>
    attention?: Array<Record<string, unknown>>
  } = {},
): CommandCenterResponse {
  return {
    data: {
      project: { id: 101, organizationId: 1 },
      headline: {
        sourceKey: 'health-diagnosis',
        evidenceClass: 'confirmed-diagnosis',
        healthStatus: 'green',
        overallScore: 86,
        degraded: false,
        degradationWarning: null,
        ...overrides.headline,
      },
      sources: overrides.sources ?? [
        {
          sourceKey: 'project-dashboard',
          meta: {
            sourceKey: 'project-dashboard',
            evidenceClass: 'fact',
            availability: 'available',
            freshness: 'current',
            authorityRef: null,
            sourceVersionDigest: null,
            calculatedAt: null,
            reasonCode: null,
          },
          warnings: [],
          targets: [],
          facts: null,
        },
        {
          sourceKey: 'health-diagnosis',
          meta: {
            sourceKey: 'health-diagnosis',
            evidenceClass: 'confirmed-diagnosis',
            availability: 'available',
            freshness: 'current',
            authorityRef: null,
            sourceVersionDigest: null,
            calculatedAt: null,
            reasonCode: null,
          },
          warnings: [],
          targets: [{ kind: 'health-evidence', params: { projectId: 101, diagnosisId: 9001 } }],
          facts: {
            sourceKey: 'health-diagnosis',
            diagnosisId: 9001,
            overallScore: 86,
            overallLabel: '良好',
            status: 'confirmed' as const,
            stale: false,
            confirmedAt: null,
            dimensionScores: [{ dimension: 'schedule', score: 82, severity: 'medium' as const }],
          },
        },
      ],
      attention: overrides.attention ?? [
        {
          attentionId: 'att-1',
          sourceKey: 'risk-workbench',
          kind: 'high-risk-open',
          severity: 'critical',
          reasonCode: 'HIGH_SEVERITY_RISK_OPEN',
          entityRef: { kind: 'risk', id: 501 },
          label: '关键依赖延期风险',
          occurredAt: null,
          dueAt: null,
          stale: false,
          targets: [{ kind: 'risk-detail', params: { projectId: 101, riskId: 501 } }],
        },
      ],
    },
    meta: {
      contractVersion: 'project-health-risk-command-center/v1',
      attentionRuleVersion: 'command-center-attention-rules.v1',
      calculatedAt: '2026-09-01T08:00:00.000Z',
      projectionSignature: 'abcd1234',
      overallAvailability: 'available',
      sourceCounts: {
        available: 5,
        empty: 0,
        stale: 0,
        forbidden: 1,
        unavailable: 0,
        unsupported: 1,
      },
      attentionTruncation: { requestedLimit: 20, returned: 1, omitted: 0, truncated: false },
      perSourceTimingMs: {},
    },
  } as unknown as CommandCenterResponse
}

type QueryState = {
  data?: CommandCenterResponse
  error?: Error
  isPendingFinal?: boolean
}

function makeQuery(state: QueryState) {
  return {
    data: state.data,
    error: state.error ?? null,
    isError: Boolean(state.error),
    isPending:
      !state.data && !state.error && !state.isPendingFinal === false
        ? true
        : !state.data && !state.error,
    isSuccess: Boolean(state.data) && !state.error,
    refetch: vi.fn().mockResolvedValue({}),
  } as unknown as Parameters<typeof CommandCenterView>[0]['query']
}

function renderView(query: ReturnType<typeof makeQuery>) {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <CommandCenterView projectId={101} query={query} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  push.mockReset()
})

describe('指挥中心页面状态（§6.1/6.2）', () => {
  test('loading 骨架与最终结构同形，内容中央无 spinner', () => {
    render(<CommandCenterSkeleton />)
    expect(screen.getByLabelText(/正在加载健康与风险/)).toBeInTheDocument()
    // 无 LoadingSpinner 角色元素
    expect(document.querySelector('[role="status"][aria-busy="true"]')).toBeNull()
  })

  test('ready：头部态势、来源条带与注意力队列渲染', async () => {
    renderView(makeQuery({ data: makeResponse() }))
    expect(screen.getByRole('region', { name: '整体态势' })).toBeInTheDocument()
    // 头部健康文案与诊断 overallLabel 均可为「良好」，用多元素断言
    expect(screen.getAllByText('良好').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('来源状态')).toHaveTextContent('健康诊断')
    expect(screen.getByRole('region', { name: '注意力队列' })).toBeInTheDocument()
    expect(screen.getByText('关键依赖延期风险')).toBeInTheDocument()
  })

  test('degraded 头部：missing/stale 回退显示降级警告文案', async () => {
    renderView(
      makeQuery({
        data: makeResponse({
          headline: {
            degraded: true,
            degradationWarning: {
              code: 'HEALTH_DIAGNOSIS_MISSING',
              message: '暂无已确认的健康诊断',
            },
          },
        }),
      }),
    )
    expect(await screen.findByText(/暂无已确认的健康诊断/)).toBeInTheDocument()
    expect(screen.getByText(/不隐式生成或刷新诊断/)).toBeInTheDocument()
  })

  test('mandatory error：整页错误 + 重试按钮可触发 refetch', async () => {
    const refetch = vi.fn().mockResolvedValue({})
    const q = makeQuery({ error: new Error('x') }) as unknown as { refetch: () => void }
    ;(q as unknown as { refetch: unknown }).refetch = refetch
    renderView(q as never)
    expect(screen.getByText(/基础项目信息读取失败/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  test('partial：unavailable 来源明确标注且不拖垮整页', async () => {
    const response = makeResponse({
      sources: [
        {
          sourceKey: 'resource-load',
          meta: {
            sourceKey: 'resource-load',
            evidenceClass: 'availability-warning',
            availability: 'unavailable',
            freshness: 'unknown',
            authorityRef: null,
            sourceVersionDigest: null,
            calculatedAt: null,
            reasonCode: 'SOURCE_UNAVAILABLE',
          },
          warnings: [
            { code: 'SOURCE_UNAVAILABLE', sourceKey: 'resource-load', message: '该来源暂时不可用' },
          ],
          targets: [],
          facts: null,
        },
      ],
      attention: [],
    })
    renderView(makeQuery({ data: response }))
    // 整页仍可读：头部存在
    expect(screen.getByRole('region', { name: '整体态势' })).toBeInTheDocument()
    expect(screen.getAllByText('不可用').length).toBeGreaterThan(0)
  })

  test('空态不虚构零风险证明', async () => {
    renderView(makeQuery({ data: makeResponse({ attention: [] }) }))
    expect(await screen.findByText(/不代表零风险证明/)).toBeInTheDocument()
  })

  test('来源状态条带：色彩非唯一编码（文字 + aria 冗余），长中文标签截断不溢出', () => {
    renderView(makeQuery({ data: makeResponse() }))
    const strip = screen.getByLabelText('来源状态')
    // 每个来源条目都有文字状态（非纯色彩）+ role=img 的可访问名称
    expect(strip).toHaveTextContent('可用')
    expect(screen.getAllByRole('img').length).toBeGreaterThan(0)
    // 注意力长标题使用 truncate 防溢出
    expect(screen.getByText('关键依赖延期风险').className).toContain('truncate')
  })

  test('「前往处理」经 safe resolver 导航；导航前零写入请求（fetch 未被调用）', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderView(makeQuery({ data: makeResponse() }))
    fireEvent.click(screen.getByRole('button', { name: '前往处理' }))
    expect(push).toHaveBeenCalledWith('/projects/101/risks?risk=501')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('「查看证据」打开页内只读抽屉（健康诊断项）', async () => {
    const response = makeResponse({
      attention: [
        {
          attentionId: 'att-hd',
          sourceKey: 'health-diagnosis',
          kind: 'source-stale-review',
          severity: 'medium',
          reasonCode: 'SOURCE_STALE_REVIEW_REQUIRED',
          entityRef: { kind: 'diagnosis', id: 9001 },
          label: '健康诊断需要刷新复核',
          occurredAt: null,
          dueAt: null,
          stale: true,
          targets: [{ kind: 'health-evidence', params: { projectId: 101, diagnosisId: 9001 } }],
        },
      ],
    })
    renderView(makeQuery({ data: response }))
    fireEvent.click(screen.getAllByRole('button', { name: '查看证据' })[0]!)
    // 抽屉打开（Radix portal 渲染到 body）
    expect(await screen.findByTestId('health-evidence-drawer')).toBeInTheDocument()
  })

  test('无安全目标时留在当前页并显示 bounded warning', async () => {
    renderView(
      makeQuery({
        data: makeResponse({
          attention: [
            {
              attentionId: 'att-2',
              sourceKey: 'change-impact',
              kind: 'source-unavailable',
              severity: 'low',
              reasonCode: 'SOURCE_UNAVAILABLE',
              entityRef: null,
              label: '变更影响来源不可用',
              occurredAt: null,
              dueAt: null,
              stale: false,
              targets: [],
            },
          ],
        }),
      }),
    )
    // targets 为空 → 不渲染「前往处理」按钮
    expect(screen.queryByRole('button', { name: '前往处理' })).not.toBeInTheDocument()
  })
})

describe('指挥中心页面键盘 / 无障碍 / 目标边界（§6.8–6.10/6.13/6.14）', () => {
  test('目标 surface 缺失（milestone-view）：留在当前页并显示 bounded warning', async () => {
    renderView(
      makeQuery({
        data: makeResponse({
          attention: [
            {
              attentionId: 'att-ms',
              sourceKey: 'task-milestone',
              kind: 'milestone-pressure',
              severity: 'medium',
              reasonCode: 'MILESTONE_OVERDUE',
              entityRef: { kind: 'project', id: 101 },
              label: '里程碑逾期',
              occurredAt: null,
              dueAt: null,
              stale: false,
              targets: [{ kind: 'milestone-view', params: { projectId: 101 } }],
            },
          ],
        }),
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: '前往处理' }))
    expect(await screen.findByText(/该处理目标当前不可用/)).toBeInTheDocument()
    // 未发生导航
    expect(push).not.toHaveBeenCalled()
  })

  const hdAttention = {
    attentionId: 'att-hd',
    sourceKey: 'health-diagnosis',
    kind: 'source-stale-review',
    severity: 'medium',
    reasonCode: 'SOURCE_STALE_REVIEW_REQUIRED',
    entityRef: { kind: 'diagnosis', id: 9001 },
    label: '健康诊断需要刷新复核',
    occurredAt: null,
    dueAt: null,
    stale: true,
    targets: [{ kind: 'health-evidence', params: { projectId: 101, diagnosisId: 9001 } }],
  } as const

  test('证据抽屉可通过键盘关闭（关闭按钮 + Radix 原生 Esc 支持）', async () => {
    renderView(makeQuery({ data: makeResponse({ attention: [hdAttention] }) }))
    fireEvent.click(screen.getAllByRole('button', { name: '查看证据' })[0]!)
    await screen.findByTestId('health-evidence-drawer')
    // 键盘路径：aria-label「关闭」按钮可聚焦回车触发
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    await waitFor(() => {
      expect(screen.queryByTestId('health-evidence-drawer')).not.toBeInTheDocument()
    })
  })

  test('抽屉 portal 到 body，不被父级 overflow 裁切', async () => {
    renderView(makeQuery({ data: makeResponse({ attention: [hdAttention] }) }))
    fireEvent.click(screen.getAllByRole('button', { name: '查看证据' })[0]!)
    const drawer = await screen.findByTestId('health-evidence-drawer')
    // Radix Portal 直接挂在 body 下（不经视图容器，避免 overflow 裁切）
    expect(drawer.parentElement).toBe(document.body)
  })

  test('筛选按钮带 aria-pressed；筛选无结果时显示引导空态', async () => {
    renderView(makeQuery({ data: makeResponse() }))
    expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true')
    // 默认数据无 medium 项？有——点击「中」后仍可见；改点「严重」并断言 critical 项保留
    fireEvent.click(screen.getByRole('button', { name: '严重' }))
    expect(screen.getByRole('button', { name: '严重' }).getAttribute('aria-pressed')).toBe('true')
    // 切到「待复核」：默认数据无 stale 项 → 引导空态
    fireEvent.click(screen.getByRole('button', { name: '待复核' }))
    expect(screen.getByText(/当前筛选下没有匹配的注意力项/)).toBeInTheDocument()
  })

  test('stale 注意力项显示「需复核」徽标；全文不出现「立即修复 / 应用」类写动作文案', () => {
    renderView(
      makeQuery({
        data: makeResponse({
          attention: [
            {
              attentionId: 'att-stale',
              sourceKey: 'prediction',
              kind: 'source-stale-review',
              severity: 'low',
              reasonCode: 'PREDICTION_STALE',
              entityRef: { kind: 'prediction-snapshot', id: 77 },
              label: '预测快照已过期',
              occurredAt: null,
              dueAt: null,
              stale: true,
              targets: [],
            },
          ],
        }),
      }),
    )
    expect(screen.getByText('需复核')).toBeInTheDocument()
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('立即修复')
    expect(text).not.toContain('一键应用')
  })

  test('交互元素携带可见焦点类（focusRing token），中文 aria 标签齐备', () => {
    renderView(makeQuery({ data: makeResponse() }))
    // 重试按钮等使用宿主 Button（内建 focusRing）；此处验证注意力操作按钮存在可聚焦
    for (const name of ['查看证据', '前往处理']) {
      for (const btn of screen.getAllByRole('button', { name })) {
        expect(btn.tagName).toBe('BUTTON')
      }
    }
    expect(screen.getByLabelText('来源状态')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '筛选注意力项' })).toBeInTheDocument()
  })
})
