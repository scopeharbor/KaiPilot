/**
 * v3-triz-contradiction-copilot W6 · tasks 6.2 —— 项目空间「高置信信号卡」用例。
 *
 * 覆盖 tasks 6.2 验收（仅高置信出现 / 跳转上下文注入 / 证据为团队聚合口径 /
 * 卡片不遮挡核心操作）+ 读数 / 阈值 / 基期展示与证据明细抽屉：
 * - 网络层用 `vi.stubGlobal('fetch')` 伪后端（禁用 `vi.mock('@/lib/api/*')` 式自证）；
 * - 伪后端**故意忽略** `confidenceTier` 查询参数并同时下发低置信信号，
 *   以验证前端的分层守卫（低置信绝不进项目空间卡）；
 * - 「零落库」= 跳转只允许只读 AI 工具执行通道，不得出现 /confirm 或状态流转请求。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { ProjectSignalCards } from '@/components/next/signals/ProjectSignalCards'
import { useAuthStore } from '@/stores/auth-store'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { makeSolveResponse } from './_next-triz-copilot-fixtures'
import {
  installFetchRouter,
  jsonResponse,
  resetFetchRouter,
  type RequestRecord,
} from './helpers/chart-gallery-network'
import {
  makeHighSignal,
  makeSignal,
  makeSignalRouter,
  type SignalRouterOptions,
} from './helpers/project-signals-fixtures'

const PROJECT_ID = 101

const FORBIDDEN_PERSONAL_TOKENS = ['个人', '排名', '排行', '工时', '打卡', '考勤', '加班', '人均']

function setAuth(permissions: string[] = ['project:view', 'risk:view', 'ai:trigger']) {
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

/** 在信号槽位上下文内挂载组件（与容器成功态挂载形状一致）。 */
function mountCards(options: SignalRouterOptions) {
  const route = makeSignalRouter(options)
  const records = installFetchRouter((path, method) =>
    method === 'POST' && path.endsWith('/triz-copilot/analyses')
      ? jsonResponse(201, makeSolveResponse({ id: 802 }))
      : route(path, method),
  ).records
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    records,
    ...render(
      <QueryClientProvider client={client}>
        <section data-project-space-signal-slot aria-label="项目信号区域">
          <ProjectSignalCards projectId={PROJECT_ID} />
        </section>
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

describe('tasks 6.2 项目空间高置信信号卡', () => {
  test('仅高置信出现：低置信不进项目空间卡，请求按 high 分层', async () => {
    const { records } = mountCards({
      // 伪后端故意忽略分层过滤并同时下发低置信信号
      ignoreTierFilter: true,
      signalsByProject: {
        101: [
          makeHighSignal({ id: 201 }),
          makeSignal({
            id: 202,
            confidenceTier: 'low',
            signalType: 'milestone_slip',
            signalTypeLabel: '里程碑滑移',
          }),
        ],
      },
    })

    expect(await screen.findByText('风险/缺陷突变')).toBeInTheDocument()
    expect(document.querySelector('[data-project-signal-card="201"]')).not.toBeNull()
    expect(document.querySelector('[data-project-signal-card="202"]')).toBeNull()
    expect(screen.queryByText('里程碑滑移')).not.toBeInTheDocument()
    // 请求口径：只读 + 高置信 + 待处理
    expect(signalRequests(records)[0]).toContain('confidenceTier=high')
    expect(signalRequests(records)[0]).toContain('status=open')
    expect(writeRequests(records)).toHaveLength(0)
  })

  test('无高置信信号：项目空间不渲染任何信号痕迹（不占位、不遮挡）', async () => {
    const { records } = mountCards({
      signalsByProject: { 101: [makeSignal({ id: 202, confidenceTier: 'low' })] },
    })

    await waitFor(() => expect(signalRequests(records).length).toBeGreaterThan(0))
    expect(document.querySelector('[data-project-signal-cards]')).toBeNull()
    expect(document.querySelectorAll('[data-project-signal-card]')).toHaveLength(0)
    // 槽位本身仍在（成功态挂载锚点），但不产生任何卡片内容
    expect(document.querySelector('[data-project-space-signal-slot]')).not.toBeNull()
    expect(writeRequests(records)).toHaveLength(0)
  })

  test('浮卡在自身行位内：不使用 fixed / 绝对定位，不压镜头工作面', async () => {
    mountCards({ signalsByProject: { 101: [makeHighSignal({ id: 201 })] } })
    await screen.findByText('风险/缺陷突变')

    const slot = document.querySelector('[data-project-space-signal-slot]') as HTMLElement
    const cards = document.querySelector('[data-project-signal-cards]') as HTMLElement
    const card = document.querySelector('[data-project-signal-card="201"]') as HTMLElement
    for (const node of [slot, cards, card]) {
      expect(node.className).not.toMatch(/(^|\s)fixed(\s|$)/)
      expect(node.className).not.toMatch(/(^|\s)absolute(\s|$)/)
      expect(node.getAttribute('style') ?? '').not.toMatch(/position\s*:\s*(fixed|absolute)/)
    }
    // 浮卡视觉存在（阴影抬升）但不动用浮层定位
    expect(card.className).toContain('shadow-')
  })

  test('读数 / 阈值 / 基期展示在卡片上，证据为团队聚合口径且无个人维度', async () => {
    const { container } = mountCards({ signalsByProject: { 101: [makeHighSignal({ id: 201 })] } })
    await screen.findByText('风险/缺陷突变')

    const summary = document.querySelector(
      '[data-project-signal-evidence-summary="201"]',
    ) as HTMLElement
    expect(summary.textContent).toContain('活跃登记项（本期）：14')
    expect(summary.textContent).toContain('阈值：活跃登记项增幅阈值 0.5')
    expect(summary.textContent).toContain(
      '本期 2026-08-25 ~ 2026-08-31 · 基期 2026-08-18 ~ 2026-08-24',
    )
    expect(summary.textContent).toContain('覆盖 2 个周期')
    expect(summary.textContent).toContain('复合证据：风险/缺陷突变 + 进度偏差')
    // 高置信分层理由（四条件命中 4/4）
    expect(
      document.querySelector('[data-project-signal-tier-reason="201"]')?.textContent,
    ).toContain('高置信：四条件命中 4 / 4')

    const text = container.textContent ?? ''
    for (const token of FORBIDDEN_PERSONAL_TOKENS) {
      expect(text).not.toContain(token)
    }
  })

  test('证据明细抽屉：读数 / 阈值 / 基期 / 分层理由 / 实体引用计数可读', async () => {
    mountCards({ signalsByProject: { 101: [makeHighSignal({ id: 201 })] } })
    await screen.findByText('风险/缺陷突变')

    expect(document.querySelector('[data-project-signal-evidence-drawer]')).toBeNull()
    fireEvent.click(
      document.querySelector('[data-project-signal-evidence-trigger="201"]') as HTMLElement,
    )

    const drawer = await waitFor(() => {
      const node = document.querySelector('[data-project-signal-evidence-drawer]')
      if (!node) throw new Error('证据抽屉未打开')
      return node as HTMLElement
    })

    expect(drawer.textContent).toContain('风险/缺陷突变 · 证据明细')
    expect(
      drawer.querySelector('[data-project-signal-reading="activeRisksCurrent"]'),
    ).not.toBeNull()
    expect(drawer.querySelector('[data-project-signal-threshold="riskGrowthRatio"]')).not.toBeNull()
    expect(drawer.textContent).toContain(
      '本期 2026-08-25 ~ 2026-08-31 · 基期 2026-08-18 ~ 2026-08-24',
    )
    expect(drawer.textContent).toContain('窗口长度 7 天')
    // 四项分层条件逐一可读
    for (const key of ['amplitude', 'consecutive', 'completeness', 'composite']) {
      expect(drawer.querySelector(`[data-project-signal-tier-condition="${key}"]`)).not.toBeNull()
    }
    expect(drawer.textContent).toContain('已命中 · 连续 ≥ 2 个采样周期')
    expect(drawer.textContent).toContain('项目实体引用计数：登记项 3 · 缺陷 2 · 里程碑 0')
    // 团队聚合口径声明 + 抽屉为只读（无写操作控件）
    expect(drawer.textContent).toContain('团队 / 项目聚合口径')
    expect(drawer.textContent).not.toContain('确认')
    for (const token of FORBIDDEN_PERSONAL_TOKENS) {
      expect(drawer.textContent).not.toContain(token)
    }
  })

  test('证据被裁剪：给中性说明，不渲染受限读数', async () => {
    mountCards({
      signalsByProject: {
        101: [
          makeHighSignal({
            id: 201,
            evidence: null,
            evidenceRedacted: true,
            redactedReason: 'missing_permission:risk:view',
          }),
        ],
      },
    })
    await screen.findByText('风险/缺陷突变')

    const redacted = document.querySelector('[data-project-signal-redacted="201"]') as HTMLElement
    expect(redacted.textContent).toContain('证据已按权限裁剪')
    expect(document.querySelector('[data-project-signal-evidence-summary="201"]')).toBeNull()
    expect(document.querySelector('[data-project-signal-composite="201"]')).toBeNull()
  })

  test('进入矛盾求解：首条消息是「矛盾求解 + 信号编号」，零落库请求', async () => {
    const { records } = mountCards({ signalsByProject: { 101: [makeHighSignal({ id: 201 })] } })
    await screen.findByText('风险/缺陷突变')

    fireEvent.click(document.querySelector('[data-project-signal-solve="201"]') as HTMLElement)

    const state = useNextAiColleagueStore.getState()
    expect(state.isOpen).toBe(true)
    const content = state.messages[0]?.content ?? ''
    expect(state.messages[0]?.sender).toBe('user')
    // 对话里只显示一句短指令（信号编号）；读数原文不再作为用户消息发出
    expect(content).toBe('矛盾求解 PROJ-101#S201')

    await waitFor(() => {
      expect(
        useNextAiColleagueStore.getState().messages.find((m) => m.trizRun)?.trizRun?.analysisId,
      ).toBe(802)
    })
    expect(writeRequests(records)).toHaveLength(1)
    for (const request of writeRequests(records)) {
      expect(request.url).toContain('/triz-copilot/analyses')
    }
    expect(records.some((record) => record.url.includes('/confirm'))).toBe(false)
  })

  test('忽略：点击后单次 dismiss POST（只流转信号表）', async () => {
    const { records } = mountCards({ signalsByProject: { 101: [makeHighSignal({ id: 201 })] } })
    await screen.findByText('风险/缺陷突变')
    const before = signalRequests(records).length

    fireEvent.click(document.querySelector('[data-project-signal-dismiss="201"]') as HTMLElement)

    await waitFor(() => {
      expect(
        records.some(
          (record) =>
            record.method === 'POST' &&
            record.url.endsWith(`/projects/${PROJECT_ID}/signals/201/dismiss`),
        ),
      ).toBe(true)
    })
    expect(writeRequests(records)).toHaveLength(1)
    await waitFor(() => expect(signalRequests(records).length).toBeGreaterThan(before))
  })

  test('无 ai:trigger：求解按钮物理禁用，零请求零面板', async () => {
    setAuth(['project:view', 'risk:view'])
    const { records } = mountCards({ signalsByProject: { 101: [makeHighSignal({ id: 201 })] } })
    await screen.findByText('风险/缺陷突变')

    const solveButton = document.querySelector(
      '[data-project-signal-solve="201"]',
    ) as HTMLButtonElement
    expect(solveButton.disabled).toBe(true)
    fireEvent.click(solveButton)

    expect(useNextAiColleagueStore.getState().isOpen).toBe(false)
    expect(writeRequests(records)).toHaveLength(0)
  })
})
