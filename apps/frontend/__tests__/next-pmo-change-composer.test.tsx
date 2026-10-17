/**
 * v3-ui-next-batch4-reports-change-queue W3 · 任务 3.2
 * 跨项目变更请求前端多查询合成器与并发控制单元测试。
 *
 * 测试项：
 * 1. 多项目变更数组合流与展平；
 * 2. 所属项目名称与项目代号元数据正确回填；
 * 3. 并发通道限制（最大 5 并发）严格控制；
 * 4. 单项目变更端点 500 时的优雅降级与弱提示回显；
 * 5. 多维排序（提交时间 submittedAt、优先级 priority、项目名称）；
 * 6. RL-01：全流程纯只读 GET，零网络写请求。
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeRequest } from '@/lib/api/change-requests'
import type { Project } from '@/lib/api/projects'
import {
  MAX_CONCURRENT_CHANNELS,
  composeCrossProjectChangeRequests,
  fetchCrossProjectChangeQueue,
  mapConcurrent,
  sortChangeQueueItems,
} from '@/lib/next/pmo-change-queue-composer'

function makeProject(id: number, overrides: Partial<Project> = {}): Project {
  return {
    id,
    organizationId: 1,
    name: `项目 ${id}`,
    code: `PRJ-${id}`,
    description: null,
    category: 'engineering',
    status: 'active',
    priority: 'medium',
    startDate: '2026-09-01',
    endDate: '2026-12-31',
    budgetCents: 100000,
    currency: 'CNY',
    progressPercent: 50,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeChangeRequest(
  id: number,
  projectId: number,
  overrides: Partial<ChangeRequest> = {},
): ChangeRequest {
  return {
    id,
    crCode: `CR-${projectId}-${id}`,
    organizationId: 1,
    projectId,
    title: `变更请求 ${id}`,
    description: `变更描述 ${id}`,
    changeType: 'scope',
    status: 'submitted',
    priority: 'medium',
    requesterId: 1,
    approverId: null,
    requestedBy: 1,
    reviewedBy: null,
    impactSummary: null,
    impactAnalysis: null,
    conditions: null,
    decisionReason: null,
    approvalComments: null,
    submittedAt: '2026-09-10T10:00:00.000Z',
    approvedAt: null,
    implementedAt: null,
    implementedBy: null,
    closedAt: null,
    closedBy: null,
    createdAt: '2026-09-10T09:00:00.000Z',
    updatedAt: '2026-09-10T10:00:00.000Z',
    ...overrides,
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('pmo-change-queue-composer 纯函数合流与排序', () => {
  test('多项目变更数组合流且正确回填项目名称与代号元数据', () => {
    const p1 = makeProject(10, { name: '智慧园区', code: 'SP-01' })
    const p2 = makeProject(20, { name: '移动端升级', code: 'MB-02' })

    const cr1 = makeChangeRequest(101, 10, { title: '园区安防范围扩充' })
    const cr2 = makeChangeRequest(102, 10, { title: '网络接入方案调整' })
    const cr3 = makeChangeRequest(201, 20, { title: '增加深色模式适配' })

    const composed = composeCrossProjectChangeRequests({
      projects: [p1, p2],
      changeRequestsByProject: {
        10: [cr1, cr2],
        20: [cr3],
      },
    })

    expect(composed).toHaveLength(3)

    const item1 = composed.find((item) => item.id === 101)!
    expect(item1.projectName).toBe('智慧园区')
    expect(item1.projectCode).toBe('SP-01')
    expect(item1.title).toBe('园区安防范围扩充')

    const item3 = composed.find((item) => item.id === 201)!
    expect(item3.projectName).toBe('移动端升级')
    expect(item3.projectCode).toBe('MB-02')
  })

  test('支持按提交时间（submittedAt）降序与升序排列', () => {
    const p1 = makeProject(1)
    const crEarly = makeChangeRequest(1, 1, { submittedAt: '2026-09-01T00:00:00.000Z' })
    const crMid = makeChangeRequest(2, 1, { submittedAt: '2026-09-05T00:00:00.000Z' })
    const crLate = makeChangeRequest(3, 1, { submittedAt: '2026-09-10T00:00:00.000Z' })

    const items = composeCrossProjectChangeRequests({
      projects: [p1],
      changeRequestsByProject: { 1: [crMid, crLate, crEarly] },
      sort: { field: 'submittedAt', direction: 'desc' },
    })

    expect(items.map((i) => i.id)).toEqual([3, 2, 1])

    const ascItems = sortChangeQueueItems(items, { field: 'submittedAt', direction: 'asc' })
    expect(ascItems.map((i) => i.id)).toEqual([1, 2, 3])
  })

  test('支持按优先级（urgent > high > medium > low）多维排序', () => {
    const p1 = makeProject(1)
    const crLow = makeChangeRequest(1, 1, { priority: 'low' })
    const crMed = makeChangeRequest(2, 1, { priority: 'medium' })
    const crHigh = makeChangeRequest(3, 1, { priority: 'high' })
    const crUrgent = makeChangeRequest(4, 1, { priority: 'urgent' })

    const sorted = sortChangeQueueItems(
      composeCrossProjectChangeRequests({
        projects: [p1],
        changeRequestsByProject: { 1: [crLow, crHigh, crUrgent, crMed] },
      }),
      { field: 'priority', direction: 'desc' },
    )

    expect(sorted.map((i) => i.priority)).toEqual(['urgent', 'high', 'medium', 'low'])
  })

  test('mapConcurrent 严格限制最大并发通道数', async () => {
    let activeWorkers = 0
    let peakConcurrency = 0
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

    const results = await mapConcurrent(items, 3, async (num) => {
      activeWorkers++
      peakConcurrency = Math.max(peakConcurrency, activeWorkers)
      await new Promise((r) => setTimeout(r, 20))
      activeWorkers--
      return num * 2
    })

    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20])
    expect(peakConcurrency).toBeLessThanOrEqual(3)
  })
})

describe('fetchCrossProjectChangeQueue 并发网络合成与容错降级', () => {
  let recordedMethods: string[] = []
  let activeInFlightRequests = 0
  let peakInFlightRequests = 0

  beforeEach(() => {
    recordedMethods = []
    activeInFlightRequests = 0
    peakInFlightRequests = 0

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      recordedMethods.push(method)
      const url = String(input)

      activeInFlightRequests++
      peakInFlightRequests = Math.max(peakInFlightRequests, activeInFlightRequests)

      // 模拟少许网络延迟以观测并发度
      await new Promise((r) => setTimeout(r, 15))
      activeInFlightRequests--

      // 1. 项目列表端点
      if (url.includes('/projects?')) {
        return jsonResponse({
          data: [
            makeProject(1, { name: 'Alpha 战略' }),
            makeProject(2, { name: 'Beta 平台' }),
            makeProject(3, { name: 'Gamma 架构' }),
            makeProject(4, { name: 'Delta 基础设施' }),
            makeProject(5, { name: 'Epsilon 终端' }),
            makeProject(6, { name: 'Zeta 算法' }),
            makeProject(7, { name: 'Eta 运维' }),
          ],
          meta: { total: 7, page: 1, perPage: 50, totalPages: 1 },
        })
      }

      // 2. 模拟项目 4 接口异常 500
      if (url.includes('/projects/4/change-requests')) {
        return jsonResponse({ message: 'Internal Server Error' }, 500)
      }

      // 3. 其余项目的变更端点
      const match = url.match(/\/projects\/(\d+)\/change-requests/)
      if (match) {
        const pId = Number(match[1])
        return jsonResponse({
          data: [
            makeChangeRequest(pId * 10 + 1, pId, {
              title: `项目 ${pId} 核心变更`,
              submittedAt: `2026-09-0${pId}T08:00:00.000Z`,
            }),
          ],
          meta: { total: 1, page: 1, perPage: 100, totalPages: 1 },
        })
      }

      return jsonResponse({ data: [] })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('并发请求通道最大不超过 5', async () => {
    await fetchCrossProjectChangeQueue({
      concurrencyLimit: MAX_CONCURRENT_CHANNELS,
    })

    // 并发拉取 7 个项目时，峰值在飞请求绝不超过 5
    expect(peakInFlightRequests).toBeLessThanOrEqual(5)
  })

  test('单项目变更端点 500 时容错安全降级，保留其余项目数据并出具弱提示', async () => {
    const result = await fetchCrossProjectChangeQueue()

    // 项目 4 失败，其余 6 个项目成功
    expect(result.hasDegraded).toBe(true)
    expect(result.failedProjectIds).toEqual([4])
    expect(result.warningMessage).toBe('部分项目变更同步受阻')
    expect(result.items).toHaveLength(6)

    // 项目 4 不在返回列表中，其余 1, 2, 3, 5, 6, 7 正常呈现
    const projectIdsInResult = result.items.map((i) => i.projectId)
    expect(projectIdsInResult).not.toContain(4)
    expect(projectIdsInResult).toContain(1)
    expect(projectIdsInResult).toContain(7)
  })

  test('RL-01 严苛铁律：合成全流程仅发起只读 GET 请求，写请求严格为 0', async () => {
    await fetchCrossProjectChangeQueue()

    expect(recordedMethods.length).toBeGreaterThan(0)
    for (const method of recordedMethods) {
      expect(method).toBe('GET')
    }
  })
})
