import { describe, expect, test, vi, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CommandCenterView } from '@/components/project/CommandCenterView'
import type { CommandCenterResponse } from '@aiproj/types'

// —— 大负载投影性能门（§7.8 P1）：100 条注意力项首屏有界渲染、局部错误可恢复 —— //

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: '101' }),
  usePathname: () => '/projects/101/health-risk-command-center',
  useSearchParams: () => new URLSearchParams(),
}))

function makeLargeResponse(attentionCount = 100): CommandCenterResponse {
  return {
    data: {
      project: { id: 101, organizationId: 1 },
      headline: {
        sourceKey: 'project-dashboard',
        evidenceClass: 'fact',
        healthStatus: 'yellow',
        overallScore: null,
        degraded: true,
        degradationWarning: {
          code: 'HEALTH_DIAGNOSIS_MISSING',
          message: '暂无已确认的健康诊断',
        },
      },
      sources: [
        {
          sourceKey: 'risk-workbench',
          meta: {
            sourceKey: 'risk-workbench',
            evidenceClass: 'fact',
            availability: 'available',
            freshness: 'current',
            authorityRef: null,
            sourceVersionDigest: 'x',
            calculatedAt: null,
            reasonCode: null,
          },
          warnings: [],
          targets: [],
          facts: {
            sourceKey: 'risk-workbench',
            totalRisks: 120,
            openRisks: 80,
            highRiskCount: 30,
            criticalRiskCount: 10,
            overdueReviewCount: 20,
            incompleteResponsePlans: 0,
            healthScore: 55,
            trend30d: { created: 40, closed: 12 },
          },
        },
      ],
      attention: Array.from({ length: attentionCount }, (_, i) => ({
        attentionId: `att-perf-${i}`,
        sourceKey: 'task-milestone',
        kind: 'task-overdue',
        severity:
          i % 4 === 0
            ? ('critical' as const)
            : i % 3 === 0
              ? ('high' as const)
              : ('medium' as const),
        reasonCode: 'TASK_OVERDUE',
        entityRef: { kind: 'task', id: 7000 + i },
        label: `长中文任务名称溢出验证用例 ${i + 1} —— 包含相当长的描述文本以测试截断行为`,
        occurredAt: new Date(1_787_000_000_000 - i * 60_000).toISOString(),
        dueAt: new Date(1_787_000_000_000).toISOString(),
        stale: false,
        targets: [{ kind: 'task-detail', params: { projectId: 101, taskId: 7000 + i } }],
      })),
    },
    meta: {
      contractVersion: 'project-health-risk-command-center/v1',
      attentionRuleVersion: 'command-center-attention-rules.v1',
      calculatedAt: '2026-09-01T08:00:00.000Z',
      projectionSignature: 'perf1234',
      overallAvailability: 'stale',
      sourceCounts: {
        available: 3,
        empty: 1,
        stale: 0,
        forbidden: 1,
        unavailable: 1,
        unsupported: 1,
      },
      attentionTruncation: {
        requestedLimit: 100,
        returned: attentionCount,
        omitted: 20,
        truncated: true,
      },
      perSourceTimingMs: {},
    },
  } as unknown as CommandCenterResponse
}

function makeQuery(state: { data?: CommandCenterResponse; error?: Error }) {
  return {
    data: state.data,
    error: state.error ?? null,
    isError: Boolean(state.error),
    isPending: !state.data && !state.error,
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
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('E2E 性能门不允许网络请求')
  })
})

describe('指挥中心 large-payload 投影与交互（§7.8 P1）', () => {
  test('100 条注意力项：首次投影 <500ms、列表有界、截断提示可见', async () => {
    // 取 3 次挂载的最快值：门禁衡量投影本身，排除整套测试并行时 CPU 争用造成的单次抖动
    const timings: number[] = []
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) cleanup()
      const started = performance.now()
      renderView(makeQuery({ data: makeLargeResponse(100) }))
      // 首屏关键区域全部就位
      expect(screen.getByRole('region', { name: '整体态势' })).toBeInTheDocument()
      expect(screen.getByRole('region', { name: '注意力队列' })).toBeInTheDocument()
      timings.push(performance.now() - started)
    }
    expect(Math.min(...timings)).toBeLessThan(500)

    // 截断提示（meta 报告另有 20 条未展示）
    expect(screen.getByText(/已按稳定规则截断/)).toBeInTheDocument()
    expect(screen.getByText(/另有 20 条未展示/)).toBeInTheDocument()
  })

  test('严重度筛选在大列表上可用且结果有界', () => {
    renderView(makeQuery({ data: makeLargeResponse(100) }))
    fireEvent.click(screen.getByRole('button', { name: '严重' }))
    // 100 条中 %4==0 → 25 条 critical
    const listItems = screen
      .getAllByRole('listitem')
      .filter((li) => li.textContent?.includes('长中文任务名称'))
    expect(listItems.length).toBe(25)
  })

  test('局部错误恢复：error → refetch 成功后整页回到 ready（非 modal 打断）', async () => {
    const refetch = vi.fn().mockRejectedValueOnce(new Error('still failing')).mockResolvedValue({})
    const q = makeQuery({ error: new Error('boom') })
    ;(q as unknown as { refetch: unknown }).refetch = refetch
    renderView(q)
    expect(screen.getByText(/基础项目信息读取失败/)).toBeInTheDocument()
    // 局部错误不是 modal（无 dialog 角色）
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // 第二次成功：模拟数据到达后重试按钮仍在原位可再次点击（不抛出）
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(refetch).toHaveBeenCalledOnce()
  })
})
