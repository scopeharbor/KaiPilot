import type {
  DelaySnapshot,
  MilestoneSnapshot,
  ProgressSnapshot,
  ReportSnapshot,
  WorkloadSnapshot,
} from '@aiproj/types'
import type { RenderReportMeta, RenderedReport, ReportRenderer } from './renderer_contract.js'

/**
 * CSV 渲染器（design D5）。
 *
 * V1 无法表格化的摘要通过「元数据段 + 分节段」形式表达：
 *   - 每段以空行分隔；
 *   - 每段以 `## 段名` 开头（Excel 会作为常规单元格显示，但人读可识别）；
 *   - 明细表格用标准 CSV：双引号包裹，内部 `"` 转义为 `""`；
 *   - 首字节写 UTF-8 BOM 让 Excel 正确识别中文。
 *
 * warnings 独立成尾部段，方便人工排查数据缺失原因。
 */
export default class CsvRenderer implements ReportRenderer {
  readonly format = 'csv' as const

  render(snapshot: ReportSnapshot, meta: RenderReportMeta): RenderedReport {
    const sections: string[] = []
    sections.push(this.metaSection(snapshot, meta))

    switch (snapshot.template) {
      case 'progress':
        sections.push(...this.renderProgress(snapshot))
        break
      case 'delay':
        sections.push(...this.renderDelay(snapshot))
        break
      case 'workload':
        sections.push(...this.renderWorkload(snapshot))
        break
      case 'milestone':
        sections.push(...this.renderMilestone(snapshot))
        break
    }

    const warnings = snapshot.snapshotMetadata.warnings ?? []
    if (warnings.length > 0) {
      const rows = [['级别', '说明']]
      for (const w of warnings) rows.push([w.level, w.message])
      sections.push(this.section('说明与警告', rows))
    }

    const body = sections.join('\r\n\r\n') + '\r\n'
    // UTF-8 BOM (Excel 中文兼容)
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    return {
      format: this.format,
      mimeType: 'text/csv; charset=utf-8',
      extension: 'csv',
      content: Buffer.concat([bom, Buffer.from(body, 'utf-8')]),
    }
  }

  // --- 通用 -----------------------------------------------------------------

  private metaSection(snapshot: ReportSnapshot, meta: RenderReportMeta): string {
    const m = snapshot.snapshotMetadata
    return this.section('报表元数据', [
      ['字段', '值'],
      ['报表 ID', String(meta.reportId)],
      ['标题', meta.title],
      ['项目', meta.projectName],
      ['模板', snapshot.template],
      ['模板版本', m.templateVersion],
      ['生成者', meta.generatedByName ?? `用户 #${m.generatedBy ?? '系统'}`],
      ['生成时间', m.generatedAt],
      ['来源数据指纹', m.sourceDataHash],
    ])
  }

  /**
   * 组装单个 CSV 段：`## 段名` + 空行 + 表格。
   */
  private section(title: string, rows: string[][]): string {
    const out = [`## ${title}`]
    for (const row of rows) {
      out.push(row.map(escapeCsv).join(','))
    }
    return out.join('\r\n')
  }

  // --- 各模板 ---------------------------------------------------------------

  private renderProgress(snap: ProgressSnapshot): string[] {
    const out: string[] = []
    const s = snap.summary
    out.push(
      this.section('进度摘要', [
        ['字段', '值'],
        ['加权进度%', String(s.overallProgressPercent)],
        ['总任务数', String(s.totalTasks)],
        ['已完成', String(s.completedTasks)],
        ['进行中', String(s.inProgressTasks)],
        ['未开始', String(s.notStartedTasks)],
        ['阻塞/暂停', String(s.blockedTasks)],
      ]),
    )

    out.push(
      this.section('状态分布', [
        ['状态', '数量', '占比'],
        ...snap.statusDistribution.map((b) => [
          b.status,
          String(b.count),
          (b.ratio * 100).toFixed(1) + '%',
        ]),
      ]),
    )

    if (snap.wbsSummaries.length > 0) {
      out.push(
        this.section('WBS 摘要', [
          ['编号', '名称', '任务总数', '已完成', '进度%'],
          ...snap.wbsSummaries.map((w) => [
            w.code,
            w.name,
            String(w.totalTasks),
            String(w.completedTasks),
            String(w.progressPercent),
          ]),
        ]),
      )
    }

    if (snap.criticalTasks.length > 0) {
      out.push(
        this.section('关键任务', [
          ['任务ID', '标题', '状态', '进度%', '负责人', '截止'],
          ...snap.criticalTasks.map((t) => [
            String(t.taskId),
            t.title,
            t.status,
            String(t.progressPercent),
            t.assigneeName ?? '',
            t.dueDate ?? '',
          ]),
        ]),
      )
    }

    if (snap.blockers.length > 0) {
      out.push(
        this.section('阻塞项', [
          ['任务ID', '标题', '原因'],
          ...snap.blockers.map((b) => [String(b.taskId), b.title, b.reason]),
        ]),
      )
    }

    return out
  }

