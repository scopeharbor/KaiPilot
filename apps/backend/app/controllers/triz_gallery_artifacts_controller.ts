/**
 * v3-triz-contradiction-copilot W4 任务 4.1 —— 分馆产物 API 控制器。
 *
 * 端点（前缀 `/api/v1/projects/:projectId/triz-gallery-artifacts`）：
 * - `GET /` 列表（类型过滤 + 统一 `{ data, meta }` 信封；`includeDeleted` / `history` 查历史）；
 * - `GET /:artifactId` 详情（可带 `version` 取回旧版本内容）；
 * - `GET /:artifactId/versions` 版本历史（软删历史仍可查，供回退）；
 * - `POST /` 创建（链内首版 / 下一版）；
 * - `PATCH /:artifactId` 更新（**版本递增**：新增下一版，旧版本行保留）；
 * - `DELETE /:artifactId` 删除（整条版本链软删）。
 *
 * 权限（design D17 ③）：读取 `project:view`；写入既有 `diagram:manage`（不新增权限码）。
 * 跨组织 / 不存在统一 404（RL-05）；越权拒绝留痕（低敏：动作 / 缺失权限 / 入参哈希）。
 *
 * HTTP 入口只做请求解析、策略判定、响应格式化与拒绝留痕；业务全部在
 * `TrizGalleryArtifactService`。写入集合只含本表，业务表零写入（红线）。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import TrizGalleryArtifactPolicy, {
  type TrizGalleryArtifactPolicyDecision,
} from '#policies/triz_gallery_artifact_policy'
import TrizGalleryArtifactService, {
  TRIZ_GALLERY_ARTIFACT_TOOL_NAME,
  type TrizGalleryArtifactType,
} from '#services/triz_copilot/triz_gallery_artifact_service'
import AuditService, { AuditEvent } from '#services/audit_service'
import { hashParameters } from '#services/ai_tools/ai_tools_audit_helper'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import {
  destroyValidator,
  listValidator,
  showValidator,
  storeValidator,
  updateValidator,
  versionsValidator,
} from '#validators/triz_gallery'
import type User from '#models/user'

@inject()
export default class TrizGalleryArtifactsController {
  constructor(
    private readonly policy: TrizGalleryArtifactPolicy,
    private readonly artifacts: TrizGalleryArtifactService,
    private readonly audit: AuditService,
  ) {}

  /** 列表：默认每类只给当前版本，`history=true` 按版本展开。 */
  async index(ctx: HttpContext) {
    const startedAt = Date.now()
    const user = this.currentUser(ctx)
    const organizationId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const query = await ctx.request.validateUsing(listValidator, {
      data: { projectId, ...ctx.request.qs() },
    })

    const decision = await this.policy.authorizeView(user, organizationId, projectId)
    await this.assertAuthorized(ctx, decision, 'list', startedAt)

    const result = await this.artifacts.list({
      organizationId,
      projectId,
      user,
      artifactType: query.artifactType as TrizGalleryArtifactType | undefined,
      includeDeleted: query.includeDeleted,
      history: query.history,
      page: query.page,
      perPage: query.perPage,
    })

    return ctx.response.ok({ data: result.data, meta: result.meta })
  }

  /** 详情（可带 `version` 取回旧版本内容）。 */
  async show(ctx: HttpContext) {
    const startedAt = Date.now()
    const user = this.currentUser(ctx)
    const organizationId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const params = await ctx.request.validateUsing(showValidator, {
      data: { projectId, artifactId: ctx.params.artifactId, ...ctx.request.qs() },
    })

    const decision = await this.policy.authorizeView(user, organizationId, projectId)
    await this.assertAuthorized(ctx, decision, 'show', startedAt)

    const record = await this.artifacts.findById(
      organizationId,
      projectId,
      Number(params.artifactId),
      { includeDeleted: params.includeDeleted, version: params.version },
    )
    return ctx.response.ok({ data: this.artifacts.toDTO(record) })
  }

  /** 版本历史（含已软删版本；旧版本内容取回后可作为回退目标）。 */
  async versions(ctx: HttpContext) {
    const startedAt = Date.now()
    const user = this.currentUser(ctx)
    const organizationId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const params = await ctx.request.validateUsing(versionsValidator, {
      data: { projectId, artifactId: ctx.params.artifactId, ...ctx.request.qs() },
    })

    const decision = await this.policy.authorizeView(user, organizationId, projectId)
    await this.assertAuthorized(ctx, decision, 'versions', startedAt)

    const records = await this.artifacts.versions(
      organizationId,
      projectId,
      Number(params.artifactId),
      { includeDeleted: params.includeDeleted },
    )
    const latest = records.length > 0 ? Number(records[0].version) : null
    return ctx.response.ok({
      data: records.map((record) =>
        this.artifacts.toDTO(record, { isCurrent: Number(record.version) === latest }),
      ),
    })
  }

  /** 创建（链内下一版本；首版为 1）。 */
  async store(ctx: HttpContext) {
    const startedAt = Date.now()
    const user = this.currentUser(ctx)
    const organizationId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const body = await ctx.request.validateUsing(storeValidator, {
      data: { projectId, ...ctx.request.body() },
    })

    const decision = await this.policy.authorizeManage(user, organizationId, projectId)
    await this.assertAuthorized(ctx, decision, 'create', startedAt)

    const record = await this.artifacts.create({
      organizationId,
      projectId,
      user,
      artifactType: body.artifactType as TrizGalleryArtifactType,
      content: body.content as Record<string, unknown>,
      requestId: this.requestIdOf(ctx),
    })
    return ctx.response.created({ data: this.artifacts.toDTO(record) })
  }

  /** 更新 = 版本递增（新增下一版并保留旧版本行）。 */
  async update(ctx: HttpContext) {
    const startedAt = Date.now()
    const user = this.currentUser(ctx)
    const organizationId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const body = await ctx.request.validateUsing(updateValidator, {
      data: { projectId, artifactId: ctx.params.artifactId, ...ctx.request.body() },
    })

    const decision = await this.policy.authorizeManage(user, organizationId, projectId)
    await this.assertAuthorized(ctx, decision, 'update', startedAt)

    const result = await this.artifacts.update({
      organizationId,
      projectId,
      user,
      artifactId: Number(body.artifactId),
      content: body.content as Record<string, unknown>,
      requestId: this.requestIdOf(ctx),
    })
    return ctx.response.ok({
      data: {
        ...this.artifacts.toDTO(result.record),
        previousVersion: result.previousVersion,
      },
    })
  }

  /** 删除 = 软删（整条版本链；历史经 `includeDeleted=true` 仍可查）。 */
  async destroy(ctx: HttpContext) {
    const startedAt = Date.now()
    const user = this.currentUser(ctx)
    const organizationId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const body = await ctx.request.validateUsing(destroyValidator, {
      data: { projectId, artifactId: ctx.params.artifactId },
    })

    const decision = await this.policy.authorizeManage(user, organizationId, projectId)
    await this.assertAuthorized(ctx, decision, 'delete', startedAt)

    const result = await this.artifacts.softDelete({
      organizationId,
      projectId,
      user,
      artifactId: Number(body.artifactId),
      requestId: this.requestIdOf(ctx),
    })
    return ctx.response.ok({
      data: {
        artifactType: result.artifactType,
        deletedRows: result.deletedRows,
        version: result.version,
        deleted: true,
      },
    })
  }

  // ── 内部 ────────────────────────────────────────────────────────────

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgIdOf(ctx: HttpContext): number {
    return Number(ctx.tenant!.organizationId)
  }

  private projectIdFrom(ctx: HttpContext): number {
    return Number(ctx.params.projectId)
  }

  private requestIdOf(ctx: HttpContext): string | null {
    return ctx.request.id() ?? null
  }

  /**
   * 策略判定失败：跨组织 / 不存在统一 404（RL-05 不泄露存在性），其余 403；
   * 两类拒绝都留痕（spec「反幻觉与低敏审计边界」第 4 条）。
   */
  private async assertAuthorized(
    ctx: HttpContext,
    decision: TrizGalleryArtifactPolicyDecision,
    action: string,
    startedAt: number,
  ): Promise<void> {
    if (decision.allowed) return

    const crossOrg = decision.reason === 'cross_org_denied'
    const errorCode = crossOrg ? 'RESOURCE_NOT_FOUND' : 'PERMISSION_DENIED'
    const parameters = {
      action,
      missingPermission: decision.missingPermission,
      reason: decision.reason,
    }

    await this.audit.log({
      event: AuditEvent.AI_TOOL_DENIED,
      userId: Number(this.currentUser(ctx).id),
      organizationId: this.orgIdOf(ctx),
      projectId: this.projectIdFrom(ctx),
      requestId: this.requestIdOf(ctx),
      entityType: 'triz_gallery_artifact',
      entityId: null,
      // 低敏：只记动作名、缺失权限码与入参哈希（RL-12）。
      metadata: {
        toolName: TRIZ_GALLERY_ARTIFACT_TOOL_NAME,
        parametersHash: hashParameters(parameters),
        status: 'REJECTED',
        durationMs: Date.now() - startedAt,
        errorCode,
        ...parameters,
      },
    })

    if (crossOrg) throw new ResourceNotFoundException('项目不存在或无权访问')
    throw new PermissionDeniedException(
      `缺少分馆产物操作所需权限 (${decision.missingPermission ?? 'project:view'})`,
    )
  }
}
