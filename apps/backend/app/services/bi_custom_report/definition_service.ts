/**
 * bi_custom_report/definition_service —— 自定义报表定义 CRUD 服务。
 *
 * 支持 list/get/create/update/copy/set default/archive/restore/list versions 和乐观并发。
 * v3-bi-custom-report-builder §3.4
 */
import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'
import BiCustomReportDefinition from '#models/bi_custom_report_definition'
import BiCustomReportVersion from '#models/bi_custom_report_version'
import { BiCustomReportPolicy } from '#policies/bi_custom_report_policy'
import type { Actor } from '#policies/bi_custom_report_policy'
import {
  normalizeDefinition,
  checkForbiddenPayloadFields,
  checkComplexity,
  validateDefinitionAgainstRegistry,
} from '../bi_custom_report/index.js'
import type {
  BiCustomReportDataSourceRef,
  BiCustomReportFieldKey,
  BiCustomReportFilter,
  BiCustomReportGroup,
  BiCustomReportLayout,
  BiCustomReportScope,
  BiCustomReportSort,
  BiCustomReportVisibility,
  BiCustomReportVisualization,
} from '@aiproj/types'

export interface ListOptions {
  page?: number
  perPage?: number
  scope?: BiCustomReportScope
  visibility?: BiCustomReportVisibility
  search?: string
  sort?: string
  includeArchived?: boolean
  projectId?: number
  portfolioId?: number
}

// 入参类型直接复用 @aiproj/types 契约的字面量联合，与 validator 的 vine.enum 输出一致；
// 不要退化成宽 string，否则写入模型 JSON 列时又要靠 as 断言掩盖契约缺口。
export interface CreateInput {
  title: string
  description?: string
  scope?: BiCustomReportScope
  visibility?: BiCustomReportVisibility
  projectId?: number
  portfolioId?: number
  dataSources: BiCustomReportDataSourceRef[]
  fields: BiCustomReportFieldKey[]
  filters?: BiCustomReportFilter[]
  groups?: BiCustomReportGroup[]
  sorts?: BiCustomReportSort[]
  visualizations: BiCustomReportVisualization[]
  layout?: BiCustomReportLayout
}

export interface UpdateInput extends Partial<CreateInput> {
  expectedVersion: number
}

export interface CopyInput {
  title?: string
  scope?: BiCustomReportScope
  visibility?: BiCustomReportVisibility
}

