/**
 * AI 同事 · 应用地图与本地动作：
 * - 应用地图直接来自界面目录（项目视图 / 空间地图 / 设置分区 / 管理后台），按权限过滤；
 * - 「带我到模型配置页面」「切成深色」「改成繁体」等交给模型理解，不在项目空间也可以；
 * - 打开页面 / 搜索 / 界面偏好在浏览器本地执行（修复：全域搜索此前被发往后端而 404）；
 * - 回答里的站内链接在当前页打开。
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  buildColleagueAppMap,
  buildColleagueUiPreferences,
  resolveAppPath,
} from '@/lib/next/ai-colleague-app-map'
import {
  parseColleagueIntent,
  shouldPlanColleagueActions,
  type ColleagueContext,
} from '@/lib/next/ai-colleague-intent'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { useUiStore } from '@/stores/ui-store'
import { getVariant, setVariant } from '@/lib/locale/variant-store'
import {
  AiColleagueLiveAnswerBubble,
  resolveInternalHref,
} from '@/components/next/ai/AiColleagueLiveAnswer'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  confirm: vi.fn(),
  plan: vi.fn(),
  search: vi.fn(),
}))
vi.mock('@/lib/api/ai-tools', () => ({
  aiToolsApi: { execute: mocks.execute, confirm: mocks.confirm, plan: mocks.plan },
  isScheduleStaleError: () => false,
}))
vi.mock('@/lib/api/search', () => ({ searchApi: { search: mocks.search } }))
vi.mock('@/lib/api/copilot', () => ({ copilotApi: { submitTurnStream: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

const homeCtx: ColleagueContext = {
  contextType: 'role_home',
  currentProjectId: null,
  pathname: '/next',
  permissions: ['ai:connection:manage'],
}
const allowAll = () => true
const allowNone = () => false

function plan(actions: unknown[]) {
  return {
    isAction: true,
    actions,
    reply: null,
    clarification: null,
    rejected: [],
    model: 'm',
    toolCallingMode: 'prompt_json',
    requestedToolCallingMode: 'prompt_json',
    fallbackReason: null,
  }
}

beforeEach(() => {
  mocks.execute.mockReset()
  mocks.plan.mockReset()
  mocks.search.mockReset()
  useNextAiColleagueStore.setState({
    conversations: [],
    conversationId: 'conv-map',
    openTabIds: ['conv-map'],
    sessionId: null,
    modelPreference: null,
    executionState: 'idle',
    messages: [],
    pendingAction: null,
    pendingTriz: null,
    actionQueue: null,
  })
})

describe('应用地图（来自界面目录）', () => {
  test('有权限时包含 AI 连接、通知、项目视图与管理后台', () => {
    const map = buildColleagueAppMap(allowAll)
    const byId = new Map(map.map((entry) => [entry.id, entry]))
    expect(byId.get('settings:ai-connections')).toMatchObject({
      title: 'AI 连接',
      group: '设置 · AI 与集成',
      path: '/next/settings/ai-connections',
    })
    expect(byId.get('space:notifications')?.path).toBe('/next/notifications')
    expect(byId.get('lens:gantt')?.path).toBe('/next/projects/:id?lens=gantt')
    expect(map.some((entry) => entry.id.startsWith('admin:'))).toBe(true)
    expect(byId.get('admin:users')?.description).toContain('Google 登录用户筛选')
    expect(byId.get('admin:users')?.description).toContain('AI 使用查看')
    expect(new Set(map.map((entry) => entry.path)).size).toBe(map.length)
  })

  test('没权限的设置分区与管理后台不出现', () => {
    const ids = buildColleagueAppMap(allowNone).map((entry) => entry.id)
    expect(ids).not.toContain('settings:ai-connections')
    expect(ids.some((id) => id.startsWith('admin:'))).toBe(false)
    expect(ids).toContain('settings:personal-profile')
  })

  test('界面偏好选项与外观菜单、文字变体一致', () => {
    const preferences = buildColleagueUiPreferences()
    expect(preferences.themes.map((option) => option.value)).toEqual(['light', 'dark', 'system'])
    expect(preferences.densities.map((option) => option.value)).toEqual(['comfortable', 'compact'])
    expect(preferences.textVariants.map((option) => option.value)).toEqual(['cn', 'tw', 'hk'])
  })

  test('resolveAppPath', () => {
    expect(resolveAppPath('/next/projects/:id/risks', 5)).toBe('/next/projects/5/risks')
    expect(resolveAppPath('/next/projects/:id/risks', null)).toBeNull()
    expect(resolveAppPath('/next/settings', null)).toBe('/next/settings')
  })
})

describe('交给模型理解的说法', () => {
  const judge = (text: string) =>
    shouldPlanColleagueActions(text, parseColleagueIntent(text, homeCtx), homeCtx)

  test('不在项目空间也可以', () => {
    expect(judge('请你带我到那个模型配置的页面')).toBe(true)
    expect(judge('切换到深色')).toBe(true)
    expect(judge('能帮我切到深色吗')).toBe(true)
    expect(judge('帮我改成繁体')).toBe(true)
    expect(judge('带我去通知')).toBe(true)
  })

  test('单纯提问仍走问答（问答会按应用地图回答在哪里）', () => {
    expect(judge('深色模式怎么开？')).toBe(false)
    expect(judge('通知在哪里')).toBe(false)
  })
})

describe('本地执行', () => {
  test('打开页面与切换界面偏好：零后端工具请求，请求带上应用地图', async () => {
    const density = useUiStore.getState().density
    const variant = getVariant()
    mocks.plan.mockResolvedValue(
      plan([
        {
          toolName: 'open_app_page',
          parameters: {
            destinationId: 'settings:ai-connections',
            title: 'AI 连接',
            path: '/next/settings/ai-connections',
          },
          summary: '打开「AI 连接」',
        },
        {
          toolName: 'set_ui_preference',
          parameters: { density: 'compact', textVariant: 'tw', theme: 'dark' },
          summary: '切换',
        },
      ]),
    )
    await useNextAiColleagueStore
      .getState()
      .submitUserMessage('带我到模型配置页面，再切成深色紧凑繁体', homeCtx)

    const request = mocks.plan.mock.calls[0]![0]
    expect(request.projectId).toBeNull()
    expect(
      request.appDestinations.some(
        (entry: { id: string }) => entry.id === 'settings:ai-connections',
      ),
    ).toBe(true)
    expect(mocks.execute).not.toHaveBeenCalled()

    const executions = useNextAiColleagueStore
      .getState()
      .messages.map((message) => message.toolExecution)
      .filter(Boolean)
    expect(executions[0]).toMatchObject({
      toolName: 'open_app_page',
      status: 'success',
      data: { path: '/next/settings/ai-connections', title: 'AI 连接' },
    })
    expect(executions[1]).toMatchObject({
      toolName: 'set_ui_preference',
      status: 'success',
      data: { theme: 'dark', labels: ['紧凑', '繁體中文（台灣）', '深色'] },
    })
    expect(useUiStore.getState().density).toBe('compact')
    expect(getVariant()).toBe('tw')

    useUiStore.getState().setDensity(density)
    setVariant(variant)
  })

  test('全域搜索在本地执行（不再发往后端），唯一命中且要前往时给出直达路径', async () => {
    mocks.search.mockResolvedValue({
      data: [
        {
          entityType: 'risk',
          entityId: 12,
          projectId: 3,
          title: '登录接口风险',
          target: '/projects/3/risks/12',
        },
      ],
    })
    mocks.plan.mockResolvedValue(
      plan([
        {
          toolName: 'search_global_entities',
          parameters: { keyword: '登录', entityTypes: ['risk'], open: true },
          summary: '搜索',
        },
      ]),
    )
    await useNextAiColleagueStore.getState().submitUserMessage('带我去登录那个风险', homeCtx)
    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: '登录', entityTypes: ['risk'] }),
    )
    expect(mocks.execute).not.toHaveBeenCalled()
    const execution = useNextAiColleagueStore.getState().messages.at(-1)?.toolExecution
    expect(execution?.status).toBe('success')
    expect(execution?.data).toMatchObject({ openPath: '/next/projects/3/risks?focusRisk=12' })
  })

  test('快捷规则命中的全域搜索同样本地执行（此前 404）', async () => {
    mocks.search.mockResolvedValue({ data: [] })
    await useNextAiColleagueStore.getState().submitUserMessage('搜索任务 支付接口', homeCtx)
    expect(mocks.search).toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(useNextAiColleagueStore.getState().messages.at(-1)?.toolExecution?.status).toBe(
      'success',
    )
  })
})

describe('回答里的站内链接', () => {
  test('resolveInternalHref', () => {
    expect(resolveInternalHref('/next/settings/ai-connections', null)).toBe(
      '/next/settings/ai-connections',
    )
    expect(resolveInternalHref('/next/projects/:id/risks', 7)).toBe('/next/projects/7/risks')
    expect(resolveInternalHref('/next/projects/:id/risks', null)).toBeNull()
    expect(resolveInternalHref('https://example.com', 7)).toBeNull()
  })

  test('站内链接不新开窗口，外部链接新开窗口', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <AiColleagueLiveAnswerBubble
          content={
            '在 [AI 连接](/next/settings/ai-connections) 配置，参考 [文档](https://example.com)'
          }
          live={{ status: 'done', modelLabel: null, webSearchRequested: false, projectId: null }}
        />
      </QueryClientProvider>,
    )
    const internal = container.querySelector('a[data-internal-link]')
    expect(internal?.getAttribute('href')).toBe('/next/settings/ai-connections')
    expect(internal?.getAttribute('target')).toBeNull()
    const external = container.querySelector('a[href="https://example.com"]')
    expect(external?.getAttribute('target')).toBe('_blank')
  })
})

describe('「我的工作」与跨项目说法', () => {
  const judge = (text: string) =>
    shouldPlanColleagueActions(text, parseColleagueIntent(text, homeCtx), homeCtx)

  test('问句形式的「我的工作」也交给模型（拿跨项目清单）', () => {
    expect(judge('我今天还有几项工作没完成？')).toBe(true)
    expect(judge('帮我排一下今天先做哪个')).toBe(true)
    expect(judge('我今天的工作做不完了')).toBe(true)
  })

  test('「第 N 个」指代上一张清单', () => {
    expect(judge('把第二个延到明天')).toBe(true)
    expect(judge('第1个标为完成')).toBe(true)
  })
})

describe('「我的工作」跟进', () => {
  test('排优先级：清单交给模型，带上一张清单顺序给后续操作', async () => {
    const copilot = await import('@/lib/api/copilot')
    const submit = copilot.copilotApi.submitTurnStream as unknown as ReturnType<typeof vi.fn>
    submit.mockReset()
    submit.mockResolvedValue(undefined)
    mocks.plan.mockResolvedValue(
      plan([
        {
          toolName: 'get_my_work',
          parameters: { filter: 'today' },
          summary: '列出我今天要处理的工作并给出优先级建议',
          followUp: 'prioritize',
        },
      ]),
    )
    mocks.execute.mockResolvedValue({
      data: {
        today: '2026-10-10',
        items: [
          {
            id: 7,
            code: 'PROJ-1#7',
            name: '接口联调',
            statusLabel: '进行中',
            dueState: 'overdue',
            overdueDays: 2,
            endDate: '2026-10-08',
            project: { id: 1, code: 'PROJ-1', name: '演示' },
            path: '/next/projects/1?focusTask=7',
          },
          {
            id: 9,
            code: 'PROJ-2#9',
            name: '写周报',
            statusLabel: '未开始',
            dueState: 'due_today',
            overdueDays: null,
            endDate: '2026-10-10',
            project: { id: 2, code: 'PROJ-2', name: '内部' },
            path: '/next/projects/2?focusTask=9',
          },
        ],
        summary: { total: 2 },
      },
      meta: { toolName: 'get_my_work', status: 'SUCCESS', durationMs: 3 },
    })
    await useNextAiColleagueStore.getState().submitUserMessage('帮我排一下今天先做哪个', homeCtx)

    expect(mocks.execute).toHaveBeenCalledWith('get_my_work', { filter: 'today' })
    expect(submit).toHaveBeenCalledTimes(1)
    const request = submit.mock.calls[0]![0] as { text: string }
    expect(request.text).toContain('优先级建议')
    expect(request.text).toContain('PROJ-1#7')
    expect(request.text).toContain('/next/projects/2?focusTask=9')

    // 下一句「把第二个延到明天」带上清单顺序
    mocks.plan.mockResolvedValue(plan([]))
    await useNextAiColleagueStore.getState().submitUserMessage('把第二个延到明天', homeCtx)
    expect(mocks.plan.mock.calls.at(-1)![0].recentTaskIds).toEqual([7, 9])
  })
})
