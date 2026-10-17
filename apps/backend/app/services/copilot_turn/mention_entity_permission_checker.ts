/**
 * v3-copilot-live-submission-channel —— 提及实体逐条读权限判定（任务 3.1–3.2）。
 *
 * 判定规则**与既有检索适配器同源**，不另建权限路径（spec REQ）：
 * 十二类检索适配器一律以 `organization_id`（组织级实体）与
 * `project_id ∈ ctx.projectIds`（项目级实体）过滤，而 `ctx.projectIds` 来自
 * `SearchPolicy.getAllowedProjectIds`。本模块把同一规则表达为按 ID 的批量查询。
 *
 * 实体 ID 语义与适配器产出的 `entityId` 严格对齐（否则复核会错判）：
 * - `document` → `document_search_entries.document_id`
 * - `file` → `file_search_entries.id`
 * - `ocr_document` → `ocr_document_search_index_entries.id`
 * - `external_link` → 适配器产出的是 `taskId`，故按 `tasks.id` 判定
 * - `project` → entityId 即项目 ID，直接比对允许项目集合
 * - `member` → 无对应检索适配器，一律不获准（缺席）
 */

import db from '@adonisjs/lucid/services/db'
import type { MentionReference } from '@aiproj/types'
import type { MentionEntityPermissionChecker } from '#services/copilot_action/mention_reference_validator'

type MentionableEntityType = MentionReference['entityType']

/** 项目级实体的查表声明。 */
interface ProjectScopedLookup {
  readonly table: string
  /** 用于匹配 entityId 的列。 */
  readonly idColumn: string
  /** 项目归属列。 */
  readonly projectColumn: string
  /** 组织归属列（该表无此列时为 null）。 */
  readonly organizationColumn: string | null
}

/**
 * 项目级实体查表映射。
 *
 * 缺席的实体类型不代表「可用」——`resolveGranted` 对未声明类型一律不获准。
 */
const PROJECT_SCOPED_LOOKUPS: Partial<Record<MentionableEntityType, ProjectScopedLookup>> = {
  task: { table: 'tasks', idColumn: 'id', projectColumn: 'project_id', organizationColumn: null },
  milestone: {
    table: 'milestones',
    idColumn: 'id',
    projectColumn: 'project_id',
    organizationColumn: null,
  },
  risk: {
    table: 'risks',
    idColumn: 'id',
    projectColumn: 'project_id',
    organizationColumn: 'organization_id',
  },
  report: {
    table: 'reports',
    idColumn: 'id',
    projectColumn: 'project_id',
    organizationColumn: null,
  },
  change_request: {
    table: 'change_requests',
    idColumn: 'id',
    projectColumn: 'project_id',
    organizationColumn: 'organization_id',
  },
  comment: {
    table: 'comments',
    idColumn: 'id',
    projectColumn: 'project_id',
    organizationColumn: 'organization_id',
  },
  document: {
    table: 'document_search_entries',
    idColumn: 'document_id',
    projectColumn: 'project_id',
    organizationColumn: 'organization_id',
  },
  file: {
    table: 'file_search_entries',
    idColumn: 'id',
    projectColumn: 'project_id',
    organizationColumn: 'organization_id',
  },
  ocr_document: {
    table: 'ocr_document_search_index_entries',
    idColumn: 'id',
    projectColumn: 'project_id',
    organizationColumn: 'organization_id',
  },
  // 适配器对外部链接产出的 entityId 是所属任务 ID
  external_link: {
    table: 'tasks',
    idColumn: 'id',
    projectColumn: 'project_id',
    organizationColumn: null,
  },
}

export interface MentionEntityPermissionCheckerOptions {
  /**
   * actor 在该组织内可访问的项目 ID 集合。
   * 来源必须是既有 `SearchPolicy.getAllowedProjectIds`，不得另算。
   */
  readonly allowedProjectIds: readonly number[]
}

/**
 * 构建逐实体权限判定器。
 *
 * 查询失败不在此吞掉——异常向上抛出，由 `reviewMentionRefs` 转为
 * `MentionPermissionUnavailableError` 阻断回合（不默认放行）。
 */
export function buildMentionEntityPermissionChecker(
  options: MentionEntityPermissionCheckerOptions,
): MentionEntityPermissionChecker {
  const allowed = new Set(options.allowedProjectIds.map((id) => Number(id)))

  return async ({ organizationId, entityType, entityIds }) => {
    if (entityIds.length === 0) return new Set<number>()

    // 项目本身：entityId 即项目 ID，直接比对允许集合
    if (entityType === 'project') {
      return new Set(entityIds.filter((id) => allowed.has(Number(id))))
    }

    const lookup = PROJECT_SCOPED_LOOKUPS[entityType]
    // 无声明（含 member）→ 一律不获准
    if (!lookup) return new Set<number>()

    // 允许项目集合为空时无需查库
    if (allowed.size === 0) return new Set<number>()

    const query = db
      .from(lookup.table)
      .whereIn(lookup.idColumn, entityIds as number[])
      .whereIn(lookup.projectColumn, [...allowed])
      .select(lookup.idColumn)

    if (lookup.organizationColumn) {
      query.where(lookup.organizationColumn, organizationId)
    }

    const rows = (await query) as readonly Record<string, unknown>[]
    const granted = new Set<number>()
    for (const row of rows) {
      const value = Number(row[lookup.idColumn])
      if (Number.isFinite(value)) granted.add(value)
    }
    return granted
  }
}
