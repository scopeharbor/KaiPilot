import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ClarificationAnswers, ClarificationCard } from '@aiproj/types'
import { PermissionGuard } from '@/components/PermissionGuard'
import { TheaterPermissionFallback } from '@/components/next/theater/TheaterPermissionFallback'
import { TheaterShell } from '@/components/next/theater/TheaterShell'
import { useAuthStore } from '@/stores/auth-store'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import NextCreatePage from '@/app/(next)/next/create/page'
import { asMock } from './_mock-types'

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/create',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

const defaultMatchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
}))

function resetAuth() {
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    permissions: [],
    currentOrganizationId: null,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function setPermissions(permissions: string[], isSuperAdmin = false) {
  resetAuth()
  useAuthStore.setState({
    permissions,
    user: {
      id: 1,
      email: 'user@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
      ...(isSuperAdmin ? { isSuperAdmin: true } : {}),
    },
  })
}

beforeEach(() => {
  routerPush.mockClear()
  resetAuth()
  useNextTrackStore.getState().reset()
  window.matchMedia = defaultMatchMedia
  document.documentElement.removeAttribute('data-immersion')
})

describe('components/next/theater/TheaterShell（v3-ui-next-theater-intent-clarify D1/D6 / 任务 1.1）', () => {
  test('全屏固定视口：nx-space-atmosphere + 令牌底色 + inset 撑满视口，零画布节点', () => {
    const { container } = render(<TheaterShell>剧场内容</TheaterShell>)

    const shell = container.querySelector('[data-theater-shell]') as HTMLElement
    expect(shell).toBeTruthy()
    const classes = shell.className
    expect(classes).toContain('nx-space-atmosphere')
    expect(classes).toContain('fixed')
    expect(classes).toContain('inset-0')
    expect(classes).toContain('bg-[var(--nx-space-bg)]')
    expect(screen.getByText('剧场内容')).toBeInTheDocument()
    expect(container.querySelector('canvas')).toBeNull()
  })

  test('沉浸档（默认）：外壳回显 data-immersion="immersive"，html 同步沉浸档', () => {
    const { container } = render(<TheaterShell />)

    expect(container.querySelector('[data-theater-shell]')?.getAttribute('data-immersion')).toBe(
      'immersive',
    )
    expect(document.documentElement.getAttribute('data-immersion')).toBe('immersive')
  })

  test('轻量档：保留氛围基座与光晕类，档位回显 light', () => {
    useNextTrackStore.getState().setImmersionTier('light')
    const { container } = render(<TheaterShell />)

    const shell = container.querySelector('[data-theater-shell]') as HTMLElement
    expect(shell.getAttribute('data-immersion')).toBe('light')
    expect(shell.className).toContain('nx-space-atmosphere')
  })

  test('精确档（precise）：外壳与 html 均回显 precise，仍零画布（光晕隐藏由 next-tokens.css 属性选择器承载）', () => {
    useNextTrackStore.getState().setImmersionTier('precise')
    const { container } = render(<TheaterShell />)

    expect(container.querySelector('[data-theater-shell]')?.getAttribute('data-immersion')).toBe(
      'precise',
    )
    expect(document.documentElement.getAttribute('data-immersion')).toBe('precise')
    expect(container.querySelector('canvas')).toBeNull()
  })

  test('系统减弱动画偏好（prefers-reduced-motion: reduce）自动降级至精确档', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    const { container } = render(<TheaterShell />)

    expect(container.querySelector('[data-theater-shell]')?.getAttribute('data-immersion')).toBe(
      'precise',
    )
  })
})

describe('components/next/theater/TheaterPermissionFallback（v3-ui-next-theater-intent-clarify D7 / 任务 1.2）', () => {
  test('无 ai:trigger 权限：渲染只读拦截面板，说明原因且零输入控件', () => {
    setPermissions([])
    const { container } = render(<TheaterPermissionFallback />)

    expect(container.querySelector('[data-theater-permission-fallback]')).toBeTruthy()
    expect(
      screen.getByText('当前角色仅供审查，需要项目经理或管理员权限方可发起 AI 项目创建。'),
    ).toBeInTheDocument()
    expect(screen.getByText('所需权限：ai:trigger')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /返回首页/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /申请权限/ })).toBeInTheDocument()
    // 物理阻断：不渲染任何输入控件（RL-01：无法触发任何后端请求）
    expect(container.querySelector('input, textarea, select')).toBeNull()
  })

  test('授权角色（permissions 含 ai:trigger）：透传子内容，不渲染拦截面板', () => {
    setPermissions(['ai:trigger'])
    const { container } = render(
      <TheaterPermissionFallback>
        <div data-auth-content>已授权内容</div>
      </TheaterPermissionFallback>,
    )

    expect(container.querySelector('[data-theater-permission-fallback]')).toBeNull()
    expect(container.querySelector('[data-auth-content]')).toBeTruthy()
  })

  test('系统管理员哨兵放行：isSuperAdmin 无显式权限也可进入剧场', () => {
    setPermissions([], true)
    const { container } = render(
      <TheaterPermissionFallback>
        <div data-auth-content>已授权内容</div>
      </TheaterPermissionFallback>,
    )

    expect(container.querySelector('[data-theater-permission-fallback]')).toBeNull()
    expect(container.querySelector('[data-auth-content]')).toBeTruthy()
  })

  test('返回首页 / 申请权限操作：跳转 /next 与静态引导（零网络副作用）', () => {
    setPermissions([])
    render(<TheaterPermissionFallback />)

    // 引导提示未点击前不渲染
    expect(screen.queryByText(/请联系组织管理员/)).not.toBeInTheDocument()

    // 点击返回首页 → 跳转新轨首页
    fireEvent.click(screen.getByRole('button', { name: /返回首页/ }))
    expect(routerPush).toHaveBeenCalledWith('/next')

    // 点击申请权限 → 仅提示联系管理员（不发起任何请求）
    fireEvent.click(screen.getByRole('button', { name: /申请权限/ }))
    expect(
      screen.getByText('请联系组织管理员为当前角色开通 ai:trigger 权限后重试。'),
    ).toBeInTheDocument()
    expect(routerPush).toHaveBeenCalledTimes(1)
  })
})

