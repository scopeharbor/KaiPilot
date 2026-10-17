/**
 * 只读结果卡片族测试（v3-ui-next-ai-colleague W3 / tasks 3.4）：
 *
 * - ProjectSummaryCard：名称/代号/状态徽章/起止跨度/进度槽宽度/计数指标/诚实微标/缺字段防崩溃；
 * - TaskListCard：条目渲染（状态双通道/优先级/责任人/截止日）、截断元数据、空态与点击回调；
 * - RiskListCard：严重度双通道色彩、应对状态、责任人、评分；
 * - NavigationResultCard：目标镜头映射、项目 ID、显式回跳链接与路由跳转回调；
 * - FallbackDataCard：未知只读工具输出的键值对兜底渲染与防崩溃。
 */
import { describe, expect, test, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { NavigationResultCard } from '@/components/next/ai/cards/NavigationResultCard'
import { ProjectSummaryCard } from '@/components/next/ai/cards/ProjectSummaryCard'
import { TaskListCard } from '@/components/next/ai/cards/TaskListCard'
import { RiskListCard } from '@/components/next/ai/cards/RiskListCard'
import { FallbackDataCard } from '@/components/next/ai/cards/FallbackDataCard'
import { useNextTrackStore } from '@/stores/next-track-store'

// next/link → 纯 <a>，避免依赖 App Router context
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

describe('ProjectSummaryCard', () => {
  const summaryData = {
    id: 7,
    name: '开项核心引擎',
    code: 'ZX-ENGINE',
    status: 'active',
    priority: 'high',
    startDate: '2026-07-01',
    endDate: '2026-12-31',
    taskCount: 37,
    completedTaskCount: 25,
    progressPercent: 68,
    memberCount: 6,
  }

  test('沉浸/轻量档保留天青色微光，精确档强制关闭光晕（修补5）', () => {
    act(() => {
      useNextTrackStore.setState({ immersionTier: null })
    })
    const immersive = render(<ProjectSummaryCard data={summaryData} />)
    const immersiveFill = immersive.container.querySelector(
      '[data-summary-progress] > div',
    ) as HTMLElement
    expect(immersiveFill.style.boxShadow).toContain('0 0 6px')

    act(() => {
      useNextTrackStore.setState({ immersionTier: 'precise' })
    })
    const precise = render(<ProjectSummaryCard data={summaryData} />)
    const preciseFill = precise.container.querySelector(
      '[data-summary-progress] > div',
    ) as HTMLElement
    expect(preciseFill.style.boxShadow).toBe('')
    expect(preciseFill.style.width).toBe('68%')
    // 数据 100% 等价：精确档下进度数值与计数照常呈现（限定本容器断言）
    expect(precise.container.querySelector('[data-summary-progress-label]')?.textContent).toBe(
      '68%',
    )
    expect(precise.container.querySelector('[data-summary-progress]')).toHaveAttribute(
      'aria-valuenow',
      '68',
    )

    act(() => {
      useNextTrackStore.setState({ immersionTier: null })
    })
  })

  test('结构化渲染全部数据槽位与天青色进度槽宽度', () => {
    const { container } = render(
      <ProjectSummaryCard
        data={{
          id: 7,
          name: '开项核心引擎',
          code: 'ZX-ENGINE',
          status: 'active',
          priority: 'high',
          startDate: '2026-07-01',
          endDate: '2026-12-31',
          taskCount: 37,
          completedTaskCount: 25,
          progressPercent: 68,
          memberCount: 6,
        }}
      />,
    )

    expect(container.querySelector('[data-card="project-summary"]')).not.toBeNull()
    expect(screen.getByText('项目摘要')).toBeInTheDocument()
    expect(screen.getByText('开项核心引擎')).toBeInTheDocument()
    expect(screen.getByText('项目代号 ZX-ENGINE')).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.getByText('2026-07-01 ~ 2026-12-31')).toBeInTheDocument()

    // 进度槽宽度 = 68%
    const progress = container.querySelector('[data-summary-progress]')
    expect(progress).toHaveAttribute('aria-valuenow', '68')
    const fill = container.querySelector('[data-summary-progress] > div')
    expect(fill).toHaveStyle({ width: '68%' })

    expect(screen.getByText('37')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('任务总数')).toBeInTheDocument()
    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(screen.getByText('成员数')).toBeInTheDocument()
  })

  test('顶部恒展示「⚡ 快捷规则匹配 · get_project_summary」诚实微标', () => {
    const { container } = render(
      <ProjectSummaryCard
        data={{
          id: 1,
          name: '名称',
          code: null,
          status: 'active',
          priority: 'low',
          startDate: null,
          endDate: null,
          taskCount: 0,
          completedTaskCount: 0,
          progressPercent: 0,
          memberCount: 0,
        }}
      />,
    )
    expect(container.querySelector('[data-rule-match-badge]')).toHaveTextContent(
      '⚡ 快捷规则匹配 · get_project_summary',
    )
  })

  test('缺字段/未知状态防崩溃：回退文案与 0 值收敛', () => {
    const { container } = render(
      <ProjectSummaryCard
        data={
          {
            id: 3,
            name: '',
            code: undefined,
            status: 'weird_status',
            startDate: undefined,
            endDate: null,
            taskCount: Number.NaN,
            completedTaskCount: undefined,
            progressPercent: 250,
            memberCount: undefined,
          } as unknown as Parameters<typeof ProjectSummaryCard>[0]['data']
        }
      />,
    )

    expect(screen.getByText('未命名项目')).toBeInTheDocument()
    expect(screen.getByText('项目代号未设置')).toBeInTheDocument()
    // 未知状态回退为原始值而非崩溃
    expect(screen.getByText('weird_status')).toBeInTheDocument()
    expect(screen.getByText('起止日期未设定')).toBeInTheDocument()
    // 250% 收敛钳制到 100%（诚实呈现，绝不渲染越界进度）
    expect(screen.getByText('100%')).toBeInTheDocument()
    const fill = container.querySelector('[data-summary-progress] > div')
    expect(fill).toHaveStyle({ width: '100%' })
    // 三个计数指标均收敛为 0
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(3)
  })
})

