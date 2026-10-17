import type {
  DelaySnapshot,
  MilestoneSnapshot,
  ProgressSnapshot,
  ReportSnapshot,
  WorkloadSnapshot,
} from '@aiproj/types'
import type { RenderReportMeta, RenderedReport, ReportRenderer } from './renderer_contract.js'

const STATUS_CN: Record<string, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '阻塞',
  on_hold: '暂停',
  cancelled: '已取消',
}

/**
 * Markdown 渲染器（design D5）。
 *
 * 结构：
 *   1. 报表标题 + 元数据头（项目、报表 id、生成者、生成时间、来源数据指纹）
 *   2. 摘要 summary（表格）
 *   3. 各模板专属分节
 *   4. warnings 列表（若非空）
 *
 * 全部内容基于 `data_snapshot`，禁止在渲染阶段再查 DB。
 */
export default class MarkdownRenderer implements ReportRenderer {
  readonly format = 'markdown' as const

  render(snapshot: ReportSnapshot, meta: RenderReportMeta): RenderedReport {
    const lines: string[] = []
    lines.push(`# ${meta.title}`)
    lines.push('')
    lines.push(this.headerBlock(snapshot, meta))
    lines.push('')

    switch (snapshot.template) {
      case 'progress':
        lines.push(...this.renderProgress(snapshot))
        break
      case 'delay':
        lines.push(...this.renderDelay(snapshot))
        break
      case 'workload':
        lines.push(...this.renderWorkload(snapshot))
        break
      case 'milestone':
        lines.push(...this.renderMilestone(snapshot))
        break
    }

    const warnings = snapshot.snapshotMetadata.warnings ?? []
    if (warnings.length > 0) {
      lines.push('')
      lines.push('## 说明与警告')
      for (const w of warnings) {
        lines.push(`- **[${w.level}]** ${w.message}`)
      }
    }

    return {
      format: this.format,
      mimeType: 'text/markdown; charset=utf-8',
      extension: 'md',
      content: Buffer.from(lines.join('\n') + '\n', 'utf-8'),
    }
  }

  // --- 头部 -----------------------------------------------------------------

  private headerBlock(snapshot: ReportSnapshot, meta: RenderReportMeta): string {
    const m = snapshot.snapshotMetadata
    const rows = [
      ['报表 ID', String(meta.reportId)],
      ['项目', meta.projectName],
      ['生成者', meta.generatedByName ?? `用户 #${m.generatedBy ?? '系统'}`],
      ['生成时间', m.generatedAt],
      ['模板版本', m.templateVersion],
      ['来源数据指纹', m.sourceDataHash],
    ]
    return [
      '| 字段 | 值 |',
      '| --- | --- |',
      ...rows.map(([k, v]) => `| ${k} | ${escapeMd(v)} |`),
    ].join('\n')
  }

  // --- 进度 -----------------------------------------------------------------

  private renderProgress(snap: ProgressSnapshot): string[] {
    const out: string[] = []
    out.push('## 项目进度摘要')
    out.push('')
    const s = snap.summary
    out.push(
      `- 总任务数：${s.totalTasks}（已完成 ${s.completedTasks} / 进行中 ${s.inProgressTasks} / 未开始 ${s.notStartedTasks} / 阻塞 ${s.blockedTasks}）`,
    )
    out.push(`- 加权进度：${s.overallProgressPercent}%`)
    out.push('')

    out.push('## 状态分布')
    out.push('')
    out.push('| 状态 | 数量 | 占比 |')
    out.push('| --- | --- | --- |')
    for (const b of snap.statusDistribution) {
      out.push(
        `| ${STATUS_CN[b.status] ?? b.status} | ${b.count} | ${(b.ratio * 100).toFixed(1)}% |`,
      )
    }
    out.push('')

    if (snap.wbsSummaries.length > 0) {
      out.push('## WBS 摘要')
      out.push('')
      out.push('| 编号 | 名称 | 任务总数 | 已完成 | 进度 |')
      out.push('| --- | --- | --- | --- | --- |')
      for (const w of snap.wbsSummaries) {
        out.push(
          `| ${escapeMd(w.code)} | ${escapeMd(w.name)} | ${w.totalTasks} | ${w.completedTasks} | ${w.progressPercent}% |`,
        )
      }
      out.push('')
    }

    if (snap.criticalTasks.length > 0) {
      out.push('## 关键任务')
      out.push('')
      out.push('| 任务 | 状态 | 进度 | 负责人 | 截止 |')
      out.push('| --- | --- | --- | --- | --- |')
      for (const t of snap.criticalTasks) {
        out.push(
          `| ${escapeMd(t.title)} | ${STATUS_CN[t.status] ?? t.status} | ${t.progressPercent}% | ${escapeMd(t.assigneeName ?? '-')} | ${t.dueDate ?? '-'} |`,
        )
      }
      out.push('')
    }

    if (snap.blockers.length > 0) {
      out.push('## 阻塞项')
      out.push('')
      for (const b of snap.blockers) {
        out.push(`- **${escapeMd(b.title)}** — ${escapeMd(b.reason)}`)
      }
    }

    return out
  }

