/**
 * v3-ui-next-pmo-domain W9 · tasks 9.9 —— PMO 组合层全链路端到端集成测试
 * （spec「组织级空间坐标与 AI 同事全域导航闭环」贯通场景 + design Decision 2/4/8）。
 *
 * 单一旅程贯通（跨 6 个页面 + 2 条导航通道，真实数据链：页面路由 + hooks + 全局
 * fetch 有状态伪后端；仅 mock 网络边界与 next/navigation）：
 * 1. 角色首页经空间地图坐标进入组合仪表盘：Ctrl+M 唤起 SpaceMapOverlay → 检索
 *    「组合仪表盘」→ 点击坐标卡 → router.push('/next/pmo')（无 :id 占位，全域直达）；
 * 2. 组合仪表盘 → 交通灯报告（页内下钻）→ 对红灯项目执行人工复核：
 *    必填备注 → 二次确认摘要 → POST /pmo/traffic-light/1001/review（RL-01）；
 * 3. 决策工作台：队列行 → 详情 8 面板 → 刷新证据（两步武装确认）→ readiness →
 *    人工结论提交（POST outcomes 携带指纹/审计元数据）→ 终态归档解锁受控交接；
 * 4. AI 优先级推荐：队列行 → 详情 → accept 二次确认 → POST …/:id/status（人工采纳）；
 * 5. 跨项目依赖：底册行 → 归档预览 Diff → 人工确认落库（preview → confirm 双步）；
 * 6. 影响分析：plan → run 二次确认 → 快照就绪 → 选中快照 → What-if 只读回放；
 * 7. 全旅程写请求白名单断言：每一步写都由显式人工确认入口触发，零意外写
 *    （无 DELETE/PATCH/PUT，无未列出的 POST）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { SpaceMapOverlay } from '@/components/next/navigation/SpaceMapOverlay'
import PmoPortfolioOverviewPage from '@/app/(next)/next/pmo/page'
import PmoTrafficLightPage from '@/app/(next)/next/pmo/traffic-light/page'
import PmoDecisionsPage from '@/app/(next)/next/pmo/decisions/page'
import PmoDecisionDetailPage from '@/app/(next)/next/pmo/decisions/[decisionId]/page'
import PmoAiPriorityRecommendationsPage from '@/app/(next)/next/pmo/ai-priority-recommendations/page'
import PmoDependenciesPage from '@/app/(next)/next/pmo/dependencies/page'
import PmoImpactAnalysisPage from '@/app/(next)/next/pmo/impact-analysis/page'
import {
  pmoDecisionSmallCaseFixture,
  pmoDecisionOptionFixtures,
  pmoDecisionApproveOutcomeFixture,
  pmoDecisionSnapshotSummaryFixture,
  pmoDecisionFixtureTimestamp,
  makeMultiProjectImpactPlanFixture,
  makeMultiProjectImpactSnapshotFixture,
  makeAffectedEndpointFixture,
  makePropagationPathFixture,
  makeSourceRefFixture,
  makeWhatIfOutputFixture,
} from '@aiproj/types'
import type {
  PmoDecisionCaseDTO,
  PmoDecisionOutcomeDTO,
  PmoRecommendationRecord,
  MultiProjectImpactSnapshot,
  PortfolioTrafficLightItem,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock（路径/参数受控，跨页旅程以 router.push 断言串联）
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  params: { decisionId: '101' } as Record<string, string>,
  searchParams: new URLSearchParams(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/pmo',
  useParams: () => navMock.params,
  useSearchParams: () => navMock.searchParams,
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------
const ORG_ADMIN_PERMISSIONS = [
  'portfolio:view',
  'portfolio:manage',
  'recommendation:manage',
  'pmo_decision:view',
  'pmo_decision:manage',
  'pmo_decision:decide',
  'pmo_decision:handoff',
  'pmo_decision:request_ai',
  'multi_project_impact:view',
  'multi_project_impact:manage',
]

function setAuth(permissions: string[] = ORG_ADMIN_PERMISSIONS) {
  useAuthStore.setState({
    user: {
      id: 7,
      email: 'admin@example.com',
      fullName: '组合管理员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'org_admin' }],
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

// ---------------------------------------------------------------------------
// 有状态伪后端（跨页共享：写动作推进服务器态，回读反映推进结果）
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

interface RequestRecord {
  method: string
  url: string
  body: Record<string, unknown> | null
}

const NOW = '2026-09-10T08:00:00.000Z'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

/** React Query v5 structural sharing：状态推进必须换新引用才能触发通知。 */
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function installJourneyBackend(): { records: RequestRecord[] } {
  const records: RequestRecord[] = []

  // ── 服务器态 ─────────────────────────────────────────────────────────────
  const trafficItem: PortfolioTrafficLightItem = {
    projectId: 1001,
    projectName: '开项核心引擎',
    projectStatus: 'active',
    trafficLight: 'red',
    severityCounts: { critical: 1, high: 1, medium: 0, low: 0 },
    sourceFreshness: { overallStale: false, staleSources: [], lastUpdatedAt: NOW },
    evidence: [
      {
        ruleId: 'TL-R01',
        ruleVersion: 'pmo-traffic-light-v1',
        severity: 'critical',
        status: 'red',
        message: '关键里程碑已错过 1 个',
        evidenceRefs: [],
        sourceFreshness: {
          source: 'project_dashboard',
          lastUpdatedAt: NOW,
          isStale: false,
          staleReason: null,
        },
        contributing: true,
      },
    ],
    warnings: [],
    reviewState: {
      reviewState: 'acknowledged',
      reviewedAt: null,
      reviewedBy: null,
      stale: false,
    },
    ruleVersion: 'pmo-traffic-light-v1',
    calculatedAt: NOW,
    allowedActions: { canReview: true, canViewDetail: true },
  }
  const trafficState = { reviewed: false }

  const decisionState: { status: PmoDecisionCaseDTO['status']; outcomes: PmoDecisionOutcomeDTO[] } =
    {
      status: 'under-review',
      outcomes: [],
    }
  const evidenceState = { refreshCalls: 0 }

  const recommendationState = { status: 'new' as PmoRecommendationRecord['status'] }

  const dependencyState = { status: 'active' as string, confirmCalls: 0 }

  const impactState = { snapshots: [] as MultiProjectImpactSnapshot[], plan: null as unknown }

  const route = (
    path: string,
    method: string,
    body: Record<string, unknown> | null,
  ): Response | null => {
    // ── 1. 组合仪表盘 ────────────────────────────────────────────────────
    if (path.startsWith('/pmo/portfolio-dashboard') && method === 'GET') {
      return jsonResponse(200, {
        data: {
          meta: {
            calculatedAt: NOW,
            metricVersion: 'portfolio-dashboard.v1',
            organizationId: 1,
            actorId: 7,
            visibleProjectCount: 3,
            totalProjectCount: 3,
          },
          kpis: [
            {
              key: 'total_projects',
              value: 3,
              unit: 'count',
              source: 'computed',
              status: 'ok',
              warnings: [],
            },
            {
              key: 'overall_progress_avg',
              value: 61,
              unit: 'percent',
              source: 'computed',
              status: 'ok',
              warnings: [],
            },
          ],
          trafficLight: {
            available: true,
            forbidden: false,
            redCount: 1,
            yellowCount: 1,
            greenCount: 1,
            grayCount: 0,
            warnings: [],
          },
          freshness: [],
          warnings: [{ code: 'SOURCE_STALE', message: '预测数据源已过期' }],
        },
      })
    }
    if (path.startsWith('/pmo/investment-distribution/catalogue')) {
      return jsonResponse(200, {
        data: {
          nonFinancialBasis: ['project_count'],
          unsupportedFinancialBasis: [],
          dimensions: ['project_type'],
          displayModes: ['donut'],
          topN: { default: 10, max: 20 },
          trendWindows: ['last_30_days'],
          metricVersion: 'pmo-investment-distribution.v1',
        },
      })
    }
    if (path.startsWith('/pmo/investment-distribution/trends')) {
      return jsonResponse(200, {
        meta: { calculatedAt: NOW, sourceFreshness: [] },
        data: [],
        warnings: [],
      })
    }
    if (path.startsWith('/pmo/investment-distribution')) {
      return jsonResponse(200, {
        data: {
          meta: {
            calculatedAt: NOW,
            metricVersion: 'pmo-investment-distribution.v1',
            organizationId: 1,
            actorId: 7,
            visibleProjectCount: 0,
            basis: 'project_count',
            dimension: 'project_type',
            displayMode: 'donut',
            totalBasisValue: 0,
            sourceFreshness: [],
          },
          buckets: [],
          warnings: [],
        },
      })
    }

    // ── 2. 红绿灯（列表 / 计数 / 人工复核 upsert）─────────────────────────
    if (path.startsWith('/pmo/traffic-light/counts') && method === 'GET') {
      return jsonResponse(200, {
        data: {
          red: 1,
          yellow: 0,
          green: 0,
          gray: 0,
          total: 1,
          calculatedAt: NOW,
        },
      })
    }
    if (path === '/pmo/traffic-light/1001/review' && method === 'POST') {
      trafficState.reviewed = true
      const payload = body as { reviewState?: string; note?: string }
      return jsonResponse(200, {
        data: {
          id: 501,
          projectId: 1001,
          organizationId: 1,
          actorId: 7,
          reviewState: payload?.reviewState ?? 'needs_follow_up',
          note: payload?.note ?? null,
          ruleVersion: 'pmo-traffic-light-v1',
          inputSignatureHash: 'abc123',
          stale: false,
          previousReviewState: 'acknowledged',
          createdAt: NOW,
          updatedAt: NOW,
        },
      })
    }
    if (path.startsWith('/pmo/traffic-light?') && method === 'GET') {
      const item = clone(trafficItem)
      if (trafficState.reviewed) {
        item.reviewState = {
          reviewState: 'needs_follow_up',
          reviewedAt: NOW,
          reviewedBy: 7,
          stale: false,
        }
      }
      return jsonResponse(200, {
        data: [item],
        meta: { page: 1, perPage: 20, total: 1, totalPages: 1, calculatedAt: NOW },
      })
    }

    // ── 3. 决策工作台 ───────────────────────────────────────────────────
    const CASE = '/organizations/1/pmo/decision-workbench/cases/101'
    if (path.endsWith('/pmo/decision-workbench/cases') && method === 'GET') {
      const dto: PmoDecisionCaseDTO = {
        ...pmoDecisionSmallCaseFixture(),
        status: decisionState.status,
      }
      return jsonResponse(200, {
        data: decisionState.status === 'under-review' ? [dto] : [],
        meta: {
          total: decisionState.status === 'under-review' ? 1 : 0,
          page: 1,
          perPage: 20,
          totalPages: 1,
        },
      })
    }
    if (path === CASE && method === 'GET') {
      return jsonResponse(200, {
        data: { ...pmoDecisionSmallCaseFixture(), status: decisionState.status },
      })
    }
    if (path === `${CASE}/options` && method === 'GET') {
      return jsonResponse(200, { data: pmoDecisionOptionFixtures() })
    }
    if (path === `${CASE}/positions` && method === 'GET') {
      return jsonResponse(200, { data: [] })
    }
    if (path === `${CASE}/evidence/snapshots` && method === 'GET') {
      return jsonResponse(200, {
        data: [
          pmoDecisionSnapshotSummaryFixture({ snapshotRevision: evidenceState.refreshCalls + 1 }),
        ],
      })
    }
    if (path === `${CASE}/evidence/refresh` && method === 'POST') {
      evidenceState.refreshCalls += 1
      return jsonResponse(200, { data: { refreshed: true } })
    }
    if (path === `${CASE}/comparison` && method === 'GET') {
      return jsonResponse(200, {
        data: {
          caseId: 101,
          baselineOptionId: 1,
          candidateOptionId: 2,
          cells: [
            {
              lensId: 'strategy_priority',
              measureRef: 'priority_scoring:project-11',
              baselineValue: 72.5,
              candidateValue: 81.25,
              delta: 8.75,
              comparable: true,
              notComparableReason: null,
              unit: 'score',
            },
          ],
          findings: [],
          lensVersions: [{ lensId: 'strategy_priority', version: 'v3' }],
          hasWinnerScore: false,
        },
      })
    }
    if (path === `${CASE}/outcomes` && method === 'GET') {
      return jsonResponse(200, { data: decisionState.outcomes })
    }
    if (path === `${CASE}/readiness` && method === 'POST') {
      return jsonResponse(200, {
        data: {
          ready: true,
          blockingFindings: [],
          warnings: [{ code: 'W1', message: '某可选来源过期', source: 'priority_scoring' }],
          fingerprint: {
            fingerprint: 'cafebabedeadbeef',
            issuedAt: pmoDecisionFixtureTimestamp(59),
            expiresAt: pmoDecisionFixtureTimestamp(74),
            ttlMinutes: 15,
          },
          binding: null,
          checkedAt: pmoDecisionFixtureTimestamp(59),
        },
      })
    }
    if (path === `${CASE}/outcomes` && method === 'POST') {
      const payload = body as {
        action: PmoDecisionOutcomeDTO['action']
        selectedOptionId: number | null
        rationale?: string
      }
      const outcome: PmoDecisionOutcomeDTO = {
        ...pmoDecisionApproveOutcomeFixture(),
        id: 5001,
        action: payload.action,
        selectedOptionId: payload.selectedOptionId,
        reviewFingerprint: 'cafebabedeadbeef',
        outcomeDigest: 'digest-approve-1',
        acknowledgedWarnings: ['W1'],
      }
      decisionState.outcomes.push(outcome)
      decisionState.status = 'decided'
      return jsonResponse(201, { data: outcome })
    }
    if (path === `${CASE}/handoffs` && method === 'GET') {
      return jsonResponse(200, { data: [] })
    }

    // ── 4. AI 优先级推荐 ────────────────────────────────────────────────
    if (path.includes('/pmo/ai-priority-recommendations')) {
      const recommendation = makeRecommendation(recommendationState.status)
      if (path.includes('/summary') && method === 'GET') {
        return jsonResponse(200, { data: makeRecommendationSummary(recommendationState.status) })
      }
      const detailMatch = path.match(/^\/pmo\/ai-priority-recommendations\/(\d+)$/)
      if (detailMatch && method === 'GET') {
        return jsonResponse(200, {
          data: { record: recommendation, sourceWarnings: [], conversionIntents: [] },
        })
      }
      if (path.endsWith('/status') && method === 'POST') {
        const payload = body as { action: string; reason?: string }
        recommendationState.status = payload.action === 'accept' ? 'accepted' : 'dismissed'
        return jsonResponse(200, {
          data: { record: makeRecommendation(recommendationState.status), conversionIntent: null },
        })
      }
      if (path.endsWith('/refresh') && method === 'POST') {
        return jsonResponse(200, { data: [], warnings: [], created: 0, merged: 0 })
      }
      if (method === 'GET') {
        const items = recommendationState.status === 'new' ? [clone(recommendation)] : []
        return jsonResponse(200, {
          data: items,
          meta: { total: items.length, page: 1, perPage: 20, totalPages: items.length > 0 ? 1 : 0 },
          summary: makeRecommendationSummary(recommendationState.status),
        })
      }
    }

    // ── 5. 跨项目依赖（底册 + 预览 → 确认双步）────────────────────────────
    const DEP_BASE = '/organizations/1/multi-project-dependencies'
    if (path.startsWith(DEP_BASE)) {
      if (path.includes('/preview-archive') && method === 'POST') {
        return jsonResponse(200, {
          data: {
            previewId: 'pv-archive-7',
            operation: 'archive',
            providerEndpoint: {
              endpointType: 'project',
              projectId: 1,
              projectName: '上游项目',
              redacted: false,
            },
            consumerEndpoint: {
              endpointType: 'task',
              projectId: 2,
              projectName: '下游项目',
              taskId: 301,
              taskName: '下游任务',
              redacted: false,
            },
            diff: {
              operation: 'archive',
              before: { status: 'active' },
              after: { status: 'archived' },
              changedFields: ['status'],
            },
            warningCodes: ['DEPENDENCY_STALE'],
            confirmationHash: 'hash-archive-7',
            expiresAt: NOW,
            idempotencyGuidance: '同一确认请求请复用幂等键',
          },
        })
      }
      if (path.includes('/confirm-archive') && method === 'POST') {
        dependencyState.confirmCalls += 1
        dependencyState.status = 'archived'
        return jsonResponse(200, {
          data: {
            dependency: makeDependencyRow('archived'),
            auditEventId: 'audit-archive-7',
            idempotentReplay: false,
          },
        })
      }
      if (method === 'GET' && path.split('?')[0] === DEP_BASE) {
        return jsonResponse(200, {
          data: [makeDependencyRow(dependencyState.status)],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        })
      }
    }

    // ── 6. 影响分析（列表 / plan / run / what-if）────────────────────────
    const IMPACT_BASE = '/organizations/1/multi-project-impact-analyses'
    if (path === `${IMPACT_BASE}/plan` && method === 'POST') {
      const plan = makeMultiProjectImpactPlanFixture()
      impactState.plan = plan
      return jsonResponse(200, { data: plan })
    }
    if (path === `${IMPACT_BASE}/run` && method === 'POST') {
      const snapshot = makeImpactSnapshot()
      impactState.snapshots = [snapshot]
      return jsonResponse(200, { data: snapshot })
    }
    if (path === `${IMPACT_BASE}/what-if` && method === 'POST') {
      return jsonResponse(200, {
        data: [makeWhatIfOutputFixture()],
        meta: { snapshotId: 1, snapshotHash: 'hash-1', isStale: false, staleReason: null },
      })
    }
    if (path.split('?')[0] === IMPACT_BASE && method === 'GET') {
      return jsonResponse(200, {
        data: impactState.snapshots.map((snapshot) => clone(snapshot)),
        meta: {
          total: impactState.snapshots.length,
          page: 1,
          perPage: 20,
          totalPages: impactState.snapshots.length > 0 ? 1 : 0,
        },
      })
    }
    const snapshotDetail = path.match(new RegExp(`^${IMPACT_BASE}/(\\d+)$`))
    if (snapshotDetail && method === 'GET') {
      const found = impactState.snapshots.find((s) => s.id === Number(snapshotDetail[1]))
      return found ? jsonResponse(200, { data: clone(found) }) : null
    }

    return null
  }

  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    let parsed: Record<string, unknown> | null = null
    if (typeof init?.body === 'string' && init.body !== '') {
      try {
        parsed = JSON.parse(init.body) as Record<string, unknown>
      } catch {
        parsed = null
      }
    }
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path, body: parsed })
    const matched = route(path, method, parsed)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function makeRecommendation(status: PmoRecommendationRecord['status']): PmoRecommendationRecord {
  return {
    id: 7,
    organizationId: 1,
    projectId: 1001,
    sourceType: 'traffic_light',
    sourceId: 'tl-1001',
    title: '推荐 #7：红灯项目需要管理层关注',
    summary: '交通灯信号：项目 1001 持续红灯，建议人工复核。',
    suggestedAction: '查看项目详情并评估风险',
    actionType: 'navigate',
    severity: 'critical',
    priorityContext: {
      priorityScore: 91.5,
      priorityLevel: 'critical',
      rank: 1,
      weightVersion: 'priority-scoring.v1',
      topDimensionContributors: ['delivery_urgency'],
      scoringAvailable: true,
    },
    sourceSignals: [],
    evidenceRefs: [],
    status,
    dedupeKey: 'k-7',
    inputSignature: 'sig-7',
    candidateVersion: 'pmo-ai-priority-recommendations.v1',
    warnings: [],
    aiMetadata: null,
    aiStatus: 'none',
    expiresAt: null,
    stale: false,
    staleReason: null,
    createdBy: 1,
    handledBy: null,
    handledAt: null,
    snoozedUntil: null,
    reviewReason: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function makeRecommendationSummary(status: PmoRecommendationRecord['status']) {
  return {
    totalCount: status === 'new' ? 1 : 0,
    newCount: status === 'new' ? 1 : 0,
    reviewingCount: 0,
    acceptedCount: status === 'accepted' ? 1 : 0,
    dismissedCount: status === 'dismissed' ? 1 : 0,
    convertedCount: 0,
    criticalCount: status === 'new' ? 1 : 0,
    highCount: 0,
    staleCount: 0,
    aiAvailableCount: 0,
    maxSeverity: 'critical' as const,
    scoringAvailable: true,
    scoringStale: false,
    topRecommendations: [],
    warnings: [],
    generatedAt: NOW,
  }
}

function makeDependencyRow(status: string) {
  return {
    id: 7,
    organizationId: 1,
    providerEndpoint: {
      endpointType: 'project',
      projectId: 1,
      projectName: '上游项目',
      redacted: false,
    },
    consumerEndpoint: {
      endpointType: 'task',
      projectId: 2,
      projectName: '下游项目',
      taskId: 301,
      taskName: '下游任务',
      redacted: false,
    },
    category: 'deliverable',
    type: 'fs',
    lagDays: 0,
    strength: 'hard',
    bufferDays: 2,
    status,
    riskLevel: 'high',
    sourceMode: 'manual',
    freshnessSignature: 'sig',
    freshnessCheckedAt: NOW,
    freshnessStatus: 'fresh',
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function makeImpactSnapshot(): MultiProjectImpactSnapshot {
  return makeMultiProjectImpactSnapshotFixture({
    id: 1,
    status: 'completed',
    generatedAt: NOW,
    propagationSummary: {
      propagationPaths: [
        makePropagationPathFixture({
          sourceRef: makeSourceRefFixture('project', 1, 1, '项目 Alpha'),
          affectedEndpoints: [
            makeAffectedEndpointFixture({
              endpointType: 'task',
              endpointId: 100,
              endpointLabel: '任务：前端登录页面',
              projectId: 2,
              projectLabel: '项目 Beta',
              severity: 'critical',
              affectedDimensions: ['schedule'],
            }),
          ],
        }),
      ],
      totalAffectedEndpoints: 1,
      severityDistribution: { blocker: 0, critical: 1, high: 0, medium: 0, low: 0, none: 0 },
      blockedEndpoints: 1,
      maxDepth: 2,
      averageDelayDays: 4,
    },
  })
}

// ---------------------------------------------------------------------------
// 渲染辅助
// ---------------------------------------------------------------------------
function renderPage(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    client,
    view: render(<QueryClientProvider client={client}>{node}</QueryClientProvider>),
  }
}

function writeRecords(records: RequestRecord[]): RequestRecord[] {
  // 实体搜索（POST /search）属只读检索协议（SearchFilters 请求体），不归入持久化写请求（RL-01 / 簇 J）
  return records.filter((record) => record.method !== 'GET' && !record.url.startsWith('/search'))
}

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  navMock.params = { decisionId: '101' }
  navMock.searchParams = new URLSearchParams()
  useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })
  useNextTrackStore.setState({ immersionTier: 'precise' })
  setAuth()
})