export class BiCustomReportDefinitionService {
  /**
   * 分页列出授权定义。
   */
  async list(
    actor: Actor,
    organizationId: number,
    options: ListOptions = {},
  ): Promise<{
    data: BiCustomReportDefinition[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    if (!BiCustomReportPolicy.isOrgMember(actor, organizationId)) {
      return {
        data: [],
        meta: { total: 0, page: options.page ?? 1, perPage: options.perPage ?? 20, totalPages: 0 },
      }
    }

    const page = options.page ?? 1
    const perPage = options.perPage ?? 20

    let query = BiCustomReportDefinition.query().where('organization_id', organizationId)

    if (!options.includeArchived) {
      query = query.whereNull('archived_at')
    }

    if (options.scope) {
      query = query.where('scope', options.scope)
    }

    if (options.projectId) {
      query = query.where('project_id', options.projectId)
    }

    if (options.portfolioId) {
      query = query.where('portfolio_id', options.portfolioId)
    }

    // 权限过滤：personal 定义只有 owner 可看
    if (!BiCustomReportPolicy.canManageReports(actor)) {
      query = query.where((q) => {
        q.where('visibility', 'shared').orWhere((q2) => {
          q2.where('visibility', 'personal').where('owner_actor_id', actor.id)
        })
      })
    }

    if (options.search) {
      const search = `%${options.search}%`
      query = query.where((q) => {
        q.where('title', 'like', search).orWhere('description', 'like', search)
      })
    }

    // 排序
    const sortField = options.sort?.startsWith('-') ? options.sort.slice(1) : options.sort
    const sortDir = options.sort?.startsWith('-') ? 'desc' : 'asc'
    if (sortField === 'title' || sortField === 'created_at' || sortField === 'updated_at') {
      query = query.orderBy(sortField, sortDir)
    } else {
      query = query.orderBy('updated_at', 'desc')
    }

    const totalQuery = query.clone()
    const total = await totalQuery.count('* as total')
    const totalCount = Number(total[0].$extras?.total ?? 0)
    const totalPages = Math.ceil(totalCount / perPage)

    const data = await query.offset((page - 1) * perPage).limit(perPage)

    return {
      data,
      meta: { total: totalCount, page, perPage, totalPages },
    }
  }

  /**
   * 获取单个定义详情。
   */
  async get(
    actor: Actor,
    organizationId: number,
    definitionId: string,
  ): Promise<BiCustomReportDefinition | null> {
    const def = await BiCustomReportDefinition.query()
      .where('definition_id', definitionId)
      .where('organization_id', organizationId)
      .first()

    if (!def) return null
    if (!BiCustomReportPolicy.canRead(actor, def)) return null
    return def
  }

  /**
   * 创建新定义。
   */
  async create(
    actor: Actor,
    organizationId: number,
    input: CreateInput,
  ): Promise<BiCustomReportDefinition> {
    // 权限检查
    const visibility = input.visibility ?? 'personal'
    if (!BiCustomReportPolicy.canCreate(actor, organizationId, visibility)) {
      throw Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' })
    }

    // 安全检查：禁止非法字段
    const forbidden = checkForbiddenPayloadFields(input as unknown as Record<string, unknown>)
    if (forbidden.length > 0) {
      throw Object.assign(new Error(`VALIDATION_ERROR: ${forbidden.join('; ')}`), {
        code: 'VALIDATION_ERROR',
      })
    }

    // 复杂度检查
    const complexity = checkComplexity(input)
    if (!complexity.valid) {
      throw Object.assign(new Error(`VALIDATION_ERROR: ${complexity.violations.join('; ')}`), {
        code: 'VALIDATION_ERROR',
      })
    }

    // 注册表校验
    const validation = validateDefinitionAgainstRegistry({
      dataSources: input.dataSources,
      fields: input.fields,
      filters: input.filters,
      groups: input.groups,
      sorts: input.sorts,
      visualizations: input.visualizations,
    })

    if (!validation.valid) {
      throw Object.assign(
        new Error(
          `VALIDATION_ERROR: ${validation.blockingWarnings.map((w) => w.message).join('; ')}`,
        ),
        { code: 'VALIDATION_ERROR' },
      )
    }

    // 标准化 + hash
    const { normalized, definitionHash } = normalizeDefinition({
      dataSources: input.dataSources,
      fields: input.fields,
      filters: input.filters ?? [],
      groups: input.groups ?? [],
      sorts: input.sorts ?? [],
      visualizations: input.visualizations,
    })

    const now = DateTime.now()
    const definitionId = randomUUID()

    const def = await BiCustomReportDefinition.create({
      definitionId,
      organizationId,
      projectId: input.projectId ?? null,
      portfolioId: input.portfolioId ?? null,
      scope: input.scope ?? 'organization',
      visibility,
      ownerActorId: actor.id,
      version: 1,
      definitionHash,
      title: input.title,
      description: input.description ?? null,
      dataSources: input.dataSources,
      fields: normalized.fields,
      filters: input.filters ?? null,
      groups: input.groups ?? null,
      sorts: input.sorts ?? null,
      visualizations: input.visualizations,
      layout: input.layout ?? null,
      warnings: validation.warnings.length > 0 ? (validation.warnings as any) : null,
      isDefault: false,
      archivedAt: null,
      createdBy: actor.id,
      updatedBy: actor.id,
      createdAt: now,
      updatedAt: now,
    })

    // 创建版本快照
    await BiCustomReportVersion.create({
      definitionId,
      organizationId,
      version: 1,
      definitionHash,
      title: input.title,
      snapshot: input as unknown as Record<string, unknown>,
      changeSummary: '初始创建',
      updatedBy: actor.id,
      createdAt: now,
    })

    return def
  }

  /**
   * 更新定义（乐观并发）。
   */
  async update(
    actor: Actor,
    organizationId: number,
    definitionId: string,
    input: UpdateInput,
  ): Promise<BiCustomReportDefinition> {
    const def = await BiCustomReportDefinition.query()
      .where('definition_id', definitionId)
      .where('organization_id', organizationId)
      .first()

    if (!def) throw Object.assign(new Error('RESOURCE_NOT_FOUND'), { code: 'RESOURCE_NOT_FOUND' })
    if (!BiCustomReportPolicy.canUpdate(actor, def)) {
      throw Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' })
    }

    // 乐观并发检查
    if (input.expectedVersion !== def.version) {
      throw Object.assign(
        new Error(`CONFLICT: 预期版本 ${input.expectedVersion} 与当前版本 ${def.version} 不一致`),
        { code: 'CONFLICT' },
      )
    }

    const newVersion = def.version + 1

    // 标准化
    const sources = input.dataSources ?? def.dataSources
    const fields = input.fields ?? def.fields
    const filters = input.filters ?? def.filters ?? []
    const groups = input.groups ?? def.groups ?? []
    const sorts = input.sorts ?? def.sorts ?? []
    const visualizations = input.visualizations ?? def.visualizations

    const { definitionHash } = normalizeDefinition({
      dataSources: sources,
      fields,
      filters,
      groups,
      sorts,
      visualizations,
    })

    const now = DateTime.now()

    // 更新字段
    if (input.title !== undefined) def.title = input.title
    if (input.description !== undefined) def.description = input.description
    if (input.scope !== undefined) def.scope = input.scope
    if (input.visibility !== undefined) def.visibility = input.visibility
    if (input.dataSources !== undefined) def.dataSources = input.dataSources
    if (input.fields !== undefined) def.fields = input.fields
    if (input.filters !== undefined) def.filters = input.filters
    if (input.groups !== undefined) def.groups = input.groups
    if (input.sorts !== undefined) def.sorts = input.sorts
    if (input.visualizations !== undefined) def.visualizations = input.visualizations
    if (input.layout !== undefined) def.layout = input.layout
    if (input.projectId !== undefined) def.projectId = input.projectId
    if (input.portfolioId !== undefined) def.portfolioId = input.portfolioId

    def.version = newVersion
    def.definitionHash = definitionHash
    def.updatedBy = actor.id
    def.updatedAt = now

    await def.save()

    // 创建版本快照
    await BiCustomReportVersion.create({
      definitionId,
      organizationId,
      version: newVersion,
      definitionHash,
      title: def.title,
      snapshot: def.$attributes as unknown as Record<string, unknown>,
      changeSummary: `更新至版本 ${newVersion}`,
      updatedBy: actor.id,
      createdAt: now,
    })

    return def
  }

  /**
   * 复制定义。
   */
  async copy(
    actor: Actor,
    organizationId: number,
    definitionId: string,
    input: CopyInput = {},
  ): Promise<BiCustomReportDefinition> {
    const source = await BiCustomReportDefinition.query()
      .where('definition_id', definitionId)
      .where('organization_id', organizationId)
      .first()

    if (!source)
      throw Object.assign(new Error('RESOURCE_NOT_FOUND'), { code: 'RESOURCE_NOT_FOUND' })
    if (!BiCustomReportPolicy.canCopy(actor, source)) {
      throw Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' })
    }

    const newId = randomUUID()
    const now = DateTime.now()

    const copy = await BiCustomReportDefinition.create({
      definitionId: newId,
      organizationId,
      projectId: source.projectId,
      portfolioId: source.portfolioId,
      scope: input.scope ? (input.scope as any) : source.scope,
      visibility: input.visibility ? (input.visibility as any) : 'personal',
      ownerActorId: actor.id,
      version: 1,
      definitionHash: source.definitionHash,
      title: input.title ?? `${source.title} (副本)`,
      description: source.description,
      dataSources: source.dataSources,
      fields: source.fields,
      filters: source.filters,
      groups: source.groups,
      sorts: source.sorts,
      visualizations: source.visualizations,
      layout: source.layout,
      warnings: source.warnings,
      isDefault: false,
      archivedAt: null,
      createdBy: actor.id,
      updatedBy: actor.id,
      createdAt: now,
      updatedAt: now,
    })

    return copy
  }

  /**
   * 设为默认。
   */
  async setDefault(
    actor: Actor,
    organizationId: number,
    definitionId: string,
    expectedVersion: number,
  ): Promise<void> {
    const def = await BiCustomReportDefinition.query()
      .where('definition_id', definitionId)
      .where('organization_id', organizationId)
      .first()

    if (!def) throw Object.assign(new Error('RESOURCE_NOT_FOUND'), { code: 'RESOURCE_NOT_FOUND' })
    if (!BiCustomReportPolicy.canSetDefault(actor, def)) {
      throw Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' })
    }

    if (expectedVersion !== def.version) {
      throw Object.assign(
        new Error(`CONFLICT: 预期版本 ${expectedVersion} 与当前版本 ${def.version} 不一致`),
        { code: 'CONFLICT' },
      )
    }

    // 清除同 scope 下的旧默认
    await BiCustomReportDefinition.query()
      .where('organization_id', organizationId)
      .where('scope', def.scope)
      .where('is_default', true)
      .update({ is_default: false })

    def.isDefault = true
    def.updatedBy = actor.id
    def.updatedAt = DateTime.now()
    await def.save()
  }

  /**
   * 归档定义（乐观并发）。
   */
  async archive(
    actor: Actor,
    organizationId: number,
    definitionId: string,
    expectedVersion: number,
  ): Promise<void> {
    const def = await BiCustomReportDefinition.query()
      .where('definition_id', definitionId)
      .where('organization_id', organizationId)
      .first()

    if (!def) throw Object.assign(new Error('RESOURCE_NOT_FOUND'), { code: 'RESOURCE_NOT_FOUND' })
    if (!BiCustomReportPolicy.canArchiveRestore(actor, def)) {
      throw Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' })
    }

    if (expectedVersion !== def.version) {
      throw Object.assign(
        new Error(`CONFLICT: 预期版本 ${expectedVersion} 与当前版本 ${def.version} 不一致`),
        { code: 'CONFLICT' },
      )
    }

    def.archivedAt = DateTime.now()
    def.isDefault = false
    def.updatedBy = actor.id
    def.updatedAt = DateTime.now()
    await def.save()
  }

  /**
   * 恢复定义（乐观并发）。
   */
  async restore(
    actor: Actor,
    organizationId: number,
    definitionId: string,
    expectedVersion: number,
  ): Promise<void> {
    const def = await BiCustomReportDefinition.query()
      .where('definition_id', definitionId)
      .where('organization_id', organizationId)
      .first()

    if (!def) throw Object.assign(new Error('RESOURCE_NOT_FOUND'), { code: 'RESOURCE_NOT_FOUND' })
    if (!BiCustomReportPolicy.canArchiveRestore(actor, def)) {
      throw Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' })
    }

    if (expectedVersion !== def.version) {
      throw Object.assign(
        new Error(`CONFLICT: 预期版本 ${expectedVersion} 与当前版本 ${def.version} 不一致`),
        { code: 'CONFLICT' },
      )
    }

    def.archivedAt = null
    def.updatedBy = actor.id
    def.updatedAt = DateTime.now()
    await def.save()
  }

  /**
   * 列出定义的所有版本。
   */
  async listVersions(
    actor: Actor,
    organizationId: number,
    definitionId: string,
  ): Promise<BiCustomReportVersion[]> {
    const def = await BiCustomReportDefinition.query()
      .where('definition_id', definitionId)
      .where('organization_id', organizationId)
      .first()

    if (!def) throw Object.assign(new Error('RESOURCE_NOT_FOUND'), { code: 'RESOURCE_NOT_FOUND' })
    if (!BiCustomReportPolicy.canRead(actor, def)) {
      throw Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' })
    }

    return BiCustomReportVersion.query()
      .where('definition_id', definitionId)
      .where('organization_id', organizationId)
      .orderBy('version', 'desc')
  }
}

export const biCustomReportDefinitionService = new BiCustomReportDefinitionService()