  private renderDelay(snap: DelaySnapshot): string[] {
    const out: string[] = []
    const s = snap.summary
    out.push(
      this.section('延期摘要', [
        ['字段', '值'],
        ['计入统计任务数', String(s.totalTasksWithDueDate)],
        ['已延期', String(s.overdueTasks)],
        ['即将到期', String(s.upcomingTasks)],
        ['延期率%', String(s.delayRatePercent)],
        ['平均延期天数', String(s.averageOverdueDays)],
        ['最大延期天数', String(s.maxOverdueDays)],
      ]),
    )

    if (snap.overdueTasks.length > 0) {
      out.push(
        this.section('已延期任务', [
          ['任务ID', '标题', '负责人', '计划截止', '实际完成', '延期天数', '关键路径'],
          ...snap.overdueTasks.map((t) => [
            String(t.taskId),
            t.title,
            t.assigneeName ?? '',
            t.plannedEndDate ?? '',
            t.actualEndDate ?? '',
            String(t.overdueDays),
            t.onCriticalPath ? '是' : '否',
          ]),
        ]),
      )
    }

    if (snap.upcomingTasks.length > 0) {
      out.push(
        this.section('即将到期', [
          ['任务ID', '标题', '负责人', '计划截止', '剩余天数'],
          ...snap.upcomingTasks.map((t) => [
            String(t.taskId),
            t.title,
            t.assigneeName ?? '',
            t.plannedEndDate ?? '',
            String(t.daysUntilDue),
          ]),
        ]),
      )
    }

    if (snap.dependencyWarnings.length > 0) {
      out.push(
        this.section('依赖 warning', [
          ['from', 'to', '原因'],
          ...snap.dependencyWarnings.map((w) => [
            String(w.fromTaskId),
            String(w.toTaskId),
            w.reason,
          ]),
        ]),
      )
    }
    return out
  }

  private renderWorkload(snap: WorkloadSnapshot): string[] {
    const out: string[] = []
    const s = snap.summary
    out.push(
      this.section('工作量摘要', [
        ['字段', '值'],
        ['负责人数', String(s.totalAssignees)],
        ['未分配任务数', String(s.unassigned.totalTasks)],
        ['未分配计划工时', String(s.unassigned.plannedHours)],
        ['总计划工时', String(s.totalPlannedHours)],
        ['总实际工时', String(s.totalActualHours)],
      ]),
    )
    if (snap.byAssignee.length > 0) {
      out.push(
        this.section('负责人分布', [
          [
            'userId',
            '姓名',
            '任务总数',
            '已完成',
            '进行中',
            '未开始',
            '计划工时',
            '实际工时',
            '过载',
          ],
          ...snap.byAssignee.map((b) => [
            String(b.userId),
            b.displayName,
            String(b.totalTasks),
            String(b.completedTasks),
            String(b.inProgressTasks),
            String(b.notStartedTasks),
            String(b.plannedHours),
            String(b.actualHours),
            b.overloadHint ? '是' : '否',
          ]),
        ]),
      )
    }
    return out
  }

  private renderMilestone(snap: MilestoneSnapshot): string[] {
    const out: string[] = []
    const s = snap.summary
    out.push(
      this.section('里程碑摘要', [
        ['字段', '值'],
        ['总数', String(s.totalMilestones)],
        ['已达成', String(s.completedMilestones)],
        ['已延期', String(s.overdueMilestones)],
        ['即将到期', String(s.upcomingMilestones)],
      ]),
    )
    if (snap.milestones.length > 0) {
      out.push(
        this.section('里程碑列表', [
          [
            'milestoneId',
            '名称',
            '计划日期',
            '状态',
            '关联任务',
            '已完成',
            '进度%',
            '延期天数',
            '自动',
          ],
          ...snap.milestones.map((m) => [
            String(m.milestoneId),
            m.name,
            m.plannedDate,
            m.status,
            String(m.linkedTaskCount),
            String(m.linkedTaskCompletedCount),
            String(m.linkedTaskProgressPercent),
            String(m.overdueDays),
            m.autoCalculated ? '是' : '否',
          ]),
        ]),
      )
    }
    if (snap.risks.length > 0) {
      out.push(
        this.section('风险提示', [
          ['milestoneId', '名称', '原因'],
          ...snap.risks.map((r) => [String(r.milestoneId), r.name, r.reason]),
        ]),
      )
    }
    return out
  }
}

/**
 * CSV 单元格 RFC 4180 转义：
 *   - 遇到 `"` `,` `\r` `\n` 时用双引号包裹；
 *   - 内部的 `"` 转义为 `""`。
 */
function escapeCsv(value: string): string {
  const s = value ?? ''
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}
