/**
 * v3-skill-knowledge-authoring —— SkillKnowledgeAuthoringController（D7/D9）。
 *
 * HTTP 入口：getDraft / putDraft / preview / commit / aiAssist。
 * 只处理请求解析、权限校验、响应格式化；业务逻辑下沉到 SkillKnowledgeAuthoringService。
 *
 * Feature flag：COMPILER_SKILL_KNOWLEDGE_AUTHORING_ENABLED 默认关，关闭时端点返回 503。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import env from '#start/env'
import SkillKnowledgeAuthoringPolicy from '#policies/skill_knowledge_authoring_policy'
import SkillKnowledgeAuthoringService from '#services/compiler/skills/skill_knowledge_authoring_service'
import {
  putDraftValidator,
  commitValidator,
  aiAssistValidator,
  previewValidator,
} from '#validators/skill_knowledge_authoring_validator'

@inject()
export default class SkillKnowledgeAuthoringController {
  constructor(
    private readonly policy: SkillKnowledgeAuthoringPolicy,
    private readonly svc: SkillKnowledgeAuthoringService,
  ) {}

  // ── Feature gate ──────────────────────────────────────────────

  private featureEnabled(): boolean {
    return env.get('COMPILER_SKILL_KNOWLEDGE_AUTHORING_ENABLED', false) === true
  }

  // ── GET draft ──────────────────────────────────────────────────

  /** GET /api/v1/ai/compiler/skills/:skillId/knowledge/draft */
  async getDraft(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    if (!this.featureEnabled()) {
      return response.serviceUnavailable({
        error: {
          code: 'FEATURE_DISABLED',
          message: 'Skill Knowledge Authoring is not enabled',
        },
      })
    }

    const authResult = await this.policy.canViewDraft(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    try {
      const skillId = Number(ctx.params.skillId)
      const draft = await this.svc.getDraft(tenant.organizationId, skillId, authUser.id)
      return response.ok({ data: draft ?? null })
    } catch (err: any) {
      if (err.code === 'DRAFT_NOT_FOUND') {
        return response.ok({ data: null })
      }
      if (err.code === 'RESOURCE_NOT_FOUND') {
        return response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: err.message },
        })
      }
      throw err
    }
  }

  // ── PUT draft ──────────────────────────────────────────────────

  /** PUT /api/v1/ai/compiler/skills/:skillId/knowledge/draft */
  async putDraft(ctx: HttpContext) {
    const { request, response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    if (!this.featureEnabled()) {
      return response.serviceUnavailable({
        error: {
          code: 'FEATURE_DISABLED',
          message: 'Skill Knowledge Authoring is not enabled',
        },
      })
    }

    const authResult = await this.policy.canAuthorDraft(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const payload = await request.validateUsing(putDraftValidator)
    const skillId = Number(ctx.params.skillId)

    try {
      // 检查是否有已有草稿——有则更新，无则创建
      const existing = await this.svc.getDraft(tenant.organizationId, skillId, authUser.id)
      if (existing) {
        const updated = await this.svc.updateDraft(
          tenant.organizationId,
          skillId,
          payload.sections,
          authUser.id,
        )
        return response.ok({ data: updated })
      }

      const created = await this.svc.createDraft(
        tenant.organizationId,
        skillId,
        payload.sections,
        authUser.id,
      )
      return response.created({ data: created })
    } catch (err: any) {
      if (err.code === 'RESOURCE_NOT_FOUND') {
        return response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: err.message },
        })
      }
      if (err.code === 'DRAFT_ALREADY_PENDING') {
        return response.conflict({
          error: { code: 'DRAFT_ALREADY_PENDING', message: err.message },
        })
      }
      if (err.code === 'DRAFT_NOT_PENDING') {
        return response.conflict({
          error: { code: 'DRAFT_NOT_PENDING', message: err.message },
        })
      }
      throw err
    }
  }

  // ── POST preview ───────────────────────────────────────────────

  /** POST /api/v1/ai/compiler/skills/:skillId/knowledge/preview */
  async preview(ctx: HttpContext) {
    const { request, response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    if (!this.featureEnabled()) {
      return response.serviceUnavailable({
        error: {
          code: 'FEATURE_DISABLED',
          message: 'Skill Knowledge Authoring is not enabled',
        },
      })
    }

    const authResult = await this.policy.canViewDraft(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    await request.validateUsing(previewValidator)

    try {
      const skillId = Number(ctx.params.skillId)
      const result = await this.svc.previewDraft(tenant.organizationId, skillId, authUser.id)
      return response.ok({ data: result })
    } catch (err: any) {
      if (err.code === 'RESOURCE_NOT_FOUND') {
        return response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: err.message },
        })
      }
      throw err
    }
  }

  // ── POST commit ────────────────────────────────────────────────

  /** POST /api/v1/ai/compiler/skills/:skillId/knowledge/commit */
  async commit(ctx: HttpContext) {
    const { request, response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    if (!this.featureEnabled()) {
      return response.serviceUnavailable({
        error: {
          code: 'FEATURE_DISABLED',
          message: 'Skill Knowledge Authoring is not enabled',
        },
      })
    }

    const authResult = await this.policy.canReviewKnowledge(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    await request.validateUsing(commitValidator)

    try {
      const skillId = Number(ctx.params.skillId)
      const result = await this.svc.commitDraft(tenant.organizationId, skillId, authUser.id)
      return response.ok({ data: result })
    } catch (err: any) {
      if (err.code === 'DRAFT_NOT_FOUND') {
        return response.notFound({
          error: {
            code: 'DRAFT_NOT_FOUND',
            message: 'No pending draft found for this skill',
          },
        })
      }
      if (err.name === 'SkillNotInDraftStateError') {
        return response.conflict({
          error: {
            code: 'SKILL_KNOWLEDGE_COMMIT_INVALID_STATE',
            message: err.message,
          },
        })
      }
      if (err.code === 'RESOURCE_NOT_FOUND') {
        return response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: err.message },
        })
      }
      throw err
    }
  }

  // ── POST ai-assist ─────────────────────────────────────────────

  /** POST /api/v1/ai/compiler/skills/:skillId/knowledge/ai-assist */
  async aiAssist(ctx: HttpContext) {
    const { request, response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    if (!this.featureEnabled()) {
      return response.serviceUnavailable({
        error: {
          code: 'FEATURE_DISABLED',
          message: 'Skill Knowledge Authoring is not enabled',
        },
      })
    }

    const authResult = await this.policy.canAuthorDraft(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const payload = await request.validateUsing(aiAssistValidator)
    const skillId = Number(ctx.params.skillId)

    try {
      const result = await this.svc.aiAssist(
        tenant.organizationId,
        skillId,
        payload.hint,
        authUser.id,
      )
      return response.created({ data: result })
    } catch (err: any) {
      if (err.code === 'RESOURCE_NOT_FOUND') {
        return response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: err.message },
        })
      }
      if (err.code === 'DRAFT_ALREADY_PENDING') {
        return response.conflict({
          error: { code: 'DRAFT_ALREADY_PENDING', message: err.message },
        })
      }
      throw err
    }
  }
}
