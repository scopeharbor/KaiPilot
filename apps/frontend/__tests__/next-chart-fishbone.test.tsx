/**
 * v3-ui-next-chart-gallery W3 · tasks 3.5-3.7 —— 鱼骨图拓扑渲染、受控编辑与持久化测试。
 *
 * 覆盖：
 * - 首次进入默认 6M（人/机/料/法/测/环）骨架 + 核心问题占位；
 * - 权限门禁：无 diagram:manage 时只读（保存/添加禁用、原因不可编辑）；
 * - 在线编辑：新增要因 → 重命名 → 撤销/重做；修改核心问题；
 * - 持久化：首次保存 POST /diagrams（type:'fishbone' 合法 DiagramSpec），
 *   已存记录 PATCH 更新；重载后要因树与 effect 完整还原；
 * - 小骨（子因）增删与「重置为初始模板」；
 * - 接口失败错误卡 + 重试恢复。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Diagram, DiagramSpec } from '@aiproj/types'
import type { FishboneData } from '@aiproj/types'
import { FishboneChartLens } from '@/components/next/charts/lenses/FishboneChartLens'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'

// ---------------------------------------------------------------------------
// Module mocks + 简易「服务器端」records（模拟 list/create/update 语义）
// ---------------------------------------------------------------------------

const apiMock = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/api/diagrams', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/diagrams')>()
  return {
    ...original,
    listDiagrams: apiMock.list,
    createDiagram: apiMock.create,
    updateDiagram: apiMock.update,
  }
})

const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/charts/fishbone',
  useParams: () => ({ id: '42', chartId: 'fishbone' }),
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function login(permissions: string[] = ['project:view', 'diagram:view', 'diagram:manage']) {
  useAuthStore.getState().setSession({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '项目经理',
      organizations: [{ id: 8, name: '开项', slug: 'aiproj', role: 'owner' }],
    },
    accessToken: accessTokenWith(permissions, { organizationId: 8 }),
    refreshToken: 'refresh',
  })
}

function logout() {
  useAuthStore.getState().clear()
}

function diagramRecord(id: number, data: FishboneData): Diagram {
  const spec: DiagramSpec = {
    version: '1.0',
    type: 'fishbone',
    title: `鱼骨图：${data.effect.slice(0, 48) || '未命名'}`,
    data,
    metadata: { generatedBy: 'user', generatedAt: '2026-03-01T00:00:00.000Z', sourceProjectId: 42 },
    exports: { mermaid: { supported: false, limitations: [] } },
  }
  return {
    id,
    organizationId: 8,
    projectId: 42,
    type: 'fishbone',
    title: spec.title,
    spec,
    sourceHash: null,
    createdBy: 1,
    updatedBy: 1,
    deletedAt: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
  }
}

function emptyEnvelope() {
  return { data: [], meta: { total: 0, page: 1, perPage: 100, totalPages: 0 } }
}

function envelopeOf(records: Diagram[]) {
  return {
    data: records,
    meta: { total: records.length, page: 1, perPage: 100, totalPages: records.length ? 1 : 0 },
  }
}

/** 内存版 fishbone 存储：让 list/create/update 有真实回显语义。 */
function makeFishboneServer() {
  const records: Diagram[] = []
  apiMock.list.mockImplementation(async () => envelopeOf(records.slice()))
  apiMock.create.mockImplementation(
    async (_projectId: number, body: { type: string; title: string; spec: DiagramSpec }) => {
      const record = diagramRecord(77, body.spec.data as FishboneData)
      record.title = body.title
      records.push(record)
      return { data: record }
    },
  )
  apiMock.update.mockImplementation(
    async (id: number, body: { title?: string; spec?: DiagramSpec }) => {
      const record = records.find((r) => r.id === id)
      if (!record) throw new Error(`no diagram ${id}`)
      if (body.spec) {
        record.spec = body.spec
        record.title = body.title ?? record.title
      }
      return { data: record }
    },
  )
  return records
}

