// v3-triz-contradiction-copilot W4 任务 4.1 —— 分馆产物持久化服务（表 `triz_gallery_artifacts`）。
//
// 职责（spec「分馆产物的持久化与权限」+ design D5/D13）：
// - 版本链：链键 = 「项目 + 产物类型」；**每一版一行、旧版本行原样保留** ——
//   创建 = 链的第 1 版，更新 = 链的下一版，删除 = 链内全部未删行软删；
// - 读取零写入，组织 + 项目双隔离（跨组织 / 不存在 / 已软删统一 404，RL-05）；
// - 一切变更产生低敏审计（产物 ID / 类型 / 版本 / 操作人 / 动作 / 耗时；RL-12）。
//
// 边界（红线）：
// - 本服务是分馆产物的**唯一**写入面，业务表（任务 / 风险 / 变更 / 矛盾 / 图表）零写入；
// - `content` 低敏：只接受结构化对象（格子 / 节点 / 连线 / 标注 / 参数对与原则编号快照），
//   键名黑名单（prompt / 模型输出全文 / 陈述原文）与体积上限双重拦截 ⇒ 422；
// - 不触碰既有 `diagrams` / `DiagramSpec` 契约与 `DiagramType` 枚举（design D13）。
//
// 版本回退：旧版本行永不就地覆盖，`versions()` 与 `findById(..., { version })` 可取回旧版本
// 内容（前端「回退到该版本」即用旧版本内容再保存为新版本，写入仍走本服务的更新端点）。

import app from '@adonisjs/core/services/app'
import { DateTime } from 'luxon'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import type User from '#models/user'
import TrizGalleryArtifact from '#models/triz_gallery_artifact'
import TenantScope from '#services/tenant_scope'
import AuditService, { AuditEvent } from '#services/audit_service'
import { hashParameters } from '#services/ai_tools/ai_tools_audit_helper'

/** 审计与观测面标识（RL-12：只落标识与计数，不落内容正文）。 */
export const TRIZ_GALLERY_ARTIFACT_TOOL_NAME = 'triz_gallery_artifact'

/** 四类产物闭集（spec「分馆产物的持久化与权限」第 1 条 / 迁移 CHECK 同源）。 */
export const TRIZ_GALLERY_ARTIFACT_TYPES = [
  'contradiction_matrix',
  'nine_windows',
  'function_analysis',
  's_curve',
] as const
export type TrizGalleryArtifactType = (typeof TRIZ_GALLERY_ARTIFACT_TYPES)[number]

/** 四类产物的中文标签（前端目录与审计展示共用一份，避免各处自造文案）。 */
export const TRIZ_GALLERY_ARTIFACT_TYPE_LABELS: Readonly<Record<TrizGalleryArtifactType, string>> =
  {
    contradiction_matrix: '矛盾矩阵快照',
    nine_windows: '九屏幕',
    function_analysis: '功能分析',
    s_curve: '进化 S 曲线快照',
  }

export const TRIZ_GALLERY_ARTIFACT_LIST_DEFAULT_PER_PAGE = 20
export const TRIZ_GALLERY_ARTIFACT_LIST_MAX_PER_PAGE = 100

/** 结构化内容体积上限（低敏：分馆产物是格子 / 节点 / 连线的有界快照，不是文档载体）。 */
export const TRIZ_GALLERY_ARTIFACT_MAX_CONTENT_BYTES = 32 * 1024

/**
 * 内容键名黑名单（小写化并去掉 `_` / `-` 后比对）：出现任一即 422。
 * 依据 RL-12 与 spec「分馆产物的持久化与权限」第 5 条：产物只存结构化内容，
 * MUST NOT 落 prompt、模型输出全文或 PM 陈述原文。
 */
export const TRIZ_GALLERY_ARTIFACT_FORBIDDEN_CONTENT_KEYS: readonly string[] = [
  'prompt',
  'systemprompt',
  'userprompt',
  'rawoutput',
  'modeloutput',
  'outputtext',
  'rawtext',
  'completion',
  'statementtext',
  'rawstatement',
]

