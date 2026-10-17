/**
 * v3-knowledge-memory-operating-layer —— Operating 层 Controller。
 *
 * 严格遵守 design D5：仅做认证 → 参数校验 → Policy → Service → 响应格式化。
 * 零业务逻辑、零写入、零网络外发、零模型调用。
 *
 * 三个 GET endpoint：
 * - GET /api/v1/knowledge-memory/summary
 * - GET /api/v1/knowledge-memory/items
 * - GET /api/v1/knowledge-memory/items/:kind/:scopedRef
 *
 * feature flag off 时四个 action 前置 short-circuit 返回 404 FEATURE_NOT_ENABLED，
 * 且不解析 Policy、不构造 read context、零 adapter 调用（§4.1/§4.2）。
 *
 * @aiproj/backend
 */

import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import KnowledgeMemoryOperatingService from '#services/knowledge_memory_operating/operating_service'
import KnowledgeMemoryOperatingPolicy from '#policies/knowledge_memory_operating_policy'
import {
  operatingDetailParamsValidator,
  operatingListQueryValidator,
  operatingSurfaceParamsValidator,
} from '#validators/knowledge_memory_operating'
import type {
  KnowledgeMemoryOperatingKind,
  KnowledgeMemoryOperatingScope,
  KnowledgeMemoryOperatingStatus,
  OperatingListFilters,
} from '@aiproj/types'
import { OPERATING_LIST_DEFAULT_PER_PAGE } from '@aiproj/types'
import { AuthRequiredException, PermissionDeniedException } from '#exceptions/api_exception'
import { OperatingServiceError } from '#services/knowledge_memory_operating/operating_service'
import type { OperatingReadContext } from '#services/knowledge_memory_operating/port'
import { isKnowledgeMemoryOperatingLayerEnabled } from '#services/knowledge_memory_operating/feature_flag'

@inject()
export default class KnowledgeMemoryOperatingController {
  constructor(
    private readonly svc: KnowledgeMemoryOperatingService,
    private readonly policy: KnowledgeMemoryOperatingPolicy,
  ) {}

  /**
   * GET /api/v1/knowledge-memory/summary
   */
  async summary(ctx: HttpContext) {
    if (this.#featureOff(ctx)) return this.#featureOffResponse(ctx)
    await this.#assertCanView(ctx)
    const operatingCtx = this.#operatingCtx(ctx)
    try {
      const result = await this.svc.getSummary(operatingCtx)
      return ctx.response.ok({ data: result })
    } catch (err) {
      return this.#mapError(ctx, err)
    }
  }

  /**
   * GET /api/v1/knowledge-memory/items
   */
  async listItems(ctx: HttpContext) {
    if (this.#featureOff(ctx)) return this.#featureOffResponse(ctx)
    await this.#assertCanView(ctx)
    const query = await operatingListQueryValidator.validate(ctx.request.qs())
    const filters: OperatingListFilters = {
      kinds: query.kind ? [query.kind as KnowledgeMemoryOperatingKind] : undefined,
      statuses: query.status ? [query.status as KnowledgeMemoryOperatingStatus] : undefined,
      scopes: query.scope ? [query.scope as KnowledgeMemoryOperatingScope] : undefined,
      attentionFacets: query.attention
        ? [query.attention as KnowledgeMemoryOperatingStatus]
        : undefined,
      sort: (query.sort as OperatingListFilters['sort']) ?? undefined,
      order: (query.order as OperatingListFilters['order']) ?? undefined,
      page: query.page ?? 1,
      perPage: query.perPage ?? OPERATING_LIST_DEFAULT_PER_PAGE,
    }
    const operatingCtx = this.#operatingCtx(ctx)
    try {
      const result = await this.svc.listItems(operatingCtx, filters)
      return ctx.response.ok({ data: result })
    } catch (err) {
      return this.#mapError(ctx, err)
    }
  }

  /**
   * GET /api/v1/knowledge-memory/items/:kind/:scopedRef
   */
  async showItem(ctx: HttpContext) {
    if (this.#featureOff(ctx)) return this.#featureOffResponse(ctx)
    await this.#assertCanView(ctx)
    const params = await operatingDetailParamsValidator.validate({
      kind: ctx.params.kind,
      scopedRef: ctx.params.scopedRef,
    })
    const operatingCtx = this.#operatingCtx(ctx)
    try {
      const result = await this.svc.getItemDetail(operatingCtx, {
        kind: params.kind as KnowledgeMemoryOperatingKind,
        ref: params.scopedRef,
      })
      if (!result) {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Operating item not found' },
        })
      }
      return ctx.response.ok({ data: result })
    } catch (err) {
      return this.#mapError(ctx, err)
    }
  }

  /**
   * GET /api/v1/knowledge-memory/items/:kind/:scopedRef/surfaces/:surface
   * （server-side surface resolve；client descriptor 不能伪造 enabled，§4.9）
   */
  async showItemSurface(ctx: HttpContext) {
    if (this.#featureOff(ctx)) return this.#featureOffResponse(ctx)
    await this.#assertCanView(ctx)
    const params = await operatingSurfaceParamsValidator.validate({
      kind: ctx.params.kind,
      scopedRef: ctx.params.scopedRef,
      surface: ctx.params.surface,
    })
    const operatingCtx = this.#operatingCtx(ctx)
    try {
      const result = await this.svc.resolveSurface(
        operatingCtx,
        { kind: params.kind as KnowledgeMemoryOperatingKind, ref: params.scopedRef },
        params.surface as import('@aiproj/types').KnowledgeMemoryOperatingSurface,
      )
      if (!result) {
        return ctx.response.notFound({
          error: { code: 'SURFACE_UNAVAILABLE', message: 'Surface unavailable' },
        })
      }
      return ctx.response.ok({ data: result })
    } catch (err) {
      return this.#mapError(ctx, err)
    }
  }

  // ── 内部 ───────────────────────────────────────────────────────

  /**
   * feature flag 判定（每请求读取，不在 boot 期固化）。
   * off 时四个 action 立即返回，**不解析 Policy、不构造 ctx、零 adapter 调用**（§4.2）。
   */
  #featureOff(_ctx: HttpContext): boolean {
    return !isKnowledgeMemoryOperatingLayerEnabled()
  }

  #featureOffResponse(ctx: HttpContext) {
    return ctx.response.notFound({
      error: {
        code: 'FEATURE_NOT_ENABLED',
        message: '知识与记忆运营层未启用',
      },
    })
  }