describe('TaskListCard', () => {
  const summaryData = {
    items: [
      {
        id: 1,
        name: '核心引擎重构',
        status: 'in_progress',
        priority: 'high',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        assigneeName: '张工',
      },
      {
        id: 2,
        name: '接口联调',
        status: 'blocked',
        priority: 'urgent',
        startDate: null,
        endDate: '2026-10-05',
        assigneeId: 12,
      },
      {
        id: 3,
        name: '文档整理',
        status: 'completed',
        priority: 'low',
        startDate: null,
        endDate: null,
        assigneeName: null,
      },
      {
        id: 4,
        name: '性能压测',
        status: 'not_started',
        priority: 'medium',
        startDate: '2026-10-01',
        endDate: '2026-10-15',
        assigneeName: null,
        assigneeId: null,
      },
      {
        id: 5,
        name: '灰度发布',
        status: 'on_hold',
        priority: 'highest',
        startDate: null,
        endDate: '2026-11-01',
        assigneeName: '李工',
      },
    ],
    meta: { total: 24, page: 1, perPage: 5, totalPages: 5 },
  }

  test('条目渲染：标题/状态双通道/优先级/责任人与截止日期', () => {
    const { container } = render(<TaskListCard data={summaryData} />)

    expect(container.querySelector('[data-card="task-list"]')).not.toBeNull()
    expect(screen.getByText('核心引擎重构')).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.getByText('高')).toBeInTheDocument()
    expect(screen.getByText('张工')).toBeInTheDocument()
    // MM-DD 确定性日期短标签
    expect(screen.getByText('09-01 – 09-30')).toBeInTheDocument()

    // 阻塞任务：状态色标为冷红（双通道：色 + 文案）
    const blockedDot = container.querySelector('[data-task-status-dot][title="阻塞"]')
    expect(blockedDot).toHaveClass('bg-[var(--nx-status-danger)]')
    expect(screen.getByText('紧急')).toBeInTheDocument()
    // assigneeId 兜底回显
    expect(screen.getByText('成员 #12')).toBeInTheDocument()
    // 未分配兜底（无 assigneeName 且无 assigneeId 的条目）
    expect(screen.getAllByText('未分配').length).toBeGreaterThan(0)
    expect(screen.getByText('10-01 – 10-15')).toBeInTheDocument()
  })

  test('截断元数据「展示前 5 项，共 24 项」与空态', () => {
    const { container } = render(<TaskListCard data={summaryData} />)
    expect(container.querySelector('[data-task-list-truncate]')).toHaveTextContent(
      '展示前 5 项，共 24 项',
    )

    const { container: emptyContainer } = render(
      <TaskListCard data={{ items: [], meta: { total: 0, page: 1, perPage: 5, totalPages: 0 } }} />,
    )
    expect(emptyContainer.querySelector('[data-task-list-empty]')).toHaveTextContent(
      '当前没有符合条件的任务',
    )
  })

  test('条目点击触发 onOpenTask 回调（联动主工作面）', () => {
    const onOpenTask = vi.fn()
    const { container } = render(<TaskListCard data={summaryData} onOpenTask={onOpenTask} />)

    const itemButton = container.querySelector('[data-task-item][data-task-id="2"]')
    expect(itemButton).not.toBeNull()
    fireEvent.click(itemButton as HTMLButtonElement)
    expect(onOpenTask).toHaveBeenCalledWith(2)
  })

  test('未知任务状态/优先级回退为原始值而不崩溃', () => {
    render(
      <TaskListCard
        data={{
          items: [
            { id: 9, name: '怪状态任务', status: 'flying', priority: '??', assigneeName: '' },
          ],
          meta: { total: 1, page: 1, perPage: 5, totalPages: 1 },
        }}
      />,
    )
    expect(screen.getByText('flying')).toBeInTheDocument()
    expect(screen.getByText('??')).toBeInTheDocument()
    expect(screen.getByText('未分配')).toBeInTheDocument()
  })
})

