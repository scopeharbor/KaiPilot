import { test } from '@japa/runner'
import MarkdownRenderer from '#services/report_exporters/markdown_renderer'
import CsvRenderer from '#services/report_exporters/csv_renderer'
import type { RenderReportMeta } from '#services/report_exporters/renderer_contract'
import type {
  DelaySnapshot,
  MilestoneSnapshot,
  ProgressSnapshot,
  ReportSnapshotMetadata,
  ReportWarning,
  WorkloadSnapshot,
} from '@aiproj/types'

/**
 * preset-project-reports —— Markdown / CSV 渲染器单元测试（tasks 5.6 / 7.3 覆盖率兜底）。
 *
 * 覆盖：
 *   - 四模板 × 「满数据」×「空数组」× 「带 warnings」路径都执行一遍；
 *   - Markdown escapeMd 对 `|` 与 `\r?\n` 的替换；
 *   - Markdown STATUS_CN 缺省 fallback；
 *   - CSV escapeCsv 对 `,` / `"` / 换行的 RFC 4180 包裹；
 *   - CSV BOM + `\r\n` 分隔；
 *   - generatedByName 缺省时头部 fallback（`用户 #<id>`）。
 *
 * 渲染器是纯函数，不需要 DB，可用最小 fixture。
 */

// ---------- fixture --------------------------------------------------------

function makeMeta(overrides: Partial<RenderReportMeta> = {}): RenderReportMeta {
  return {
    reportId: 42,
    title: '2026-07 快照',
    projectName: '示范项目',
    generatedAt: '2026-07-08T00:00:00.000Z',
    generatedByName: 'Alice',
    ...overrides,
  }
}

function makeSnapshotMeta(warnings: ReportWarning[] = []): ReportSnapshotMetadata {
  return {
    templateVersion: '1.0',
    generatedAt: '2026-07-08T00:00:00.000Z',
    generatedBy: 9,
    sourceRange: {},
    sourceDataHash: 'abc123',
    warnings,
  }
}

function progressFull(warnings: ReportWarning[] = []): ProgressSnapshot {
  return {
    template: 'progress',
    summary: {
      projectId: 1,
      projectName: '示范',
      overallProgressPercent: 66,
      totalTasks: 10,
      completedTasks: 6,
      inProgressTasks: 2,
      notStartedTasks: 1,
      blockedTasks: 1,
    },
    statusDistribution: [
      { status: 'completed', count: 6, ratio: 0.6 },
      // 未知状态用于测 STATUS_CN fallback 分支
      { status: 'custom_state_x', count: 1, ratio: 0.1 },
    ],
    wbsSummaries: [
      {
        wbsNodeId: 11,
        code: '1.1',
        // 名称含 `|` 与换行，测 escapeMd 两条 replace
        name: '规划|阶段\n换行',
        totalTasks: 5,
        completedTasks: 3,
        progressPercent: 60,
      },
    ],
    criticalTasks: [
      {
        taskId: 100,
        title: '关键任务A',
        status: 'unknown_status',
        progressPercent: 40,
        assigneeName: 'Bob',
        dueDate: '2026-08-01',
      },
    ],
    blockers: [{ taskId: 200, title: '阻塞任务', reason: '缺依赖' }],
    snapshotMetadata: makeSnapshotMeta(warnings),
  }
}

function progressEmpty(): ProgressSnapshot {
  return {
    template: 'progress',
    summary: {
      projectId: 1,
      projectName: '空项目',
      overallProgressPercent: 0,
      totalTasks: 0,
      completedTasks: 0,
      inProgressTasks: 0,
      notStartedTasks: 0,
      blockedTasks: 0,
    },
    statusDistribution: [],
    wbsSummaries: [],
    criticalTasks: [],
    blockers: [],
    snapshotMetadata: makeSnapshotMeta(),
  }
}

function delayFull(): DelaySnapshot {
  return {
    template: 'delay',
    summary: {
      projectId: 1,
      projectName: '示范',
      totalTasksWithDueDate: 5,
      overdueTasks: 2,
      upcomingTasks: 1,
      delayRatePercent: 40,
      averageOverdueDays: 3,
      maxOverdueDays: 5,
    },
    overdueTasks: [
      {
        taskId: 1,
        title: '延期A',
        assigneeName: 'Carol',
        plannedEndDate: '2026-07-01',
        actualEndDate: null,
        overdueDays: 5,
        onCriticalPath: true,
      },
      {
        taskId: 2,
        title: '延期B',
        // assigneeName undefined → 走 `?? '-'` 分支
        plannedEndDate: null,
        actualEndDate: '2026-07-05',
        overdueDays: 1,
        onCriticalPath: false,
      },
    ],
    upcomingTasks: [
      { taskId: 3, title: '即将到期', plannedEndDate: '2026-07-15', daysUntilDue: 7 },
    ],
    dependencyWarnings: [{ fromTaskId: 1, toTaskId: 2, reason: '依赖含|管道' }],
    snapshotMetadata: makeSnapshotMeta(),
  }
}

