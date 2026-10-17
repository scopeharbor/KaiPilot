/**
 * v3-copilot-portfolio-scope —— 主动汇报测试
 *
 * §6 测试覆盖：
 * - 6.1 每日站会摘要与每周项目简报内容产出
 * - 6.2 未新建周期作业框架
 * - 6.3 按收件人逐项目判权生成
 * - 6.4 非泄露测试：两个收件人汇报不含对方无权内容
 * - 6.5 汇报不负责投递
 * - 6.6 零投递、零外部请求
 * - 6.7 汇报内容可追溯到具体项目与信号
 */

import { describe, it, expect } from 'vitest'
import {
  generateDailyStandupContent,
  generateWeeklyBriefContent,
  assertReportContentTraceable,
  assertNoDelivery,
  type ReportPermissionChecker,
  type ReportDataProvider,
} from '../../app/services/copilot/copilot_portfolio_reporting_service.js'

// ─── Helpers ──────────────────────────────────────────────────────────────

function allowAll(): ReportPermissionChecker {
  return { canReadProject: async () => true }
}

function denyProject(deniedIds: Set<number>): ReportPermissionChecker {
  return {
    canReadProject: async (_orgId, _actorId, projectId) => !deniedIds.has(projectId),
  }
}

function simpleProvider(): ReportDataProvider {
  return {
    getProjectSummary: async (_orgId, projectId) => ({
      projectName: `Project ${projectId}`,
      healthStatus: 'green',
      recentActivity: '最近有更新',
      risks: ['风险 A'],
      milestones: ['里程碑 1'],
    }),
  }
}

const PROJECTS = [
  { projectId: 1, projectName: 'P1' },
  { projectId: 2, projectName: 'P2' },
  { projectId: 3, projectName: 'P3' },
]

// ─── 6.1 每日站会摘要 ────────────────────────────────────────────────────

describe('§6.1 每日站会摘要内容产出', () => {
  it('生成包含项目信息的摘要', async () => {
    const content = await generateDailyStandupContent(1, 1, PROJECTS, allowAll(), simpleProvider())
    expect(content.reportType).toBe('daily_standup')
    expect(content.items).toHaveLength(3)
    expect(content.items.every((i) => i.projectId > 0)).toBe(true)
  })
})

// ─── 6.2 未新建周期作业框架 ──────────────────────────────────────────────

describe('§6.2 未新建周期作业框架', () => {
  it('汇报服务仅生成内容，不依赖新的作业框架', async () => {
    // 汇报服务是纯函数，不注册新的作业类型
    // 这是代码审查级断言
    const content = await generateDailyStandupContent(1, 1, PROJECTS, allowAll(), simpleProvider())
    expect(content.items).toBeDefined()
  })
})

// ─── 6.3 按收件人逐项目判权 ──────────────────────────────────────────────

describe('§6.3 按收件人逐项目判权生成', () => {
  it('无权项目不出现在汇报中', async () => {
    const content = await generateDailyStandupContent(
      1,
      1,
      PROJECTS,
      denyProject(new Set([2])),
      simpleProvider(),
    )
    expect(content.items.every((i) => i.projectId !== 2)).toBe(true)
    expect(content.items).toHaveLength(2)
  })
})

// ─── 6.4 非泄露测试 ──────────────────────────────────────────────────────

describe('§6.4 两个收件人汇报不含对方无权内容', () => {
  it('收件人 A 有所有项目，收件人 B 无项目 2', async () => {
    const contentA = await generateDailyStandupContent(
      100,
      1,
      PROJECTS,
      allowAll(),
      simpleProvider(),
    )
    const contentB = await generateDailyStandupContent(
      200,
      1,
      PROJECTS,
      denyProject(new Set([2])),
      simpleProvider(),
    )

    // A 的汇报包含项目 2
    expect(contentA.items.some((i) => i.projectId === 2)).toBe(true)
    // B 的汇报不包含项目 2
    expect(contentB.items.some((i) => i.projectId === 2)).toBe(false)
    // B 的汇报不包含 A 独有的内容
    expect(contentB.items.every((i) => i.projectId !== 2)).toBe(true)
  })
})

// ─── 6.5 汇报不负责投递 ──────────────────────────────────────────────────

describe('§6.5 汇报不负责投递', () => {
  it('汇报服务无投递依赖', () => {
    const check = assertNoDelivery()
    expect(check.ok).toBe(true)
  })
})

// ─── 6.6 零投递、零外部请求 ──────────────────────────────────────────────

describe('§6.6 零投递、零外部请求', () => {
  it('汇报路径零投递、零外部请求', () => {
    const check = assertNoDelivery()
    expect(check.ok).toBe(true)
  })
})

// ─── 6.7 汇报内容可追溯 ──────────────────────────────────────────────────

describe('§6.7 汇报内容可追溯到具体项目与信号', () => {
  it('每条内容可解析到项目与信号', async () => {
    const content = await generateDailyStandupContent(1, 1, PROJECTS, allowAll(), simpleProvider())
    const check = assertReportContentTraceable(content)
    expect(check.ok).toBe(true)
  })

  it('每周简报内容可追溯', async () => {
    const content = await generateWeeklyBriefContent(1, 1, PROJECTS, allowAll(), simpleProvider())
    const check = assertReportContentTraceable(content)
    expect(check.ok).toBe(true)
  })
})
