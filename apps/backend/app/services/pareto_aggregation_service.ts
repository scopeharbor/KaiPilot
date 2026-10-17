/**
 * v3-chart-gallery-data-foundation —— ParetoAggregationService（W4.7）。
 *
 * 柏拉图二八（80/20）分析纯只读聚合引擎，四个维度单次 SQL 分组计数：
 * - issue_type / issue_severity：issues 表（type / severity）；
 * - risk_category：risks 表（category）；
 * - change_type：change_requests 表（change_type）。
 *
 * 算法（design D2-4）：
 * 1. 按组织 + 项目 + 未删除过滤后 GROUP BY 目标维度；
 * 2. 内存按频数降序（同频按类别名升序，保证输出确定性）；
 * 3. 单项占比 round(2)、累计百分比 round(2)；
 * 4. 二八标记：当且仅当前一项累计百分比仍 < 80.0% 时，当前项 isVitalFew=true。
 *
 * 纯计算零写库（RL-06）；组织隔离 projectOrFail → 跨租户 404（RL-05）。
 */
import Project from '#models/project'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import db from '@adonisjs/lucid/services/db'
import { inject } from '@adonisjs/core'

/** 帕累托统计维度。 */
export type ParetoDimension = 'issue_type' | 'issue_severity' | 'risk_category' | 'change_type'

/** 帕累托单项条目。 */
export interface ParetoItem {
  category: string
  label: string
  count: number
  percentage: number
  cumulativePercentage: number
  isVitalFew: boolean
}

export interface ParetoResult {
  dimension: ParetoDimension
  totalCount: number
  items: ParetoItem[]
}

const VITAL_FEW_THRESHOLD = 80

const ISSUE_TYPE_LABELS: Record<string, string> = {
  bug: '功能缺陷',
  blocker: '阻塞障碍',
  technical: '技术问题',
  process: '流程问题',
  other: '其他',
}

const ISSUE_SEVERITY_LABELS: Record<string, string> = {
  critical: '致命',
  major: '严重',
  minor: '一般',
  trivial: '轻微',
}

const RISK_CATEGORY_LABELS: Record<string, string> = {
  technical: '技术',
  schedule: '进度',
  cost: '成本',
  resource: '资源',
  external: '外部',
  organizational: '组织',
  legal: '法律合规',
  other: '其他',
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  scope: '范围变更',
  schedule: '进度变更',
  cost: '成本变更',
  resource: '资源变更',
  quality: '质量变更',
  risk: '风险变更',
  other: '其他变更',
}

const UNCLASSIFIED_CATEGORY = 'unclassified'
const UNCLASSIFIED_LABEL = '未分类'

function round2(value: number): number {
  return Number(value.toFixed(2))
}

/** 分组计数原始行（Lucid 聚合值落在 $extras 或行字段）。 */
type CountRow = Record<string, unknown> & { $extras?: Record<string, unknown> }

@inject()
export default class ParetoAggregationService {
  async getPareto(
    organizationId: number,
    projectId: number,
    dimension: ParetoDimension = 'issue_type',
  ): Promise<ParetoResult> {
    const effectiveDimension = this.normalizeDimension(dimension)
    await this.projectOrFail(organizationId, projectId)

    const counts = await this.groupCounts(organizationId, projectId, effectiveDimension)
    const totalCount = [...counts.values()].reduce((acc, value) => acc + value, 0)
    if (totalCount === 0) {
      return { dimension: effectiveDimension, totalCount: 0, items: [] }
    }

    const sortedCategories = [...counts.keys()].sort((a, b) => {
      const diff = (counts.get(b) ?? 0) - (counts.get(a) ?? 0)
      return diff !== 0 ? diff : a.localeCompare(b)
    })

    const labelMap = this.dimensionLabels(effectiveDimension)
    const items: ParetoItem[] = []
    let cumulative = 0
    for (const category of sortedCategories) {
      const count = counts.get(category) ?? 0
      const percentage = round2((count / totalCount) * 100)
      const isVitalFew = cumulative < VITAL_FEW_THRESHOLD
      cumulative = round2(cumulative + percentage)
      items.push({
        category,
        label:
          labelMap[category] ??
          (category === UNCLASSIFIED_CATEGORY ? UNCLASSIFIED_LABEL : category),
        count,
        percentage,
        cumulativePercentage: cumulative,
        isVitalFew,
      })
    }

    return { dimension: effectiveDimension, totalCount, items }
  }

  // ---------------------------------------------------------------------------
  // 数据装配
  // ---------------------------------------------------------------------------

  private normalizeDimension(dimension: ParetoDimension): ParetoDimension {
    switch (dimension) {
      case 'issue_severity':
      case 'risk_category':
      case 'change_type':
        return dimension
      default:
        return 'issue_type'
    }
  }

  private dimensionLabels(dimension: ParetoDimension): Record<string, string> {
    switch (dimension) {
      case 'issue_severity':
        return ISSUE_SEVERITY_LABELS
      case 'risk_category':
        return RISK_CATEGORY_LABELS
      case 'change_type':
        return CHANGE_TYPE_LABELS
      default:
        return ISSUE_TYPE_LABELS
    }
  }

  private async groupCounts(
    organizationId: number,
    projectId: number,
    dimension: ParetoDimension,
  ): Promise<Map<string, number>> {
    // 经 Lucid 模型查询构造器做聚合时，select 列会被驼峰化、聚合值落到 $extras，
    // 跨模型不可控；此处统一走裸 SQL 构造器（保留 DB 列名），软删除过滤显式声明。
    switch (dimension) {
      case 'issue_type':
        return this.toCategoryMap(
          await this.rawGroupCount('issues', 'type', organizationId, projectId),
          'type',
        )
      case 'issue_severity':
        return this.toCategoryMap(
          await this.rawGroupCount('issues', 'severity', organizationId, projectId),
          'severity',
        )
      case 'risk_category':
        return this.toCategoryMap(
          await this.rawGroupCount('risks', 'category', organizationId, projectId),
          'category',
        )
      case 'change_type':
        return this.toCategoryMap(
          await this.rawGroupCount('change_requests', 'change_type', organizationId, projectId),
          'change_type',
        )
    }
  }

  private async rawGroupCount(
    table: 'issues' | 'risks' | 'change_requests',
    column: string,
    organizationId: number,
    projectId: number,
  ): Promise<CountRow[]> {
    return (await db
      .from(table)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .select(column)
      .count('* as count')
      .groupBy(column)) as CountRow[]
  }

  private toCategoryMap(rows: CountRow[], column: string): Map<string, number> {
    const counts = new Map<string, number>()
    for (const row of rows) {
      const raw = row[column]
      const category = raw === null || raw === undefined ? UNCLASSIFIED_CATEGORY : String(raw)
      const rawCount = row.count
      const count = Number(rawCount ?? 0)
      counts.set(category, (counts.get(category) ?? 0) + (Number.isFinite(count) ? count : 0))
    }
    return counts
  }

  private async projectOrFail(organizationId: number, projectId: number): Promise<Project> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }
}
