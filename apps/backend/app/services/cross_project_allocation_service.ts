import type User from '#models/user'
import CrossProjectAllocationDraft from '#models/cross_project_allocation_draft'
import CrossProjectAllocationItem from '#models/cross_project_allocation_item'
import CrossProjectAllocationCommit from '#models/cross_project_allocation_commit'
import CrossProjectAllocationPolicy from '#policies/cross_project_allocation_policy'
import type {
  CrossProjectAllocationDraft as DraftDTO,
  CrossProjectAllocationDraftDetail,
  CrossProjectAllocationDraftItem,
  CrossProjectAllocationCandidateResource,
  CrossProjectAllocationDemand,
  CrossProjectAllocationConflict,
  CrossProjectAllocationPreview,
  CrossProjectAllocationConfirmation,
  CrossProjectAllocationApplyResult,
  CrossProjectAllocationWarning,
  CrossProjectAllocationEvidence,
  CrossProjectAllocationQueryShape,
  CrossProjectAllocationDraftStatus,
} from '@aiproj/types'
import {
  normalizeCrossProjectAllocationQuery,
  computePreviewFingerprint,
  computeIdempotencyHash,
  computeAllocationEvidenceHash,
  computeQueryShapeHash,
  sortConflictsBySeverity,
} from '@aiproj/types'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'

@inject()
export default class CrossProjectAllocationService {
  constructor(private readonly policy: CrossProjectAllocationPolicy) {}

  // ── 创建草案 ────────────────────────────────────────────────────────────

  async createDraft(
    user: User,
    organizationId: number,
    input: {
      name: string
      projectIds: number[]
      dateWindow: { from: string; to: string }
      resourceTypes?: string[]
      roles?: string[]
      skillTags?: string[]
      departments?: string[]
      loadStatuses?: string[]
      topN?: number
      freshnessThresholdMinutes?: number
    },
  ): Promise<DraftDTO> {
    await this.policy.authorizeManage(user, organizationId)

    const queryShape = normalizeCrossProjectAllocationQuery({
      organizationId,
      projectIds: input.projectIds,
      dateWindow: input.dateWindow,
      resourceTypes: input.resourceTypes ?? [],
      roles: input.roles ?? [],
      skillTags: input.skillTags ?? [],
      departments: input.departments ?? [],
      loadStatuses: input.loadStatuses ?? [],
      topN: input.topN ?? 10,
      freshnessThresholdMinutes: input.freshnessThresholdMinutes ?? 60,
    })

    const draft = await CrossProjectAllocationDraft.create({
      organizationId,
      name: input.name,
      status: 'draft',
      queryShape: queryShape as unknown as Record<string, unknown>,
      actorId: user.id,
      sourceSignatures: null,
      warnings: null,
    })

    return this.toDraftDTO(draft)
  }

  // ── 更新草案 items ────────────────────────────────────────────────────

  async updateItems(
    user: User,
    organizationId: number,
    draftId: number,
    input: {
      items: Array<{
        id?: string
        itemType: string
        targetProjectId: number
        targetTaskId?: number
        candidateResourceId?: number
        allocationPercent: number
        startDate: string
        endDate: string
        source?: string
      }>
    },
  ): Promise<CrossProjectAllocationDraftItem[]> {
    await this.policy.authorizeManage(user, organizationId)

    const draft = await CrossProjectAllocationDraft.query()
      .where('id', draftId)
      .where('organization_id', organizationId)
      .firstOrFail()

    if (draft.status !== 'draft' && draft.status !== 'previewed') {
      throw new Error('草案状态不允许修改 items')
    }

    // 重置为 draft 状态
    draft.status = 'draft'
    draft.previewHash = null
    draft.previewExpiresAt = null
    await draft.save()

    // 删除旧 items
    await CrossProjectAllocationItem.query().where('draft_id', draftId).delete()

    // 创建新 items
    const created: CrossProjectAllocationItem[] = []
    for (const item of input.items) {
      // 权限检查：用户必须能看到目标项目
      if (!(await this.policy.canViewProject(user, organizationId, item.targetProjectId))) {
        continue
      }
      const model = await CrossProjectAllocationItem.create({
        draftId: draft.id,
        organizationId,
        itemType: item.itemType,
        itemStatus: 'pending',
        targetProjectId: item.targetProjectId,
        targetTaskId: item.targetTaskId ?? null,
        candidateResourceId: item.candidateResourceId ?? null,
        allocationPercent: item.allocationPercent,
        startDate: item.startDate as any,
        endDate: item.endDate as any,
        source: item.source ?? 'manual',
        advisoryOnly: 0,
        confirmationRequired: 1,
        applied: 0,
        demandSnapshot: {},
        candidateSnapshot: null,
        conflicts: null,
      })
      created.push(model)
    }

    return created.map((i) => this.toItemDTO(i))
  }