  async #assertCanView(ctx: HttpContext): Promise<void> {
    const user = ctx.authUser
    if (!user) {
      throw new AuthRequiredException('Authentication required')
    }
    const can = await this.policy.canView(user, this.#organizationIdOf(ctx))
    if (!can.allowed) {
      throw new PermissionDeniedException(can.reason ?? 'Permission denied')
    }
  }

  #organizationIdOf(ctx: HttpContext): number {
    const orgId = ctx.tenant?.organizationId
    if (!orgId) {
      throw new PermissionDeniedException('缺少组织上下文')
    }
    return Number(orgId)
  }

  #operatingCtx(ctx: HttpContext): OperatingReadContext {
    const user = ctx.authUser
    if (!user) {
      throw new AuthRequiredException('Authentication required')
    }
    return {
      organizationId: this.#organizationIdOf(ctx),
      actorId: user.id,
      projectId: null,
      // 生产路径恒为 false —— L3 synthetic knowledge 只在 Eval 上下文可用，
      // 运营层永远不是 Eval 上下文。
      evalContext: false,
    }
  }

  #mapError(ctx: HttpContext, err: unknown) {
    if (err instanceof AuthRequiredException) {
      return ctx.response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: err.message },
      })
    }
    if (err instanceof PermissionDeniedException) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: err.message },
      })
    }
    if (err instanceof OperatingServiceError) {
      if (err.code === 'OPERATING_SERVICE_DENIED') {
        return ctx.response.forbidden({
          error: { code: 'PERMISSION_DENIED', message: err.message },
        })
      }
      if (err.code === 'OPERATING_SERVICE_PAGE_OUT_OF_RANGE') {
        return ctx.response.unprocessableEntity({
          error: { code: 'VALIDATION_ERROR', message: err.message },
        })
      }
      return ctx.response.internalServerError({
        error: { code: 'OPERATING_SERVICE_INTERNAL', message: err.message },
      })
    }
    return ctx.response.internalServerError({
      error: {
        code: 'OPERATING_SERVICE_INTERNAL',
        message: (err as Error)?.message?.slice(0, 200) ?? 'unknown',
      },
    })
  }
}
