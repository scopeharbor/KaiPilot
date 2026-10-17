/**
 * v2-pdm-migration-compatibility —— PDM 迁移共享类型（Section 2）。
 *
 * 定义 CanonicalSnapshot、MigrationIssue、MigrationReport、DualReadSummary、
 * 迁移状态枚举、severity 常量与门禁规则的唯一事实来源。
 *
 * 所有迁移服务从本模块 import 类型，避免类型定义分散。
 */

/**
 * 迁移运行态状态机（design D4）。
 * planned → dry_run_passed → snapshot_created → migrating → verifying → dual_read → completed
 * 任意阶段失败 → failed；回滚 → rolled_back。
 */
export const MIGRATION_RUN_STATUSES = [
  'planned',
  'dry_run_passed',
  'snapshot_created',
  'migrating',
  'verifying',
  'dual_read',
  'completed',
  'failed',
  'rolled_back',
] as const

export type MigrationRunStatus = (typeof MIGRATION_RUN_STATUSES)[number]

// ── 问题严重级别 ──

export const ISSUE_SEVERITIES = ['blocking', 'warning', 'info'] as const
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number]

/** blocking 门禁：存在 blocking 级别 issue 时禁止 execute/complete/切换读路径。 */
export function isBlocked(issues: MigrationIssue[]): boolean {
  return issues.some((i) => i.severity === 'blocking')
}

// ── Canonical Snapshot（V1 数据只读快照）──

/** V1 项目实体的 canonic 表示。 */
export interface CanonicalProjectEntity {
  /** V1 原始表名（如 projects）。 */
  sourceTable: string
  /** V1 原始主键。 */
  sourceId: number
  /** 来源字段哈希。 */
  sourceHash: string
  /** 组织 ID。 */
  organizationId: number
  /** 字段映射（扁平化，保留 V1 字段名）。 */
  fields: Record<string, unknown>
  /** 扩展字段（PDM 无对应槽位的字段）。 */
  extensions: Record<string, unknown>
  /** 软删除标记。 */
  deletedAt: string | null
  /** 创建时间（ISO）。 */
  createdAt: string
  /** 更新时间（ISO）。 */
  updatedAt: string | null
}

export interface CanonicalProjectSnapshot {
  kind: 'project'
  organizationId: number
  projectId: number
  project: CanonicalProjectEntity
  wbsNodes: CanonicalProjectEntity[]
  tasks: CanonicalProjectEntity[]
  dependencies: CanonicalProjectEntity[]
  milestones: CanonicalProjectEntity[]
  resources: CanonicalProjectEntity[]
  resourceAllocations: CanonicalProjectEntity[]
  risks: CanonicalProjectEntity[]
  aiMetadata: Record<string, unknown>
  extractedAt: string // ISO datetime
}

export interface CanonicalDraftSnapshot {
  kind: 'draft'
  organizationId: number
  draftId: number
  draft: CanonicalProjectEntity
  versions: CanonicalProjectEntity[]
  events: CanonicalProjectEntity[]
  confirmations: CanonicalProjectEntity[]
  extractedAt: string // ISO datetime
}

export type CanonicalSnapshot = CanonicalProjectSnapshot | CanonicalDraftSnapshot

// ── Migration Issue / Report ──

export interface MigrationIssue {
  severity: IssueSeverity
  code: string
  message: string
  entityType?: string
  entityId?: string | number
  sourceTable?: string
  sourceId?: number
  fieldPath?: string
}

export interface MigrationReport {
  runId: number
  reportType: 'plan' | 'dry_run' | 'execute' | 'verify' | 'dual_read' | 'rollback'
  scope: MigrationScope
  counts: {
    projects: number
    wbsNodes: number
    tasks: number
    dependencies: number
    milestones: number
    resources: number
    resourceAllocations: number
    risks: number
    drafts: number
    draftVersions: number
  }
  issues: MigrationIssue[]
  blockingCount: number
  warningCount: number
  infoCount: number
  summary: string
  suggestions: string[]
  generatedAt: string // ISO datetime
}

// ── Dual Read Summary ──

export interface DualReadEntitySummary {
  entityType: string
  v1Count: number
  pdmCount: number
  countMatch: boolean
  fieldHashMatch: boolean
  v1FieldHash: string
  pdmFieldHash: string
  issues: MigrationIssue[]
}

export interface DualReadSummary {
  runId: number
  organizationId: number
  projectId?: number
  summaries: DualReadEntitySummary[]
  overallMatch: boolean
  blockingMismatches: MigrationIssue[]
  generatedAt: string // ISO datetime
}

// ── 迁移范围 ──

export interface MigrationScope {
  organizationId: number
  projectIds?: number[]
  draftIds?: number[]
  allProjects: boolean
  allDrafts: boolean
}

export const READ_MODE_V1_PRIMARY = 'v1_primary' as const
export const READ_MODE_DUAL_READ = 'dual_read' as const
export const READ_MODE_PDM_PRIMARY = 'pdm_primary' as const

export type ReadMode =
  typeof READ_MODE_V1_PRIMARY | typeof READ_MODE_DUAL_READ | typeof READ_MODE_PDM_PRIMARY

export const DEFAULT_READ_MODE: ReadMode = READ_MODE_V1_PRIMARY

// ── 范围配置 ──

export interface MigrationConfig {
  /** 默认 dry-run（禁止默认全库 execute）。 */
  defaultDryRun: boolean
  /** 允许的最大项目数（单次 execute）。 */
  maxProjectsPerRun: number
  /** 当前读模式。 */
  readMode: ReadMode
  /** 已通过双读的域（允许切 PDM Adapter）。 */
  dualReadPassedDomains: string[]
}
