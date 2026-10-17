/**
 * v3-skill-registry-and-lifecycle —— SkillRegistryService（D1/D5/D8）。
 *
 * 组织级 Skill 的 CRUD / 查询 / 匹配 / 生命周期治理。
 * 所有查询强制 `where organization_id`（组织隔离红线）。
 * draft 可编辑/删除；eval/active/deprecated 内容冻结。
 * eval→active 为显式动作，无任何自动化触发。
 *
 * @aiproj/backend
 */
import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'
import CompilerSkill from '#models/compiler_skill'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  validateSkillLifecycleTransition,
  matchSkills,
  type Skill,
  type SkillLifecycleStatus,
  type SkillQuery,
  type SkillMatchQuery,
  type SkillMatchResult,
} from '@aiproj/types'

export class SkillNotFoundError extends Error {
  constructor(id: number) {
    super(`Skill not found: ${id}`)
    this.name = 'SkillNotFoundError'
  }
}

export class SkillNotEditableError extends Error {
  constructor(id: number, status: string) {
    super(`Skill ${id} is not editable in status "${status}"`)
    this.name = 'SkillNotEditableError'
  }
}

export class SkillTransitionRejectedError extends Error {
  constructor(id: number, from: string, to: string, reason: string) {
    super(`Transition rejected for skill ${id}: ${from}→${to} — ${reason}`)
    this.name = 'SkillTransitionRejectedError'
  }
}

@inject()
export default class SkillRegistryService {
  constructor(private readonly audit: AuditService) {}

  // ── CRUD ────────────────────────────────────────────────────────

  /**
   * 创建 Skill（仅 draft 可创建）。
   */
  async create(
    organizationId: number,
    data: {
      skillKey: string
      name: string
      version: string
      description: string
      category: Record<string, unknown>
      tags: string[]
      activation: Record<string, unknown>
      knowledge: Record<string, unknown>
      provenance?: Record<string, unknown> | null
      basePriority: number
    },
    actorId: number,
  ): Promise<Skill> {
    const skill = await CompilerSkill.create({
      organizationId,
      skillKey: data.skillKey,
      name: data.name,
      version: data.version,
      description: data.description,
      status: 'draft' as SkillLifecycleStatus,
      category: data.category as any,
      tags: data.tags,
      activation: data.activation as any,
      knowledge: data.knowledge as any,
      provenance: (data.provenance ?? null) as any,
      basePriority: data.basePriority,
      createdBy: actorId,
      updatedBy: actorId,
    })

    // 低敏审计
    await this.audit.log({
      event: AuditEvent.AI_COMPILER_SKILL_CREATED,
      userId: actorId,
      organizationId,
      metadata: {
        skillKey: data.skillKey,
        version: data.version,
        category: data.category,
      },
    })

    return this.toSkill(skill)
  }

  /**
   * 更新 Skill（仅 draft 可编辑，D8）。
   */
  async update(
    organizationId: number,
    id: number,
    data: Partial<{
      name: string
      description: string
      category: Record<string, unknown>
      tags: string[]
      activation: Record<string, unknown>
      knowledge: Record<string, unknown>
      provenance: Record<string, unknown> | null
      basePriority: number
    }>,
    actorId: number,
  ): Promise<Skill> {
    const skill = await this.getOwnedById(organizationId, id)

    if (skill.status !== 'draft') {
      throw new SkillNotEditableError(id, skill.status)
    }

    const updateData: Record<string, unknown> = { updatedBy: actorId }
    if (data.name !== undefined) updateData.name = data.name
    if (data.description !== undefined) updateData.description = data.description
    if (data.category !== undefined) updateData.category = JSON.stringify(data.category)
    if (data.tags !== undefined) updateData.tags = JSON.stringify(data.tags)
    if (data.activation !== undefined) updateData.activation = JSON.stringify(data.activation)
    if (data.knowledge !== undefined) updateData.knowledge = JSON.stringify(data.knowledge)
    if (data.provenance !== undefined) {
      updateData.provenance = data.provenance !== null ? JSON.stringify(data.provenance) : null
    }
    if (data.basePriority !== undefined) updateData.basePriority = data.basePriority

    skill.merge(updateData)
    await skill.save()

    // 低敏审计
    await this.audit.log({
      event: AuditEvent.AI_COMPILER_SKILL_UPDATED,
      userId: actorId,
      organizationId,
      metadata: {
        skillKey: skill.skillKey,
        version: skill.version,
        category: skill.category,
      },
    })

    return this.toSkill(skill)
  }

  /**
   * 软删除 draft（仅 draft 可删除，D8）。
   */
  async softDeleteDraft(organizationId: number, id: number, actorId: number): Promise<void> {
    const skill = await this.getOwnedById(organizationId, id)

    if (skill.status !== 'draft') {
      throw new SkillNotEditableError(id, skill.status)
    }

    await skill.delete()

    // 低敏审计
    await this.audit.log({
      event: AuditEvent.AI_COMPILER_SKILL_DELETED,
      userId: actorId,
      organizationId,
      metadata: {
        skillKey: skill.skillKey,
        version: skill.version,
        category: skill.category,
      },
    })
  }

