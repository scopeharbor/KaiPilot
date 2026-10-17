/**
 * v3-ui-next-batch3-global-convergence W3 · 任务 3.8
 * 全域时间主轴集中失效联动与无整页刷新测试。
 *
 * 覆盖：
 * 1. invalidateTaskQueries 触发全域时间主轴 ['global-timeline'] 与跨项目任务 ['cross-project-tasks'] 失效；
 * 2. invalidateMilestoneQueries 联动触发 ['global-timeline'] 失效；
 * 3. 反应式缓存状态重对齐：预热数据在失效后被正确标记为 isInvalidated = true；
 * 4. 严苛断言操作全流程零额外整页刷新（window.location.reload 调用次数为 0）；
 * 5. 遵循硬约束：使用 vi.stubGlobal('fetch')，严禁 vi.mock('@/lib/api/*')。
 */

import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { invalidateMilestoneQueries, invalidateTaskQueries } from '@/lib/task-query-invalidation'

const PROJECT_ID = 88

describe('全域时间主轴集中失效网联动 (W3 任务 3.7 / 3.8)', () => {
  let queryClient: QueryClient
  let reloadSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: Infinity,
          staleTime: 60_000,
        },
      },
    })

    // 监控页面刷新操作，严格守护无整页刷新原则
    reloadSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        reload: reloadSpy,
      },
    })

    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    queryClient.clear()
  })

  test("invalidateTaskQueries 广播必须包含 ['global-timeline'] 与 ['cross-project-tasks'] 缓存键", async () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')

    await invalidateTaskQueries(queryClient, PROJECT_ID)

    const calledQueryKeys = spy.mock.calls.map(
      (call) => (call[0] as { queryKey: unknown[] }).queryKey,
    )

    // 断言集中失效网已覆盖全域时间主轴
    expect(calledQueryKeys).toContainEqual(['global-timeline'])
    // 断言集中失效网已覆盖跨项目任务 HUD 与个人工作桶
    expect(calledQueryKeys).toContainEqual(['cross-project-tasks'])
  })

  test("invalidateMilestoneQueries 里程碑变更同样失效 ['global-timeline'] 缓存键", async () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')

    await invalidateMilestoneQueries(queryClient, PROJECT_ID)

    const calledQueryKeys = spy.mock.calls.map(
      (call) => (call[0] as { queryKey: unknown[] }).queryKey,
    )

    expect(calledQueryKeys).toContainEqual(['global-timeline'])
  })

  test('预热的全域时间主轴缓存调用 invalidateTaskQueries 后状态标记为 isInvalidated: true', async () => {
    // 预热全域主轴与跨项目任务缓存
    queryClient.setQueryData(['global-timeline'], {
      lanes: [{ projectId: PROJECT_ID, name: '深空领航' }],
      allNodes: [],
    })
    queryClient.setQueryData(
      ['cross-project-tasks'],
      [{ id: 101, title: '跨项目待办', status: 'todo' }],
    )

    expect(queryClient.getQueryState(['global-timeline'])?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(['cross-project-tasks'])?.isInvalidated).toBe(false)

    // 执行任务集中失效
    await invalidateTaskQueries(queryClient, PROJECT_ID)

    // 缓存标记就地失效，驱动前端视图就地无感重对齐
    expect(queryClient.getQueryState(['global-timeline'])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['cross-project-tasks'])?.isInvalidated).toBe(true)
  })

  test('任务与里程碑失效联动过程严苛断言零整页刷新 (zero reload)', async () => {
    // 连续触发任务与里程碑集中失效
    await invalidateTaskQueries(queryClient, PROJECT_ID)
    await invalidateMilestoneQueries(queryClient, PROJECT_ID)

    // 断言未发生任何整页刷新
    expect(reloadSpy).not.toHaveBeenCalled()
  })
})