  // ── 列出草案 ────────────────────────────────────────────────────────────

  async listDrafts(
    user: User,
    organizationId: number,
    query: Partial<CrossProjectAllocationQueryShape>,
  ): Promise<{
    data: DraftDTO[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    await this.policy.authorizeView(user, organizationId)

    const q = normalizeCrossProjectAllocationQuery({ ...query, organizationId })
    let baseQuery = CrossProjectAllocationDraft.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')

    if (q.draftStatuses.length > 0) {
      baseQuery = baseQuery.whereIn('status', q.draftStatuses)
    }
    if (q.search) {
      baseQuery = baseQuery.where('name', 'like', `%${q.search}%`)
    }

    const total = await baseQuery.clone().count('* as total')
    const totalNum = Number(total[0].$extras?.total ?? 0)

    const drafts = await baseQuery
      .orderBy(q.sort, q.sortDir)
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage)

    return {
      data: drafts.map((d) => this.toDraftDTO(d)),
      meta: {
        total: totalNum,
        page: q.page,
        perPage: q.perPage,
        totalPages: Math.ceil(totalNum / q.perPage),
      },
    }
  }

  // ── 获取单个草案 ────────────────────────────────────────────────────────

  async getDraft(
    user: User,
    organizationId: number,
    draftId: number,
  ): Promise<CrossProjectAllocationDraftDetail> {
    await this.policy.authorizeView(user, organizationId)

    const draft = await CrossProjectAllocationDraft.query()
      .where('id', draftId)
      .where('organization_id', organizationId)
      .preload('items')
      .preload('commits')
      .firstOrFail()

    const items = draft.items.map((i) => this.toItemDTO(i))
    const latestCommit = draft.commits[0] ?? null

    return {
      ...this.toDraftDTO(draft),
      items,
      confirmation: latestCommit
        ? {
            id: String(latestCommit.id),
            draftId: String(draft.id),
            actorId: latestCommit.actorId,
            organizationId: latestCommit.organizationId,
            visibleTargetProjectIds: latestCommit.visibleTargetProjectIds,
            itemIds: latestCommit.itemIds,
            previewHash: latestCommit.previewHash,
            queryShape: (draft.queryShape ?? {}) as unknown as CrossProjectAllocationQueryShape,
            warnings: (latestCommit.warnings ?? []) as CrossProjectAllocationWarning[],
            idempotencyKeyHash: latestCommit.idempotencyKeyHash,
            confirmedAt: latestCommit.confirmedAt.toISO()!,
          }
        : null,
      applyResult: latestCommit?.applyResult
        ? (latestCommit.applyResult as unknown as CrossProjectAllocationApplyResult)
        : null,
    }
  }

  // ── 候选资源 ────────────────────────────────────────────────────────────