  /**
   * 按组织列出所有 Skill。
   */
  async listByOrg(
    organizationId: number,
    query?: SkillQuery,
  ): Promise<{ data: Skill[]; total: number }> {
    let dbQuery = CompilerSkill.forOrganization(organizationId)

    if (query?.search) {
      dbQuery = dbQuery
        .where('name', 'like', `%${query.search}%`)
        .orWhere('description', 'like', `%${query.search}%`)
        .andWhere('organization_id', organizationId)
    }
    if (query?.status) {
      dbQuery = dbQuery.where('status', query.status)
    }
    if (query?.categoryPrimary) {
      // JSON 搜索 — SQLite 下用 LIKE
      dbQuery = dbQuery.where('category', 'like', `%"primary":"${query.categoryPrimary}"%`)
    }

    const page = query?.page ?? 1
    const perPage = query?.perPage ?? 20
    const sortBy = query?.sortBy ?? 'updated_at'
    const sortOrder = query?.sortOrder ?? 'desc'

    // 防止 SQL 注入：只允许已知排序字段
    const allowedSortFields = [
      'updated_at',
      'created_at',
      'name',
      'skill_key',
      'version',
      'base_priority',
    ]
    const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'updated_at'

    const result = await dbQuery.orderBy(safeSortBy, sortOrder).paginate(page, perPage)

    return {
      data: result.all().map((s) => this.toSkill(s)),
      total: result.total ?? 0,
    }
  }

  /**
   * 按 ID 获取 Skill（强制组织过滤）。
   */
  async getById(organizationId: number, id: number): Promise<Skill> {
    return this.toSkill(await this.getOwnedById(organizationId, id))
  }

  // ── 查询 / 匹配 ────────────────────────────────────────────────

  /**
   * 查询本组织 Skill（仅返回 effective active）。
   */
  async query(
    organizationId: number,
    query: SkillQuery,
  ): Promise<{ data: Skill[]; total: number }> {
    return this.listByOrg(organizationId, { ...query, status: 'active' })
  }

  /**
   * 匹配本组织 active Skill。
   * Service 层注入 DateTime.now() 作参考时间（保持 matchSkills 纯函数确定性）。
   */
  async match(organizationId: number, matchQuery: SkillMatchQuery): Promise<SkillMatchResult[]> {
    const skills = await CompilerSkill.forOrganization(organizationId).where('status', 'active')

    const allSkills = await skills

    const typedSkills: Skill[] = allSkills.map((s) => this.toSkill(s))

    const referenceTime = DateTime.now().toISO()

    return matchSkills(typedSkills, matchQuery, {
      referenceTime,
      limit: matchQuery.limit ?? 10,
    })
  }

  // ── 生命周期 ────────────────────────────────────────────────────

  /**
   * 受治理生命周期转移（D3/D7/D10）。
   * 先经纯函数状态机校验，非法则零副作用；合法则持久化并写低敏审计。
   * eval→active 为显式动作，无任何自动化触发。
   */
  async transitionLifecycle(
    organizationId: number,
    id: number,
    to: SkillLifecycleStatus,
    actorId: number,
  ): Promise<Skill> {
    const skill = await this.getOwnedById(organizationId, id)
    const from = skill.status as SkillLifecycleStatus

    const validation = validateSkillLifecycleTransition(from, to)
    if (!validation.valid) {
      throw new SkillTransitionRejectedError(id, from, to, validation.reasonCode)
    }

    skill.status = to
    skill.updatedBy = actorId
    await skill.save()

    // 低敏审计
    await this.audit.log({
      event: AuditEvent.AI_COMPILER_SKILL_LIFECYCLE_TRANSITIONED,
      userId: actorId,
      organizationId,
      metadata: {
        skillKey: skill.skillKey,
        version: skill.version,
        category: skill.category,
        from,
        to,
        reasonCode: validation.reasonCode,
      },
    })

    return this.toSkill(skill)
  }

  // ── 内部工具 ────────────────────────────────────────────────────

  /**
   * 按 ID 获取并验证组织归属。
   */
  private async getOwnedById(organizationId: number, id: number): Promise<CompilerSkill> {
    const skill = await CompilerSkill.query()
      .where('id', id)
      .where('organization_id', organizationId)
      .first()

    if (!skill) {
      throw new SkillNotFoundError(id)
    }

    return skill
  }

  /**
   * Model → 共享契约 Skill 类型转换。
   */
  private toSkill(model: CompilerSkill): Skill {
    return {
      id: model.id,
      organizationId: model.organizationId,
      skillKey: model.skillKey,
      name: model.name,
      version: model.version,
      description: model.description,
      status: model.status,
      category: model.category as any,
      tags: model.tags ?? [],
      dependencies: model.dependencies ?? [],
      activation: model.activation as any,
      knowledge: model.knowledge as any,
      provenance: (model.provenance as any) ?? undefined,
      basePriority: model.basePriority,
      createdBy: model.createdBy,
      updatedBy: model.updatedBy,
      createdAt: model.createdAt?.toISO() ?? '',
      updatedAt: model.updatedAt?.toISO() ?? '',
    }
  }
}