describe('RiskListCard', () => {
  const riskData = {
    items: [
      {
        id: 1,
        riskCode: 'RK-001',
        title: '上游依赖延期风险',
        riskLevel: 'high',
        status: 'mitigating',
        score: 15,
        ownerId: 8,
      },
      {
        id: 2,
        title: '环境波动风险',
        riskLevel: 'low',
        status: 'identified',
        score: 3,
        ownerName: '王工',
      },
      {
        id: 3,
        title: '关键岗位流失风险',
        riskLevel: 'critical',
        status: 'analyzing',
        score: 21,
        ownerId: null,
      },
    ],
    meta: { total: 3, page: 1, perPage: 5, totalPages: 1 },
  }

  test('严重度双通道（冷红/琥珀/冷青 + 中文标签）、应对状态与责任人', () => {
    const { container } = render(<RiskListCard data={riskData} />)

    expect(container.querySelector('[data-card="risk-list"]')).not.toBeNull()
    expect(screen.getByText('上游依赖延期风险')).toBeInTheDocument()
    expect(screen.getByText('RK-001')).toBeInTheDocument()

    // 高风险 = 冷红语义
    const levelSpans = container.querySelectorAll('[data-risk-level]')
    expect(levelSpans[0]).toHaveTextContent('高')
    expect(levelSpans[0]).toHaveClass('text-[var(--nx-status-danger)]')
    // 低风险 = 中性冷青
    expect(levelSpans[1]).toHaveTextContent('低')
    expect(levelSpans[1]).toHaveClass('text-[var(--nx-space-cyan)]')
    // 严重风险 = 冷红（更强调）
    expect(levelSpans[2]).toHaveTextContent('严重')
    expect(levelSpans[2]).toHaveClass('text-[var(--nx-status-danger)]')

    expect(screen.getByText('应对中')).toBeInTheDocument()
    expect(screen.getByText('已识别')).toBeInTheDocument()
    expect(screen.getByText('成员 #8')).toBeInTheDocument()
    expect(screen.getByText('王工')).toBeInTheDocument()
    expect(screen.getByText('未指派')).toBeInTheDocument()
    expect(screen.getByText('评分 15')).toBeInTheDocument()
  })

  test('空态与截断元数据', () => {
    const { container } = render(
      <RiskListCard
        data={{ items: riskData.items, meta: { total: 3, page: 1, perPage: 5, totalPages: 1 } }}
      />,
    )
    expect(container.querySelector('[data-risk-list-truncate]')).toHaveTextContent(
      '展示前 3 项，共 3 项',
    )

    const { container: empty } = render(<RiskListCard data={{ items: [] }} />)
    expect(empty.querySelector('[data-risk-list-empty]')).toHaveTextContent(
      '当前没有登记的风险条目',
    )
  })
})

