/**
 * v3-plugin-policy-bundles —— 组织策略包管理 API（任务 4.1）。
 *
 * 路由组：/api/v1/organizations/:organizationId/plugin-policy-bundles
 * - GET    /                列表（内置模板 + 组织副本 + 当前激活摘要）
 * - GET    /:bundleId       详情（版本历史 + 规则）
 * - POST   /copy            从模板复制并发起统一变更请求
 * - POST   /:bundleId/activation  enable/disable 变更请求
 * - GET    /changes/:requestUid/impact  变更影响摘要（有界、低敏）
 *
 * 权限：读=组织成员；写=owner/admin，且实际生效必须经统一变更流审批+确认；
 * 权限不足时动作端点直接对非成员隐藏语义（403/404 不泄露存在性差异）。
 */
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import PluginPolicyBundlePolicy from '#policies/plugin_policy_bundle_policy'
import PluginPolicyBundleService, {
  buildPolicyImpactSummary,
} from '#services/plugin_policy_bundle_service'
import PluginChangeRequestService from '#services/plugin_change_request_service'
import PluginPolicyBundle from '#models/plugin_policy_bundle'
import PluginPolicyBundleActivation from '#models/plugin_policy_bundle_activation'
import { BUILTIN_PLUGIN_POLICY_TEMPLATES } from '@aiproj/types'
import {
  validateCopyInput,
  validateActivationInput,
} from '#validators/plugin_policy_bundle_validator'

@inject()
export default class PluginPolicyBundlesController {
  constructor(
    private service: PluginPolicyBundleService,
    private changeFlow: PluginChangeRequestService,
    private policy: PluginPolicyBundlePolicy,
  ) {}

