import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Milestone } from '@/lib/api/milestones'
import type { Project } from '@/lib/api/projects'
import type { Task } from '@/lib/api/tasks'
import {
  calculateWeightedProgress,
  composeOrgDelayReport,
  composeOrgMilestoneReport,
  composeOrgProgressReport,
  composeOrgReportSnapshot,
  composeOrgWorkloadReport,
  fetchAndComposeOrgReport,
  mapConcurrent,
  type ProjectDataPackage,
} from '@/lib/next/org-reports-composer'
import { jsonResponse } from './helpers/chart-gallery-network'

/**
 * v3-ui-next-batch4-reports-change-queue W1 · tasks 1.5 / 1.6
 * 组织级报表数据合成器纯函数测试（next-org-reports-composer.test.tsx）
 */
describe('组织级报表数据合成器（W1 · tasks 1.5/1.6）', () => {
  const baseProject1: Project = {
    id: 101,
    organizationId: 1,
    name: '核心算法研发',
    code: 'CORE-01',
    description: null,
    category: null,
    status: 'active',
    priority: 'high',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    budgetCents: null,
    currency: null,
    progressPercent: 40,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }

  const baseProject2: Project = {
    id: 102,
    organizationId: 1,
    name: '云端控制台重构',
    code: 'CLOUD-02',
    description: null,
    category: null,
    status: 'active',
    priority: 'medium',
    startDate: '2026-02-01',
    endDate: '2026-11-30',
    budgetCents: null,
    currency: null,
    progressPercent: 80,
    healthStatus: 'warning',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }

  function makeTask(overrides: Partial<Task> = {}): Task {
    return {
      id: 1,
      projectId: 101,
      name: '测试任务',
      description: null,
      status: 'in_progress',
      priority: 'medium',
      taskType: 'task',
      startDate: '2026-03-01',
      endDate: '2026-03-15',
      actualStartDate: null,
      actualEndDate: null,
      durationDays: 14,
      estimatedHours: 20,
      actualHours: 15,
      progressPercent: 50,
      assigneeId: 10,
      reviewerId: null,
      parentTaskId: null,
      wbsNodeId: null,
      milestoneId: null,
      costEstimateCents: null,
      costActualCents: null,
      customFields: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    }
  }

  function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
    return {
      id: 1,
      projectId: 101,
      name: '里程碑 M1',
      description: null,
      plannedDate: '2026-04-01',
      status: 'planned',
      storedStatus: 'planned',
      autoCalculated: true,
      displayOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    }
  }

  describe('1. 加权平均进度计算 (calculateWeightedProgress)', () => {
    test('按任务总数加权平均计算组织总进度', () => {
      // 项目 1: 10 个任务，进度 20% -> 权数 200
      // 项目 2: 30 个任务，进度 60% -> 权数 1800
      // 总任务数: 40，加权进度 = (200 + 1800) / 40 = 50%
      const result = calculateWeightedProgress([
        { progressPercent: 20, totalTasks: 10 },
        { progressPercent: 60, totalTasks: 30 },
      ])
      expect(result).toBe(50)
    })

    test('当项目无任务数（总任务为 0）时，回退到项目进度算术均值', () => {
      const result = calculateWeightedProgress([
        { progressPercent: 30, totalTasks: 0 },
        { progressPercent: 70, totalTasks: 0 },
      ])
      expect(result).toBe(50)
    })

    test('自动剔除降级项目（isDegraded: true），避免污染正常均值', () => {
      const result = calculateWeightedProgress([
        { progressPercent: 80, totalTasks: 20, isDegraded: false },
        { progressPercent: 0, totalTasks: 0, isDegraded: true },
      ])
      expect(result).toBe(80)
    })

    test('空项目列表返回 0', () => {
      expect(calculateWeightedProgress([])).toBe(0)
    })
  })

  describe('2. 进度概览快照合成 (composeOrgProgressReport)', () => {
    test('正确累加多项目任务状态分布与识别阻塞项', () => {
      const packages: ProjectDataPackage[] = [
        {
          project: baseProject1,
          tasks: [
            makeTask({ id: 1, status: 'completed' }),
            makeTask({ id: 2, status: 'in_progress' }),
            makeTask({ id: 3, status: 'blocked', name: '数据库死锁阻塞' }),
          ],
          milestones: [],
        },
        {
          project: baseProject2,
          tasks: [
            makeTask({ id: 4, projectId: 102, status: 'completed' }),
            makeTask({ id: 5, projectId: 102, status: 'not_started' }),
          ],
          milestones: [],
        },
      ]

      const report = composeOrgProgressReport(packages)

      expect(report.template).toBe('progress')
      expect(report.totalProjects).toBe(2)
      expect(report.activeProjects).toBe(2)
      expect(report.totalTasks).toBe(5)
      expect(report.completedTasks).toBe(2)
      expect(report.inProgressTasks).toBe(1)
      expect(report.notStartedTasks).toBe(1)
      expect(report.blockedTasks).toBe(1)
      expect(report.taskCompletionRate).toBe(40) // 2 / 5 = 40%

      expect(report.criticalBlockers).toHaveLength(1)
      expect(report.criticalBlockers[0]?.title).toBe('数据库死锁阻塞')
      expect(report.criticalBlockers[0]?.projectId).toBe(101)
    })
  })

  describe('3. 延期全景快照合成 (composeOrgDelayReport)', () => {
    test('正确判定逾期任务、计算延期率与最大/平均逾期天数', () => {
      const fixedToday = '2026-05-10'

      const packages: ProjectDataPackage[] = [
        {
          project: baseProject1,
          tasks: [
            // 已完成任务：即使截止日早于 today 也不计入逾期
            makeTask({ id: 1, endDate: '2026-05-01', status: 'completed' }),
            // 未完成且截止日早于 today：逾期 9 天 (2026-05-01 到 2026-05-10)
            makeTask({ id: 2, endDate: '2026-05-01', status: 'in_progress', priority: 'highest' }),
            // 未完成且截止日早于 today：逾期 5 天 (2026-05-05 到 2026-05-10)
            makeTask({ id: 3, endDate: '2026-05-05', status: 'not_started' }),
            // 未到期任务：截止日晚于 today
            makeTask({ id: 4, endDate: '2026-06-01', status: 'in_progress' }),
          ],
          milestones: [],
        },
      ]

      const report = composeOrgDelayReport(packages, { today: fixedToday })

      expect(report.template).toBe('delay')
      expect(report.totalTasksWithDueDate).toBe(4)
      expect(report.totalOverdueTasks).toBe(2)
      expect(report.overallDelayRatePercent).toBe(50) // 2 / 4 = 50%
      expect(report.maxOverdueDays).toBe(9)
      expect(report.averageOverdueDays).toBe(7) // (9 + 5) / 2 = 7

      expect(report.topOverdueTasks).toHaveLength(2)
      expect(report.topOverdueTasks[0]?.taskId).toBe(2)
      expect(report.topOverdueTasks[0]?.overdueDays).toBe(9)
      expect(report.topOverdueTasks[0]?.onCriticalPath).toBe(true)
    })
  })

  describe('4. 组织资源工时负荷快照合成 (composeOrgWorkloadReport)', () => {
    test('按成员跨项目聚合工时，并标出超负荷成员', () => {
      const packages: ProjectDataPackage[] = [
        {
          project: baseProject1,
          tasks: [
            // 用户 10 在项目 1 投入 30h
            makeTask({ id: 1, assigneeId: 10, estimatedHours: 30, actualHours: 25 }),
            // 未分配任务 10h
            makeTask({ id: 2, assigneeId: null, estimatedHours: 10, actualHours: 0 }),
          ],
          milestones: [],
        },
        {
          project: baseProject2,
          tasks: [
            // 用户 10 在项目 2 投入 20h -> 合计 50h（> 40h，触发 overloadHint）
            makeTask({ id: 3, assigneeId: 10, estimatedHours: 20, actualHours: 15 }),
            // 用户 20 投入 15h -> 正常
            makeTask({ id: 4, assigneeId: 20, estimatedHours: 15, actualHours: 10 }),
          ],
          milestones: [],
        },
      ]

      const report = composeOrgWorkloadReport(packages)

      expect(report.template).toBe('workload')
      expect(report.totalProjects).toBe(2)
      expect(report.totalMembers).toBe(2)
      expect(report.totalPlannedHours).toBe(75) // 30 + 10 + 20 + 15
      expect(report.totalActualHours).toBe(50) // 25 + 0 + 15 + 10
      expect(report.unassignedTasksCount).toBe(1)
      expect(report.unassignedPlannedHours).toBe(10)
      expect(report.overallocatedMemberCount).toBe(1)

      const member10 = report.memberWorkloads.find((m) => m.userId === 10)
      expect(member10?.plannedHours).toBe(50)
      expect(member10?.actualHours).toBe(40)
      expect(member10?.projectCount).toBe(2)
      expect(member10?.overloadHint).toBe(true)

      const member20 = report.memberWorkloads.find((m) => m.userId === 20)
      expect(member20?.overloadHint).toBe(false)
    })
  })

  describe('5. 里程碑交付全景快照合成 (composeOrgMilestoneReport)', () => {
    test('计算跨项目里程碑交付率与风险里程碑识别', () => {
      const fixedToday = '2026-06-01'

      const packages: ProjectDataPackage[] = [
        {
          project: baseProject1,
          tasks: [],
          milestones: [
            makeMilestone({ id: 1, status: 'achieved', plannedDate: '2026-04-01' }),
            makeMilestone({ id: 2, status: 'missed', plannedDate: '2026-05-01' }),
            makeMilestone({ id: 3, status: 'at_risk', plannedDate: '2026-07-01' }),
            makeMilestone({ id: 4, status: 'planned', plannedDate: '2026-08-01' }),
          ],
        },
      ]

      const report = composeOrgMilestoneReport(packages, { today: fixedToday })

      expect(report.template).toBe('milestone')
      expect(report.totalMilestones).toBe(4)
      expect(report.completedMilestones).toBe(1)
      expect(report.overdueMilestones).toBe(1)
      expect(report.upcomingMilestones).toBe(2)
      expect(report.deliveryRatePercent).toBe(25) // 1 / 4 = 25%

      expect(report.atRiskMilestones).toHaveLength(2)
      expect(report.atRiskMilestones.map((r) => r.milestoneId)).toContain(2)
      expect(report.atRiskMilestones.map((r) => r.milestoneId)).toContain(3)
    })
  })

  describe('6. 快照组装与安全降级兜底 (composeOrgReportSnapshot)', () => {
    test('单项目异常标记时生成 warnings 并回显 degradedProjectIds', () => {
      const packages: ProjectDataPackage[] = [
        {
          project: baseProject1,
          tasks: [makeTask({ id: 1, status: 'completed' })],
          milestones: [],
          isDegraded: false,
        },
        {
          project: baseProject2,
          tasks: [],
          milestones: [],
          isDegraded: true,
          errorMessage: '500 Internal Server Error',
        },
      ]

      const snapshot = composeOrgReportSnapshot({
        template: 'progress',
        organizationId: 1,
        packages,
      })

      expect(snapshot.metadata.includedProjectIds).toEqual([101, 102])
      expect(snapshot.metadata.degradedProjectIds).toEqual([102])
      expect(snapshot.metadata.warnings).toHaveLength(1)
      expect(snapshot.metadata.warnings[0]?.level).toBe('warning')
      expect(snapshot.metadata.warnings[0]?.message).toContain('云端控制台重构')
      expect(snapshot.data.template).toBe('progress')
      // 整体未崩溃，正常聚合了项目 1 的数据
      if (snapshot.data.template === 'progress') {
        expect(snapshot.data.completedTasks).toBe(1)
      }
    })
  })

  describe('7. 轻量并发控制器 (mapConcurrent)', () => {
    test('严格限制并发执行数不超过 limit，且维持原顺序', async () => {
      const items = [1, 2, 3, 4, 5, 6, 7]
      let activeCount = 0
      let maxSeenActive = 0

      const results = await mapConcurrent(items, 3, async (val) => {
        activeCount++
        if (activeCount > maxSeenActive) maxSeenActive = activeCount
        await new Promise((resolve) => setTimeout(resolve, 10))
        activeCount--
        return val * 10
      })

      expect(maxSeenActive).toBeLessThanOrEqual(3)
      expect(results).toEqual([10, 20, 30, 40, 50, 60, 70])
    })

    test('空数组安全返回', async () => {
      const res = await mapConcurrent([], 5, async () => 1)
      expect(res).toEqual([])
    })
  })

  describe('8. 异步多查询并发提取与容错合成 (fetchAndComposeOrgReport)', () => {
    const recordedRequests: Array<{ url: string; method: string }> = []

    beforeEach(() => {
      recordedRequests.length = 0
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const method = (init?.method ?? 'GET').toUpperCase()
        recordedRequests.push({ url, method })

        if (url.includes('/projects?')) {
          return jsonResponse(200, {
            data: [baseProject1, baseProject2],
            meta: { total: 2, page: 1, perPage: 50, totalPages: 1 },
          })
        }

        if (url.includes('/projects/101/tasks')) {
          return jsonResponse(200, {
            data: [makeTask({ id: 1011, projectId: 101, status: 'completed' })],
          })
        }

        if (url.includes('/projects/101/milestones')) {
          return jsonResponse(200, {
            data: [makeMilestone({ id: 1012, projectId: 101, status: 'achieved' })],
          })
        }

        // 项目 102 模拟接口 500 报错
        if (url.includes('/projects/102/tasks')) {
          return jsonResponse(500, { message: 'DB Connection Error' })
        }

        if (url.includes('/projects/102/milestones')) {
          return jsonResponse(500, { message: 'DB Timeout' })
        }

        return jsonResponse(404, {})
      })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    test('并发抓取项目数据、单个项目 500 时安全降级、全流程零写请求 (RL-01)', async () => {
      const snapshot = await fetchAndComposeOrgReport(1, {
        template: 'progress',
        concurrency: 2,
      })

      expect(snapshot.template).toBe('progress')
      expect(snapshot.metadata.includedProjectIds).toEqual([101, 102])
      expect(snapshot.metadata.degradedProjectIds).toEqual([102])

      // 验证网络请求：全部为 GET，零写请求 (RL-01)
      const writeRequests = recordedRequests.filter((r) =>
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method),
      )
      expect(writeRequests).toHaveLength(0)

      // 正常项目 101 的任务被计入
      if (snapshot.data.template === 'progress') {
        expect(snapshot.data.completedTasks).toBe(1)
      }
    })

    test('传入 projectIds 时只检索指定项目', async () => {
      const snapshot = await fetchAndComposeOrgReport(1, {
        template: 'progress',
        projectIds: [101],
      })

      expect(snapshot.metadata.includedProjectIds).toEqual([101])
      expect(snapshot.metadata.degradedProjectIds).toHaveLength(0)
    })
  })
})