describe('NavigationResultCard', () => {
  test('展示导航目标信息、镜头中文映射与显式回跳链接', () => {
    const { container } = render(
      <NavigationResultCard
        data={{
          projectId: 42,
          lens: 'gantt',
          depth: 'workbench',
          targetId: null,
          path: '/projects/42/gantt',
        }}
      />,
    )

    expect(container.querySelector('[data-card="navigate"]')).not.toBeNull()
    expect(screen.getByText('已为你导航至项目 42 的甘特图镜头')).toBeInTheDocument()
    expect(screen.getByText('项目 #42')).toBeInTheDocument()
    // 景深中文回显（未臆造）
    expect(screen.getByText('工作台景深')).toBeInTheDocument()
    expect(screen.getByText('/next/projects/42?lens=gantt')).toBeInTheDocument()
    expect(container.querySelector('[data-rule-match-badge]')).toHaveTextContent(
      '⚡ 快捷规则匹配 · navigate_to_space',
    )

    const againLink = container.querySelector('[data-navigate-again]') as HTMLAnchorElement
    expect(againLink).not.toBeNull()
    expect(againLink.getAttribute('href')).toBe('/next/projects/42?lens=gantt')
  })

  test('目标实体与再次前往按钮触发路由跳转回调', () => {
    const onNavigate = vi.fn()
    const { container } = render(
      <NavigationResultCard
        data={{
          projectId: 7,
          lens: 'kanban',
          depth: 'workbench',
          targetId: 99,
          path: '/projects/7/kanban/99',
        }}
        onNavigate={onNavigate}
      />,
    )

    expect(screen.getByText('已为你导航至项目 7 的看板（目标实体 #99）镜头')).toBeInTheDocument()
    fireEvent.click(container.querySelector('[data-navigate-again]') as HTMLAnchorElement)
    // 新版入口换算成新版地址
    expect(onNavigate).toHaveBeenCalledWith('/next/projects/7?focusTask=99')
  })

  test('未知镜头/景深回退为原始值而不崩溃', () => {
    render(
      <NavigationResultCard
        data={{
          projectId: 1,
          lens: 'matrix',
          depth: 'quantum',
          targetId: null,
          path: '/projects/1/matrix',
        }}
      />,
    )
    expect(screen.getByText('已为你导航至项目 1 的matrix镜头')).toBeInTheDocument()
    expect(screen.getByText('quantum')).toBeInTheDocument()
  })

  test('risks / change_requests 镜头中文回显与新轨深层路径（v3-ui-next-risk-change-domains）', () => {
    const { container: risksContainer, unmount: unmountRisks } = render(
      <NavigationResultCard
        data={{
          projectId: 42,
          lens: 'risks',
          depth: 'workbench',
          targetId: null,
          path: '/next/projects/42/risks',
        }}
      />,
    )
    expect(screen.getByText('已为你导航至项目 42 的风险管理镜头')).toBeInTheDocument()
    expect(risksContainer.querySelector('[data-navigate-lens]')?.textContent).toBe('风险管理')
    expect(screen.getByText('/next/projects/42/risks')).toBeInTheDocument()
    expect(
      (risksContainer.querySelector('[data-navigate-again]') as HTMLAnchorElement).getAttribute(
        'href',
      ),
    ).toBe('/next/projects/42/risks')
    unmountRisks()

    const { container: crContainer } = render(
      <NavigationResultCard
        data={{
          projectId: 42,
          lens: 'change_requests',
          depth: 'workbench',
          targetId: null,
          path: '/next/projects/42/change-requests',
        }}
      />,
    )
    expect(screen.getByText('已为你导航至项目 42 的变更请求镜头')).toBeInTheDocument()
    expect(crContainer.querySelector('[data-navigate-lens]')?.textContent).toBe('变更请求')
    expect(screen.getByText('/next/projects/42/change-requests')).toBeInTheDocument()
  })

  test('resources / members / files 镜头中文回显与新轨深层路径（v3-ui-next-resource-team-domains）', () => {
    const cases: Array<{ lens: string; label: string; path: string }> = [
      { lens: 'resources', label: '资源工作台', path: '/next/projects/42/resources' },
      { lens: 'members', label: '成员与团队', path: '/next/projects/42/members' },
      { lens: 'files', label: '项目文件库', path: '/next/projects/42/files' },
    ]
    for (const item of cases) {
      const { container, unmount } = render(
        <NavigationResultCard
          data={{
            projectId: 42,
            lens: item.lens,
            depth: 'workbench',
            targetId: null,
            path: item.path,
          }}
        />,
      )
      expect(screen.getByText(`已为你导航至项目 42 的${item.label}镜头`)).toBeInTheDocument()
      expect(container.querySelector('[data-navigate-lens]')?.textContent).toBe(item.label)
      expect(screen.getByText(item.path)).toBeInTheDocument()
      expect(
        (container.querySelector('[data-navigate-again]') as HTMLAnchorElement).getAttribute(
          'href',
        ),
      ).toBe(item.path)
      unmount()
    }
  })
})