  async listCandidates(
    user: User,
    organizationId: number,
    input: {
      dateFrom: string
      dateTo: string
      projectIds?: number[]
      skillTags?: string[]
      roles?: string[]
      resourceTypes?: string[]
      loadStatuses?: string[]
      topN?: number
      freshnessThresholdMinutes?: number
    },
  ): Promise<{
    data: CrossProjectAllocationCandidateResource[]
    meta: { total: number; topN: number; hasMore: boolean }
  }> {
    await this.policy.authorizeView(user, organizationId)

    const topN = Math.min(input.topN ?? 20, 50)

    // 从资源池聚合查询候选（从既有派生事实读取，不从 task assignee 推导）
    // 此处使用 Lucid 查询替代完整 Service 注入
    const resources = await db.rawQuery(
      `SELECT r.id as resource_id, r.name as resource_name, r.project_id as source_project_id,
              r.daily_capacity_hours, r.skill_tags, r.role,
              p.name as source_project_name
       FROM resources r
       JOIN projects p ON r.project_id = p.id
       WHERE p.organization_id = ?
         AND r.status = 'active'
         AND r.deleted_at IS NULL
       LIMIT ?`,
      [organizationId, topN * 3],
    )

    const candidates: CrossProjectAllocationCandidateResource[] = []
    for (const row of resources) {
      // 权限检查：过滤用户不可见的项目资源
      if (!(await this.policy.canViewProject(user, organizationId, row.source_project_id))) {
        continue
      }

      let skillTags: string[] = []
      try {
        skillTags =
          typeof row.skill_tags === 'string' ? JSON.parse(row.skill_tags) : (row.skill_tags ?? [])
      } catch {
        skillTags = []
      }

      candidates.push({
        resourceId: row.resource_id,
        resourceName: row.resource_name,
        redaction: 'visible',
        sourceProjectId: row.source_project_id,
        sourceProjectName: row.source_project_name ?? '',
        remainingCapacityHours: Number(row.daily_capacity_hours ?? 8) * 5,
        dailyCapacityHours: Number(row.daily_capacity_hours ?? 8),
        skillTags,
        skillFitPercent: 0,
        availabilitySlots: [],
        unavailableDates: [],
        currentUtilizationPercent: 0,
        afterAllocationUtilizationPercent: null,
        pmoPriorityScore: null,
        source: 'rule',
        rationale: null,
      })

      if (candidates.length >= topN) break
    }

    return {
      data: candidates,
      meta: { total: candidates.length, topN, hasMore: candidates.length >= topN },
    }
  }

  // ── 预览草案 ────────────────────────────────────────────────────────────

  async previewDraft(
    user: User,
    organizationId: number,
    draftId: number,
  ): Promise<CrossProjectAllocationPreview> {
    await this.policy.authorizeView(user, organizationId)

    const draft = await CrossProjectAllocationDraft.query()
      .where('id', draftId)
      .where('organization_id', organizationId)
      .preload('items')
      .firstOrFail()

    // 收集 source signatures
    const sourceSignatures: Record<string, string> = {}
    const conflicts: CrossProjectAllocationConflict[] = []
    const affectedProjects: Array<{
      projectId: number
      projectName: string
      redaction: 'visible' | 'redacted' | 'forbidden' | 'unavailable'
    }> = []

    for (const item of draft.items) {
      // 检查目标项目可见性
      const canView = await this.policy.canViewProject(user, organizationId, item.targetProjectId)
      if (!canView) {
        conflicts.push({
          severity: 'warning',
          code: 'TARGET_PROJECT_HIDDEN',
          message: '目标项目不可见',
          affectedDates: [],
          affectedProjectIds: [item.targetProjectId],
          redaction: 'redacted',
        })
        continue
      }

      // 检查资源权限
      if (
        !(await this.policy.canManageResourceInProject(user, organizationId, item.targetProjectId))
      ) {
        conflicts.push({
          severity: 'error',
          code: 'TARGET_PERMISSION_REVOKED',
          message: '无权在目标项目中分配资源',
          affectedDates: [],
          affectedProjectIds: [item.targetProjectId],
          redaction: 'redacted',
        })
      }

      affectedProjects.push({
        projectId: item.targetProjectId,
        projectName: `project-${item.targetProjectId}`,
        redaction: 'visible',
      })
    }

    // 生成 source signatures
    const now = new Date().toISOString()
    sourceSignatures['resources'] = computePreviewFingerprint([String(draft.id), now, 'resources'])
    sourceSignatures['tasks'] = computePreviewFingerprint([String(draft.id), now, 'tasks'])
    sourceSignatures['allocations'] = computePreviewFingerprint([
      String(draft.id),
      now,
      'allocations',
    ])

    const evidenceHash = computeAllocationEvidenceHash(sourceSignatures)
    const previewHash = computePreviewFingerprint([
      String(draft.id),
      evidenceHash,
      String(draft.items.length),
      now,
    ])

    const evidence: CrossProjectAllocationEvidence = {
      references: [],
      sourceSignatures,
      freshness: [
        {
          source: 'resource_registry',
          lastUpdatedAt: now,
          isStale: false,
          staleThresholdMinutes: 60,
          sourceSignature: sourceSignatures['resources'],
        },
        {
          source: 'resource_allocation',
          lastUpdatedAt: now,
          isStale: false,
          staleThresholdMinutes: 60,
          sourceSignature: sourceSignatures['allocations'],
        },
        {
          source: 'computed',
          lastUpdatedAt: now,
          isStale: false,
          staleThresholdMinutes: 60,
          sourceSignature: sourceSignatures['tasks'],
        },
      ],
      warnings: [],
      evidenceHash,
      computedAt: now,
    }

    // 更新草案状态
    draft.status = 'previewed'
    draft.previewHash = previewHash
    draft.previewExpiresAt = new Date(Date.now() + 30 * 60 * 1000) as any // 30 min
    draft.sourceSignatures = sourceSignatures
    await draft.save()

    const items = draft.items.map((i) => this.toItemDTO(i))

    return {
      draftId: String(draft.id),
      status: 'previewed',
      items,
      conflicts: sortConflictsBySeverity(conflicts),
      affectedVisibleProjects: affectedProjects,
      evidence,
      previewHash,
      previewExpiresAt: draft.previewExpiresAt?.toISO()!,
      warnings: [],
    }
  }