function delayEmpty(): DelaySnapshot {
  return {
    template: 'delay',
    summary: {
      projectId: 1,
      projectName: '空项目',
      totalTasksWithDueDate: 0,
      overdueTasks: 0,
      upcomingTasks: 0,
      delayRatePercent: 0,
      averageOverdueDays: 0,
      maxOverdueDays: 0,
    },
    overdueTasks: [],
    upcomingTasks: [],
    dependencyWarnings: [],
    snapshotMetadata: makeSnapshotMeta(),
  }
}

function workloadFull(): WorkloadSnapshot {
  return {
    template: 'workload',
    summary: {
      projectId: 1,
      projectName: '示范',
      totalAssignees: 2,
      totalPlannedHours: 40,
      totalActualHours: 32,
      unassigned: { totalTasks: 1, plannedHours: 4 },
    },
    byAssignee: [
      {
        userId: 10,
        displayName: 'David',
        totalTasks: 4,
        completedTasks: 2,
        inProgressTasks: 1,
        notStartedTasks: 1,
        plannedHours: 20,
        actualHours: 18,
        overloadHint: true,
      },
      {
        userId: 11,
        displayName: 'Eve',
        totalTasks: 3,
        completedTasks: 3,
        inProgressTasks: 0,
        notStartedTasks: 0,
        plannedHours: 20,
        actualHours: 14,
        overloadHint: false,
      },
    ],
    snapshotMetadata: makeSnapshotMeta(),
  }
}

function workloadEmpty(): WorkloadSnapshot {
  return {
    template: 'workload',
    summary: {
      projectId: 1,
      projectName: '空项目',
      totalAssignees: 0,
      totalPlannedHours: 0,
      totalActualHours: 0,
      unassigned: { totalTasks: 0, plannedHours: 0 },
    },
    byAssignee: [],
    snapshotMetadata: makeSnapshotMeta(),
  }
}

function milestoneFull(): MilestoneSnapshot {
  return {
    template: 'milestone',
    summary: {
      projectId: 1,
      projectName: '示范',
      totalMilestones: 2,
      completedMilestones: 1,
      overdueMilestones: 1,
      upcomingMilestones: 0,
    },
    milestones: [
      {
        milestoneId: 1,
        name: 'M1',
        plannedDate: '2026-06-01',
        status: 'completed',
        linkedTaskCount: 3,
        linkedTaskCompletedCount: 3,
        linkedTaskProgressPercent: 100,
        overdueDays: 0,
        autoCalculated: false,
      },
      {
        milestoneId: 2,
        name: 'M2 "带引号,逗号"',
        plannedDate: '2026-07-01',
        status: 'overdue',
        linkedTaskCount: 4,
        linkedTaskCompletedCount: 2,
        linkedTaskProgressPercent: 50,
        overdueDays: 7,
        autoCalculated: true,
      },
    ],
    risks: [{ milestoneId: 2, name: 'M2 "带引号,逗号"', reason: '进度不足,含逗号' }],
    snapshotMetadata: makeSnapshotMeta(),
  }
}

function milestoneEmpty(): MilestoneSnapshot {
  return {
    template: 'milestone',
    summary: {
      projectId: 1,
      projectName: '空项目',
      totalMilestones: 0,
      completedMilestones: 0,
      overdueMilestones: 0,
      upcomingMilestones: 0,
    },
    milestones: [],
    risks: [],
    snapshotMetadata: makeSnapshotMeta(),
  }
}

// ---------- Markdown -------------------------------------------------------

