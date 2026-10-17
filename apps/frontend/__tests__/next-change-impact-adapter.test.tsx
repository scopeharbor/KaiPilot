/**
 * v3-ui-next-risk-change-domains W2 · tasks 2.8 —— 六维影响分析暗黑仪器感适配
 * 面板解算、告警与过期检测测试。
 *
 * 覆盖（spec「六维影响深度分析面板接入」/ design Decision 5.2）：
 * - 空态触发解算：无快照时点击「开始影响分析」调用创建端点（POST
 *   /projects/:id/change-requests/:crId/impact-analyses）；
 * - 六维受影响大盘：受影响实体总数、严重度分布计数与维度摘要卡片；
 * - 关键路径触碰与阻断性告警高亮（data-change-impact-critical-path / -blocking）；
 * - 实体级穿透证据链（规则 ID、严重度、深度）渲染；
 * - isStale 过期检测：警示横幅回显 staleReason，重新评估按钮调用 refresh 端点；
 * - 无 change_impact 权限：查看受阻提示（物理隐藏）。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { ChangeImpactAnalysis } from '@/lib/api/change-requests'
import { ChangeImpactAnalysisAdapter } from '@/components/next/change-requests/ChangeImpactAnalysisAdapter'
import { useAuthStore } from '@/stores/auth-store'
import { installFetchRouter, jsonResponse, resetFetchRouter } from './helpers/chart-gallery-network'

function setAuth(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function makeAnalysis(overrides: Partial<ChangeImpactAnalysis> = {}): ChangeImpactAnalysis {
  return {
    id: 101,
    organizationId: 1,
    projectId: 42,
    changeRequestId: 7,
    status: 'completed',
    ruleVersion: 'R1.4',
    inputSignature: 'sig-20260904',
    summary: {
      totalAffected: 4,
      severityDistribution: { critical: 1, high: 2, medium: 1, low: 0, none: 0 },
      dimensionSummaries: [
        {
          dimension: 'schedule',
          affectedCount: 2,
          highestSeverity: 'high',
          topEvidence: ['关键路径任务 #8 前序延迟 4 天'],
        },
        {
          dimension: 'resource',
          affectedCount: 1,
          highestSeverity: 'medium',
          topEvidence: ['前端资源负载超过 90%'],
        },
        {
          dimension: 'scope',
          affectedCount: 1,
          highestSeverity: 'critical',
          topEvidence: ['范围基线需要变更申请'],
        },
      ],
      criticalPathAffected: true,
      hasBlockingWarnings: true,
    },
    items: [
      {
        id: 1001,
        entityType: 'task',
        entityId: 8,
        dimension: 'schedule',
        severity: 'high',
        score: 16,
        propagationPath: null,
        depth: 1,
        ruleId: 'R001',
        evidence: '核心网关任务前序依赖节点延迟 4 天，存在级联滑移风险',
        requiresReview: false,
        isVisible: true,
      },
      {
        id: 1002,
        entityType: 'task',
        entityId: 9,
        dimension: 'scope',
        severity: 'critical',
        score: 20,
        propagationPath: [
          {
            fromEntityType: 'task',
            fromEntityId: 8,
            toEntityType: 'task',
            toEntityId: 9,
            relationshipType: 'depends_on',
            relationshipId: null,
          },
        ],
        depth: 2,
        ruleId: 'R003',
        evidence: '关键路径节点 #9 依赖被阻断',
        requiresReview: true,
        isVisible: true,
      },
    ],
    warnings: [{ code: 'BLOCKING', message: '任务 #9 处于阻断状态', dimension: 'schedule' }],
    missingInputs: null,
    isStale: false,
    staleReason: null,
    aiExplanation: null,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: '2026-09-04T09:00:00.000Z',
    ...overrides,
  }
}

const listMeta = { total: 1, page: 1, perPage: 10, totalPages: 1 }

function renderAdapter(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  setAuth(['change_impact:view', 'change_impact:manage'])
})

afterEach(() => {
  resetFetchRouter()
})

describe('解算触发（空态 → 开始影响分析）', () => {
  test('无快照时点击「开始影响分析」调用创建端点', async () => {
    const { records } = installFetchRouter((path, method) => {
      if (path === '/projects/42/change-requests/7/impact-analyses' && method === 'GET') {
        return jsonResponse(200, {
          data: [],
          meta: { total: 0, page: 1, perPage: 10, totalPages: 1 },
        })
      }
      if (path === '/projects/42/change-requests/7/impact-analyses' && method === 'POST') {
        return jsonResponse(201, { data: makeAnalysis() })
      }
      return null
    })
    renderAdapter(
      <ChangeImpactAnalysisAdapter projectId={42} changeRequestId={7} currentAnalysisId={null} />,
    )
    const createButton = await screen.findByText('开始影响分析')
    fireEvent.click(createButton)
    await waitFor(() => {
      expect(
        records.some(
          (record) =>
            record.method === 'POST' &&
            record.url.endsWith('/projects/42/change-requests/7/impact-analyses'),
        ),
      ).toBe(true)
    })
  })

  test('无 change_impact 权限：渲染权限受阻提示', async () => {
    setAuth(['change_request:view'])
    const { records } = installFetchRouter(() => null)
    renderAdapter(
      <ChangeImpactAnalysisAdapter projectId={42} changeRequestId={7} currentAnalysisId={null} />,
    )
    expect(await screen.findByText(/暂无六维影响分析查看权限/)).toBeInTheDocument()
    // 权限受阻即零面板请求（列表查询同样不发出）
    expect(records).toHaveLength(0)
  })
})

describe('六维受影响大盘、告警与证据链', () => {
  function adapterBackend(analysis: ChangeImpactAnalysis) {
    return (path: string, method: string): Response | null => {
      if (path === '/projects/42/change-requests/7/impact-analyses' && method === 'GET') {
        return jsonResponse(200, { data: [analysis], meta: listMeta })
      }
      if (path === `/impact-analyses/${analysis.id}` && method === 'GET') {
        return jsonResponse(200, { data: analysis })
      }
      return null
    }
  }

  test('渲染受影响实体总数、严重度分布与维度摘要卡片', async () => {
    installFetchRouter(adapterBackend(makeAnalysis()))
    renderAdapter(
      <ChangeImpactAnalysisAdapter projectId={42} changeRequestId={7} currentAnalysisId={101} />,
    )
    // 面板标题 + 受影响统计
    expect(await screen.findByText('六维影响分析')).toBeInTheDocument()
    await waitFor(() => {
      expect(document.querySelector('[data-change-impact-total]')?.textContent).toContain('4')
    })
    // 严重度分布徽标
    expect(
      document.querySelector('[data-change-impact-severity="critical"]')?.textContent,
    ).toContain('严重 1')
    expect(document.querySelector('[data-change-impact-severity="high"]')?.textContent).toContain(
      '高 2',
    )
    // 维度卡片（进度/资源/范围）
    expect(document.querySelector('[data-change-impact-dimension="schedule"]')).not.toBeNull()
    expect(document.querySelector('[data-change-impact-dimension="resource"]')).not.toBeNull()
    expect(document.querySelector('[data-change-impact-dimension="scope"]')?.textContent).toContain(
      '最高 严重',
    )
    // 穿透证据链
    await waitFor(() => {
      expect(document.querySelector('[data-change-impact-items]')).not.toBeNull()
    })
    expect(document.querySelector('[data-change-impact-item]')?.textContent).toContain('R001')
  })

  test('关键路径触碰与阻断性告警高亮', async () => {
    installFetchRouter(adapterBackend(makeAnalysis()))
    renderAdapter(
      <ChangeImpactAnalysisAdapter projectId={42} changeRequestId={7} currentAnalysisId={101} />,
    )
    await waitFor(() => {
      const critical = document.querySelector('[data-change-impact-critical-path]')
      expect(critical?.getAttribute('data-change-impact-critical-path-value')).toBe('true')
      expect(critical?.textContent).toContain('触碰项目关键路径')
    })
    const blocking = document.querySelector('[data-change-impact-blocking]')
    expect(blocking?.getAttribute('data-change-impact-blocking-value')).toBe('true')
    expect(blocking?.textContent).toContain('存在阻断性告警')
  })

  test('未触碰关键路径的变更呈现中性标记', async () => {
    const analysis = makeAnalysis()
    analysis.summary = {
      ...analysis.summary!,
      criticalPathAffected: false,
      hasBlockingWarnings: false,
    }
    installFetchRouter(adapterBackend(analysis))
    renderAdapter(
      <ChangeImpactAnalysisAdapter projectId={42} changeRequestId={7} currentAnalysisId={101} />,
    )
    await waitFor(() => {
      expect(
        document
          .querySelector('[data-change-impact-critical-path]')
          ?.getAttribute('data-change-impact-critical-path-value'),
      ).toBe('false')
    })
    expect(screen.getByText('未触碰关键路径')).toBeInTheDocument()
    expect(document.querySelector('[data-change-impact-blocking]')).toBeNull()
  })
})

describe('过期检测与重新评估（Stale Defence）', () => {
  test('isStale 时呈现黄色警示横幅（staleReason）并可重新评估', async () => {
    const staleAnalysis = makeAnalysis({
      status: 'stale',
      isStale: true,
      staleReason: '基线任务工期已调整',
    })
    const { records } = installFetchRouter((path, method) => {
      if (path === '/projects/42/change-requests/7/impact-analyses' && method === 'GET') {
        return jsonResponse(200, { data: [staleAnalysis], meta: listMeta })
      }
      if (path === '/impact-analyses/101' && method === 'GET') {
        return jsonResponse(200, { data: staleAnalysis })
      }
      if (path === '/impact-analyses/101/refresh' && method === 'POST') {
        return jsonResponse(200, {
          data: makeAnalysis({ isStale: false, staleReason: null }),
        })
      }
      return null
    })
    renderAdapter(
      <ChangeImpactAnalysisAdapter projectId={42} changeRequestId={7} currentAnalysisId={101} />,
    )
    // 状态角标 + 过期警示文案
    await waitFor(() => {
      expect(document.querySelector('[data-change-impact-status-value]')?.textContent).toContain(
        '已过期',
      )
    })
    const banner = document.querySelector('[data-change-impact-stale]')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toContain('基线任务工期已调整')
    expect(screen.getByText('重新评估')).toBeInTheDocument()

    fireEvent.click(document.querySelector('[data-change-impact-refresh]')!)
    await waitFor(() => {
      expect(
        records.some(
          (record) =>
            record.method === 'POST' && record.url.endsWith('/impact-analyses/101/refresh'),
        ),
      ).toBe(true)
    })
  })

  test('过期快照书面确认：填写理由后提交 confirm-stale', async () => {
    const staleAnalysis = makeAnalysis({
      status: 'stale',
      isStale: true,
      staleReason: '排程已更新',
    })
    const { records } = installFetchRouter((path, method) => {
      if (path === '/projects/42/change-requests/7/impact-analyses' && method === 'GET') {
        return jsonResponse(200, { data: [staleAnalysis], meta: listMeta })
      }
      if (path === '/impact-analyses/101' && method === 'GET') {
        return jsonResponse(200, { data: staleAnalysis })
      }
      if (path === '/impact-analyses/101/confirm-stale' && method === 'POST') {
        return jsonResponse(200, { data: staleAnalysis })
      }
      return null
    })
    renderAdapter(
      <ChangeImpactAnalysisAdapter projectId={42} changeRequestId={7} currentAnalysisId={101} />,
    )
    await waitFor(() => {
      expect(document.querySelector('[data-change-impact-stale]')).not.toBeNull()
    })
    fireEvent.click(document.querySelector('[data-change-impact-stale-confirm-toggle]')!)
    await waitFor(() => {
      expect(document.querySelector('[data-change-impact-stale-reason]')).not.toBeNull()
    })
    // 未填理由时确认按钮禁用
    expect(
      (document.querySelector('[data-change-impact-stale-confirm-submit]') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    fireEvent.change(document.querySelector('[data-change-impact-stale-reason]')!, {
      target: { value: '经核对排程变化不影响本次变更范围，批准继续使用该快照' },
    })
    fireEvent.click(document.querySelector('[data-change-impact-stale-confirm-submit]')!)
    await waitFor(() => {
      expect(
        records.some(
          (record) =>
            record.method === 'POST' && record.url.endsWith('/impact-analyses/101/confirm-stale'),
        ),
      ).toBe(true)
    })
  })
})