describe('生成剧场页权限门控（PermissionGuard require="ai:trigger"，任务 1.3）', () => {
  test('PM 角色（含 ai:trigger）：渲染 TheaterShell 与意图输入，无拦截面板', () => {
    setPermissions(['ai:trigger'])
    render(
      <PermissionGuard require="ai:trigger" fallback={<TheaterPermissionFallback />}>
        <TheaterShell>
          <input aria-label="意图输入" readOnly value="placeholder" />
        </TheaterShell>
      </PermissionGuard>,
    )

    expect(screen.queryByText('仅审查模式')).not.toBeInTheDocument()
    expect(screen.getByLabelText('意图输入')).toBeInTheDocument()
    // 拦截面板与登录壳标记不出现
    expect(document.querySelector('[data-theater-permission-fallback]')).toBeNull()
  })

  test('Observer 角色（无 ai:trigger）：降级渲染只读拦截卡片，剧场外壳与输入控件被物理阻断', () => {
    setPermissions([])
    render(
      <PermissionGuard require="ai:trigger" fallback={<TheaterPermissionFallback />}>
        <TheaterShell>
          <input aria-label="意图输入" readOnly value="placeholder" />
        </TheaterShell>
      </PermissionGuard>,
    )

    expect(screen.getByText('仅审查模式')).toBeInTheDocument()
    expect(screen.getByText(/当前角色仅供审查/)).toBeInTheDocument()
    expect(document.querySelector('[data-theater-shell]')).toBeNull()
    expect(screen.queryByLabelText('意图输入')).not.toBeInTheDocument()
    expect(document.querySelector('input, textarea, select')).toBeNull()
  })
})

describe('生成剧场页脚手架（app/(next)/next/create/page.tsx，任务 1.6）', () => {
  beforeEach(() => {
    useAiProjectDraftStore.setState({
      status: 'idle',
      rawInput: '',
      cards: [],
      answers: {},
      context: null,
      activeCard: null,
      error: null,
    })
    setPermissions(['ai:trigger'])
  })

  test('PM 权限 + idle：渲染剧场外壳与单焦点意图输入，初次进入为闲置输入态', () => {
    const { container } = render(<NextCreatePage />)

    expect(container.querySelector('[data-theater-shell]')).toBeTruthy()
    expect(screen.getByText('用一句话描述项目意图')).toBeInTheDocument()
    expect(container.querySelector('[data-theater-intent]')).toBeTruthy()
    expect(screen.getByLabelText('用一句话描述项目意图')).toBeInTheDocument()
    expect(screen.queryByText(/当前角色仅供审查/)).not.toBeInTheDocument()
  })

  test('挂载时 initializeScope 绑定租户域（userId + organizationId）', () => {
    render(<NextCreatePage />)

    const draft = useAiProjectDraftStore.getState()
    expect(draft.userId).toBe(1)
    expect(draft.organizationId).toBe(1)
  })

  test('跨组织切换（RL-05）：initializeScope 检测 isCrossScopeSwitch 并清空本地草案', () => {
    // 预置上一个组织（101）的草案现场（合法 ClarificationCard 形状，澄清卡可渲染）
    useAiProjectDraftStore.setState({
      userId: 1,
      organizationId: 101,
      status: 'clarifying',
      rawInput: '上一个组织的意图输入',
      cards: [
        asMock<ClarificationCard>({
          cardId: 'x-1',
          field: 'projectGoal',
          category: 'critical',
          title: '旧组织的问题？',
          description: '旧组织的问题描述。',
          impactScope: [],
          questionType: 'single_choice',
          quickOptions: [],
          customInput: {
            enabled: true,
            label: '补充自定义要求',
            placeholder: '请输入补充说明',
            description: '补充',
          },
          defaultValue: null,
          confidence: 0.5,
          reasoning: '旧数据。',
          allowSkip: false,
          isRequired: true,
        }),
      ],
      answers: asMock<ClarificationAnswers>({
        scope: { field: 'scope', action: 'answer', value: '旧答案' },
      }),
    })
    setPermissions(['ai:trigger'])

    render(<NextCreatePage />)

    const draft = useAiProjectDraftStore.getState()
    expect(draft.organizationId).toBe(1)
    expect(draft.rawInput).toBe('')
    expect(draft.cards).toEqual([])
    expect(draft.answers).toEqual({})
    expect(draft.status).toBe('idle')
  })
})
