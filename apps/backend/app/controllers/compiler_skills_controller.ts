/**
 * v3-skill-registry-and-lifecycle + v3-initial-skill-software-development —— CompilerSkillsController（D5/D6/D7/D9）。
 *
 * HTTP 入口：列表/详情/创建/更新/删除/生命周期转移/匹配预览/副本创建。
 * 只处理请求解析、权限校验、响应格式化；业务逻辑下沉到 SkillRegistryService。
 *
 * Feature flag：COMPILER_SKILL_REGISTRY_ENABLED 默认关，关闭时端点返回 503。
 * 内置 Skill 不可编辑/删除/转移（isBuiltin 拦截，D7）。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import env from '#start/env'
import CompilerSkill from '#models/compiler_skill'
import CompilerSkillPolicy from '#policies/compiler_skill_policy'
import SkillRegistryService from '#services/compiler/skills/skill_registry_service'
import BuiltinSeedService from '#services/compiler/skills/builtin_seed_service'
import {
  validateCreateSkill,
  validateUpdateSkill,
  validateLifecycleTransition,
  validateSkillMatch,
} from '#validators/compiler_skill_validator'

@inject()
export default class CompilerSkillsController {
  constructor(
    private readonly policy: CompilerSkillPolicy,
    private readonly svc: SkillRegistryService,
    private readonly builtinSeed: BuiltinSeedService,
  ) {}

  // ── Feature flags ────────────────────────────────────────────

  private registryEnabled(): boolean {
    return env.get('COMPILER_SKILL_REGISTRY_ENABLED', false)
  }

  private builtinSeedEnabled(): boolean {
    // 读实时 process.env（同 builtin_seed_service 的 isEnabled；env.get 只是启动快照）
    const raw = process.env.COMPILER_SKILL_BUILTIN_SEED_ENABLED
    if (raw !== undefined) return raw === 'true'
    return env.get('COMPILER_SKILL_BUILTIN_SEED_ENABLED', false)
  }

  // ── 列表 ────────────────────────────────────────────────────

  /** GET /api/v1/ai/compiler/skills */
  async index(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    if (!this.registryEnabled()) {
      return response.serviceUnavailable({
        error: { code: 'FEATURE_DISABLED', message: 'Skill Registry is not enabled' },
      })
    }

    const authResult = await this.policy.canViewSkill(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const qs = ctx.request.qs()
    const result = await this.svc.listByOrg(tenant.organizationId, {
      search: qs.search,
      status: qs.status,
      sortBy: qs.sortBy,
      sortOrder: qs.sortOrder,
      page: qs.page ? Number(qs.page) : 1,
      perPage: qs.perPage ? Number(qs.perPage) : 20,
    })

    const data = result.data.map((s: any) => this.toDto(s))
    return response.ok({
      data,
      meta: { total: result.total, page: qs.page ?? 1, perPage: qs.perPage ?? 20 },
    })
  }

  // ── 详情 ────────────────────────────────────────────────────

  /** GET /api/v1/ai/compiler/skills/:id */
  async show(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    if (!this.registryEnabled()) {
      return response.serviceUnavailable({
        error: { code: 'FEATURE_DISABLED', message: 'Skill Registry is not enabled' },
      })
    }

    const authResult = await this.policy.canViewSkill(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: authResult.reason },
      })
    }

    const id = Number(ctx.params.id)
    try {
      const skill = await this.svc.getById(tenant.organizationId, id)
      return response.ok({ data: this.toDto(skill as any) })
    } catch (err: any) {
      if (err.name === 'SkillNotFoundError') {
        return response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Skill not found' },
        })
      }
      throw err
    }
  }

  // ── 创建 ────────────────────────────────────────────────────

  /** POST /api/v1/ai/compiler/skills */
  async store(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    if (!this.registryEnabled()) {
      return response.serviceUnavailable({
        error: { code: 'FEATURE_DISABLED', message: 'Skill Registry is not enabled' },
      })
    }

    const authResult = await this.policy.canAuthorSkill(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: authResult.reason },
      })
    }

    const body = validateCreateSkill(ctx)
    if (body === null) return

    const skill = await this.svc.create(tenant.organizationId, body, authUser.id)
    return response.created({ data: this.toDto(skill as any) })
  }

  // ── 更新 ────────────────────────────────────────────────────

  /** PATCH /api/v1/ai/compiler/skills/:id */
  async update(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    if (!this.registryEnabled()) {
      return response.serviceUnavailable({
        error: { code: 'FEATURE_DISABLED', message: 'Skill Registry is not enabled' },
      })
    }

    const authResult = await this.policy.canAuthorSkill(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: authResult.reason },
      })
    }

    const id = Number(ctx.params.id)

    // isBuiltin 拦截
    try {
      const model = await CompilerSkill.forOrganization(tenant.organizationId)
        .where('id', id)
        .first()
      if (!model) {
        return response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Skill not found' },
        })
      }
      this.builtinSeed.assertNotBuiltin(model)
    } catch (err: any) {
      if (err.name === 'BuiltinSkillPermissionError') {
        return response.forbidden({
          error: { code: 'PERMISSION_DENIED', message: err.message },
        })
      }
      throw err
    }

    const body = validateUpdateSkill(ctx)
    if (body === null) return

    try {
      const skill = await this.svc.update(tenant.organizationId, id, body, authUser.id)
      return response.ok({ data: this.toDto(skill as any) })
    } catch (err: any) {
      if (err.name === 'SkillNotFoundError') {
        return response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Skill not found' },
        })
      }
      if (err.name === 'SkillNotEditableError') {
        return response.badRequest({
          error: { code: 'VALIDATION_ERROR', message: err.message },
        })
      }
      throw err
    }
  }

  // ── 删除 ────────────────────────────────────────────────────

  /** DELETE /api/v1/ai/compiler/skills/:id */
  async destroy(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    if (!this.registryEnabled()) {
      return response.serviceUnavailable({
        error: { code: 'FEATURE_DISABLED', message: 'Skill Registry is not enabled' },
      })
    }

    const authResult = await this.policy.canAuthorSkill(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: authResult.reason },
      })
    }

    const id = Number(ctx.params.id)

    // isBuiltin 拦截
    try {
      const model = await CompilerSkill.forOrganization(tenant.organizationId)
        .where('id', id)
        .first()
      if (!model) {
        return response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Skill not found' },
        })
      }
      this.builtinSeed.assertNotBuiltin(model)
    } catch (err: any) {
      if (err.name === 'BuiltinSkillPermissionError') {
        return response.forbidden({
          error: { code: 'PERMISSION_DENIED', message: err.message },
        })
      }
      throw err
    }

    try {
      await this.svc.softDeleteDraft(tenant.organizationId, id, authUser.id)
      return response.noContent()
    } catch (err: any) {
      if (err.name === 'SkillNotFoundError') {
        return response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Skill not found' },
        })
      }
      if (err.name === 'SkillNotEditableError') {
        return response.badRequest({
          error: { code: 'VALIDATION_ERROR', message: err.message },
        })
      }
      throw err
    }
  }

  // ── 生命周期转移 ──────────────────────────────────────────

  /** POST /api/v1/ai/compiler/skills/:id/lifecycle */
  async lifecycle(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    if (!this.registryEnabled()) {
      return response.serviceUnavailable({
        error: { code: 'FEATURE_DISABLED', message: 'Skill Registry is not enabled' },
      })
    }

    const authResult = await this.policy.canManageSkill(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: authResult.reason },
      })
    }

    const id = Number(ctx.params.id)

    // isBuiltin 拦截
    try {
      const model = await CompilerSkill.forOrganization(tenant.organizationId)
        .where('id', id)
        .first()
      if (!model) {
        return response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Skill not found' },
        })
      }
      this.builtinSeed.assertNotBuiltin(model)
    } catch (err: any) {
      if (err.name === 'BuiltinSkillPermissionError') {
        return response.forbidden({
          error: { code: 'PERMISSION_DENIED', message: err.message },
        })
      }
      throw err
    }

    const body = validateLifecycleTransition(ctx)
    if (body === null) return

    try {
      const skill = await this.svc.transitionLifecycle(
        tenant.organizationId,
        id,
        body.status,
        authUser.id,
      )
      return response.ok({ data: this.toDto(skill as any) })
    } catch (err: any) {
      if (err.name === 'SkillNotFoundError') {
        return response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Skill not found' },
        })
      }
      if (err.name === 'SkillTransitionRejectedError') {
        return response.badRequest({
          error: { code: 'VALIDATION_ERROR', message: err.message },
        })
      }
      throw err
    }
  }

  // ── 匹配预览 ──────────────────────────────────────────────

  /** POST /api/v1/ai/compiler/skills/match */
  async match(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    if (!this.registryEnabled()) {
      return response.serviceUnavailable({
        error: { code: 'FEATURE_DISABLED', message: 'Skill Registry is not enabled' },
      })
    }

    const authResult = await this.policy.canViewSkill(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: authResult.reason },
      })
    }

    const body = validateSkillMatch(ctx)
    if (body === null) return

    const results = await this.svc.match(tenant.organizationId, body)
    return response.ok({ data: results })
  }

  // ── 副本创建 ──────────────────────────────────────────────

  /** POST /api/v1/ai/compiler/skills/:id/duplicate */
  async duplicate(ctx: HttpContext) {
    const { response, authUser, tenant, request } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    if (!this.registryEnabled()) {
      return response.serviceUnavailable({
        error: { code: 'FEATURE_DISABLED', message: 'Skill Registry is not enabled' },
      })
    }

    const authResult = await this.policy.canAuthorSkill(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: authResult.reason },
      })
    }

    const id = Number(ctx.params.id)
    const { newSkillKey } = request.only(['newSkillKey'])

    if (!newSkillKey || typeof newSkillKey !== 'string') {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'newSkillKey is required' },
      })
    }

    // 检查 skillKey 唯一性
    const existing = await CompilerSkill.forOrganizationByKey(tenant.organizationId, newSkillKey)
    if (existing) {
      return response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: `Skill key "${newSkillKey}" already exists in this organization`,
        },
      })
    }

    try {
      const source = await this.svc.getById(tenant.organizationId, id)
      const skill = await this.svc.create(
        tenant.organizationId,
        {
          skillKey: newSkillKey,
          name: `${source.name}（副本）`,
          version: '0.1.0',
          description: source.description,
          category: source.category as any,
          tags: source.tags,
          activation: source.activation as any,
          knowledge: source.knowledge as any,
          provenance: {
            sourceSkillKey: source.skillKey,
            sourceVersion: source.version,
            importedAt: new Date().toISOString(),
            importNote: '基于内置 Skill 创建的副本',
          },
          basePriority: source.basePriority,
        },
        authUser.id,
      )
      return response.created({ data: this.toDto(skill as any) })
    } catch (err: any) {
      if (err.name === 'SkillNotFoundError') {
        return response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Skill not found' },
        })
      }
      throw err
    }
  }

  // ── DTO 投影 ──────────────────────────────────────────────

  /**
   * Skill → DTO（后端局部扩展 isBuiltin，不改共享 Skill 契约）。
   */
  private toDto(skill: any): Record<string, unknown> {
    const dto: Record<string, unknown> = { ...skill }
    if (this.builtinSeedEnabled()) {
      dto.isBuiltin = skill.isBuiltin ?? false
    }
    return dto
  }
}