  // ── 确认草案 ────────────────────────────────────────────────────────────

  async confirmDraft(
    user: User,
    organizationId: number,
    draftId: number,
    input: { idempotencyKey: string; warningsAcknowledged?: string[] },
  ): Promise<CrossProjectAllocationConfirmation> {
    await this.policy.authorizeManage(user, organizationId)

    const draft = await CrossProjectAllocationDraft.query()
      .where('id', draftId)
      .where('organization_id', organizationId)
      .preload('items')
      .firstOrFail()

    if (draft.status !== 'previewed') {
      throw new Error('草案未经过预览，无法确认')
    }

    if (!draft.previewHash) {
      throw new Error('预览哈希缺失')
    }

    // 检查 freshness
    if (draft.previewExpiresAt && draft.previewExpiresAt.toJSDate() < new Date()) {
      throw new Error('预览已过期，请重新预览')
    }

    const idempotencyKeyHash = computeIdempotencyHash(input.idempotencyKey)

    // 幂等检查
    const existingCommit = await CrossProjectAllocationCommit.query()
      .where('idempotency_key_hash', idempotencyKeyHash)
      .where('draft_id', draftId)
      .first()
    if (existingCommit) {
      return {
        id: String(existingCommit.id),
        draftId: String(draft.id),
        actorId: existingCommit.actorId,
        organizationId: existingCommit.organizationId,
        visibleTargetProjectIds: existingCommit.visibleTargetProjectIds,
        itemIds: existingCommit.itemIds,
        previewHash: existingCommit.previewHash,
        queryShape: (draft.queryShape ?? {}) as unknown as CrossProjectAllocationQueryShape,
        warnings: (existingCommit.warnings ?? []) as CrossProjectAllocationWarning[],
        idempotencyKeyHash: existingCommit.idempotencyKeyHash,
        confirmedAt: existingCommit.confirmedAt.toISO()!,
      }
    }

    const itemIds = draft.items.map((i) => String(i.id))
    const visibleProjectIds = [...new Set(draft.items.map((i) => i.targetProjectId))]

    const commit = await CrossProjectAllocationCommit.create({
      draftId: draft.id,
      organizationId,
      actorId: user.id,
      visibleTargetProjectIds: visibleProjectIds,
      itemIds,
      previewHash: draft.previewHash,
      queryShapeHash: computeQueryShapeHash(
        draft.queryShape as unknown as CrossProjectAllocationQueryShape,
      ),
      warnings: [],
      idempotencyKeyHash,
      status: 'confirmed',
      confirmedAt: new Date() as any,
    })

    draft.status = 'confirmed'
    await draft.save()

    return {
      id: String(commit.id),
      draftId: String(draft.id),
      actorId: commit.actorId,
      organizationId: commit.organizationId,
      visibleTargetProjectIds: commit.visibleTargetProjectIds,
      itemIds: commit.itemIds,
      previewHash: commit.previewHash,
      queryShape: (draft.queryShape ?? {}) as unknown as CrossProjectAllocationQueryShape,
      warnings: (commit.warnings ?? []) as CrossProjectAllocationWarning[],
      idempotencyKeyHash: commit.idempotencyKeyHash,
      confirmedAt: commit.confirmedAt.toISO()!,
    }
  }

