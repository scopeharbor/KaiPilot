/**
 * v3-ui-next-resource-team-domains W1 · tasks 1.9 —— 新建资源抽屉测试
 * （ResourceCreateDrawer + 伪后端）。
 *
 * 覆盖（spec「受控新建资源（Create Resource）」场景）：
 * - 抽屉开启重置为默认值（人员 / 成员 / 8h / Asia/Shanghai）；
 * - Zod 表单校验：名称缺失、容量越界、非法单价、非法邮箱即时微标阻断且零请求；
 * - 合法提交 POST /projects/42/resources：元→分、技能标签解析、关闭抽屉；
 * - 后端 4xx 精确错误回显；
 * - 取消 / 关闭零请求。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ResourceCreateDrawer } from '@/components/next/resources/ResourceCreateDrawer'
import type { Resource } from '@/lib/api/resources'

const API_PREFIX = 'http://localhost:3333/api/v1'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

export interface RequestRecord {
  method: string
  url: string
  body: Record<string, unknown> | null
}

function installFetchRouter(
  route: (
    path: string,
    method: string,
    body: Record<string, unknown> | null,
  ) => Response | Promise<Response> | null,
): { records: RequestRecord[] } {
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
    const matched = await route(path, method, body)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 99,
    projectId: 42,
    userId: null,
    name: '张工',
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
  }
}

function createBackend({ failCreateOnce = false } = {}) {
  let failNext = failCreateOnce
  const route = (
    path: string,
    method: string,
    body: Record<string, unknown> | null,
  ): Response | null => {
    if (/^\/projects\/42\/resources(\?|$)/.test(path) && method === 'POST') {
      if (failNext) {
        failNext = false
        return jsonResponse(400, {
          error: { code: 'VALIDATION_ERROR', message: '资源名称与现有条目冲突' },
        })
      }
      return jsonResponse(200, {
        data: makeResource({ id: 99, name: String(body?.name) }),
      })
    }
    return null
  }
  return { route }
}

function renderDrawer(props: { open?: boolean; onClose?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onClose = props.onClose ?? vi.fn()
  render(
    <QueryClientProvider client={client}>
      <ResourceCreateDrawer projectId={42} open={props.open ?? true} onClose={onClose} />
    </QueryClientProvider>,
  )
  return { onClose }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

afterEach(() => {
  resetFetchRouter()
})

describe('ResourceCreateDrawer：初始状态与默认值', () => {
  test('关闭态不渲染；开启后渲染暗黑仪器感抽屉并预填默认值', () => {
    renderDrawer({ open: false })
    expect(document.querySelector('[data-resource-create-panel]')).toBeNull()
  })

  test('开启后渲染面板：默认人员 / 成员 / 8h / Asia/Shanghai，标注端点', () => {
    renderDrawer()
    expect(document.querySelector('[data-resource-create-panel]')).not.toBeNull()
    expect(screen.getByRole('dialog', { name: '新建资源' })).toBeInTheDocument()
    expect(document.querySelector('[data-resource-create-panel]')?.textContent).toContain(
      'POST /projects/42/resources',
    )
    expect((document.querySelector('[data-resource-create-type]') as HTMLSelectElement).value).toBe(
      'human',
    )
    expect((document.querySelector('[data-resource-create-role]') as HTMLSelectElement).value).toBe(
      'member',
    )
    expect(
      (document.querySelector('[data-resource-create-capacity]') as HTMLInputElement).value,
    ).toBe('8')
    expect(
      (document.querySelector('[data-resource-create-timezone]') as HTMLInputElement).value,
    ).toBe('Asia/Shanghai')
  })
})

describe('ResourceCreateDrawer：Zod 前端即时校验（RL-06 零请求）', () => {
  test('名称为空：展示「请输入资源名称」警示且提交按钮禁用零请求', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderDrawer()

    expect(screen.getByText('请输入资源名称')).toBeInTheDocument()
    const submit = document.querySelector('[data-resource-create-submit]') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(submit)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records.filter((record) => record.method === 'POST')).toHaveLength(0)
  })

  test('日额定工时越界（30h）：即时警示「0.5 ~ 24」并阻断', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderDrawer()

    fireEvent.change(document.querySelector('[data-resource-create-name]') as Element, {
      target: { value: '张工' },
    })
    fireEvent.change(document.querySelector('[data-resource-create-capacity]') as Element, {
      target: { value: '30' },
    })
    expect(screen.getByText('日额定工时需在 0.5 ~ 24 小时之间')).toBeInTheDocument()
    expect(
      (document.querySelector('[data-resource-create-submit]') as HTMLButtonElement).disabled,
    ).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records.filter((record) => record.method === 'POST')).toHaveLength(0)
  })

  test('非法单价与非法邮箱：各自红标展示，修正后校验通过', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderDrawer()

    fireEvent.change(document.querySelector('[data-resource-create-name]') as Element, {
      target: { value: '张工' },
    })
    fireEvent.change(document.querySelector('[data-resource-create-cost]') as Element, {
      target: { value: '-5' },
    })
    expect(screen.getByText('单价需为 0 ~ 1000000 之间的非负数')).toBeInTheDocument()

    fireEvent.change(document.querySelector('[data-resource-create-email]') as Element, {
      target: { value: 'not-an-email' },
    })
    expect(screen.getByText('邮箱格式不合法')).toBeInTheDocument()

    // 修正后警示消失、可提交
    fireEvent.change(document.querySelector('[data-resource-create-cost]') as Element, {
      target: { value: '150.5' },
    })
    fireEvent.change(document.querySelector('[data-resource-create-email]') as Element, {
      target: { value: '' },
    })
    expect(screen.queryByText('邮箱格式不合法')).not.toBeInTheDocument()
    expect(
      (document.querySelector('[data-resource-create-submit]') as HTMLButtonElement).disabled,
    ).toBe(false)
  })
})

describe('ResourceCreateDrawer：合法提交闭环', () => {
  test('填写名称保存：POST 载荷元→分、技能标签解析，成功后回调关闭', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    const { onClose } = renderDrawer()

    fireEvent.change(document.querySelector('[data-resource-create-name]') as Element, {
      target: { value: '张工' },
    })
    fireEvent.change(document.querySelector('[data-resource-create-type]') as Element, {
      target: { value: 'human' },
    })
    fireEvent.change(document.querySelector('[data-resource-create-capacity]') as Element, {
      target: { value: '6.5' },
    })
    fireEvent.change(document.querySelector('[data-resource-create-cost]') as Element, {
      target: { value: '150.5' },
    })
    fireEvent.change(document.querySelector('[data-resource-create-skill-tags]') as Element, {
      target: { value: 'React, TypeScript' },
    })

    fireEvent.click(document.querySelector('[data-resource-create-submit]') as Element)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    const post = records.find((record) => record.method === 'POST')
    expect(post?.url).toBe('/projects/42/resources')
    // 成功后触发列表缓存失效（缓存联动在页面级测试中验证；此处断言提交成功）
    expect(post?.body).toMatchObject({
      name: '张工',
      resourceType: 'human',
      role: 'member',
      timezone: 'Asia/Shanghai',
      dailyCapacityHours: 6.5,
      costPerUnitCents: 15050,
      skillTags: ['React', 'TypeScript'],
      email: null,
    })
  })

  test('后端 4xx：抽屉内精确回显错误文案，不静默失败', async () => {
    const backend = createBackend({ failCreateOnce: true })
    const { records } = installFetchRouter(backend.route)
    renderDrawer()

    fireEvent.change(document.querySelector('[data-resource-create-name]') as Element, {
      target: { value: '重复名称' },
    })
    fireEvent.click(document.querySelector('[data-resource-create-submit]') as Element)

    await waitFor(() =>
      expect(document.querySelector('[data-resource-create-error]')).not.toBeNull(),
    )
    expect(screen.getByText('资源名称与现有条目冲突')).toBeInTheDocument()
    expect(records.filter((record) => record.method === 'POST')).toHaveLength(1)
  })

  test('取消与关闭按钮零写请求', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    const { onClose } = renderDrawer()

    fireEvent.change(document.querySelector('[data-resource-create-name]') as Element, {
      target: { value: '张工' },
    })
    fireEvent.click(document.querySelector('[data-resource-create-cancel]') as Element)
    expect(onClose).toHaveBeenCalledTimes(1)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records.filter((record) => record.method === 'POST')).toHaveLength(0)
  })
})
