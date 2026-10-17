/**
 * v3-ui-next-org-portfolio-domains W8 · tasks 8.3 —— 技能矩阵工作台组件测试
 * （组件级真实数据链：hooks + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「全局资源入口、技能矩阵与问题风险入口」技能矩阵项 + tasks 8.3）：
 * - 首屏装配：KPI 条 / 覆盖率环（双通道文字）/ warning 徽标 / fresh 来源行 / 缺口表
 *   严重度徽标（色阶 + 中文文字）；初始仅 summary 一个 GET，候选/详情/下钻零请求；
 * - 缺口行「查看候选」→ candidates + skill-detail 两个只读 GET；候选卡渲染
 *   （可用/已分配/剩余容量、冲突警戒文案、匹配分）；advisory 只读提示呈现
 *   （来源标注 + advisoryOnly + 评审中 Eval 徽标）；
 * - 候选卡「下钻明细」→ drill-down GET（端点 data.items 形态）→ 下钻行与证据
 *   visibility 低敏呈现；
 * - 覆盖率行选择技能 → 候选空态与「暂无 Skill advisory」中性空态；
 * - summary 5xx → 错误卡 + 重试 refetch 成功；空数据 → 语义空态；
 * - 全部交互零写请求（所有记录 method 均为 GET，RL-01）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { SkillMatrixWorkspace } from '@/components/next/org-skill-matrix/SkillMatrixWorkspace'

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------
function setAuth() {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions: ['resource:view', 'portfolio:view'],
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

// ---------------------------------------------------------------------------
// 伪后端与夹具
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

interface RequestRecord {
  method: string
  url: string
  body: Record<string, unknown> | null
}

function installFetchRouter(route: (path: string, method: string) => Response | null): {
  records: RequestRecord[]
} {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: Record<string, unknown> | null = null
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>
      } catch {
        body = null
      }
    }
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path, body })
    const matched = route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

const META = {
  calculatedAt: '2026-09-01T08:00:00.000Z',
  metricVersion: '1.0.0',
  organizationId: 1,
  actorId: 1,
  scope: 'organization' as const,
  visibleProjectCount: 2,
  visibleResourceCount: 5,
  visibleRequirementCount: 4,
  visibleSkillCount: 3,
  dateWindow: { from: '2026-08-01', to: '2026-09-01' },
  sourceFreshness: [
    {
      source: 'project_resource' as const,
      lastUpdatedAt: '2026-09-01T07:00:00.000Z',
      stale: false,
    },
    { source: 'task_requirement' as const, lastUpdatedAt: '2026-08-28T07:00:00.000Z', stale: true },
  ],
  inputSignatureHash: 'sig-hash',
}

function normalSummary() {
  return {
    meta: META,
    overallCoverageRatio: 0.42,
    totalGaps: 2,
    totalCandidateResources: 3,
    totalSkillAdvisories: 2,
    coverageBySkill: [
      {
        skillKey: '项目管理',
        totalResources: 5,
        skilledResources: 4,
        totalAvailableCapacityHours: 240,
        totalAllocatedCapacityHours: 60,
        coverageRatio: 0.8,
        resourceCoverageRatio: 0.8,
      },
      {
        skillKey: 'react',
        totalResources: 5,
        skilledResources: 2,
        totalAvailableCapacityHours: 80,
        totalAllocatedCapacityHours: 120,
        coverageRatio: 0.4,
        resourceCoverageRatio: 0.4,
      },
    ],
    criticalGaps: [
      {
        skillKey: 'react',
        severity: 'critical',
        requirementCount: 3,
        requiredCapacityHours: 200,
        availableCapacityHours: 80,
        gapCapacityHours: 120,
        requirementSourceRefs: ['proj-1#t1', 'proj-2#t3'],
        recoverySuggestion: '建议为技能 react 补充资源或调整任务需求',
        warnings: [],
      },
      {
        skillKey: 'figma',
        severity: 'high',
        requirementCount: 1,
        requiredCapacityHours: 60,
        availableCapacityHours: 30,
        gapCapacityHours: 30,
        requirementSourceRefs: ['proj-1#t8'],
        recoverySuggestion: undefined,
        warnings: [],
      },
    ],
    warnings: [{ code: 'STALE_RESOURCE_DATA', message: '资源数据过旧', severity: 'warning' }],
  }
}

function emptySummary() {
  return {
    ...normalSummary(),
    overallCoverageRatio: 0,
    totalGaps: 0,
    totalCandidateResources: 0,
    totalSkillAdvisories: 0,
    coverageBySkill: [],
    criticalGaps: [],
    warnings: [],
  }
}

function reactCandidates() {
  return [
    {
      resourceId: 10,
      resourceName: '陈默',
      role: '前端工程师',
      availableCapacityHours: 80,
      allocatedCapacityHours: 120,
      remainingCapacityHours: -40,
      skillTags: ['react', 'typescript'],
      matchScore: 0.86,
      conflictSummary: ['react 需求窗口与现有迭代冲突'],
    },
    {
      resourceId: 11,
      resourceName: '林知微',
      role: '全栈工程师',
      availableCapacityHours: 120,
      allocatedCapacityHours: 40,
      remainingCapacityHours: 80,
      skillTags: ['react', 'node'],
      matchScore: 0.71,
      conflictSummary: [],
    },
  ]
}

function reactSkillDetail() {
  return {
    meta: META,
    skillKey: 'react',
    skillLabel: 'React 前端',
    resourceCount: 2,
    requirementCount: 3,
    coverageRatio: 0.4,
    gapSeverity: 'critical',
    resources: reactCandidates(),
    advisory: [
      {
        skillName: '前端性能调优技能',
        skillKey: 'react-performance-skill',
        skillVersion: '1.2.0',
        skillStatus: 'active',
        skillCategory: '前端',
        matchedTags: ['react'],
        matchReason: '组织存在 react 容量缺口且该 Skill 覆盖相关调优知识',
        evaluationOnly: false,
        advisoryOnly: true,
        activationApplied: false,
        drillDownUrl: null,
      },
      {
        skillName: '大型表单稳定性技能',
        skillKey: 'react-form-stability-skill',
        skillVersion: '0.9.0',
        skillStatus: 'eval',
        skillCategory: '前端',
        matchedTags: ['react', '表单'],
        matchReason: '候选 Eval Skill，评审中',
        evaluationOnly: true,
        advisoryOnly: true,
        activationApplied: false,
        drillDownUrl: null,
      },
    ],
    evidenceRefs: [],
    warnings: [],
  }
}

function createBackend(mode: 'normal' | 'empty' | 'flaky' = 'normal') {
  let summaryCalls = 0
  return {
    route: (path: string, method: string): Response | null => {
      if (method !== 'GET') return null
      if (path === '/organizations/1/resource-skill-matrix/summary') {
        summaryCalls += 1
        if (mode === 'flaky' && summaryCalls === 1) {
          return jsonResponse(500, { error: { code: 'INTERNAL', message: 'boom' } })
        }
        return jsonResponse(200, { data: mode === 'empty' ? emptySummary() : normalSummary() })
      }
      if (path.startsWith('/organizations/1/resource-skill-matrix/candidates?')) {
        const skillKey = new URLSearchParams(path.split('?')[1] ?? '').get('skillKey')
        const candidates = skillKey === 'react' ? reactCandidates() : []
        return jsonResponse(200, { data: { skillKey, candidates, meta: META } })
      }
      if (path.startsWith('/organizations/1/resource-skill-matrix/skill-detail?')) {
        const skillKey = new URLSearchParams(path.split('?')[1] ?? '').get('skillKey')
        if (skillKey !== 'react') {
          return jsonResponse(200, {
            data: {
              ...reactSkillDetail(),
              skillKey,
              skillLabel: skillKey,
              advisory: [],
              resources: [],
              gapSeverity: 'none',
            },
          })
        }
        return jsonResponse(200, { data: reactSkillDetail() })
      }
      if (path.startsWith('/organizations/1/resource-skill-matrix/drill-down?')) {
        return jsonResponse(200, {
          data: {
            items: [
              {
                itemId: 10,
                itemType: 'resource',
                itemName: '陈默',
                skillKey: 'react',
                details: reactCandidates()[0],
                evidenceRefs: [
                  {
                    source: 'project_resource',
                    refSeed: 'seed-1',
                    valueSummary: '北极星项目资源登记',
                    visibility: 'full',
                    lastUpdatedAt: '2026-09-01T07:00:00.000Z',
                  },
                  {
                    source: 'resource_pool',
                    refSeed: 'seed-2',
                    valueSummary: '',
                    visibility: 'redacted',
                    lastUpdatedAt: null,
                  },
                ],
                warnings: [],
              },
            ],
          },
          meta: META,
        })
      }
      return null
    },
  }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SkillMatrixWorkspace organizationId={1} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  setAuth()
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------

describe('SkillMatrixWorkspace：首屏装配与只读铁律（tasks 8.3）', () => {
  test('summary 到达后渲染 KPI/覆盖率环/缺口严重度徽标/warning/freshness；初始仅 summary 请求', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderWorkspace()

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '技能矩阵' })).toBeInTheDocument(),
    )
    // 覆盖率环中心文字（42%）
    await waitFor(() =>
      expect(document.querySelector('[data-skill-coverage-total]')?.textContent).toContain('42%'),
    )
    // KPI 条
    expect(document.querySelector('[data-skill-kpi="coverage"]')?.textContent).toContain('42%')
    expect(document.querySelector('[data-skill-kpi="gaps"]')?.textContent).toContain('2')
    expect(document.querySelector('[data-skill-kpi="candidates"]')?.textContent).toContain('3')
    expect(document.querySelector('[data-skill-kpi="advisories"]')?.textContent).toContain('2')
    // 覆盖行
    expect(document.querySelector('[data-skill-coverage-row="react"]')).not.toBeNull()
    // 缺口表严重度徽标（双通道文字）
    await waitFor(() =>
      expect(document.querySelector('[data-skill-gap-row="react"]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-skill-gap-severity="react"]')?.textContent).toContain(
      '严重',
    )
    expect(document.querySelector('[data-skill-gap-severity="figma"]')?.textContent).toContain('高')
    // warning 徽标
    expect(document.querySelector('[data-skill-warning="STALE_RESOURCE_DATA"]')).not.toBeNull()
    // fresh 来源行（过时 → 任务需求）
    expect(document.querySelector('[data-skill-freshness]')?.textContent).toContain('来源新鲜度')
    expect(document.querySelector('[data-skill-freshness]')?.textContent).toContain('过时')
    // 初始候选/详情面板零请求：仅 summary
    expect(records).toHaveLength(1)
    expect(records[0]?.method).toBe('GET')
    expect(records[0]?.url).toContain('/resource-skill-matrix/summary')
    expect(document.querySelector('[data-skill-detail-empty]')).not.toBeNull()
  })

  test('缺口行「查看候选」→ 候选卡与 advisory 只读提示；候选「下钻明细」→ drill-down 行；全程零写', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderWorkspace()

    await waitFor(() =>
      expect(document.querySelector('[data-skill-gap-view-candidates="react"]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-skill-gap-view-candidates="react"]') as Element)

    // 候选资源卡（陈默：剩余容量为负 → 「缺 40 小时」警戒）
    await waitFor(() =>
      expect(document.querySelector('[data-skill-candidate-card="10"]')).not.toBeNull(),
    )
    expect(screen.getByText('陈默')).toBeInTheDocument()
    expect(document.querySelector('[data-skill-candidate-remaining="10"]')?.textContent).toContain(
      '缺 40 小时',
    )
    expect(document.querySelector('[data-skill-candidate-match="10"]')?.textContent).toContain(
      '匹配 86%',
    )
    // 冲突警戒文案（琥珀双通道徽标）
    expect(document.querySelector('[data-skill-candidate-conflict="10"]')).not.toBeNull()

    // advisory 只读提示：来源标注 + advisoryOnly + 评审中 Eval
    await waitFor(() =>
      expect(document.querySelector('[data-skill-advisory-source]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-skill-advisory-source]')?.textContent).toContain('来源')
    expect(document.querySelector('[data-skill-advisory-source]')?.textContent).toContain(
      'advisoryOnly',
    )
    expect(screen.getByText('前端性能调优技能')).toBeInTheDocument()
    expect(screen.getByText('评审中 Eval')).toBeInTheDocument()

    // 下钻明细
    await waitFor(() =>
      expect(document.querySelector('[data-skill-candidate-drilldown="10"]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-skill-candidate-drilldown="10"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-skill-drilldown-row="10"]')).not.toBeNull(),
    )
    // 证据引用按 visibility 低敏呈现（full 显示低敏摘要 / redacted 仅「受限」）
    expect(document.querySelector('[data-skill-drilldown-evidence="full"]')?.textContent).toContain(
      '北极星项目资源登记',
    )
    expect(
      document.querySelector('[data-skill-drilldown-evidence="redacted"]')?.textContent,
    ).toContain('受限')

    // 请求核对：summary + candidates + skill-detail + drill-down，全部 GET
    const urls = records.map((record) => record.url)
    expect(urls.some((url) => url.includes('/resource-skill-matrix/summary'))).toBe(true)
    expect(
      urls.some((url) => url.includes('/resource-skill-matrix/candidates?skillKey=react')),
    ).toBe(true)
    expect(
      urls.some((url) => url.includes('/resource-skill-matrix/skill-detail?skillKey=react')),
    ).toBe(true)
    expect(
      urls.some(
        (url) =>
          url.includes('/resource-skill-matrix/drill-down?') &&
          url.includes('itemType=resource') &&
          url.includes('skillKey=react'),
      ),
    ).toBe(true)
    expect(records.every((record) => record.method === 'GET')).toBe(true)
  })

  test('覆盖率行选择技能 → 候选空态与「暂无 Skill advisory」中性空态（只读）', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderWorkspace()

    await waitFor(() =>
      expect(document.querySelector('[data-skill-coverage-row="项目管理"]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-skill-coverage-row="项目管理"]') as Element)

    await waitFor(() =>
      expect(document.querySelector('[data-skill-candidates-empty]')).not.toBeNull(),
    )
    expect(screen.getByText('暂无该技能的 Skill advisory')).toBeInTheDocument()
    expect(records.every((record) => record.method === 'GET')).toBe(true)
  })

  test('summary 5xx → 错误卡可重试；点击重试后 refetch 成功装配', async () => {
    const backend = createBackend('flaky')
    const { records } = installFetchRouter(backend.route)
    renderWorkspace()

    await waitFor(() => expect(document.querySelector('[data-skill-matrix-error]')).not.toBeNull())
    expect(screen.getByText('加载技能矩阵失败')).toBeInTheDocument()
    fireEvent.click(document.querySelector('[data-skill-matrix-error-retry]') as Element)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '技能矩阵' })).toBeInTheDocument(),
    )
    expect(
      records.filter((record) => record.url.includes('/resource-skill-matrix/summary')),
    ).toHaveLength(2)
  })

  test('无覆盖无缺口 → 语义空态引导', async () => {
    const backend = createBackend('empty')
    installFetchRouter(backend.route)
    renderWorkspace()

    await waitFor(() => expect(document.querySelector('[data-skill-matrix-empty]')).not.toBeNull())
    expect(screen.getByText('暂无技能数据')).toBeInTheDocument()
  })
})