test.group('MarkdownRenderer', () => {
  const renderer = new MarkdownRenderer()

  test('progress 满数据：分节齐、STATUS_CN 覆盖 & fallback、escapeMd 处理管道与换行', ({
    assert,
  }) => {
    const out = renderer.render(
      progressFull([
        { level: 'warning', message: '资源模块未启用' },
        { level: 'info', message: '仅示例' },
      ]),
      makeMeta(),
    )
    const md = out.content.toString('utf-8')

    assert.equal(out.format, 'markdown')
    assert.equal(out.extension, 'md')
    assert.match(out.mimeType, /markdown/)

    assert.include(md, '# 2026-07 快照')
    assert.include(md, '## 项目进度摘要')
    assert.include(md, '## 状态分布')
    assert.include(md, '| 已完成 | 6 | 60.0% |')
    // STATUS_CN fallback：未知状态原样保留
    assert.include(md, '| custom_state_x | 1 | 10.0% |')
    // WBS 名称的 `|` 被转义、换行被替换为空格
    assert.include(md, '规划\\|阶段 换行')
    assert.notMatch(md, /规划\|阶段/) // 未转义原样不应出现
    // 关键任务状态未知也应 fallback
    assert.include(md, 'unknown_status')
    assert.include(md, '## 阻塞项')
    assert.include(md, '## 说明与警告')
    assert.include(md, '**[warning]** 资源模块未启用')
    assert.include(md, '**[info]** 仅示例')
  })

  test('progress 空数据：可选分节全部省略，warnings 段不出现', ({ assert }) => {
    const md = renderer.render(progressEmpty(), makeMeta()).content.toString('utf-8')
    assert.include(md, '## 项目进度摘要')
    assert.include(md, '## 状态分布')
    assert.notInclude(md, '## WBS 摘要')
    assert.notInclude(md, '## 关键任务')
    assert.notInclude(md, '## 阻塞项')
    assert.notInclude(md, '## 说明与警告')
  })

  test('delay 满数据：延期/即将到期/依赖 warning 三节 + assigneeName 缺省显示 -', ({ assert }) => {
    const md = renderer.render(delayFull(), makeMeta()).content.toString('utf-8')
    assert.include(md, '## 延期摘要')
    assert.include(md, '## 已延期任务')
    // 第二条无 assigneeName → 单元格显示 `-`
    assert.match(md, /延期B \| - \|/)
    assert.include(md, '## 即将到期')
    assert.include(md, '## 依赖 warning')
    assert.include(md, '依赖含\\|管道')
  })

  test('delay 空数据：仅摘要段，不含明细分节', ({ assert }) => {
    const md = renderer.render(delayEmpty(), makeMeta()).content.toString('utf-8')
    assert.include(md, '## 延期摘要')
    assert.notInclude(md, '## 已延期任务')
    assert.notInclude(md, '## 即将到期')
    assert.notInclude(md, '## 依赖 warning')
  })

  test('workload 满数据：byAssignee 表格 + 过载图标显示', ({ assert }) => {
    const md = renderer.render(workloadFull(), makeMeta()).content.toString('utf-8')
    assert.include(md, '## 工作量摘要')
    assert.include(md, '## 按负责人分布')
    // 过载 hint=true 用 ⚠️
    assert.match(md, /David \|.*⚠️/)
    // 过载 hint=false 用 -
    assert.match(md, /Eve \|.*\| - \|/)
  })

  test('workload 空数据：仅摘要', ({ assert }) => {
    const md = renderer.render(workloadEmpty(), makeMeta()).content.toString('utf-8')
    assert.include(md, '## 工作量摘要')
    assert.notInclude(md, '## 按负责人分布')
  })

  test('milestone 满数据：里程碑列表 + 风险提示两节', ({ assert }) => {
    const md = renderer.render(milestoneFull(), makeMeta()).content.toString('utf-8')
    assert.include(md, '## 里程碑摘要')
    assert.include(md, '## 里程碑列表')
    assert.include(md, '## 风险提示')
    // markdown 里 escapeMd 只处理 `|` 和 换行；`,`/`"` 不动
    assert.include(md, 'M2 "带引号,逗号"')
  })

  test('milestone 空数据：仅摘要', ({ assert }) => {
    const md = renderer.render(milestoneEmpty(), makeMeta()).content.toString('utf-8')
    assert.include(md, '## 里程碑摘要')
    assert.notInclude(md, '## 里程碑列表')
    assert.notInclude(md, '## 风险提示')
  })

  test('generatedByName 缺省时头部 fallback 到 `用户 #<id>`', ({ assert }) => {
    const md = renderer
      .render(progressEmpty(), makeMeta({ generatedByName: undefined }))
      .content.toString('utf-8')
    assert.include(md, '用户 #9')
  })
})

// ---------- CSV ------------------------------------------------------------