function renderLens() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const utils = render(
    <QueryClientProvider client={client}>
      <div style={{ height: 760, width: 1520 }}>
        <FishboneChartLens projectId={42} />
      </div>
    </QueryClientProvider>,
  )
  return { client, ...utils }
}

async function waitForCanvas() {
  await waitFor(() => expect(document.querySelector('[data-fishbone-canvas]')).not.toBeNull())
}

function methodAddButton(): HTMLElement {
  const el = document.querySelector('[data-fishbone-add-cause][data-category-key="method"]')
  expect(el).not.toBeNull()
  return el as HTMLElement
}

function causeChip(label: string): HTMLElement {
  const chips = [...document.querySelectorAll<HTMLElement>('[data-fishbone-cause]')]
  const hit = chips.find((chip) => chip.textContent?.includes(label))
  expect(hit, `原因槽「${label}」应存在`).toBeDefined()
  return hit!
}

function causeEditorInput(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('[data-fishbone-cause-input]')
  expect(el).not.toBeNull()
  return el!
}

beforeEach(() => {
  apiMock.list.mockReset()
  apiMock.create.mockReset()
  apiMock.update.mockReset()
})

afterEach(() => {
  logout()
})

// ---------------------------------------------------------------------------
describe('鱼骨图默认模板与权限门禁', () => {
  test('首次进入（无已存记录）渲染 6M 骨架与核心问题占位', async () => {
    login()
    apiMock.list.mockResolvedValue(emptyEnvelope())
    renderLens()
    await waitForCanvas()

    expect(screen.getByText('人员 Manpower')).toBeInTheDocument()
    expect(screen.getByText('机器 Machinery')).toBeInTheDocument()
    expect(screen.getByText('物料 Material')).toBeInTheDocument()
    expect(screen.getByText('方法 Method')).toBeInTheDocument()
    expect(screen.getByText('测量 Measurement')).toBeInTheDocument()
    expect(screen.getByText('环境 Environment')).toBeInTheDocument()

    expect(document.querySelectorAll('[data-fishbone-cause]')).toHaveLength(0)
    // 每个大骨一条「+ 要因」
    expect(document.querySelectorAll('[data-fishbone-add-cause]')).toHaveLength(6)
    // 保存按钮可用（可编辑）
    expect(document.querySelector('[data-fishbone-save]')).not.toBeDisabled()
  })

  test('无 diagram:manage 权限：只读浏览，保存/添加禁用且原因不可点', async () => {
    login(['project:view'])
    apiMock.list.mockResolvedValue(
      envelopeOf([
        diagramRecord(77, {
          effect: '登录失败率过高',
          categories: [
            {
              key: 'method',
              label: '方法 Method',
              causes: [{ id: 'c-9', label: '缺乏交叉审查机制', children: [] }],
            },
          ],
        }),
      ]),
    )
    renderLens()
    await waitForCanvas()

    expect(document.querySelector('[data-fishbone-lens]')).toHaveAttribute('data-can-edit', 'false')
    expect(document.querySelector('[data-fishbone-save]')).toBeDisabled()
    expect(document.querySelectorAll('[data-fishbone-add-cause]')).toHaveLength(0)
    expect(document.querySelector('[data-fishbone-readonly-note]')).not.toBeNull()
    // effect 以只读文本呈现（非输入框）
    expect(document.querySelector('[data-fishbone-effect]')?.tagName).toBe('P')
    // 原因以禁用按钮呈现
    const chip = causeChip('缺乏交叉审查机制')
    expect(chip.querySelector('button')).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
describe('鱼骨图在线编辑与持久化（POST/PATCH）', () => {
  test('新增要因 → 重命名 → 撤销/重做 → 保存触发合法 type:fishbone POST', async () => {
    login()
    const records = makeFishboneServer()
    expect(records).toHaveLength(0)
    renderLens()
    await waitForCanvas()

    // 在「方法」大骨下新增要因（进入内联编辑）
    fireEvent.click(methodAddButton())
    await waitFor(() =>
      expect(document.querySelector('[data-fishbone-cause-editor]')).not.toBeNull(),
    )
    fireEvent.change(causeEditorInput(), { target: { value: '缺乏交叉审查机制' } })
    fireEvent.click(document.querySelector('[data-fishbone-cause-save]')!)
    await waitFor(() => expect(document.querySelectorAll('[data-fishbone-cause]')).toHaveLength(1))
    const chip = causeChip('缺乏交叉审查机制')
    expect(chip).toHaveAttribute('data-category-key', 'method')
    expect(chip).toHaveAttribute('data-cause-depth', '0')

    // 撤销（重命名入栈 ×1）：回到默认文案；再撤销（新增入栈 ×1）：槽位清空
    fireEvent.click(document.querySelector('[data-fishbone-undo]')!)
    await waitFor(() => expect(causeChip('新要因')).toBeInTheDocument())
    fireEvent.click(document.querySelector('[data-fishbone-undo]')!)
    await waitFor(() => expect(document.querySelectorAll('[data-fishbone-cause]')).toHaveLength(0))

    // 重做 ×2：恢复到「缺乏交叉审查机制」
    fireEvent.click(document.querySelector('[data-fishbone-redo]')!)
    fireEvent.click(document.querySelector('[data-fishbone-redo]')!)
    await waitFor(() => expect(causeChip('缺乏交叉审查机制')).toBeInTheDocument())

    // 修改核心问题
    const effectInput = document.querySelector<HTMLInputElement>('[data-fishbone-effect]')!
    fireEvent.change(effectInput, { target: { value: '登录失败率过高' } })
    fireEvent.blur(effectInput)
    await waitFor(() =>
      expect(document.querySelector('[data-fishbone-dirty]')).toHaveTextContent('存在未保存更改'),
    )

    // 保存 → POST，payload 合法 fishbone DiagramSpec
    fireEvent.click(document.querySelector('[data-fishbone-save]')!)
    await waitFor(() => expect(apiMock.create).toHaveBeenCalledTimes(1))
    expect(apiMock.update).not.toHaveBeenCalled()

    const [projectId, body] = apiMock.create.mock.calls[0]!
    expect(projectId).toBe(42)
    expect(body.type).toBe('fishbone')
    expect(body.spec.type).toBe('fishbone')
    expect(body.spec.version).toBe('1.0')
    const data = body.spec.data as FishboneData
    expect(data.effect).toBe('登录失败率过高')
    const method = data.categories.find((c) => c.key === 'method')
    expect(method?.causes.map((c) => c.label)).toContain('缺乏交叉审查机制')
    expect(apiMock.list).toHaveBeenCalled()

    await waitFor(() =>
      expect(document.querySelector('[data-fishbone-dirty]')).toHaveTextContent('已与服务器同步'),
    )
    await waitFor(() => expect(document.querySelector('[data-fishbone-save]')).not.toBeDisabled())
  })

  test('已存版本回显：effect 与要因树完整还原；再次保存走 PATCH', async () => {
    login()
    const records = makeFishboneServer()
    records.push(
      diagramRecord(77, {
        effect: '登录失败率过高',
        categories: [
          {
            key: 'method',
            label: '方法 Method',
            causes: [{ id: 'c-9', label: '缺乏交叉审查机制', children: [] }],
          },
        ],
      }),
    )
    const first = renderLens()
    const unmountFirst = first.unmount
    await waitForCanvas()

    // 回显
    const effectInput = document.querySelector<HTMLInputElement>('[data-fishbone-effect]')!
    expect(effectInput.value).toBe('登录失败率过高')
    expect(causeChip('缺乏交叉审查机制')).toHaveAttribute('data-category-key', 'method')

    // 追加一条要因并改 effect 后保存 → PATCH /diagrams/77
    fireEvent.change(effectInput, { target: { value: '登录失败率过高（移动端）' } })
    fireEvent.blur(effectInput)
    fireEvent.click(methodAddButton())
    await waitFor(() =>
      expect(document.querySelector('[data-fishbone-cause-editor]')).not.toBeNull(),
    )
    fireEvent.change(causeEditorInput(), { target: { value: '验证码难以识别' } })
    fireEvent.click(document.querySelector('[data-fishbone-cause-save]')!)
    await waitFor(() => expect(causeChip('验证码难以识别')).toBeInTheDocument())

    fireEvent.click(document.querySelector('[data-fishbone-save]')!)
    await waitFor(() => expect(apiMock.update).toHaveBeenCalledTimes(1))
    expect(apiMock.create).not.toHaveBeenCalled()
    const [diagramId, updateBody] = apiMock.update.mock.calls[0]!
    expect(diagramId).toBe(77)
    const updated = updateBody.spec!.data as FishboneData
    expect(updated.effect).toBe('登录失败率过高（移动端）')
    expect(updated.categories.find((c) => c.key === 'method')!.causes).toHaveLength(2)

    // 模拟重载（全新挂载）：再次进入数据完整还原
    unmountFirst()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <FishboneChartLens projectId={42} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(causeChip('缺乏交叉审查机制')).toBeInTheDocument())
    expect(causeChip('验证码难以识别')).toBeInTheDocument()
    expect(document.querySelector<HTMLInputElement>('[data-fishbone-effect]')!.value).toBe(
      '登录失败率过高（移动端）',
    )
    unmount()
  })
})

// ---------------------------------------------------------------------------
describe('小骨层级与重置', () => {
  test('在要因下追加小骨、删除小骨、重置为初始模板', async () => {
    login()
    apiMock.list.mockResolvedValue(emptyEnvelope())
    renderLens()
    await waitForCanvas()

    // 新增一个要因并命名
    fireEvent.click(methodAddButton())
    await waitFor(() =>
      expect(document.querySelector('[data-fishbone-cause-editor]')).not.toBeNull(),
    )
    fireEvent.change(causeEditorInput(), { target: { value: '流程缺失' } })
    fireEvent.click(document.querySelector('[data-fishbone-cause-save]')!)
    await waitFor(() => expect(causeChip('流程缺失')).toBeInTheDocument())

    // 打开要因编辑器并追加小骨
    const parent = causeChip('流程缺失')
    fireEvent.click(within(parent).getByRole('button'))
    await waitFor(() =>
      expect(document.querySelector('[data-fishbone-add-subcause]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-fishbone-add-subcause]')!)
    await waitFor(() =>
      expect(document.querySelector('[data-fishbone-cause-editor]')).not.toBeNull(),
    )
    fireEvent.change(causeEditorInput(), { target: { value: '无评审节点' } })
    fireEvent.click(document.querySelector('[data-fishbone-cause-save]')!)
    const child = causeChip('无评审节点')
    expect(child).toHaveAttribute('data-cause-depth', '1')

    // 删除小骨
    fireEvent.click(within(child).getByRole('button'))
    await waitFor(() =>
      expect(document.querySelector('[data-fishbone-cause-editor]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-fishbone-cause-delete]')!)
    await waitFor(() => expect(document.querySelectorAll('[data-fishbone-cause]')).toHaveLength(1))

    // 重置为初始模板（两次点击确认），要因清空但核心问题保留
    fireEvent.click(document.querySelector('[data-fishbone-reset]')!)
    fireEvent.click(document.querySelector('[data-fishbone-reset]')!)
    await waitFor(() => expect(document.querySelectorAll('[data-fishbone-cause]')).toHaveLength(0))
  })

  test('加载失败错误卡 + 重试恢复', async () => {
    login()
    apiMock.list.mockRejectedValueOnce(new Error('network down'))
    renderLens()
    await waitFor(() => expect(document.querySelector('[data-fishbone-error]')).not.toBeNull())
    apiMock.list.mockResolvedValue(emptyEnvelope())
    fireEvent.click(document.querySelector('[data-fishbone-retry]')!)
    await waitForCanvas()
  })
})