  /** GET / —— 模板 + 副本 + 激活状态 */
  async index(ctx: HttpContext) {
    const organizationId = Number(ctx.params.organizationId)
    if (!Number.isFinite(organizationId))
      return ctx.response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'invalid organizationId' },
      })
    if (!(await this.policy.canView(ctx.auth.user!, organizationId))) {
      return ctx.response.forbidden({ error: { code: 'PERMISSION_DENIED', message: 'forbidden' } })
    }
    const copies = await PluginPolicyBundle.query()
      .where('organization_id', organizationId)
      .orderBy('bundle_id')
      .orderBy('version', 'desc')
    const activation = await PluginPolicyBundleActivation.findForOrganization(organizationId)
    return ctx.response.ok({
      data: {
        templates: BUILTIN_PLUGIN_POLICY_TEMPLATES.map((t) => ({
          templateId: t.templateId,
          templateVersion: t.templateVersion,
          titleZh: t.titleZh,
          descriptionZh: t.descriptionZh,
        })),
        orgCopies: copies.map((c) => ({
          bundleId: c.bundleId,
          version: c.version,
          sourceTemplateId: c.sourceTemplateId,
          sourceTemplateVersion: c.sourceTemplateVersion,
          descriptionZh: c.descriptionZh,
          documentDigest: c.documentDigest,
          createdAt: c.createdAt.toISO(),
        })),
        activation: activation
          ? {
              bundleId: activation.bundleId,
              activeVersion: activation.activeVersion,
              status: activation.status,
              revision: activation.revision,
            }
          : null,
      },
      meta: { total: copies.length },
    })
  }

  /** GET /:bundleId —— 版本历史与规则 */
  async show(ctx: HttpContext) {
    const organizationId = Number(ctx.params.organizationId)
    const bundleId = String(ctx.params.bundleId ?? '')
    if (!(await this.policy.canView(ctx.auth.user!, organizationId))) {
      return ctx.response.forbidden({ error: { code: 'PERMISSION_DENIED', message: 'forbidden' } })
    }
    const rows = await PluginPolicyBundle.query()
      .where('organization_id', organizationId)
      .where('bundle_id', bundleId)
      .orderBy('version', 'desc')
    if (rows.length === 0) {
      return ctx.response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: 'policy bundle not found' },
      })
    }
    return ctx.response.ok({
      data: rows.map((c) => ({
        bundleId: c.bundleId,
        version: c.version,
        sourceTemplateId: c.sourceTemplateId,
        sourceTemplateVersion: c.sourceTemplateVersion,
        descriptionZh: c.descriptionZh,
        rules: c.rulesJson,
        documentDigest: c.documentDigest,
        createdAt: c.createdAt.toISO(),
      })),
      meta: { total: rows.length },
    })
  }

  /** POST /copy */
  async copy(ctx: HttpContext) {
    const organizationId = Number(ctx.params.organizationId)
    if (!(await this.policy.canManage(ctx, organizationId))) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '仅组织管理员可发起策略复制' },
      })
    }
    const v = await validateCopyInput(ctx.request.body() ?? {})
    if (!v.valid || !v.value) {
      return ctx.response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: v.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
          details: v.errors,
        },
      })
    }
    try {
      const res = await this.service.requestCopyFromTemplate({
        organizationId,
        templateId: v.value.templateId,
        requestedBy: `user:${ctx.auth.user!.id}`,
      })
      if (!res.ok) {
        const status =
          res.code === 'policy-template-expansion'
            ? 422
            : res.code === 'policy-copy-exists'
              ? 409
              : 400
        return ctx.response.status(status).json({ error: { code: res.code, message: res.message } })
      }
      return ctx.response.created({
        data: {
          requestUid: res.requestUid,
          bundleId: res.document.bundleId,
          digest: res.digest,
          summary: res.summary,
        },
      })
    } catch (e) {
      return ctx.response.internalServerError({
        error: { code: 'AI_SERVICE_ERROR', message: (e as Error).message },
      })
    }
  }

  /** POST /:bundleId/activation —— enable/disable 走统一变更流 */
  async changeActivation(ctx: HttpContext) {
    const organizationId = Number(ctx.params.organizationId)
    const bundleId = String(ctx.params.bundleId ?? '')
    if (!(await this.policy.canManage(ctx, organizationId))) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '仅组织管理员可变更策略激活' },
      })
    }
    const v = await validateActivationInput(ctx.request.body() ?? {})
    if (!v.valid || !v.value) {
      return ctx.response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: v.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
          details: v.errors,
        },
      })
    }
    try {
      const res = await this.service.requestActivationChange({
        organizationId,
        bundleId,
        version: v.value.version,
        action: v.value.action,
        requestedBy: `user:${ctx.auth.user!.id}`,
      })
      if (!res.ok) {
        const status = res.code === 'policy-version-not-found' ? 404 : 400
        return ctx.response.status(status).json({ error: { code: res.code, message: res.message } })
      }
      return ctx.response.accepted({ data: { requestUid: res.requestUid, summary: res.summary } })
    } catch (e) {
      return ctx.response.internalServerError({
        error: { code: 'AI_SERVICE_ERROR', message: (e as Error).message },
      })
    }
  }

  /** GET /changes/:requestUid/impact —— 有界影响摘要（从不可变 diff 推导） */
  async impact(ctx: HttpContext) {
    const organizationId = Number(ctx.params.organizationId)
    const requestUid = String(ctx.params.requestUid ?? '')
    if (!(await this.policy.canView(ctx.auth.user!, organizationId))) {
      return ctx.response.forbidden({ error: { code: 'PERMISSION_DENIED', message: 'forbidden' } })
    }
    const row = await this.changeFlow.getByUid(organizationId, requestUid)
    if (row.kind !== 'policy-bundle-change') {
      return ctx.response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: '非策略类变更请求' },
      })
    }
    const diff = row.diffJson as { kind: string; pluginId: string } & Record<string, unknown>
    const bundleId =
      String(diff.pluginId ?? '').replace(/^policy-bundle:/, '') || row.targetRevision.split(':')[0]
    // 动作语义：targetRevision 前缀 copy:v / enable:v / disable:v；默认按 copy 归类展示
    const prefix = row.targetRevision.split(':')[0]
    const action = (['enable', 'disable'].includes(prefix) ? prefix : 'copy') as
      'enable' | 'disable' | 'copy'
    const summary = buildPolicyImpactSummary(diff as never, action as never, bundleId)
    return ctx.response.ok({
      data: {
        summary,
        state: row.state,
        approvalRequired: row.approvalRequired,
        approvedBy: row.approvedBy,
        expiresAt: row.expiresAt.toISO(),
      },
    })
  }
}
