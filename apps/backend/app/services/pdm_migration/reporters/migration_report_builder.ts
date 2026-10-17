/**
 * v2-pdm-migration-compatibility —— MigrationReportBuilder（Section 7.5）。
 *
 * 输出简体中文迁移报告。覆盖范围、计数、blocking/warning/info、差异、下一步建议。
 */
import { DateTime } from 'luxon'
import type {
  CanonicalProjectSnapshot,
  CanonicalDraftSnapshot,
  MigrationIssue,
  MigrationReport,
} from '../types.js'
import { isBlocked } from '../types.js'

export class MigrationReportBuilder {
  /**
   * 构建 dry-run / execute / verify 等阶段的中文报告。
   */
  build(params: {
    runId: number
    reportType: MigrationReport['reportType']
    snapshot?: CanonicalProjectSnapshot | CanonicalDraftSnapshot
    issues: MigrationIssue[]
    scope: MigrationReport['scope']
    suggestions?: string[]
  }): MigrationReport {
    const { runId, reportType, snapshot, issues, scope, suggestions } = params

    const counts = {
      projects: snapshot?.kind === 'project' ? 1 : 0,
      wbsNodes: snapshot?.kind === 'project' ? snapshot.wbsNodes.length : 0,
      tasks: snapshot?.kind === 'project' ? snapshot.tasks.length : 0,
      dependencies: snapshot?.kind === 'project' ? snapshot.dependencies.length : 0,
      milestones: snapshot?.kind === 'project' ? snapshot.milestones.length : 0,
      resources: snapshot?.kind === 'project' ? snapshot.resources.length : 0,
      resourceAllocations: snapshot?.kind === 'project' ? snapshot.resourceAllocations.length : 0,
      risks: snapshot?.kind === 'project' ? snapshot.risks.length : 0,
      drafts: snapshot?.kind === 'draft' ? 1 : 0,
      draftVersions: snapshot?.kind === 'draft' ? snapshot.versions.length : 0,
    }

    const blockingCount = issues.filter((i) => i.severity === 'blocking').length
    const warningCount = issues.filter((i) => i.severity === 'warning').length
    const infoCount = issues.filter((i) => i.severity === 'info').length

    const blocked = isBlocked(issues)
    const summary = this.buildSummary(reportType, counts, blockingCount, warningCount, blocked)
    const defaultSuggestions = this.buildSuggestions(reportType, blocked)

    return {
      runId,
      reportType,
      scope,
      counts,
      issues,
      blockingCount,
      warningCount,
      infoCount,
      summary,
      suggestions: suggestions ?? defaultSuggestions,
      generatedAt: DateTime.now().toISO(),
    }
  }

  /**
   * 合并多个报告为一个整体报告（用于双读总览）。
   */
  merge(
    reports: MigrationReport[],
    runId: number,
    scope: MigrationReport['scope'],
  ): MigrationReport {
    const allIssues = reports.flatMap((r) => r.issues)
    const counts = reports.reduce(
      (acc, r) => {
        for (const [k, v] of Object.entries(r.counts)) {
          acc[k as keyof typeof acc] += v
        }
        return acc
      },
      {
        projects: 0,
        wbsNodes: 0,
        tasks: 0,
        dependencies: 0,
        milestones: 0,
        resources: 0,
        resourceAllocations: 0,
        risks: 0,
        drafts: 0,
        draftVersions: 0,
      },
    )

    const blockingCount = allIssues.filter((i) => i.severity === 'blocking').length
    const warningCount = allIssues.filter((i) => i.severity === 'warning').length
    const infoCount = allIssues.filter((i) => i.severity === 'info').length
    const blocked = isBlocked(allIssues)

    return {
      runId,
      reportType: 'verify',
      scope,
      counts,
      issues: allIssues,
      blockingCount,
      warningCount,
      infoCount,
      summary: this.buildSummary('verify', counts, blockingCount, warningCount, blocked),
      suggestions: this.buildSuggestions('verify', blocked),
      generatedAt: DateTime.now().toISO(),
    }
  }

  private buildSummary(
    type: MigrationReport['reportType'],
    counts: MigrationReport['counts'],
    blocking: number,
    warnings: number,
    blocked: boolean,
  ): string {
    const typeLabel: Record<string, string> = {
      plan: '迁移规划',
      dry_run: '预检',
      execute: '执行',
      verify: '校验',
      dual_read: '双读验证',
      rollback: '回滚',
    }
    const lines: string[] = [
      `## ${typeLabel[type] ?? type} 报告`,
      '',
      `项目数: ${counts.projects}，WBS 节点: ${counts.wbsNodes}，任务: ${counts.tasks}`,
      `依赖: ${counts.dependencies}，里程碑: ${counts.milestones}`,
      `资源: ${counts.resources}，资源分配: ${counts.resourceAllocations}，风险: ${counts.risks}`,
      `草案: ${counts.drafts}，草案版本: ${counts.draftVersions}`,
      '',
      `blocking: ${blocking}，warning: ${warnings}，info: ${counts}`,
    ]

    if (blocked) {
      lines.push('', '❌ 存在 blocking 问题，迁移被阻止。请解决后重试。')
    } else {
      lines.push('', '✅ 未发现 blocking 问题。')
    }

    return lines.join('\n')
  }

  private buildSuggestions(type: MigrationReport['reportType'], blocked: boolean): string[] {
    if (blocked) {
      return ['请逐个解决 blocking 级别问题', '修复后重新执行 dry-run']
    }
    const suggestions: Record<string, string[]> = {
      plan: ['查看规划报告，确认迁移范围', '如无误可执行 dry-run'],
      dry_run: ['查看预检问题列表', '如无 blocking 问题，可创建快照并执行迁移'],
      execute: ['迁移执行完成，请运行 verify 确认一致性', '如通过后可执行双读验证'],
      verify: ['校验通过，可进入双读阶段'],
      dual_read: ['双读验证通过，可切换读路径'],
      rollback: ['回滚完成，请确认 V1 路径可用'],
    }
    return suggestions[type] ?? ['查看报告详情']
  }
}