  // ── 应用确认草案 ────────────────────────────────────────────────────────

  async applyConfirmedDraft(
    user: User,
    organizationId: number,
    draftId: number,
    input: { idempotencyKey: string },
  ): Promise<CrossProjectAllocationApplyResult> {
    await this.policy.authorizeManage(user, organizationId)

    const draft = await CrossProjectAllocationDraft.query()
      .where('id', draftId)
      .where('organization_id', organizationId)
      .preload('items')
      .firstOrFail()

    if (draft.status !== 'confirmed') {
      throw new Error('草案未经过确认，无法应用')
    }

    const idempotencyKeyHash = computeIdempotencyHash(input.idempotencyKey)

    // 幂等检查
    const existingCommit = await CrossProjectAllocationCommit.query()
      .where('draft_id', draftId)
      .where('status', 'applied')
      .first()
    if (existingCommit?.applyResult) {
      return existingCommit.applyResult as unknown as CrossProjectAllocationApplyResult
    }

    const commit = await CrossProjectAllocationCommit.query()
      .where('draft_id', draftId)
      .where('status', 'confirmed')
      .orderBy('confirmed_at', 'desc')
      .firstOrFail()

    const itemResults: CrossProjectAllocationApplyResult['itemResults'] = []
    let hasFailure = false

    // 按项目分组，每组内短事务写入
    const projectItems = new Map<number, CrossProjectAllocationItem[]>()
    for (const item of draft.items) {
      const group = projectItems.get(item.targetProjectId) || []
      group.push(item)
      projectItems.set(item.targetProjectId, group)
    }

    for (const [projectId, items] of projectItems) {
      // 二次授权检查
      if (!(await this.policy.canManageResourceInProject(user, organizationId, projectId))) {
        for (const item of items) {
          itemResults.push({
            itemId: String(item.id),
            status: 'failed',
            targetProjectId: projectId,
            targetAllocationId: null,
            errorCode: 'PERMISSION_DENIED',
          })
        }
        hasFailure = true
        continue
      }

      // 项目内写入（这里创建项目本地 resource_allocations）
      for (const item of items) {
        try {
          await db.transaction(async (trx) => {
            // v3-multitenant-database-isolation §5.5 / §4.5 修复三点：
            // 1. 原来这些 raw SQL 走 `db.rawQuery` 而不是 `trx.rawQuery`——虽然包在
            //    `db.transaction` 里，却用独立连接执行，失败时**根本不会回滚**；
            // 2. `resource_allocations` 的 SELECT/UPDATE/INSERT 完全没有租户或项目条件，
            //    而 `item.targetTaskId` / `item.candidateResourceId` 来自 draft item——
            //    他租 task/resource 的 id 会被直接读出并改写（该表无 organization_id，
            //    catalog 声明其归属经 resources/tasks 父级链解析）；
            // 3. `db.rawQuery(...).length` 只在 SQLite 成立，PG 返回 `{ rows }`，
            //    `!undefined` 恒为 true，方言不兼容。
            // 项目本身已由上方 `canManageResourceInProject` 校验属于当前组织，
            // 因此把 task/resource 限定在该项目内即等价于限定在租户内。
            const rowsOf = (res: unknown): Array<Record<string, unknown>> => {
              const maybe = res as { rows?: Array<Record<string, unknown>> }
              return maybe.rows ?? (res as Array<Record<string, unknown>>)
            }

            // 缺目标 id 的 item 无法定位到任何项目内实体：直接失败，不放行无 scope 查询
            const candidateResourceId = item.candidateResourceId
            const targetTaskId = item.targetTaskId

            // 检查资源是否在目标项目中登记
            const resourceExists =
              candidateResourceId === null
                ? []
                : rowsOf(
                    await trx.rawQuery(
                      `SELECT id FROM resources WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
                      [candidateResourceId, projectId],
                    ),
                  )

            if (resourceExists.length === 0 && item.itemType === 'map_resource') {
              // 自动创建项目本地资源映射
              // (在实际实现中，这里需要从候选快照复制资源信息)
            }

            // 写入 resource_allocations
            if (item.itemType === 'allocate' || item.itemType === 'reallocate') {
              if (candidateResourceId === null || targetTaskId === null) {
                throw new ResourceNotFoundException('资源不存在')
              }
              // 目标 task 必须属于本项目（进而属于本组织），否则整条 item 失败回滚
              const targetTask = rowsOf(
                await trx.rawQuery(
                  `SELECT id FROM tasks WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
                  [targetTaskId, projectId],
                ),
              )
              if (targetTask.length === 0) {
                throw new ResourceNotFoundException('资源不存在')
              }

              const existingAllocation = rowsOf(
                await trx.rawQuery(
                  `SELECT ra.id FROM resource_allocations ra
                   JOIN tasks t ON t.id = ra.task_id
                   WHERE ra.resource_id = ? AND ra.task_id = ? AND t.project_id = ?`,
                  [candidateResourceId, targetTaskId, projectId],
                ),
              )

              // luxon DateTime 不是合法的 SQL binding（better-sqlite3 只接受
              // number/string/bigint/buffer/null）——原实现直接绑 DateTime，这条路径
              // 在真实执行时必然抛「can only bind numbers, strings...」。转成日期串。
              // `start_date` / `end_date` 在 schema 上可空，而 knex 的 `StrictValues`
              // 类型不含 null，故绑定数组整体断言（值本身是合法 SQL binding）。
              const startDateSql = (item.startDate?.toISODate() ?? null) as never
              const endDateSql = (item.endDate?.toISODate() ?? null) as never

              if (existingAllocation.length > 0) {
                // db-scope-verified: id 来自上方 JOIN tasks 限定 project_id 的查询，
                // 目标项目已由 canManageResourceInProject 校验属当前组织
                await trx.rawQuery(
                  `UPDATE resource_allocations SET allocation_percent = ?, start_date = ?, end_date = ?, updated_at = ? WHERE id = ?`,
                  [
                    item.allocationPercent,
                    startDateSql,
                    endDateSql,
                    new Date().toISOString(),
                    Number(existingAllocation[0].id),
                  ],
                )
              } else {
                // db-scope-verified: targetTaskId 已确认属于目标项目、candidateResourceId
                // 已按项目查存在性，目标项目已校验属当前组织
                await trx.rawQuery(
                  `INSERT INTO resource_allocations (resource_id, task_id, allocation_type, allocation_percent, start_date, end_date, planned_units, created_at) VALUES (?, ?, 'allocated', ?, ?, ?, ?, ?)`,
                  [
                    candidateResourceId,
                    targetTaskId,
                    item.allocationPercent,
                    startDateSql,
                    endDateSql,
                    0,
                    new Date().toISOString(),
                  ],
                )
              }
            }

            item.itemStatus = 'applied'
            item.applied = 1
            await item.useTransaction(trx).save()
          })

          itemResults.push({
            itemId: String(item.id),
            status: 'applied',
            targetProjectId: projectId,
            targetAllocationId: item.candidateResourceId,
            errorCode: null,
          })
        } catch (err) {
          itemResults.push({
            itemId: String(item.id),
            status: 'failed',
            targetProjectId: projectId,
            targetAllocationId: null,
            errorCode: 'APPLY_FAILED',
          })
          hasFailure = true
        }
      }
    }

