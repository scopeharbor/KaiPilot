/**
 * v3-four-layer-knowledge-system —— KnowledgeController。
 *
 * HTTP 入口：创建/详情/检索/确认/生命周期转移/AI 结构化。
 * 只处理请求解析、权限校验、响应格式化；业务逻辑下沉到 KnowledgeService。
 *
 * 协议归属：/api/v1（V3 baseline A1）。
 *
 * @aiproj/backend
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import KnowledgeService, {
  KnowledgeItemNotFoundError,
  KnowledgeValidationError,
  KnowledgeTransitionRejectedError,
  L3AccessDeniedError,
} from '#services/knowledge/knowledge_service'
import AiStructureKnowledgeService from '#services/knowledge/ai_structure_knowledge_service'
import KnowledgePolicy from '#policies/knowledge_policy'
import {
  validateCreateKnowledge,
  validateQueryKnowledge,
  validateLifecycleTransition,
  validateAiStructureKnowledge,
} from '#validators/knowledge_validator'

@inject()
export default class KnowledgeController {
  constructor(
    private readonly svc: KnowledgeService,
    private readonly aiStructure: AiStructureKnowledgeService,
    private readonly policy: KnowledgePolicy,
  ) {}

  // ── CRUD ────────────────────────────────────────────────────

  /** POST /api/v1/knowledge */
  async create({ request, response, authUser, tenant }: HttpContext) {
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const can = await this.policy.canAuthor(authUser, tenant.organizationId)
    if (!can.allowed) {
      return response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: can.reason ?? 'Permission denied' },
      })
    }

    const body = validateCreateKnowledge({ request, response } as HttpContext)
    if (!body) return

    try {
      const item = await this.svc.create(tenant.organizationId, authUser.id, {
        layer: body.layer as 'L1' | 'L2',
        title: body.title,
        content: body.content,
        domain: body.domain,
        purpose: body.purpose,
        complexity: body.complexity,
        provenance: body.provenance,
      })
      return response.created({ data: item })
    } catch (e) {
      if (e instanceof KnowledgeValidationError) {
        return response.badRequest({
          error: { code: 'VALIDATION_ERROR', message: e.message },
        })
      }
      throw e
    }
  }

  /** GET /api/v1/knowledge/:id */
  async show({ request, response, authUser, tenant }: HttpContext) {
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const can = await this.policy.canView(authUser, tenant.organizationId)
    if (!can.allowed) {
      return response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: can.reason ?? 'Permission denied' },
      })
    }

    try {
      // 契约（api-contract 冻结点）：详情返回完整 KnowledgeItem（含 content/reviewHistory），
      // 供审查抽屉展示；L3 与非 Eval 上下文仍由服务层门禁拒绝。
      const item = await this.svc.getById(tenant.organizationId, Number(request.param('id')))
      if (item.layer === 'L3') {
        throw new L3AccessDeniedError()
      }
      return response.ok({ data: item })
    } catch (e) {
      if (e instanceof KnowledgeItemNotFoundError) {
        return response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: e.message },
        })
      }
      if (e instanceof L3AccessDeniedError) {
        return response.forbidden({
          error: { code: 'PERMISSION_DENIED', message: e.message },
        })
      }
      throw e
    }
  }

  // ── 检索 ────────────────────────────────────────────────────

  /** GET /api/v1/knowledge */
  async index({ request, response, authUser, tenant }: HttpContext) {
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const can = await this.policy.canView(authUser, tenant.organizationId)
    if (!can.allowed) {
      return response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: can.reason ?? 'Permission denied' },
      })
    }

    const query = validateQueryKnowledge({ request, response } as HttpContext)
    if (!query) return

    const result = await this.svc.query(tenant.organizationId, {
      layer: query.layer,
      domain: query.domain,
      purpose: query.purpose,
      complexity: query.complexity,
      status: query.status,
      keyword: query.keyword,
      evalContext: query.evalContext,
      page: query.page,
      perPage: query.perPage,
    })

    return response.ok(result)
  }

  // ── 生命周期治理 ────────────────────────────────────────────

  /** POST /api/v1/knowledge/:id/confirm */
  async confirm({ request, response, authUser, tenant }: HttpContext) {
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const can = await this.policy.canManage(authUser, tenant.organizationId)
    if (!can.allowed) {
      return response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: can.reason ?? 'Permission denied' },
      })
    }

    try {
      const item = await this.svc.confirm(
        tenant.organizationId,
        authUser.id,
        Number(request.param('id')),
      )
      return response.ok({ data: item })
    } catch (e) {
      if (e instanceof KnowledgeItemNotFoundError) {
        return response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: e.message },
        })
      }
      if (e instanceof KnowledgeTransitionRejectedError) {
        return response.badRequest({
          error: { code: 'VALIDATION_ERROR', message: e.message },
        })
      }
      throw e
    }
  }

  /** POST /api/v1/knowledge/:id/transition */
  async transitionLifecycle({ request, response, authUser, tenant }: HttpContext) {
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const can = await this.policy.canManage(authUser, tenant.organizationId)
    if (!can.allowed) {
      return response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: can.reason ?? 'Permission denied' },
      })
    }

    const body = validateLifecycleTransition({ request, response } as HttpContext)
    if (!body) return

    try {
      const item = await this.svc.transitionLifecycle(
        tenant.organizationId,
        authUser.id,
        Number(request.param('id')),
        body.status,
      )
      return response.ok({ data: item })
    } catch (e) {
      if (e instanceof KnowledgeItemNotFoundError) {
        return response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: e.message },
        })
      }
      if (e instanceof KnowledgeTransitionRejectedError) {
        return response.badRequest({
          error: { code: 'VALIDATION_ERROR', message: e.message },
        })
      }
      throw e
    }
  }

  // ── AI 结构化 ────────────────────────────────────────────────

  /** POST /api/v1/knowledge/structure */
  async structure({ request, response, authUser, tenant }: HttpContext) {
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const can = await this.policy.canAuthor(authUser, tenant.organizationId)
    if (!can.allowed) {
      return response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: can.reason ?? 'Permission denied' },
      })
    }

    const body = validateAiStructureKnowledge({ request, response } as HttpContext)
    if (!body) return

    const result = await this.aiStructure.structure(tenant.organizationId, authUser.id, {
      rawText: body.rawText,
      targetLayer: body.targetLayer,
      domain: body.domain,
      purpose: body.purpose,
    })

    return response.ok({ data: result })
  }
}
