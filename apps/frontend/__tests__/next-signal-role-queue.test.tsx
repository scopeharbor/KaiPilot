/**
 * v3-triz-contradiction-copilot W6 · tasks 6.1 —— 角色首页「信号建议队列」用例。
 *
 * 覆盖 tasks 6.1 验收（渲染 / 空态不显示任何占位或示例数据 / 权限裁剪 /
 * 错误态可辨识不被吞成空态）+ 低打扰与禁个人维度断言
 * （spec「低打扰与禁个人监控」「建议队列与信号卡的承载边界」）：
 * - 网络层用 `vi.stubGlobal('fetch')` 伪后端（禁用 `vi.mock('@/lib/api/*')` 式自证）；
 * - 低打扰 = 渲染不弹窗、不推送、不自动打开面板、零 AI 请求；
 * - 禁个人维度 = 渲染 DOM 中不出现任何个人维度度量或排名用语。
 */
import * as React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { RoleSignalQueue } from '@/components/next/signals/RoleSignalQueue'
import { RoleHomeContainer } from '@/components/next/home/RoleHomeContainer'
import { useAuthStore } from '@/stores/auth-store'
import { matchSignalSolveRequest, useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { makeSolveResponse } from './_next-triz-copilot-fixtures'
import {
  installFetchRouter,
  jsonResponse,
  resetFetchRouter,
  type RequestRecord,
} from './helpers/chart-gallery-network'
import {
  makeSignal,
  makeSignalEvidence,
  makeSignalRouter,
  type SignalRouterOptions,
} from './helpers/project-signals-fixtures'

const PROJECT_ID = 101

/** 个人维度度量 / 排名的禁用用语（design D9 ③ / spec「低打扰与禁个人监控」第 2 条）。 */
const FORBIDDEN_PERSONAL_TOKENS = ['个人', '排名', '排行', '工时', '打卡', '考勤', '加班', '人均']

function setAuth(permissions: string[] = ['project:view', 'task:view', 'ai:trigger']) {
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

function mountQueue(route: Parameters<typeof installFetchRouter>[0]) {
  const records = installFetchRouter(route).records
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    records,
    ...render(
      <QueryClientProvider client={client}>
        <RoleSignalQueue />
      </QueryClientProvider>,
    ),
  }
}

function signalRequests(records: RequestRecord[]): string[] {
  return records.filter((record) => /\/signals/.test(record.url)).map((record) => record.url)
}

function writeRequests(records: RequestRecord[]): RequestRecord[] {
  return records.filter((record) => record.method !== 'GET')
}

/** 读取产品源码（承载边界静态断言用；相对 vitest 根 = apps/frontend）。 */
function readSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

/** 剥离注释后再做红线扫描：禁令针对代码（数据源引用），说明性注释不算。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

beforeEach(() => {
  resetFetchRouter()
  setAuth()
  useNextAiColleagueStore.setState({
    isOpen: false,
    messages: [],
    executionState: 'idle',
    context: null,
  })
})

describe('tasks 6.1 角色首页信号建议队列', () => {
  test('渲染：跨项目低置信信号列表含类型 / 严重度双通道 / 项目 / 证据摘要 / 分层理由', async () => {
    const options: SignalRouterOptions = {
      signalsByProject: {
        101: [
          makeSignal({ id: 12, projectId: 101 }),
          // 高置信不得出现在队列（同一信号不同时出现在两处）
          makeSignal({ id: 13, projectId: 101, confidenceTier: 'high' }),
        ],
        102: [
          makeSignal({
            id: 77,
            projectId: 102,
            signalType: 'milestone_slip',
            signalTypeLabel: '里程碑滑移',
            requiredPermission: 'milestone:view',
            evidence: makeSignalEvidence({
              metric: 'milestone_schedule_slip',
              readings: {
                metric: 'milestone_schedule_slip',
                cumulativeSlipDays: 9,
                maxSlipDays: 6,
                slippedMilestoneCount: 2,
                milestoneCount: 6,
                coveredCycles: 1,
              },
              thresholds: { cumulativeDays: 7, singleDays: 14 },
              hitConditions: ['milestone_slip'],
              entityRefs: { milestones: [31, 32] },
            }),
          }),
        ],
      },
    }
    const { records } = mountQueue(makeSignalRouter(options))

    expect(await screen.findByText('进度偏差')).toBeInTheDocument()
    expect(screen.getByText('里程碑滑移')).toBeInTheDocument()
    // 两个项目各一条低置信；高置信不进队列
    expect(document.querySelectorAll('[data-role-signal-item]')).toHaveLength(2)
    expect(document.querySelector('[data-role-signal-item="13"]')).toBeNull()
    // 严重度双通道（文字 + 颜色令牌）
    const severity = document.querySelector('[data-role-signal-severity="12"]') as HTMLElement
    expect(severity.textContent).toBe('关注')
    expect(severity.className).toContain('--nx-status-warning')
    // 证据摘要：读数 / 阈值参考线 / 基期 / 覆盖周期
    const evidenceBlock = document.querySelector('[data-role-signal-evidence="12"]') as HTMLElement
    expect(evidenceBlock.textContent).toContain('排程绩效指数 SPI：0.91')
    expect(evidenceBlock.textContent).toContain('阈值参考线：SPI 滞后线 0.95')
    expect(evidenceBlock.textContent).toContain(
      '本期 2026-08-25 ~ 2026-08-31 · 基期 2026-08-18 ~ 2026-08-24',
    )
    expect(evidenceBlock.textContent).toContain('覆盖 2 个周期')
    // 分层理由（为什么是低置信）
    const tierReason = document.querySelector('[data-role-signal-tier-reason="12"]') as HTMLElement
    expect(tierReason.textContent).toContain('低置信')
    expect(tierReason.textContent).toContain('连续 ≥ 2 个采样周期')
    // 项目归属可跳转
    expect(document.querySelector('[data-role-signal-project="12"]')?.getAttribute('href')).toBe(
      '/next/projects/101',
    )

    // 请求口径：单次请求组织级端点，且全部为只读 GET
    const orgSignalCalls = records.filter((record) =>
      record.url.includes('/organizations/1/signals'),
    )
    expect(orgSignalCalls).toHaveLength(1)
    expect(orgSignalCalls[0]?.url).toContain('confidenceTier=low')
    expect(orgSignalCalls[0]?.url).toContain('status=open')
    expect(records.some((record) => record.url.includes('/projects?sort=-updatedAt'))).toBe(false)
    expect(document.querySelector('[data-role-signal-queue-coverage]')).toBeNull()
    expect(document.body.textContent).not.toContain('已覆盖最近')
    expect(writeRequests(records)).toHaveLength(0)
  })

  test('空态：呈现明确文案，不显示任何占位或示例信号数据', async () => {
    const { container, records } = mountQueue(
      makeSignalRouter({ signalsByProject: { 101: [], 102: [] } }),
    )

    const empty = await waitFor(() => {
      const node = container.querySelector('[data-role-signal-queue-empty]')
      if (!node) throw new Error('空态未渲染')
      return node as HTMLElement
    })

    expect(empty.textContent).toContain('当前没有待查看的低置信信号')
    expect(container.querySelectorAll('[data-role-signal-item]')).toHaveLength(0)
    expect(container.querySelector('[data-role-signal-queue-list]')).toBeNull()
    // 空态不得含占位 / 示例数据字样，也不得伪造读数
    expect(empty.textContent).not.toMatch(/示例|占位|demo|样例|0\.91/)
    expect(empty.textContent).not.toMatch(/SPI|阈值/)
    // 空态不是错误态
    expect(container.querySelector('[data-role-signal-queue-error]')).toBeNull()
    expect(writeRequests(records)).toHaveLength(0)
  })

  test('权限裁剪：证据被裁剪的信号只给中性说明，不渲染受限读数', async () => {
    const { container } = mountQueue(
      makeSignalRouter({
        signalsByProject: {
          101: [
            makeSignal({
              id: 31,
              signalType: 'risk_surge',
              signalTypeLabel: '风险/缺陷突变',
              requiredPermission: 'risk:view',
              evidence: null,
              evidenceRedacted: true,
              redactedReason: 'missing_permission:risk:view',
            }),
          ],
          102: [],
        },
      }),
    )

    expect(await screen.findByText('风险/缺陷突变')).toBeInTheDocument()
    const redacted = container.querySelector('[data-role-signal-redacted="31"]') as HTMLElement
    expect(redacted.textContent).toContain('证据已按权限裁剪')
    expect(redacted.textContent).toContain('risk:view')
    // 受限读数既不渲染也不出现在 DOM 文本里
    expect(container.querySelector('[data-role-signal-evidence="31"]')).toBeNull()
    const item = container.querySelector('[data-role-signal-item="31"]') as HTMLElement
    expect(item.textContent).not.toContain('活跃登记项')
    expect(item.textContent).not.toContain('14')
  })

  test('错误态可辨识：读取失败不被吞成空态，可重新载入', async () => {
    const { container, records } = mountQueue(
      makeSignalRouter({
        signalsByProject: { 101: [], 102: [] },
        signalsStatus: 500,
        signalsError: { code: 'INTERNAL_ERROR', message: '雷达服务暂不可用' },
      }),
    )

    const errorBlock = await waitFor(() => {
      const node = container.querySelector('[data-role-signal-queue-error]')
      if (!node) throw new Error('错误态未渲染')
      return node as HTMLElement
    })

    expect(errorBlock.getAttribute('role')).toBe('alert')
    expect(errorBlock.textContent).toContain('信号读取失败')
    expect(errorBlock.textContent).toContain('雷达服务暂不可用')
    expect(container.querySelector('[data-role-signal-queue-empty]')).toBeNull()
    expect(container.querySelectorAll('[data-role-signal-item]')).toHaveLength(0)

    const before = signalRequests(records).length
    fireEvent.click(container.querySelector('[data-role-signal-retry]') as HTMLElement)
    await waitFor(() => expect(signalRequests(records).length).toBeGreaterThan(before))
  })

  test('低打扰：渲染不弹窗、不推送、不自动打开面板、零 AI 请求', async () => {
    const { container, records } = mountQueue(
      makeSignalRouter({ signalsByProject: { 101: [makeSignal({ id: 12 })], 102: [] } }),
    )
    await screen.findByText('进度偏差')

    // 不弹窗 / 不打断
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    // 不自动打开 AI 同事面板，也不发起任何 AI 工具请求
    expect(useNextAiColleagueStore.getState().isOpen).toBe(false)
    expect(useNextAiColleagueStore.getState().messages).toHaveLength(0)
    expect(records.some((record) => record.url.includes('/ai/tools'))).toBe(false)
    // 队列本身是内容区而非模态
    expect(container.querySelector('[data-role-signal-queue]')).not.toBeNull()
  })

  test('禁个人维度：DOM 文本与属性中不出现个人度量或排名', async () => {
    const { container } = mountQueue(
      makeSignalRouter({
        signalsByProject: {
          101: [
            makeSignal({ id: 12 }),
            makeSignal({
              id: 41,
              signalType: 'resource_overload',
              signalTypeLabel: '资源负载过载',
              requiredPermission: 'resource:view',
              evidence: makeSignalEvidence({
                metric: 'resource_allocation_overload',
                readings: {
                  metric: 'resource_allocation_overload',
                  overloadRatioPercent: 37,
                  overloadedResourceCount: 3,
                  resourceCount: 8,
                  teamAverageUtilizationPercent: 96,
                  overloadedHours: 24,
                },
                thresholds: { referencePercent: 100, ratioPercent: 25, countMin: 2 },
                hitConditions: ['resource_overload'],
                compositeTypes: ['resource_overload'],
                entityRefs: {},
              }),
            }),
          ],
          102: [],
        },
      }),
    )
    await screen.findByText('资源负载过载')

    const text = container.textContent ?? ''
    for (const token of FORBIDDEN_PERSONAL_TOKENS) {
      expect(text).not.toContain(token)
    }

    const attributes = Array.from(container.querySelectorAll('*')).flatMap((node) =>
      Array.from(node.attributes).map((attribute) => attribute.name),
    )
    for (const name of attributes) {
      expect(name).not.toMatch(/person|assignee|member|ranking|rank_|user_id|overtime|attendance/i)
    }
    // 聚合口径证据照常可读（不是靠不渲染证据来「通过」）
    expect(document.querySelector('[data-role-signal-evidence="41"]')?.textContent).toContain(
      '超载占比（%）：37',
    )
  })

  test('忽略：点击后单次 dismiss POST（信号表流转，非业务表写入）', async () => {
    const { records } = mountQueue(
      makeSignalRouter({ signalsByProject: { 101: [makeSignal({ id: 12 })], 102: [] } }),
    )
    await screen.findByText('进度偏差')
    const before = signalRequests(records).length

    fireEvent.click(document.querySelector('[data-role-signal-dismiss="12"]') as HTMLElement)

    await waitFor(() => {
      expect(
        records.some(
          (record) =>
            record.method === 'POST' &&
            record.url.endsWith(`/projects/${PROJECT_ID}/signals/12/dismiss`),
        ),
      ).toBe(true)
    })
    const posts = writeRequests(records)
    expect(posts).toHaveLength(1)
    // 成功后失效列表缓存 → 重新读取（读取仍是只读 GET）
    await waitFor(() => expect(signalRequests(records).length).toBeGreaterThan(before))
  })

  test('进入矛盾求解：面板打开且首条消息是信号编号指令，零落库请求', async () => {
    const route = makeSignalRouter({ signalsByProject: { 101: [makeSignal({ id: 12 })], 102: [] } })
    const { records } = mountQueue((path, method) =>
      method === 'POST' && path.endsWith('/projects/101/triz-copilot/analyses')
        ? jsonResponse(201, makeSolveResponse({ id: 801 }))
        : route(path, method),
    )
    await screen.findByText('进度偏差')

    fireEvent.click(document.querySelector('[data-role-signal-solve="12"]') as HTMLElement)

    const state = useNextAiColleagueStore.getState()
    expect(state.isOpen).toBe(true)
    const first = state.messages[0]
    expect(first?.sender).toBe('user')
    const content = first?.content ?? ''
    // 对话里只显示「矛盾求解 + 信号编号」，由 store 直接对该信号求解（不经意图规则 / 模型理解）
    expect(content).toBe('矛盾求解 PROJ-101#S12')
    expect(matchSignalSolveRequest(content)).toEqual({ signalId: 12, projectCode: 'PROJ-101' })

    await waitFor(() => {
      expect(
        useNextAiColleagueStore.getState().messages.find((m) => m.trizRun)?.trizRun?.analysisId,
      ).toBe(801)
    })
    expect(useNextAiColleagueStore.getState().context?.permissions).toContain('ai:trigger')
    expect(writeRequests(records)).toHaveLength(1)
    // 仅提交 AI 分析；不确认业务写入，也不改变信号状态。
    for (const request of writeRequests(records)) {
      expect(request.url).toContain('/triz-copilot/analyses')
    }
  })

  test('无 ai:trigger：求解按钮物理禁用，零请求零面板', async () => {
    setAuth(['project:view', 'task:view'])
    const { records } = mountQueue(
      makeSignalRouter({ signalsByProject: { 101: [makeSignal({ id: 12 })], 102: [] } }),
    )
    await screen.findByText('进度偏差')

    const solveButton = document.querySelector('[data-role-signal-solve="12"]') as HTMLButtonElement
    expect(solveButton.disabled).toBe(true)
    fireEvent.click(solveButton)

    expect(useNextAiColleagueStore.getState().isOpen).toBe(false)
    expect(useNextAiColleagueStore.getState().messages).toHaveLength(0)
    expect(writeRequests(records)).toHaveLength(0)
  })

  test('挂载于角色首页：队列区落在建议卡槽之后，骨架卡槽零改动', async () => {
    const route = makeSignalRouter({ signalsByProject: { 101: [makeSignal({ id: 12 })], 102: [] } })
    installFetchRouter(route)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={client}>
        <RoleHomeContainer />
      </QueryClientProvider>,
    )

    await screen.findByText('进度偏差')
    const home = container.querySelector('[data-role-home]') as HTMLElement
    const cards = container.querySelector('[data-role-suggestion-cards]') as HTMLElement
    const queue = container.querySelector('[data-role-signal-queue]') as HTMLElement
    expect(cards).not.toBeNull()
    expect(queue).not.toBeNull()
    // 追加式：建议卡槽在前，信号队列在后
    expect(cards.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelectorAll('[data-role-suggestion-slot]')).toHaveLength(3)
    expect(home.contains(queue)).toBe(true)
  })

  test('承载边界静态断言：两处共用一份数据契约，无个人维度维度词与禁用数据源', () => {
    const sources = [
      'lib/api/project-signals.ts',
      'hooks/use-project-signals.ts',
      'lib/next/signals/signal-presentation.ts',
      'lib/next/signals/signal-solver-handoff.ts',
      'components/next/signals/RoleSignalQueue.tsx',
      'components/next/signals/ProjectSignalCards.tsx',
    ].map((file) => ({ file, source: readSource(file) }))

    // ① 单一读接口：两处承载都不得自拼信号端点或直接发请求（D10）
    const componentSources = sources.filter((entry) => entry.file.startsWith('components/'))
    for (const { file, source } of componentSources) {
      expect(`${file}:apiFetch=${/apiFetch/.test(source)}`).toBe(`${file}:apiFetch=false`)
      expect(`${file}:endpoint=${/['"`]\/projects\//.test(source)}`).toBe(`${file}:endpoint=false`)
      expect(source).toContain('@/lib/next/signals/signal-presentation')
      expect(source).toContain('@/hooks/use-project-signals')
      expect(source).toContain('@/lib/next/signals/signal-solver-handoff')
    }
    // ③ 禁用数据源（打卡 / 考勤 / 签到 / 独立工时日志，AGENTS.md §6）：
    //    代码层零引用（注释里的红线说明不计）；个人维度度量的禁令在 DOM 层用例中按渲染结果断言。
    for (const { file, source } of sources) {
      const code = stripComments(source)
      for (const token of ['打卡', '考勤', '签到', '工时日志', 'timesheet', 'attendance']) {
        expect(`${file}#${token}:${code.includes(token)}`).toBe(`${file}#${token}:false`)
      }
    }
    // ④ 双轨隔离：新轨承载不得 import 旧轨 TRIZ / copilot 组件
    for (const { file, source } of sources) {
      expect(`${file}:${/from ['"]@\/components\/(triz|copilot)\//.test(source)}`).toBe(
        `${file}:false`,
      )
    }
  })
})
