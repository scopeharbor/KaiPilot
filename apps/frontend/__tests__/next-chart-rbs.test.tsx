/**
 * v3-ui-next-chart-gallery W4 · tasks 4.4 / 4.6 —— RBS 四级聚合纯函数与
 * 资源分解树状分级镜头测试（结构正确性 / 容量卷算 / 技能检索高亮 / 零写保护）。
 *
 * - 纯函数单元测试：parseSkillTags 防御解析、buildRbsTree 四级结构与层级卷算
 *   （资源数 / 容量工时 / 人天）、空输入容错、大类固定排序；
 * - 镜头组件测试：api 层走真实模块（lib/api/resources）+ 全局 fetch stub，
 *   验证默认展开层级、全部展开/折叠、技能关键词高亮与其余节点弱化；
 * - 只读铁律：展开/折叠/检索/清除全交互期间仅 GET，零 POST/PATCH/PUT/DELETE；
 * - RBAC：无 resource:view 时受限提示渲染且数据请求零发出。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import type { Resource } from '@/lib/api/resources'
import { RbsTreeChartLens } from '@/components/next/charts/RbsTreeChartLens'
import {
  buildRbsTree,
  capacityToPersonDays,
  collectSkillMatchIds,
  matchesSkillKeyword,
  parseSkillTags,
  type RbsResourceInput,
} from '@/lib/next/charts/rbs-aggregator'

// ---------------------------------------------------------------------------
// 资源实体工厂
// ---------------------------------------------------------------------------
let nextResourceId = 1

function makeResource(overrides: Partial<Resource>): Resource {
  return {
    projectId: 42,
    userId: null,
    name: '未命名资源',
    email: null,
    resourceType: 'human',
    role: 'member',
    status: 'active',
    dailyCapacityHours: 8,
    skillTags: null,
    workDays: '1,2,3,4,5',
    timezone: 'Asia/Shanghai',
    costPerUnitCents: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
    id: overrides.id ?? nextResourceId++,
  }
}

function defaultResources(): Resource[] {
  nextResourceId = 1
  return [
    makeResource({
      id: 1,
      name: '张伟',
      email: 'zhang.wei@aiproj.dev',
      resourceType: 'human',
      role: 'project_manager',
      skillTags: '["PMP","项目治理"]',
    }),
    makeResource({
      id: 2,
      name: '李娜',
      email: 'li.na@aiproj.dev',
      resourceType: 'human',
      role: 'project_manager',
      skillTags: '["PMP"]',
    }),
    makeResource({
      id: 3,
      name: '王强',
      email: 'wang.qiang@aiproj.dev',
      resourceType: 'human',
      role: 'team_lead',
      skillTags: '["React","TypeScript","系统架构"]',
    }),
    makeResource({
      id: 4,
      name: '刘敏',
      resourceType: 'human',
      role: 'team_lead',
      skillTags: '["React","Next.js"]',
    }),
    makeResource({
      id: 5,
      name: '陈晨',
      resourceType: 'human',
      role: 'member',
      skillTags: '["React","Node.js"]',
    }),
    makeResource({
      id: 6,
      name: '赵岩',
      resourceType: 'human',
      role: 'member',
      skillTags: '["Selenium","性能测试"]',
    }),
    makeResource({
      id: 7,
      name: '4K 显示器套装',
      resourceType: 'material',
      role: 'member',
      dailyCapacityHours: 0,
      skillTags: '["办公耗材"]',
    }),
    makeResource({
      id: 8,
      name: 'GPU 训练服务器 S-01',
      resourceType: 'equipment',
      role: 'member',
      dailyCapacityHours: 16,
      skillTags: '["CUDA","GPU"]',
    }),
    makeResource({
      id: 9,
      name: '应急预算池',
      resourceType: 'budget',
      role: 'member',
      dailyCapacityHours: 0,
      skillTags: null,
    }),
  ]
}

// ---------------------------------------------------------------------------
// fetch stub：资源列表分页语义（可编程失败）
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

interface ResourceBackend {
  resources: Resource[]
  failNextList: boolean
  writeCalls: string[]
}

function createResourceBackend(seed: Resource[]): ResourceBackend {
  return { resources: [...seed], failNextList: false, writeCalls: [] }
}

function installResourceFetch(backend: ResourceBackend) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.replace(API_PREFIX, '')
    if (method !== 'GET') backend.writeCalls.push(`${method} ${path}`)
    if (path.startsWith('/projects/42/resources')) {
      if (backend.failNextList) {
        backend.failNextList = false
        return jsonResponse(500, { error: { code: 'INTERNAL_SERVER_ERROR', message: '' } })
      }
      const query = new URL(url, 'http://x').searchParams
      const page = Number(query.get('page') ?? 1)
      const perPage = Number(query.get('perPage') ?? 20)
      const total = backend.resources.length
      const totalPages = Math.max(1, Math.ceil(total / perPage))
      const start = (page - 1) * perPage
      return jsonResponse(200, {
        data: backend.resources.slice(start, start + perPage),
        meta: { total, page, perPage, totalPages },
      })
    }
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function writeMethods(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map((call) => {
      const init = call[1] as RequestInit | undefined
      return (init?.method ?? 'GET').toUpperCase()
    })
    .filter((method) => method !== 'GET')
}

// ---------------------------------------------------------------------------
// 会话辅助
// ---------------------------------------------------------------------------
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

function resetAuth() {
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    permissions: [],
    currentOrganizationId: null,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: false,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function renderLens(backend: ResourceBackend) {
  const fetchMock = installResourceFetch(backend)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <RbsTreeChartLens projectId={42} />
    </QueryClientProvider>,
  )
  return { view, client, fetchMock }
}

function rows(): Element[] {
  return Array.from(document.querySelectorAll('[data-rbs-node]'))
}

beforeEach(() => {
  nextResourceId = 1
  resetAuth()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
describe('rbs-aggregator：四级树聚合与容量卷算纯函数', () => {
  test('parseSkillTags 防御解析：JSON 数组 / 空值 / 非法 JSON / 纯文本', () => {
    expect(parseSkillTags('["React","TypeScript"]')).toEqual(['React', 'TypeScript'])
    expect(parseSkillTags(null)).toEqual([])
    expect(parseSkillTags('')).toEqual([])
    expect(parseSkillTags('   ')).toEqual([])
    expect(parseSkillTags('not-json')).toEqual(['not-json'])
    expect(parseSkillTags('["a",  "b" ]')).toEqual(['a', 'b'])
    expect(parseSkillTags('{bad json')).toEqual(['{bad json'])
    expect(parseSkillTags('["a",null]')).toEqual(['a', 'null'])
    expect(parseSkillTags('Node.js, React')).toEqual(['Node.js', 'React'])
  })

  test('buildRbsTree：四级结构与类别固定顺序（human→material→equipment→budget）', () => {
    const resources = defaultResources() as unknown as RbsResourceInput[]
    const tree = buildRbsTree(resources)

    expect(tree.kind).toBe('root')
    expect(tree.level).toBe(1)
    expect(tree.label).toBe('项目资源总库')
    expect(tree.children.map((c) => c.resourceType)).toEqual([
      'human',
      'material',
      'equipment',
      'budget',
    ])

    const human = tree.children[0]!
    expect(human.level).toBe(2)
    expect(human.label).toBe('人力资源')
    expect(human.children.map((c) => c.role)).toEqual(['project_manager', 'team_lead', 'member'])
    expect(human.children.map((c) => c.label)).toEqual(['项目经理', '团队负责人', '成员'])

    // L3 → L4 实例展开
    const pm = human.children[0]!
    expect(pm.level).toBe(3)
    expect(pm.children.map((c) => c.name)).toEqual(['张伟', '李娜'])
    expect(pm.children[0]!.skillTags).toEqual(['PMP', '项目治理'])
    expect(pm.children[0]!.key).toBe('l4:1')
    expect(pm.children[0]!.level).toBe(4)
  })

  test('容量卷算：各级 资源数 / 容量工时 / 人天 逐级累加正确', () => {
    const resources = defaultResources() as unknown as RbsResourceInput[]
    const tree = buildRbsTree(resources)

    // 全局：9 项 · 64 工时/日（6×8 + 16）· 8 人天
    expect(tree.resourceCount).toBe(9)
    expect(tree.capacityHoursPerDay).toBe(64)
    expect(tree.capacityPersonDays).toBe(capacityToPersonDays(64))
    expect(capacityToPersonDays(64)).toBe(8)
    expect(capacityToPersonDays(4)).toBe(0.5)
    expect(capacityToPersonDays(0)).toBe(0)

    const human = tree.children[0]!
    expect(human.resourceCount).toBe(6)
    expect(human.capacityHoursPerDay).toBe(48)
    expect(human.capacityPersonDays).toBe(6)

    // 角色层：团队负责人 2 人 16 工时 = 2 人天
    const leads = human.children[1]!
    expect(leads.resourceCount).toBe(2)
    expect(leads.capacityHoursPerDay).toBe(16)
    expect(leads.capacityPersonDays).toBe(2)

    // 设备实例：单实例 16 工时/日 → 2 人天
    const equipment = tree.children[2]!
    expect(equipment.children[0]!.children[0]!.capacityHoursPerDay).toBe(16)
    expect(equipment.children[0]!.children[0]!.capacityPersonDays).toBe(2)
    expect(equipment.resourceCount).toBe(1)
  })

  test('未知资源大类按出现顺序追加在固定四类之后；空输入返回零值根', () => {
    const unknown: RbsResourceInput = {
      id: 99,
      name: '软件许可',
      resourceType: 'license',
      role: 'member',
      status: 'active',
      dailyCapacityHours: 0,
      skillTags: null,
    }
    const tree = buildRbsTree([unknown])
    expect(tree.children.map((c) => c.resourceType)).toEqual(['license'])
    expect(tree.children[0]!.label).toBe('license')
    expect(tree.resourceCount).toBe(1)

    const empty = buildRbsTree([])
    expect(empty.resourceCount).toBe(0)
    expect(empty.capacityHoursPerDay).toBe(0)
    expect(empty.capacityPersonDays).toBe(0)
    expect(empty.children).toEqual([])
  })

  test('技能检索纯函数：大小写不敏感命中与关键词匹配', () => {
    const resources = defaultResources() as unknown as RbsResourceInput[]
    expect(matchesSkillKeyword(resources[2]!, 'react')).toBe(true)
    expect(matchesSkillKeyword(resources[2]!, 'REACT')).toBe(true)
    expect(matchesSkillKeyword(resources[0]!, 'react')).toBe(false)
    expect(matchesSkillKeyword(resources[0]!, '  ')).toBe(false)

    const tree = buildRbsTree(resources)
    const ids = collectSkillMatchIds(tree, 'React')
    expect([...ids].sort()).toEqual([3, 4, 5])
    expect(collectSkillMatchIds(tree, '不存在的技能xyz').size).toBe(0)
    expect(collectSkillMatchIds(tree, '').size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
describe('RbsTreeChartLens：树状分级渲染与展开/折叠', () => {
  test('默认展开根与四大类；摘要徽章展示卷算汇总', async () => {
    setAuth(['resource:view'])
    const backend = createResourceBackend(defaultResources())
    renderLens(backend)
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))

    expect(rows()).toHaveLength(11) // 根 + 4 大类 + 6 角色（L4 实例折叠）
    expect(rows()[0]?.getAttribute('data-rbs-node-key')).toBe('root')
    expect(rows()[0]?.getAttribute('data-rbs-node-level')).toBe('1')
    expect(screen.getByText('项目资源总库')).toBeInTheDocument()
    expect(screen.getByText('人力资源')).toBeInTheDocument()
    expect(screen.getByText('设备资源')).toBeInTheDocument()

    expect(document.querySelector('[data-rbs-summary-count]')?.textContent).toContain('9 项资源')
    expect(document.querySelector('[data-rbs-summary-hours]')?.textContent).toContain('64 工时/日')
    expect(document.querySelector('[data-rbs-summary-person-days]')?.textContent).toContain(
      '约 8 人天',
    )
    // L3 角色行可见但 L4 实例默认折叠不可见
    expect(screen.getByText('项目经理')).toBeInTheDocument()
    expect(screen.queryByText('王强')).toBeNull()
  })

  test('全部展开/全部折叠一键切换；单节点逐级折叠与展开', async () => {
    setAuth(['resource:view'])
    const backend = createResourceBackend(defaultResources())
    renderLens(backend)
    await waitFor(() => expect(rows()).toHaveLength(11))

    fireEvent.click(screen.getByRole('button', { name: '全部展开' }))
    await waitFor(() => expect(rows()).toHaveLength(20)) // 1+4+6+9
    expect(screen.getByText('张伟')).toBeInTheDocument()
    expect(screen.getByText('GPU 训练服务器 S-01')).toBeInTheDocument()
    expect(screen.getByText('应急预算池')).toBeInTheDocument()

    // 单角色折叠：项目经理（2 实例）隐藏
    fireEvent.click(screen.getByRole('button', { name: '折叠 项目经理' }))
    expect(rows()).toHaveLength(18)
    expect(screen.queryByText('张伟')).toBeNull()
    // 整支大类折叠：人力资源子树（3 角色 + 6 实例）收拢，其余分支仍可见
    fireEvent.click(screen.getByRole('button', { name: '折叠 人力资源' }))
    await waitFor(() => expect(rows()).toHaveLength(11))
    expect(screen.queryByText('王强')).toBeNull()
    expect(screen.getByText('GPU 训练服务器 S-01')).toBeInTheDocument()
    // 重新展开大类：恢复角色行与其余角色实例（项目经理保持折叠 → 18 行）
    fireEvent.click(screen.getByRole('button', { name: '展开 人力资源' }))
    await waitFor(() => expect(rows()).toHaveLength(18))
    expect(screen.getByText('王强')).toBeInTheDocument()
    expect(screen.queryByText('张伟')).toBeNull()

    // 一键全部折叠 → 仅根
    fireEvent.click(screen.getByRole('button', { name: '全部折叠' }))
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(screen.queryByText('人力资源')).toBeNull()
  })

  test('技能搜索「React」：命中行高亮 + 其余节点弱化；清除后恢复', async () => {
    setAuth(['resource:view'])
    const backend = createResourceBackend(defaultResources())
    renderLens(backend)
    await waitFor(() => expect(rows()).toHaveLength(11))

    const input = screen.getByRole('searchbox', { name: '按技能标签搜索资源' })
    fireEvent.change(input, { target: { value: 'React' } })

    await waitFor(() =>
      expect(document.querySelector('[data-rbs-search-status]')?.textContent).toContain(
        '命中 3 项资源',
      ),
    )
    // 命中：王强 / 刘敏 / 陈晨
    const hitNodes = document.querySelectorAll('[data-rbs-node][data-rbs-search-match]')
    expect(hitNodes).toHaveLength(3)
    const hitNames = Array.from(hitNodes).map(
      (node) =>
        node.textContent?.includes('王强') ||
        node.textContent?.includes('刘敏') ||
        node.textContent?.includes('陈晨'),
    )
    expect(hitNames.every(Boolean)).toBe(true)
    // 命中行的技能芯片标记
    const hitSkill = document.querySelectorAll('[data-rbs-skill-hit]')
    expect(hitSkill.length).toBeGreaterThanOrEqual(3)
    expect(hitSkill[0]?.textContent).toBe('React')

    // 非匹配节点半透明弱化（含同级人员与整支设备分支）
    const dimmed = document.querySelectorAll('[data-rbs-node][data-rbs-dimmed]')
    expect(dimmed.length).toBeGreaterThan(0)
    const zhangRow = Array.from(document.querySelectorAll('[data-rbs-node]')).find((n) =>
      n.textContent?.includes('张伟'),
    )
    expect(zhangRow?.getAttribute('data-rbs-dimmed')).toBe('true')
    const gpuRow = Array.from(document.querySelectorAll('[data-rbs-node]')).find((n) =>
      n.textContent?.includes('GPU 训练服务器'),
    )
    expect(gpuRow?.getAttribute('data-rbs-dimmed')).toBe('true')
    // 命中行自身不弱化
    expect(Array.from(hitNodes).every((n) => n.getAttribute('data-rbs-dimmed') === null)).toBe(true)

    // 清空关键词 → 弱化/高亮状态全部移除
    fireEvent.click(screen.getByRole('button', { name: '清除技能搜索' }))
    await waitFor(() =>
      expect(document.querySelectorAll('[data-rbs-node][data-rbs-search-match]')).toHaveLength(0),
    )
    expect(document.querySelectorAll('[data-rbs-node][data-rbs-dimmed]')).toHaveLength(0)
  })

  test('空资源项目：语义空态渲染', async () => {
    setAuth(['resource:view'])
    const backend = createResourceBackend([])
    renderLens(backend)
    await waitFor(() => expect(document.querySelector('[data-rbs-empty]')).not.toBeNull())
    expect(screen.getByText('当前项目尚未配置资源')).toBeInTheDocument()
  })

  test('加载失败：错误卡 + 重新加载恢复', async () => {
    setAuth(['resource:view'])
    const backend = createResourceBackend(defaultResources())
    backend.failNextList = true
    renderLens(backend)

    await screen.findByRole('alert', { name: '资源分解结构加载错误' })
    expect(screen.queryByText('项目资源总库')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await waitFor(() => expect(screen.getByText('项目资源总库')).toBeInTheDocument())
  })

  test('无 resource:view 权限：受限提示渲染且数据请求零发出', async () => {
    setAuth(['project:view'])
    const backend = createResourceBackend(defaultResources())
    const fetchMock = installResourceFetch(backend)
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RbsTreeChartLens projectId={42} />
      </QueryClientProvider>,
    )

    expect(document.querySelector('[data-rbs-view-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看该项目资源分解的权限')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('只读铁律：展开/折叠/检索/清除交互期间零写请求（仅 GET）', async () => {
    setAuth(['resource:view'])
    const backend = createResourceBackend(defaultResources())
    const fetchMock = renderLens(backend).fetchMock
    await waitFor(() => expect(rows()).toHaveLength(11))

    fireEvent.click(screen.getByRole('button', { name: '全部展开' }))
    fireEvent.click(screen.getByRole('button', { name: '折叠 人力资源' }))
    fireEvent.click(screen.getByRole('button', { name: '展开 人力资源' }))
    fireEvent.click(screen.getByRole('button', { name: '全部折叠' }))
    const input = screen.getByRole('searchbox', { name: '按技能标签搜索资源' })
    fireEvent.change(input, { target: { value: 'cuda' } })
    fireEvent.change(input, { target: { value: '' } })

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(writeMethods(fetchMock)).toHaveLength(0)
    expect(backend.writeCalls).toEqual([])
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0) // 初始 GET 确实发生
  })
})