test.group('CsvRenderer', () => {
  const renderer = new CsvRenderer()

  test('输出以 UTF-8 BOM 起始，行分隔使用 CRLF', ({ assert }) => {
    const out = renderer.render(progressEmpty(), makeMeta())
    assert.equal(out.format, 'csv')
    assert.equal(out.extension, 'csv')
    assert.match(out.mimeType, /csv/)

    // BOM = 0xEF 0xBB 0xBF
    assert.equal(out.content[0], 0xef)
    assert.equal(out.content[1], 0xbb)
    assert.equal(out.content[2], 0xbf)

    const body = out.content.slice(3).toString('utf-8')
    assert.include(body, '\r\n')
    assert.include(body, '## 报表元数据')
  })

  test('progress 满数据：状态分布、WBS、关键任务、阻塞项、warnings 各段都出现', ({ assert }) => {
    const body = renderer
      .render(progressFull([{ level: 'critical', message: '依赖存在环路' }]), makeMeta())
      .content.slice(3)
      .toString('utf-8')

    assert.include(body, '## 进度摘要')
    assert.include(body, '## 状态分布')
    assert.include(body, '## WBS 摘要')
    assert.include(body, '## 关键任务')
    assert.include(body, '## 阻塞项')
    assert.include(body, '## 说明与警告')
    assert.include(body, 'critical,依赖存在环路')
  })

  test('progress 空数据：可选分节整体省略', ({ assert }) => {
    const body = renderer.render(progressEmpty(), makeMeta()).content.slice(3).toString('utf-8')
    assert.include(body, '## 进度摘要')
    assert.include(body, '## 状态分布')
    assert.notInclude(body, '## WBS 摘要')
    assert.notInclude(body, '## 关键任务')
    assert.notInclude(body, '## 阻塞项')
    assert.notInclude(body, '## 说明与警告')
  })

  test('delay 满数据：三节导出', ({ assert }) => {
    const body = renderer.render(delayFull(), makeMeta()).content.slice(3).toString('utf-8')
    assert.include(body, '## 延期摘要')
    assert.include(body, '## 已延期任务')
    assert.include(body, '## 即将到期')
    assert.include(body, '## 依赖 warning')
  })

  test('delay 空数据：仅摘要', ({ assert }) => {
    const body = renderer.render(delayEmpty(), makeMeta()).content.slice(3).toString('utf-8')
    assert.include(body, '## 延期摘要')
    assert.notInclude(body, '## 已延期任务')
    assert.notInclude(body, '## 即将到期')
    assert.notInclude(body, '## 依赖 warning')
  })

  test('workload 满数据：byAssignee 段', ({ assert }) => {
    const body = renderer.render(workloadFull(), makeMeta()).content.slice(3).toString('utf-8')
    assert.include(body, '## 工作量摘要')
    assert.include(body, '## 负责人分布')
  })

  test('workload 空数据：仅摘要', ({ assert }) => {
    const body = renderer.render(workloadEmpty(), makeMeta()).content.slice(3).toString('utf-8')
    assert.include(body, '## 工作量摘要')
    assert.notInclude(body, '## 负责人分布')
  })

  test('milestone 满数据：里程碑列表 + 风险 + RFC4180 双引号包裹逗号/引号', ({ assert }) => {
    const body = renderer.render(milestoneFull(), makeMeta()).content.slice(3).toString('utf-8')
    assert.include(body, '## 里程碑摘要')
    assert.include(body, '## 里程碑列表')
    assert.include(body, '## 风险提示')
    // 含 `,` 或 `"` 的字段必须被双引号包裹、内部 `"` → `""`
    assert.include(body, '"M2 ""带引号,逗号"""')
    // 风险原因含 `,` 也要包裹
    assert.include(body, '"进度不足,含逗号"')
  })

  test('milestone 空数据：仅摘要', ({ assert }) => {
    const body = renderer.render(milestoneEmpty(), makeMeta()).content.slice(3).toString('utf-8')
    assert.include(body, '## 里程碑摘要')
    assert.notInclude(body, '## 里程碑列表')
    assert.notInclude(body, '## 风险提示')
  })

  test('generatedByName 缺省时元数据段回退 `用户 #<id>`', ({ assert }) => {
    const body = renderer
      .render(progressEmpty(), makeMeta({ generatedByName: undefined }))
      .content.slice(3)
      .toString('utf-8')
    assert.include(body, '用户 #9')
  })
})