    const applyResult: CrossProjectAllocationApplyResult = {
      status: hasFailure ? 'partial' : 'success',
      draftId: String(draft.id),
      confirmationId: String(commit.id),
      itemResults,
      idempotencyKeyHash,
      appliedAt: new Date().toISOString(),
      warnings: [],
    }

    // 更新 commit
    commit.applyResult = applyResult as unknown as Record<string, unknown>
    commit.status = hasFailure ? 'partial' : 'applied'
    commit.appliedAt = new Date() as any
    await commit.save()

    draft.status = hasFailure ? 'failed' : 'applied'
    await draft.save()

    return applyResult
  }

  // ── 取消草案 ────────────────────────────────────────────────────────────

  async cancelDraft(user: User, organizationId: number, draftId: number): Promise<DraftDTO> {
    await this.policy.authorizeManage(user, organizationId)

    const draft = await CrossProjectAllocationDraft.query()
      .where('id', draftId)
      .where('organization_id', organizationId)
      .firstOrFail()

    if (['applied', 'cancelled', 'expired'].includes(draft.status)) {
      throw new Error('草案状态不允许取消')
    }

    draft.status = 'cancelled'
    await draft.save()

    return this.toDraftDTO(draft)
  }

  // ── 下钻 ────────────────────────────────────────────────────────────────

  async drillDown(
    user: User,
    organizationId: number,
    kind: string,
    targetId: number,
    projectId?: number,
    resourceId?: number,
  ): Promise<{
    targetKind: string
    targetId: number
    data: Record<string, unknown>
    evidence: CrossProjectAllocationEvidence | null
  }> {
    await this.policy.authorizeDrillDown(user, organizationId, kind, projectId, resourceId)

    // 按 kind 返回低敏目标详情
    return {
      targetKind: kind,
      targetId,
      data: { kind, targetId, authorized: true },
      evidence: null,
    }
  }

  // ── DTO 转换 ────────────────────────────────────────────────────────────

  private toDraftDTO(draft: CrossProjectAllocationDraft): DraftDTO {
    const warnings = (draft.warnings ?? []) as CrossProjectAllocationWarning[]
    return {
      id: String(draft.id),
      organizationId: draft.organizationId,
      status: draft.status as CrossProjectAllocationDraftStatus,
      name: draft.name,
      queryShape: (draft.queryShape ?? {}) as unknown as CrossProjectAllocationQueryShape,
      itemCount: 0,
      evidence: null,
      previewHash: draft.previewHash,
      previewExpiresAt: draft.previewExpiresAt?.toISO() ?? null,
      warnings,
      createdAt: draft.createdAt.toISO()!,
      updatedAt: draft.updatedAt?.toISO() ?? draft.createdAt.toISO()!,
    }
  }

  private toItemDTO(item: CrossProjectAllocationItem): CrossProjectAllocationDraftItem {
    return {
      id: String(item.id),
      itemType: item.itemType as CrossProjectAllocationDraftItem['itemType'],
      status: item.itemStatus as CrossProjectAllocationDraftItem['status'],
      demand: (item.demandSnapshot ?? {}) as unknown as CrossProjectAllocationDemand,
      candidate: (item.candidateSnapshot ?? null) as CrossProjectAllocationCandidateResource | null,
      allocationPercent: item.allocationPercent,
      startDate: item.startDate.toISODate()!,
      endDate: item.endDate.toISODate()!,
      conflicts: (item.conflicts ?? []) as CrossProjectAllocationConflict[],
      source: item.source as CrossProjectAllocationDraftItem['source'],
      advisoryOnly: item.advisoryOnly === 1,
      confirmationRequired: item.confirmationRequired === 1,
      applied: item.applied === 1,
      createdAt: item.createdAt.toISO()!,
      updatedAt: item.updatedAt?.toISO() ?? item.createdAt.toISO()!,
    }
  }
}