export interface TrizGalleryArtifactDTO {
  id: number
  organizationId: number
  projectId: number
  artifactType: TrizGalleryArtifactType
  artifactTypeLabel: string
  content: Record<string, unknown>
  version: number
  /** 是否为该产物类型下的当前版本（链内最大版本且未软删） */
  isCurrent: boolean
  createdBy: number
  updatedBy: number | null
  createdAt: string | null
  updatedAt: string | null
  deletedAt: string | null
  deleted: boolean
}

export interface TrizGalleryArtifactRequestContext {
  organizationId: number
  projectId: number
  user: User
  requestId?: string | null
}

export interface TrizGalleryArtifactListRequest extends TrizGalleryArtifactRequestContext {
  artifactType?: TrizGalleryArtifactType
  /** 是否包含已软删产物（默认 false；历史查询显式传 true） */
  includeDeleted?: boolean
  /** 是否按版本展开（默认 false = 每类只给当前版本） */
  history?: boolean
  page?: number
  perPage?: number
}

export interface TrizGalleryArtifactListResult {
  data: TrizGalleryArtifactDTO[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface TrizGalleryArtifactCreateRequest extends TrizGalleryArtifactRequestContext {
  artifactType: TrizGalleryArtifactType
  content: Record<string, unknown>
}

export interface TrizGalleryArtifactUpdateRequest extends TrizGalleryArtifactRequestContext {
  artifactId: number
  content: Record<string, unknown>
}

export interface TrizGalleryArtifactDeleteRequest extends TrizGalleryArtifactRequestContext {
  artifactId: number
}

export interface TrizGalleryArtifactUpdateResult {
  record: TrizGalleryArtifact
  /** 被本次更新取代的版本号（首版时等于新版本的前一版，恒为新版本 - 1） */
  previousVersion: number
}

export interface TrizGalleryArtifactDeleteResult {
  artifactType: TrizGalleryArtifactType
  /** 本次软删的行数（整条版本链） */
  deletedRows: number
  /** 软删前的当前版本号 */
  version: number
}

export interface TrizGalleryArtifactServiceDeps {
  audit?: AuditService
}

export default class TrizGalleryArtifactService {
  readonly #deps: TrizGalleryArtifactServiceDeps

  constructor(deps: TrizGalleryArtifactServiceDeps = {}) {
    this.#deps = deps
  }

  // ── 读取（零写入） ──────────────────────────────────────────────────

  /**
   * 列表：默认每类只给**当前版本**（链内最大版本），`history=true` 按版本展开。
   * 统一 `{ data, meta }` 分页信封；`includeDeleted=true` 时历史仍可查（软删不物理破坏历史）。
   */
  async list(request: TrizGalleryArtifactListRequest): Promise<TrizGalleryArtifactListResult> {
    const page = normalizePositive(request.page, 1)
    const perPage = Math.min(
      normalizePositive(request.perPage, TRIZ_GALLERY_ARTIFACT_LIST_DEFAULT_PER_PAGE),
      TRIZ_GALLERY_ARTIFACT_LIST_MAX_PER_PAGE,
    )

    const query = TenantScope.forOrganization(TrizGalleryArtifact.query(), request.organizationId)
      .where('project_id', request.projectId)
      .orderBy('artifact_type', 'asc')
      .orderBy('version', 'desc')
      .orderBy('id', 'desc')

    if (!request.includeDeleted) query.whereNull('deleted_at')
    if (request.artifactType) query.where('artifact_type', request.artifactType)

    if (request.history === true) {
      const countRows = (await query.clone().clearOrder().count('* as total')) as unknown as Array<{
        $extras: { total: number | string }
      }>
      const total = Number(countRows[0]?.$extras?.total ?? 0)
      const rows = await query.offset((page - 1) * perPage).limit(perPage)
      return {
        data: rows.map((row) => this.toDTO(row)),
        meta: { total, page, perPage, totalPages: perPage > 0 ? Math.ceil(total / perPage) : 0 },
      }
    }

    // 当前版本视图：每类至多一行（四类产物），先在内存里按链取最大版本再分页。
    const rows = await query
    const current = new Map<string, TrizGalleryArtifact>()
    for (const row of rows) {
      const key = String(row.artifactType)
      const existing = current.get(key)
      if (!existing || Number(row.version) > Number(existing.version)) current.set(key, row)
    }
    const all = [...current.values()].sort((a, b) =>
      String(a.artifactType).localeCompare(String(b.artifactType)),
    )
    const total = all.length
    const paged = all.slice((page - 1) * perPage, (page - 1) * perPage + perPage)
    const currentIds = new Set(paged.map((row) => Number(row.id)))

    return {
      data: paged.map((row) => this.toDTO(row, { isCurrent: currentIds.has(Number(row.id)) })),
      meta: { total, page, perPage, totalPages: perPage > 0 ? Math.ceil(total / perPage) : 0 },
    }
  }

  /**
   * 详情：组织 + 项目双隔离；不存在 / 跨组织 / 已软删（未显式要求历史）统一 404。
   * `version` 给定且不等于该行版本时，按版本链回退取回**旧版本内容**（版本回退读路径）。
   */
  async findById(
    organizationId: number,
    projectId: number,
    artifactId: number,
    options: { includeDeleted?: boolean; version?: number } = {},
  ): Promise<TrizGalleryArtifact> {
    const record = await this.#requireRecord(organizationId, projectId, artifactId, options)
    if (options.version === undefined || options.version === Number(record.version)) return record

    const target = await this.#chainRow(organizationId, projectId, record.artifactType, options)
    if (!target) throw new ResourceNotFoundException('分馆产物版本不存在')
    return target
  }

  /** 版本历史（含已软删版本）：旧版本内容可取回，供前端做「回退到该版本」。 */
  async versions(
    organizationId: number,
    projectId: number,
    artifactId: number,
    options: { includeDeleted?: boolean } = {},
  ): Promise<TrizGalleryArtifact[]> {
    const record = await this.#requireRecord(organizationId, projectId, artifactId, options)
    const query = TenantScope.forOrganization(TrizGalleryArtifact.query(), organizationId)
      .where('project_id', projectId)
      .where('artifact_type', record.artifactType)
      .orderBy('version', 'desc')
    if (!options.includeDeleted) query.whereNull('deleted_at')
    return query
  }

  // ── 写入（本表是分馆产物的唯一写入面） ───────────────────────────────

  /** 创建：链内下一版本（首版为 1）；产生 `DIAGRAM_CREATED` 审计。 */
  async create(request: TrizGalleryArtifactCreateRequest): Promise<TrizGalleryArtifact> {
    const startedAt = Date.now()
    const content = assertStructuredArtifactContent(request.content)
    const version =
      (await this.#maxVersion(request.organizationId, request.projectId, request.artifactType)) + 1

    const record = await TrizGalleryArtifact.create({
      organizationId: request.organizationId,
      projectId: request.projectId,
      artifactType: request.artifactType,
      content,
      version,
      createdBy: Number(request.user.id),
      updatedBy: Number(request.user.id),
      deletedAt: null,
    })

    await this.#audit(AuditEvent.DIAGRAM_CREATED, 'create', request, record, startedAt)
    return record
  }

  /**
   * 更新 = 版本递增：新增下一版并保留旧版本行（旧内容不被覆盖 ⇒ 版本回退可用）。
   * 目标行必须属于本组织 + 本项目且未软删（否则 404）。
   */
  async update(
    request: TrizGalleryArtifactUpdateRequest,
  ): Promise<TrizGalleryArtifactUpdateResult> {
    const startedAt = Date.now()
    const content = assertStructuredArtifactContent(request.content)
    const current = await this.#requireRecord(
      request.organizationId,
      request.projectId,
      request.artifactId,
    )

    const version =
      (await this.#maxVersion(request.organizationId, request.projectId, current.artifactType)) + 1
    const record = await TrizGalleryArtifact.create({
      organizationId: request.organizationId,
      projectId: request.projectId,
      artifactType: current.artifactType,
      content,
      version,
      createdBy: Number(current.createdBy),
      updatedBy: Number(request.user.id),
      deletedAt: null,
    })

    await this.#audit(AuditEvent.DIAGRAM_UPDATED, 'update', request, record, startedAt, {
      previousVersion: version - 1,
      previousArtifactId: Number(current.id),
    })
    return { record, previousVersion: version - 1 }
  }

  /**
   * 删除 = 软删：整条版本链置 `deleted_at`（不物理删除、不破坏历史；
   * 历史经 `includeDeleted=true` 仍可查）；产生 `DIAGRAM_DELETED` 审计。
   */
  async softDelete(
    request: TrizGalleryArtifactDeleteRequest,
  ): Promise<TrizGalleryArtifactDeleteResult> {
    const startedAt = Date.now()
    const current = await this.#requireRecord(
      request.organizationId,
      request.projectId,
      request.artifactId,
    )

    const chain = await TenantScope.forOrganization(
      TrizGalleryArtifact.query(),
      request.organizationId,
    )
      .where('project_id', request.projectId)
      .where('artifact_type', current.artifactType)
      .whereNull('deleted_at')

    const deletedAt = DateTime.now()
    let deletedRows = 0
    for (const row of chain) {
      row.deletedAt = deletedAt
      row.updatedBy = Number(request.user.id)
      await row.save()
      deletedRows += 1
    }

    await this.#audit(AuditEvent.DIAGRAM_DELETED, 'delete', request, current, startedAt, {
      deletedRows,
    })
    return {
      artifactType: current.artifactType as TrizGalleryArtifactType,
      deletedRows,
      version: Number(current.version),
    }
  }

  // ── 投影 ────────────────────────────────────────────────────────────

  toDTO(
    record: TrizGalleryArtifact,
    options: { isCurrent?: boolean } = {},
  ): TrizGalleryArtifactDTO {
    const artifactType = record.artifactType as TrizGalleryArtifactType
    return {
      id: Number(record.id),
      organizationId: Number(record.organizationId),
      projectId: Number(record.projectId),
      artifactType,
      artifactTypeLabel: TRIZ_GALLERY_ARTIFACT_TYPE_LABELS[artifactType] ?? String(artifactType),
      content: (record.content ?? {}) as Record<string, unknown>,
      version: Number(record.version),
      isCurrent: options.isCurrent ?? record.deletedAt === null,
      createdBy: Number(record.createdBy),
      updatedBy: record.updatedBy === null ? null : Number(record.updatedBy),
      createdAt: record.createdAt ? record.createdAt.toISO() : null,
      updatedAt: record.updatedAt ? record.updatedAt.toISO() : null,
      deletedAt: record.deletedAt ? record.deletedAt.toISO() : null,
      deleted: record.deletedAt !== null,
    }
  }

  // ── 内部 ────────────────────────────────────────────────────────────

  /** 链内最大版本号（含已软删行：版本号在链内不复用，避免与唯一约束冲突）。 */
  async #maxVersion(
    organizationId: number,
    projectId: number,
    artifactType: string,
  ): Promise<number> {
    const rows = (await TenantScope.forOrganization(TrizGalleryArtifact.query(), organizationId)
      .where('project_id', projectId)
      .where('artifact_type', artifactType)
      .max('version as max_version')) as unknown as Array<{
      $extras: { max_version: number | string | null }
    }>
    const value = rows[0]?.$extras?.max_version
    return value === null || value === undefined ? 0 : Number(value)
  }

  async #chainRow(
    organizationId: number,
    projectId: number,
    artifactType: string,
    options: { includeDeleted?: boolean; version?: number },
  ): Promise<TrizGalleryArtifact | null> {
    const query = TenantScope.forOrganization(TrizGalleryArtifact.query(), organizationId)
      .where('project_id', projectId)
      .where('artifact_type', artifactType)
      .where('version', options.version as number)
    if (!options.includeDeleted) query.whereNull('deleted_at')
    return query.first()
  }

  async #requireRecord(
    organizationId: number,
    projectId: number,
    artifactId: number,
    options: { includeDeleted?: boolean } = {},
  ): Promise<TrizGalleryArtifact> {
    const query = TenantScope.forOrganization(TrizGalleryArtifact.query(), organizationId)
      .where('project_id', projectId)
      .where('id', artifactId)
    if (!options.includeDeleted) query.whereNull('deleted_at')
    const record = await query.first()
    if (!record) {
      // 跨组织 / 不存在 / 已软删统一同一响应（RL-05：不泄露存在性）
      throw new ResourceNotFoundException('分馆产物不存在')
    }
    return record
  }

  async #resolveAudit(): Promise<AuditService | null> {
    if (this.#deps.audit) return this.#deps.audit
    try {
      return await app.container.make(AuditService)
    } catch {
      return null
    }
  }

  /** 低敏审计：产物 ID / 类型 / 版本 / 动作 / 状态 / 耗时 + 入参哈希（无内容正文，RL-12）。 */
  async #audit(
    event: (typeof AuditEvent)['DIAGRAM_CREATED' | 'DIAGRAM_UPDATED' | 'DIAGRAM_DELETED'],
    action: string,
    request: TrizGalleryArtifactRequestContext,
    record: TrizGalleryArtifact,
    startedAt: number,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const audit = await this.#resolveAudit()
    if (!audit) return

    const parameters = {
      action,
      artifactId: Number(record.id),
      artifactType: String(record.artifactType),
      version: Number(record.version),
    }
    await audit.log({
      event,
      userId: Number(request.user.id),
      organizationId: request.organizationId,
      projectId: request.projectId,
      requestId: request.requestId ?? null,
      entityType: 'triz_gallery_artifact',
      entityId: Number(record.id),
      metadata: {
        toolName: TRIZ_GALLERY_ARTIFACT_TOOL_NAME,
        parametersHash: hashParameters(parameters),
        status: 'SUCCESS',
        durationMs: Date.now() - startedAt,
        errorCode: null,
        ...parameters,
        ...extra,
      },
    })
  }
}