  // --- 延期 -----------------------------------------------------------------

  private renderDelay(snap: DelaySnapshot): string[] {
    const out: string[] = []
    const s = snap.summary
    out.push('## 延期摘要')
    out.push('')
    out.push(`- 计入统计的带截止任务：${s.totalTasksWithDueDate}`)
    out.push(
      `- 已延期 ${s.overdueTasks} · 即将到期 ${s.upcomingTasks} · 延期率 ${s.delayRatePercent}%`,
    )
    out.push(`- 平均延期天数：${s.averageOverdueDays} · 最大延期天数：${s.maxOverdueDays}`)
    out.push('')

    if (snap.overdueTasks.length > 0) {
      out.push('## 已延期任务')
      out.push('')
      out.push('| 任务 | 负责人 | 计划截止 | 实际完成 | 延期天数 | 关键路径 |')
      out.push('| --- | --- | --- | --- | --- | --- |')
      for (const t of snap.overdueTasks) {
        out.push(
          `| ${escapeMd(t.title)} | ${escapeMd(t.assigneeName ?? '-')} | ${t.plannedEndDate ?? '-'} | ${t.actualEndDate ?? '-'} | ${t.overdueDays} | ${t.onCriticalPath ? '是' : '否'} |`,
        )
      }
      out.push('')
    }

    if (snap.upcomingTasks.length > 0) {
      out.push('## 即将到期')
      out.push('')
      out.push('| 任务 | 负责人 | 计划截止 | 剩余天数 |')
      out.push('| --- | --- | --- | --- |')
      for (const t of snap.upcomingTasks) {
        out.push(
          `| ${escapeMd(t.title)} | ${escapeMd(t.assigneeName ?? '-')} | ${t.plannedEndDate ?? '-'} | ${t.daysUntilDue} |`,
        )
      }
      out.push('')
    }

    if (snap.dependencyWarnings.length > 0) {
      out.push('## 依赖 warning')
      out.push('')
      for (const w of snap.dependencyWarnings) {
        out.push(`- 任务 ${w.fromTaskId} → ${w.toTaskId}：${escapeMd(w.reason)}`)
      }
    }
    return out
  }

  // --- 工作量 ---------------------------------------------------------------

  private renderWorkload(snap: WorkloadSnapshot): string[] {
    const out: string[] = []
    const s = snap.summary
    out.push('## 工作量摘要')
    out.push('')
    out.push(
      `- 负责人数：${s.totalAssignees} · 未分配任务 ${s.unassigned.totalTasks} 个（${s.unassigned.plannedHours}h）`,
    )
    out.push(`- 计划工时：${s.totalPlannedHours}h · 实际工时：${s.totalActualHours}h`)
    out.push('')

    if (snap.byAssignee.length > 0) {
      out.push('## 按负责人分布')
      out.push('')
      out.push('| 负责人 | 任务总数 | 已完成 | 进行中 | 未开始 | 计划工时 | 实际工时 | 过载 |')
      out.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
      for (const b of snap.byAssignee) {
        out.push(
          `| ${escapeMd(b.displayName)} | ${b.totalTasks} | ${b.completedTasks} | ${b.inProgressTasks} | ${b.notStartedTasks} | ${b.plannedHours}h | ${b.actualHours}h | ${b.overloadHint ? '⚠️' : '-'} |`,
        )
      }
    }
    return out
  }

  // --- 里程碑 ---------------------------------------------------------------

  private renderMilestone(snap: MilestoneSnapshot): string[] {
    const out: string[] = []
    const s = snap.summary
    out.push('## 里程碑摘要')
    out.push('')
    out.push(
      `- 里程碑总数 ${s.totalMilestones} · 已达成 ${s.completedMilestones} · 已延期 ${s.overdueMilestones} · 即将到期 ${s.upcomingMilestones}`,
    )
    out.push('')

    if (snap.milestones.length > 0) {
      out.push('## 里程碑列表')
      out.push('')
      out.push('| 名称 | 计划日期 | 状态 | 关联任务 | 完成数 | 进度 | 延期天数 |')
      out.push('| --- | --- | --- | --- | --- | --- | --- |')
      for (const m of snap.milestones) {
        out.push(
          `| ${escapeMd(m.name)} | ${m.plannedDate} | ${m.status} | ${m.linkedTaskCount} | ${m.linkedTaskCompletedCount} | ${m.linkedTaskProgressPercent}% | ${m.overdueDays} |`,
        )
      }
      out.push('')
    }

    if (snap.risks.length > 0) {
      out.push('## 风险提示')
      out.push('')
      for (const r of snap.risks) {
        out.push(`- **${escapeMd(r.name)}** — ${escapeMd(r.reason)}`)
      }
    }
    return out
  }
}

/** Markdown 表格单元格内的管道符与换行需要转义，避免破坏结构。 */
function escapeMd(input: string): string {
  return String(input).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}