afterEach(() => {
  useNextTrackStore.setState({ immersionTier: null })
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
describe('PMO 组合层全链路（tasks 9.9）', () => {
  test('角色首页 → 空间地图坐标 → 仪表盘 → 红绿灯复核 → 决策结论 → AI 采纳 → 依赖确认 → 影响分析 What-if', async () => {
    const journey = installJourneyBackend()

    // ======================================================================
    // 1. 角色首页经空间地图坐标进入组合仪表盘（全域直达，无 :id 占位）
    // ======================================================================
    const overlayShell = renderPage(<SpaceMapOverlayHarness />)
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })
    await screen.findByRole('dialog', { name: '空间地图' })

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '组合仪表盘' } })
    const pmoCard = screen.getByRole('button', { name: /组合仪表盘/ })
    expect(pmoCard).toHaveAttribute('data-space-coordinate', 'pmo')
    expect(pmoCard).toHaveAttribute('data-status', 'available')
    fireEvent.click(pmoCard)
    expect(navMock.push).toHaveBeenCalledWith('/next/pmo')
    overlayShell.view.unmount()

    // ======================================================================
    // 2. 组合仪表盘：KPI/交通灯/告警装配 → 下钻红绿灯报告
    // ======================================================================
    const overview = renderPage(<PmoPortfolioOverviewPage />)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-portfolio-workspace]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-pmo-kpi="total_projects"]')).not.toBeNull()
    expect(document.querySelector('[data-pmo-traffic-count="red"]')?.textContent).toContain('1')
    expect(document.querySelector('[data-pmo-alert-item]')?.textContent).toContain(
      '预测数据源已过期',
    )
    expect(writeRecords(journey.records)).toHaveLength(0)

    navMock.push.mockClear()
    fireEvent.click(document.querySelector('[data-pmo-traffic-report-link]') as Element)
    expect(navMock.push).toHaveBeenCalledWith('/next/pmo/traffic-light')
    overview.view.unmount()

    // ======================================================================
    // 3. 红绿灯：管理用户对红灯项目执行人工复核（备注必填 → 二次确认 → POST）
    // ======================================================================
    const traffic = renderPage(<PmoTrafficLightPage />)
    await waitFor(() => expect(document.querySelector('[data-traffic-row="1001"]')).not.toBeNull())
    expect(document.querySelector('[data-traffic-row="1001"]')?.textContent).toContain(
      '开项核心引擎',
    )

    fireEvent.click(screen.getByLabelText('复核项目：开项核心引擎'))
    await waitFor(() =>
      expect(document.querySelector('[data-traffic-review-modal]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-review-to-confirm]') as Element)
    await waitFor(() => expect(screen.getByText('请填写复核备注后再继续')).toBeInTheDocument())
    expect(writeRecords(journey.records)).toHaveLength(0)

    fireEvent.change(document.querySelector('[data-review-state]') as HTMLElement, {
      target: { value: 'needs_follow_up' },
    })
    fireEvent.change(document.querySelector('[data-review-note]') as HTMLElement, {
      target: { value: '已与项目负责人确认，9/14 前完成关键里程碑追赶' },
    })
    fireEvent.click(document.querySelector('[data-review-to-confirm]') as Element)
    await waitFor(() => expect(document.querySelector('[data-review-summary]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-review-submit]') as Element)
    await waitFor(() => expect(document.querySelector('[data-traffic-review-modal]')).toBeNull())
    const reviewPost = writeRecords(journey.records).find((record) =>
      record.url.endsWith('/pmo/traffic-light/1001/review'),
    )
    expect(reviewPost?.body).toEqual({
      reviewState: 'needs_follow_up',
      note: '已与项目负责人确认，9/14 前完成关键里程碑追赶',
    })
    traffic.view.unmount()

    // ======================================================================
    // 4. 决策工作台：队列 → 详情 8 面板 → 刷新证据 → readiness → 人工结论
    // ======================================================================
    const decisions = renderPage(<PmoDecisionsPage />)
    await waitFor(() => expect(document.querySelector('[data-pmo-decision-row]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-pmo-decision-row]') as Element)
    expect(
      navMock.push.mock.calls.some((call) => String(call[0]).startsWith('/next/pmo/decisions/101')),
    ).toBe(true)
    decisions.view.unmount()

    const detail = renderPage(<PmoDecisionDetailPage />)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-detail-workspace]')).not.toBeNull(),
    )
    expect(screen.getByText('是否将资源从项目 A 调往项目 B')).toBeInTheDocument()
    // 8 面板装配
    await waitFor(() =>
      expect(document.querySelectorAll('[data-pmo-decision-option]')).toHaveLength(2),
    )
    expect(document.querySelector('[data-pmo-decision-comparison] table')).not.toBeNull()
    expect(document.querySelector('[data-pmo-decision-evidence-snapshot]')).not.toBeNull()
    expect(document.querySelector('[data-pmo-decision-outcome]')).not.toBeNull()
    expect(document.querySelector('[data-pmo-decision-handoff]')).toBeNull()

    // 刷新证据：两步武装确认（第一次点击不写，第二次才 POST）
    const writesBeforeRefresh = writeRecords(journey.records).length
    fireEvent.click(document.querySelector('[data-pmo-decision-evidence-refresh]') as Element)
    expect(writeRecords(journey.records)).toHaveLength(writesBeforeRefresh)
    fireEvent.click(
      document.querySelector('[data-pmo-decision-evidence-refresh-confirm]') as Element,
    )
    await waitFor(() =>
      expect(
        writeRecords(journey.records).some((record) =>
          record.url.endsWith('/cases/101/evidence/refresh'),
        ),
      ).toBe(true),
    )

    // 结论：readiness（绑定指纹）→ 二次确认 → POST outcomes（审计元数据）
    fireEvent.click(document.querySelector('[data-outcome-action="approve"]') as Element)
    await waitFor(() => expect(document.querySelector('[data-outcome-option="1"]')).not.toBeNull())
    expect(document.querySelector('[data-outcome-audit-meta]')?.textContent).toContain(
      'cafebabedeadbeef',
    )
    fireEvent.change(document.querySelector('[data-outcome-rationale]') as HTMLElement, {
      target: { value: '经组合评审确认调动方案可行，约束已交接。' },
    })
    fireEvent.click(document.querySelector('[data-pmo-decision-outcome-submit]') as Element)
    await waitFor(() => {
      const post = writeRecords(journey.records).find((record) =>
        record.url.endsWith('/cases/101/outcomes'),
      )
      expect(post?.body).toMatchObject({
        action: 'approve',
        selectedOptionId: 1,
        reviewFingerprint: 'cafebabedeadbeef',
        rationale: '经组合评审确认调动方案可行，约束已交接。',
        acknowledgedWarnings: ['W1'],
      })
    })
    // 终态归档：decided + 交接区解锁（受控下游）
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-handoff]')).not.toBeNull(),
    )
    expect(screen.getByText(/议题已决定（decided）/)).toBeInTheDocument()
    detail.view.unmount()

    // ======================================================================
    // 5. AI 优先级推荐：队列 → 详情 → accept 二次确认 → POST status
    // ======================================================================
    const aiQueue = renderPage(<PmoAiPriorityRecommendationsPage />)
    await waitFor(() => expect(document.querySelector('[data-pmo-ai-row-id="7"]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-pmo-ai-row-id="7"]') as Element)
    await waitFor(() => expect(document.querySelector('[data-pmo-ai-detail]')).not.toBeNull())

    fireEvent.click(document.querySelector('[data-pmo-ai-action="accept"]') as Element)
    await waitFor(() => expect(document.querySelector('[data-pmo-ai-confirm]')).not.toBeNull())
    const confirmDialog = document.querySelector('[data-pmo-ai-confirm]') as HTMLElement
    // 确认文案明示「不会自动执行任何项目变更」（RL-01）
    expect(confirmDialog.textContent).toContain('不会自动执行任何项目变更')
    fireEvent.click(within(confirmDialog).getByText('确认接受'))
    await waitFor(() => {
      const post = writeRecords(journey.records).find((record) =>
        record.url.endsWith('/pmo/ai-priority-recommendations/7/status'),
      )
      expect(post?.body).toEqual({ action: 'accept' })
    })
    // 采纳后队列回读为空（状态推进）
    await waitFor(() => expect(document.querySelector('[data-pmo-ai-empty]')).not.toBeNull())
    aiQueue.view.unmount()

    // ======================================================================
    // 6. 跨项目依赖：底册行 → 归档预览 Diff → 人工确认落库（preview → confirm）
    // ======================================================================
    const deps = renderPage(<PmoDependenciesPage />)
    await waitFor(() => expect(document.querySelector('[data-mpd-row-id="7"]')).not.toBeNull())
    expect(screen.getByText('上游项目')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('归档依赖 7'))
    await waitFor(() => expect(document.querySelector('[data-mpd-diff-row="状态"]')).not.toBeNull())
    // 预览 ≠ 落库：确认前零 confirm 请求
    expect(
      writeRecords(journey.records).some((record) => record.url.includes('confirm-archive')),
    ).toBe(false)
    expect(screen.getByText('确认执行 · 归档依赖')).toBeInTheDocument()
    fireEvent.click(document.querySelector('[data-mpd-confirm-execute]') as Element)
    await waitFor(() =>
      expect(
        writeRecords(journey.records).some((record) => record.url.includes('confirm-archive')),
      ).toBe(true),
    )
    await waitFor(() => expect(screen.getByText(/依赖已归档成功 · #7/)).toBeInTheDocument())
    deps.view.unmount()

    // ======================================================================
    // 7. 影响分析：plan → run 二次确认 → 快照就绪 → What-if 只读回放
    // ======================================================================
    const impact = renderPage(<PmoImpactAnalysisPage />)
    await waitFor(() => expect(document.querySelector('[data-imp-workspace]')).not.toBeNull())

    fireEvent.change(document.querySelector('[data-imp-plan-project-ids]') as HTMLElement, {
      target: { value: '1, 2' },
    })
    fireEvent.click(document.querySelector('[data-imp-plan-action]') as Element)
    await waitFor(() => expect(document.querySelector('[data-imp-plan-summary]')).not.toBeNull())
    // plan 只出计划（runToken），未产生 run 写
    expect(writeRecords(journey.records).some((record) => record.url.endsWith('/run'))).toBe(false)

    fireEvent.click(document.querySelector('[data-imp-run-open]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-imp-run-confirm-dialog]')).not.toBeNull(),
    )
    // 取消不落库
    fireEvent.click(document.querySelector('[data-imp-run-cancel]') as Element)
    expect(writeRecords(journey.records).some((record) => record.url.endsWith('/run'))).toBe(false)

    fireEvent.click(document.querySelector('[data-imp-run-open]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-imp-run-confirm-dialog]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-imp-run-confirm]') as Element)
    await waitFor(() =>
      expect(writeRecords(journey.records).some((record) => record.url.endsWith('/run'))).toBe(
        true,
      ),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-imp-snapshot-row]').length).toBe(1))

    // 选中快照 → What-if 只读回放
    fireEvent.click(screen.getByLabelText('查看快照 1 详情'))
    await waitFor(() => expect(document.querySelector('[data-imp-whatif]')).not.toBeNull())
    await waitFor(() => expect(document.querySelector('[data-imp-whatif-run]')).not.toBeNull())
    const writesBeforeWhatIf = writeRecords(journey.records).length
    fireEvent.click(document.querySelector('[data-imp-whatif-run]') as Element)
    await waitFor(() => expect(document.querySelector('[data-imp-whatif-result]')).not.toBeNull())
    expect(document.querySelector('[data-imp-whatif-hypothetical]')?.textContent).toContain(
      '假设性 · 未应用',
    )
    expect(document.querySelector('[data-imp-whatif-delta]')?.textContent).toBe('+3')
    // What-if 仅一次 POST /what-if（只读试算，无任何落库动作）
    const whatIfWrites = writeRecords(journey.records).slice(writesBeforeWhatIf)
    expect(whatIfWrites.map((record) => record.url)).toEqual([
      '/organizations/1/multi-project-impact-analyses/what-if',
    ])
    impact.view.unmount()

    // ======================================================================
    // 8. 全旅程写请求白名单：每一步都由显式人工确认入口触发，零意外写
    // ======================================================================
    const writes = writeRecords(journey.records)
    const allowed = [
      '/pmo/traffic-light/1001/review',
      '/organizations/1/pmo/decision-workbench/cases/101/evidence/refresh',
      '/organizations/1/pmo/decision-workbench/cases/101/readiness',
      '/organizations/1/pmo/decision-workbench/cases/101/outcomes',
      '/pmo/ai-priority-recommendations/7/status',
      '/organizations/1/multi-project-dependencies/preview-archive',
      '/organizations/1/multi-project-dependencies/confirm-archive',
      '/organizations/1/multi-project-impact-analyses/plan',
      '/organizations/1/multi-project-impact-analyses/run',
      '/organizations/1/multi-project-impact-analyses/what-if',
    ]
    const unexpected = writes.filter((record) => !allowed.includes(record.url))
    expect(unexpected).toEqual([])
    // 零破坏性动词：全程无 DELETE/PATCH/PUT
    expect(writes.every((record) => record.method === 'POST')).toBe(true)
    // 确无「跳过 preview 直接 confirm」：confirm-archive 恰一次且 preceded by preview
    expect(writes.filter((record) => record.url.endsWith('confirm-archive'))).toHaveLength(1)
    expect(writes.findIndex((record) => record.url.endsWith('preview-archive'))).toBeLessThan(
      writes.findIndex((record) => record.url.endsWith('confirm-archive')),
    )
    // settle 收尾：等所有挂起查询落定，避免未包裹状态更新噪声
    await act(async () => {
      await settle()
    })
  })
})

// ---------------------------------------------------------------------------
// 空间地图装配壳（Ctrl+M 唤起，与真实 NextAppShell 快捷键语义一致）
// ---------------------------------------------------------------------------
function SpaceMapOverlayHarness() {
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'm') setOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  return <SpaceMapOverlay open={open} onOpenChange={setOpen} />
}
