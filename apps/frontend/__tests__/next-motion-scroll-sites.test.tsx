/**
 * v3-motion-fallback-closure tasks 2.2 —— 3 处 JS 平滑滚动站点的偏好接线测试。
 *
 * 站点（design「统一封装与护栏」D5，行号漂移以符号名为准）：
 * 1. `components/next/gantt/WorkspaceGanttChart.tsx` focusToday 的 `el.scrollTo`
 *    —— 渲染级断言：reduce 为真 → `behavior: 'auto'`，为假 → `'smooth'`；
 * 2. `components/next/reports/PresetReportPanel.tsx` 空态 CTA 的 `scrollIntoView`
 *    —— 渲染级断言；`@/hooks/use-reports` 打桩，聚焦空态分支；
 * 3. `components/views/wbs/WbsTree.tsx` 空态「创建根节点」的 `scrollIntoView`
 *    —— **静态接线断言**（覆盖面如实登记，见下方该组测试的注释：空态分支下
 *    `scrollRef.current` 为 null，`?.` 短路使调用在 jsdom 中不可观测）。
 *
 * 断言口径只覆盖 `behavior` 取值来源；滚动目标、`block` 选项与触发时机不属于本 change。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspaceGanttChart } from '@/components/next/gantt/WorkspaceGanttChart'
import { PresetReportPanel } from '@/components/next/reports/PresetReportPanel'
import { createGanttViewStore } from '@/stores/gantt-store'
import { useAuthStore } from '@/stores/auth-store'
import type { GanttModel } from '@/lib/gantt/types'

const EPOCH_MS = Date.parse('2026-09-07T00:00:00Z')
const MS_DAY = 86_400_000

// ---------------------------------------------------------------------------
// 偏好桩：可控的 matchMedia（本 change 的偏好源 = prefers-reduced-motion: reduce）
// ---------------------------------------------------------------------------

type MatchMediaListener = (event: { matches: boolean }) => void

function installReducedMotion(reduced: boolean) {
  const listeners = new Set<MatchMediaListener>()
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: reduced,
      media: query,
      addEventListener: (_type: string, listener: MatchMediaListener) => listeners.add(listener),
      removeEventListener: (_type: string, listener: MatchMediaListener) =>
        listeners.delete(listener),
      addListener: (listener: MatchMediaListener) => listeners.add(listener),
      removeListener: (listener: MatchMediaListener) => listeners.delete(listener),
      dispatchEvent: () => false,
      onchange: null,
    })),
  )
}

/** 安装/还原滚动调用桩（jsdom 未实现 scrollTo；scrollIntoView 由 setup 提供空桩）。 */
function installScrollSpies() {
  const originalScrollTo = Element.prototype.scrollTo
  const originalScrollIntoView = Element.prototype.scrollIntoView
  const scrollToSpy = vi.fn()
  const scrollIntoViewSpy = vi.fn()
  Element.prototype.scrollTo = scrollToSpy
  Element.prototype.scrollIntoView = scrollIntoViewSpy
  return {
    scrollToSpy,
    scrollIntoViewSpy,
    restore: () => {
      Element.prototype.scrollTo = originalScrollTo
      Element.prototype.scrollIntoView = originalScrollIntoView
    },
  }
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// 站点 1：新轨甘特「定位到今天」
// ---------------------------------------------------------------------------

/** 最小确定性渲染模型（3 行任务，覆盖横向滚动目标计算即可）。 */
function ganttModel(): GanttModel {
  return {
    tasks: [
      {
        id: 1,
        name: '需求分析',
        wbsCode: '1',
        depth: 0,
        parentId: null,
        kind: 'task',
        startDay: 0,
        durationDays: 6,
        progress: 0.5,
        status: 'in_progress',
      },
      {
        id: 2,
        name: '方案设计',
        wbsCode: '2',
        depth: 0,
        parentId: null,
        kind: 'task',
        startDay: 6,
        durationDays: 8,
        progress: 0,
        status: 'not_started',
      },
    ],
    dependencies: [],
    milestones: [],
    timeRange: { startDay: 0, endDay: 60 },
    epochMs: EPOCH_MS,
  }
}

function renderGantt(reduced: boolean) {
  installReducedMotion(reduced)
  const spies = installScrollSpies()
  const utils = render(
    <WorkspaceGanttChart
      model={ganttModel()}
      store={createGanttViewStore()}
      todayMs={EPOCH_MS + 20 * MS_DAY}
      initialViewport={{ width: 600, height: 400 }}
    />,
  )
  return { ...utils, ...spies }
}

describe('站点 1：甘特「定位到今天」的 scrollTo（tasks 2.1）', () => {
  test('reduce 为真 → scrollTo 收到 behavior: "auto"（立即跳转，无平滑动画）', () => {
    const { container, scrollToSpy, restore } = renderGantt(true)
    try {
      // 首次打开会自动定位到今天（今天在项目周期内），同样遵守减少动态效果偏好
      expect(scrollToSpy).toHaveBeenLastCalledWith({ left: expect.any(Number), behavior: 'auto' })
      scrollToSpy.mockClear()
      fireEvent.click(container.querySelector('[data-gantt-today-button]')!)
      expect(scrollToSpy).toHaveBeenCalledTimes(1)
      expect(scrollToSpy).toHaveBeenCalledWith({
        left: expect.any(Number),
        behavior: 'auto',
      })
    } finally {
      restore()
    }
  })

  test('reduce 为假 → scrollTo 仍为 behavior: "smooth"（行为与现状一致）', () => {
    const { container, scrollToSpy, restore } = renderGantt(false)
    try {
      fireEvent.click(container.querySelector('[data-gantt-today-button]')!)
      expect(scrollToSpy).toHaveBeenCalledWith({
        left: expect.any(Number),
        behavior: 'smooth',
      })
    } finally {
      restore()
    }
  })
})

// ---------------------------------------------------------------------------
// 站点 2：新轨报表空态 CTA
// ---------------------------------------------------------------------------

vi.mock('@/hooks/use-reports', () => ({
  useReportList: () => ({
    data: { data: [] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useReportDetail: () => ({ data: undefined }),
  useCreateReport: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
}))

function setReportPermissions() {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions: ['report:view', 'report:create'],
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function renderReportPanel(reduced: boolean) {
  setReportPermissions()
  installReducedMotion(reduced)
  const spies = installScrollSpies()
  const utils = render(<PresetReportPanel projectId={42} />)
  return { ...utils, ...spies }
}

describe('站点 2：报表空态 CTA 的 scrollIntoView（tasks 2.1）', () => {
  test('reduce 为真 → behavior: "auto"，block 选项与现状一致（nearest）', () => {
    const { container, scrollIntoViewSpy, restore } = renderReportPanel(true)
    try {
      fireEvent.click(container.querySelector('[data-report-empty-cta]')!)
      expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1)
      expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: 'auto', block: 'nearest' })
    } finally {
      restore()
    }
  })

  test('reduce 为假 → behavior: "smooth"', () => {
    const { container, scrollIntoViewSpy, restore } = renderReportPanel(false)
    try {
      fireEvent.click(container.querySelector('[data-report-empty-cta]')!)
      expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' })
    } finally {
      restore()
    }
  })
})

// ---------------------------------------------------------------------------
// 站点 3：WBS 空态「创建根节点」——静态接线断言（覆盖面如实登记）
// ---------------------------------------------------------------------------

const WBS_TREE_SOURCE = readFileSync(
  join(process.cwd(), 'components/views/wbs/WbsTree.tsx'),
  'utf8',
)

describe('站点 3：WBS 空态「创建根节点」的 scrollIntoView（tasks 2.1）', () => {
  /**
   * 静态断言原因（任务 2.2 允许的降级口径，此处如实登记）：
   * 空态分支在 `<div ref={scrollRef}>` 之前 return，`scrollRef.current` 为 null，
   * 既有 `scrollRef.current?.scrollIntoView(...)` 被 `?.` 短路——jsdom 中**无法**
   * 观测到 `scrollIntoView` 被调用（该空态 CTA 的滚动目标在改动前即不可达，
   * 属既有事实，本 change 红线禁止改滚动目标/触发时机，故不动）。
   * 因此该站点以「统一封装 + 静态接线断言」覆盖，不虚报为渲染级覆盖。
   */
  test('组件消费 useMotionPreference 并把 behavior 交给统一封装解析', () => {
    expect(WBS_TREE_SOURCE).toMatch(
      /import\s+\{\s*useMotionPreference\s*\}\s+from\s+'@\/hooks\/use-motion-preference'/,
    )
    expect(WBS_TREE_SOURCE).toMatch(/const reducedMotion = useMotionPreference\(\)/)

    const cta = WBS_TREE_SOURCE.match(/scrollRef\.current\?\.scrollIntoView\(\{[\s\S]*?\}\)/)
    expect(cta, '未找到 WBS 空态的 scrollIntoView 调用').not.toBeNull()
    expect(cta![0]).toContain('behavior: resolveScrollBehavior(reducedMotion)')
    // 调用点不得自行读取媒体查询或硬编码平滑滚动
    expect(cta![0]).not.toMatch(/'smooth'/)
    expect(WBS_TREE_SOURCE).not.toMatch(/matchMedia|prefers-reduced-motion/)
  })
})