describe('FallbackDataCard（未知只读工具兜底）', () => {
  test('结构化键值对渲染嵌套数据并展示诚实微标', () => {
    const { container } = render(
      <FallbackDataCard
        toolName="some_unknown_tool"
        data={{
          name: '示例',
          count: 3,
          payload: { requestId: 'abc' },
          tags: ['a', 'b'],
          flag: true,
          empty: null,
        }}
      />,
    )

    expect(container.querySelector('[data-card="fallback-data"]')).not.toBeNull()
    expect(container.querySelector('[data-rule-match-badge]')).toHaveTextContent(
      '⚡ 快捷规则匹配 · some_unknown_tool',
    )
    expect(screen.getByText('示例')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('{"requestId":"abc"}')).toBeInTheDocument()
    expect(screen.getByText('["a","b"]')).toBeInTheDocument()
    expect(screen.getByText('true')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  test('序列化异常与超长字段均不崩溃（截断提示）', () => {
    const circular: Record<string, unknown> = { name: '循环引用' }
    circular.self = circular
    const wide = Object.fromEntries(
      Array.from({ length: 14 }, (_, index) => [`field_${index}`, index]),
    )

    render(<FallbackDataCard data={circular} />)
    expect(screen.getByText('循环引用')).toBeInTheDocument()
    // 循环引用序列化失败 → 消化为「—」
    expect(screen.getByText('—')).toBeInTheDocument()

    const { container: wideContainer } = render(<FallbackDataCard data={wide} />)
    expect(wideContainer.querySelector('[data-fallback-truncate]')).toHaveTextContent(
      '共 14 个字段，展示前 12 项',
    )
  })

  test('标量与非对象输入不抛异常', () => {
    const { container } = render(<FallbackDataCard data="plain string" />)
    expect(container.querySelector('[data-card="fallback-data"]')).not.toBeNull()
    expect(screen.getByText('plain string')).toBeInTheDocument()

    const { container: arrContainer } = render(<FallbackDataCard data={[1, 'x']} />)
    expect(arrContainer.querySelector('[data-card="fallback-data"]')).not.toBeNull()
    expect(screen.getByText('条目数')).toBeInTheDocument()
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
  })
})
describe('toNextTrackPath：新版入口的导航换算', () => {
  test('项目视图旧地址 → 新版项目空间镜头', async () => {
    const { toNextTrackPath } = await import('@/lib/next/next-track-path')
    expect(toNextTrackPath('/projects/3/wbs')).toBe('/next/projects/3?lens=wbs')
    expect(toNextTrackPath('/projects/3/kanban')).toBe('/next/projects/3')
    expect(toNextTrackPath('/projects/3/gantt/12')).toBe('/next/projects/3?lens=gantt&focusTask=12')
    expect(toNextTrackPath('/next/projects/3/risks')).toBe('/next/projects/3/risks')
    expect(toNextTrackPath('/projects/3/unknown')).toBe('/projects/3/unknown')
  })
})