/**
 * 结构化产物内容白名单式校验：
 * - 必须是普通对象（不接受数组 / 标量 / null）：分馆产物是格子、节点、连线、标注的快照；
 * - 体积上限 `TRIZ_GALLERY_ARTIFACT_MAX_CONTENT_BYTES`（低敏：产物不是文档载体）；
 * - 递归拒绝黑名单键名（prompt / 模型输出 / 陈述原文），任一命中即 422（RL-12）。
 */
export function assertStructuredArtifactContent(content: unknown): Record<string, unknown> {
  if (content === null || typeof content !== 'object' || Array.isArray(content)) {
    throw new ValidationException('分馆产物内容必须是结构化的 JSON 对象')
  }

  const bytes = Buffer.byteLength(JSON.stringify(content), 'utf8')
  if (bytes > TRIZ_GALLERY_ARTIFACT_MAX_CONTENT_BYTES) {
    throw new ValidationException(
      `分馆产物内容超出体积上限（${bytes} > ${TRIZ_GALLERY_ARTIFACT_MAX_CONTENT_BYTES} 字节）`,
    )
  }

  const forbidden = findForbiddenContentKey(content)
  if (forbidden) {
    throw new ValidationException(
      `分馆产物内容不得包含「${forbidden}」字段：产物只存结构化结果，不存 prompt、模型输出或陈述原文`,
    )
  }

  return content as Record<string, unknown>
}

/** 递归查找黑名单键名；命中即返回原始键名（供错误信息定位，不回显字段值）。 */
export function findForbiddenContentKey(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findForbiddenContentKey(item)
      if (hit) return hit
    }
    return null
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[_-]/g, '')
    if (TRIZ_GALLERY_ARTIFACT_FORBIDDEN_CONTENT_KEYS.includes(normalized)) return key
    const hit = findForbiddenContentKey(nested)
    if (hit) return hit
  }
  return null
}

function normalizePositive(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : fallback
}
