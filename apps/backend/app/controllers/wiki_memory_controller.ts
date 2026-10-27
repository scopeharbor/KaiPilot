/**
 * v3-llm-wiki-memory-foundation —— 记忆维基 HTTP 入口（/api/v1/wiki/*）。
 *
 * 只做请求解析、开关与身份前置、错误映射与响应格式化；业务全部在 #services/wiki_memory。
 * 列表返回 {data, meta}，错误返回 {error:{code,message,details?}}；不可读资源一律 404。
 * 维基内容不注入模型上下文：Copilot 只经只读维基工具与影子观测读取（v3-llm-wiki-query-navigation）。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import type { z } from 'zod'
import { parseWikiEvalQuestions } from '@aiproj/types'
import { WikiError, WikiNotFoundError } from '#services/wiki_memory/errors'
import type { WikiActor } from '#services/wiki_memory/wiki_access_service'
import WikiExportService from '#services/wiki_memory/wiki_export_service'
import WikiIngestService, {
  wikiIngestRunDto,
} from '#services/wiki_memory/ingest/wiki_ingest_service'
import WikiLintService from '#services/wiki_memory/wiki_lint_service'
import WikiContextShadowService from '#services/wiki_memory/query/wiki_context_shadow_service'
import WikiFileBackService from '#services/wiki_memory/query/wiki_file_back_service'
import WikiPlanningDossierService from '#services/wiki_memory/dossier/wiki_planning_dossier_service'
import WikiPersonalEstimateService from '#services/wiki_memory/person/wiki_personal_estimate_service'
import WikiPersonalMemoryImportService from '#services/wiki_memory/person/wiki_personal_memory_import_service'
import WikiProcessInterpretService from '#services/wiki_memory/process/wiki_process_interpret_service'
import WikiContradictionService from '#services/wiki_memory/lint/wiki_contradiction_service'
import WikiRetrospectiveService from '#services/wiki_memory/retrospective/wiki_retrospective_service'
import WikiRetrospectiveLessonsService from '#services/wiki_memory/retrospective/wiki_retrospective_lessons_service'
import WikiLessonService from '#services/wiki_memory/retrospective/wiki_lesson_service'
import WikiEvalService from '#services/wiki_memory/eval/wiki_eval_service'
import WikiAnswerEvalService from '#services/wiki_memory/eval/wiki_answer_eval_service'
import WikiMemoryMigrationService from '#services/wiki_memory/person/wiki_memory_migration_service'
import WikiProcessRealityService from '#services/wiki_memory/process/wiki_process_reality_service'
import WikiPersonalSpaceService from '#services/wiki_memory/wiki_personal_space_service'
import WikiReadService, { revisionDto } from '#services/wiki_memory/wiki_read_service'
import WikiRetractionService from '#services/wiki_memory/wiki_retraction_service'
import WikiRevisionService from '#services/wiki_memory/wiki_revision_service'
import WikiSettingsService from '#services/wiki_memory/wiki_settings_service'
import WikiSpaceService from '#services/wiki_memory/wiki_space_service'
import {
  wikiAsOfSchema,
  wikiCreatePageSchema,
  wikiCreateRevisionSchema,
  wikiFileBackSchema,
  wikiEvalRunSchema,
  wikiAnswerEvalRunSchema,
  wikiFindingStatusSchema,
  wikiLessonRecallSchema,
  wikiIdParam,
  wikiPagingSchema,
  wikiQueueSchema,
  wikiReasonSchema,
  wikiResolveSpaceSchema,
  wikiRollbackSchema,
  wikiSearchSchema,
  wikiSettingsSchema,
  wikiSharingSchema,
} from '#validators/wiki_memory_validator'

class RequestValidationError extends WikiError {
  constructor(issues: z.ZodIssue[]) {
    super('VALIDATION_ERROR', issues[0]?.message ?? '请求参数不合法', 400, {
      issues: issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
}

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input ?? {})
  if (!r.success) throw new RequestValidationError(r.error.issues)
  return r.data
}

@inject()
export default class WikiMemoryController {
  constructor(
    private readonly settings: WikiSettingsService,
    private readonly spaces: WikiSpaceService,
    private readonly reader: WikiReadService,
    private readonly revisions: WikiRevisionService,
    private readonly lint: WikiLintService,
    private readonly retractions: WikiRetractionService,
    private readonly personal: WikiPersonalSpaceService,
    private readonly exporter: WikiExportService,
    private readonly ingest: WikiIngestService,
    private readonly fileBackService: WikiFileBackService,
    private readonly shadow: WikiContextShadowService,
    private readonly dossier: WikiPlanningDossierService,
    private readonly processReality: WikiProcessRealityService,
    private readonly processInterpret: WikiProcessInterpretService,
    private readonly personalEstimate: WikiPersonalEstimateService,
    private readonly memoryImport: WikiPersonalMemoryImportService,
    private readonly contradictions: WikiContradictionService,
    private readonly retrospective: WikiRetrospectiveService,
    private readonly retrospectiveLessons: WikiRetrospectiveLessonsService,
    private readonly lessons: WikiLessonService,
    private readonly evaluation: WikiEvalService,
    private readonly answerEvaluation: WikiAnswerEvalService,
    private readonly memoryMigration: WikiMemoryMigrationService,
  ) {}

  /** 认证 + 组织上下文 + 开关 + 错误映射。 */
  private async run(
    ctx: HttpContext,
    fn: (actor: WikiActor) => Promise<unknown>,
    opts: { requireEnabled?: boolean } = {},
  ) {
    const { authUser, tenant, response } = ctx
    if (!authUser) {
      return response.unauthorized({ error: { code: 'AUTH_REQUIRED', message: '需要登录' } })
    }
    if (!tenant?.organizationId) {
      return response.forbidden({ error: { code: 'PERMISSION_DENIED', message: '缺少组织上下文' } })
    }
    const actor: WikiActor = { user: authUser, organizationId: Number(tenant.organizationId) }
    try {
      if (opts.requireEnabled !== false) await this.settings.assertEnabled(actor.organizationId)
      const result = await fn(actor)
      if (result === undefined) return
      return response.ok(result)
    } catch (error) {
      if (error instanceof WikiError) {
        return response.status(error.httpStatus).json({
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        })
      }
      throw error
    }
  }

  private idParam(ctx: HttpContext, name = 'id'): number {
    const r = wikiIdParam.safeParse(ctx.request.param(name))
    if (!r.success) throw new WikiNotFoundError()
    return r.data
  }

  // ── 开关 ───────────────────────────────────────────────────────────────

  async getSettings(ctx: HttpContext) {
    return this.run(
      ctx,
      async (actor) => ({
        data: {
          enabled: await this.settings.isEnabled(actor.organizationId),
          canManage: await this.settings.canManage(actor.user, actor.organizationId),
        },
      }),
      { requireEnabled: false },
    )
  }

  async updateSettings(ctx: HttpContext) {
    return this.run(
      ctx,
      async (actor) => {
        const { enabled } = parse(wikiSettingsSchema, ctx.request.body())
        await this.settings.setEnabled(actor.user, actor.organizationId, enabled)
        return { data: { enabled, canManage: true } }
      },
      { requireEnabled: false },
    )
  }

  // ── 空间 ───────────────────────────────────────────────────────────────

  async listSpaces(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const spaces = await this.spaces.listReadable(actor)
      const data = await Promise.all(spaces.map((s) => this.spaces.toDto(actor, s)))
      return { data, meta: { total: data.length, page: 1, perPage: data.length, totalPages: 1 } }
    })
  }

  async resolveSpace(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const input = parse(wikiResolveSpaceSchema, ctx.request.body())
      const refId =
        input.scopeRefId ??
        (input.scopeKind === 'organization'
          ? actor.organizationId
          : input.scopeKind === 'user'
            ? Number(actor.user.id)
            : undefined)
      if (refId === undefined) throw new WikiNotFoundError()
      const space = await this.spaces.resolve(actor, input.scopeKind, refId)
      return { data: await this.spaces.toDto(actor, space) }
    })
  }

  async listPages(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const { page, perPage } = parse(wikiPagingSchema, ctx.request.qs())
      return this.reader.listPages(actor, this.idParam(ctx), page, perPage)
    })
  }

  async createPage(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const input = parse(wikiCreatePageSchema, ctx.request.body())
      const space = await this.spaces.getReadable(actor, this.idParam(ctx))
      const result = await this.revisions.createPage(
        actor,
        space,
        input.slug,
        input.body,
        input.changeSummary,
      )
      ctx.response.created({
        data: {
          page: this.reader.summaryDto(result.page, !result.published),
          revision: revisionDto(result.revision),
          published: result.published,
        },
      })
    })
  }

  async search(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const { q } = parse(wikiSearchSchema, ctx.request.qs())
      const data = await this.reader.search(actor, this.idParam(ctx), q)
      return { data, meta: { total: data.length, page: 1, perPage: data.length, totalPages: 1 } }
    })
  }

  async listLog(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const { page, perPage } = parse(wikiPagingSchema, ctx.request.qs())
      return this.reader.listLog(actor, this.idParam(ctx), page, perPage)
    })
  }

  async listFindings(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const { status } = parse(wikiFindingStatusSchema, ctx.request.qs())
      const space = await this.spaces.getReadable(actor, this.idParam(ctx))
      await this.reader.assertReviewer(actor, space)
      const data = await this.lint.list(space, status)
      return { data, meta: { total: data.length, page: 1, perPage: data.length, totalPages: 1 } }
    })
  }

  async runLint(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const space = await this.spaces.getReadable(actor, this.idParam(ctx))
      await this.reader.assertReviewer(actor, space)
      return { data: await this.lint.run(space, actor) }
    })
  }

  /** POST /wiki/spaces/:id/contradiction-check —— 审阅者请 AI 检查矛盾（异步，只写体检发现、不改页面）。 */
  async checkContradictions(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const run = await this.contradictions.trigger(actor, this.idParam(ctx))
      setImmediate(() => {
        void this.contradictions.execute(run.id).catch(() => undefined)
      })
      ctx.response.accepted({ data: wikiIngestRunDto(run) })
    })
  }

  /** POST /wiki/projects/:id/retrospective/refresh —— 项目结项后生成或刷新复盘页（项目维基审阅者，确定性统计）。 */
  async refreshRetrospective(ctx: HttpContext) {
    return this.run(ctx, async (actor) => ({
      data: await this.retrospective.refresh(actor, this.idParam(ctx)),
    }))
  }

  /** POST /wiki/pages/:id/lessons —— 审阅者请 AI 从复盘页提炼教训（异步，只产出待审提议）。 */
  async draftLessons(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const pageId = this.idParam(ctx)
      const run = await this.retrospectiveLessons.trigger(actor, pageId)
      setImmediate(() => {
        void this.retrospectiveLessons.execute(run.id, pageId).catch(() => undefined)
      })
      ctx.response.accepted({ data: wikiIngestRunDto(run) })
    })
  }

  /** POST /wiki/claims/:id/promote —— 把复盘页教训晋升到组织教训库（组织空间待审提议）。 */
  async promoteLesson(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const data = await this.lessons.promote(actor, this.idParam(ctx))
      ctx.response.created({ data })
    })
  }

  /** GET /wiki/lessons/recall —— 按关键词与项目类型召回组织教训库里已发布、可见的教训（只读）。 */
  async recallLessons(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const { q, projectId } = parse(wikiLessonRecallSchema, ctx.request.qs())
      const data = await this.lessons.recall(actor, { q, projectId })
      return { data, meta: { total: data.length, page: 1, perPage: data.length, totalPages: 1 } }
    })
  }

  /** POST /wiki/eval/run —— 组织维基管理者运行评测（确定性、只读、不调用模型）。 */
  async runEval(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const { questions } = parse(wikiEvalRunSchema, ctx.request.body())
      const parsed = parseWikiEvalQuestions(questions)
      if (!parsed.ok)
        throw new RequestValidationError([
          { code: 'custom', path: ['questions'], message: parsed.reason } as z.ZodIssue,
        ])
      ctx.response.created({ data: await this.evaluation.run(actor, parsed.questions) })
    })
  }

  /** 解析问答集（与检索层评测同一规则）。 */
  private evalQuestions(ctx: HttpContext) {
    const { questions } = parse(wikiEvalRunSchema, ctx.request.body())
    const parsed = parseWikiEvalQuestions(questions)
    if (!parsed.ok)
      throw new RequestValidationError([
        { code: 'custom', path: ['questions'], message: parsed.reason } as z.ZodIssue,
      ])
    return parsed.questions
  }

  /** POST /wiki/eval/answer-estimate —— 回答评测的调用次数与 token 估算（不调用 AI）。 */
  async estimateAnswerEval(ctx: HttpContext) {
    return this.run(ctx, async (actor) => ({
      data: await this.answerEvaluation.estimate(actor, this.evalQuestions(ctx)),
    }))
  }

  /** POST /wiki/eval/answer-run —— 确认费用后开始回答评测（异步，会调用组织 AI 连接）。 */
  async runAnswerEval(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const questions = this.evalQuestions(ctx)
      const { confirmCost } = parse(wikiAnswerEvalRunSchema, ctx.request.body())
      const run = await this.answerEvaluation.trigger(actor, questions, confirmCost === true)
      setImmediate(() => {
        void this.answerEvaluation.execute(run.id, questions).catch(() => undefined)
      })
      ctx.response.accepted({ data: wikiIngestRunDto(run) })
    })
  }

  /** GET /wiki/eval/answer-runs/latest —— 最近一次回答评测的运行状态。 */
  async latestAnswerEval(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const run = await this.answerEvaluation.latest(actor)
      return { data: run ? wikiIngestRunDto(run) : null }
    })
  }

  /** POST /wiki/spaces/:id/import-copilot-memory —— 项目 / 组织 AI 同事记忆迁移为待审提议（本空间审阅者）。 */
  async migrateCopilotMemory(ctx: HttpContext) {
    return this.run(ctx, async (actor) => ({
      data: await this.memoryMigration.migrate(actor, this.idParam(ctx)),
    }))
  }

  /** GET /wiki/eval/runs —— 最近 10 次评测。 */
  async listEvalRuns(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const data = await this.evaluation.list(actor)
      return { data, meta: { total: data.length, page: 1, perPage: data.length, totalPages: 1 } }
    })
  }

  /** POST /wiki/lint-findings/:id/dismiss —— 审阅者忽略一条体检发现（不再重新打开）。 */
  async dismissFinding(ctx: HttpContext) {
    return this.run(ctx, async (actor) => ({
      data: await this.lint.dismiss(actor, this.idParam(ctx)),
    }))
  }

  async listRetractions(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const data = await this.retractions.list(actor, this.idParam(ctx))
      return { data, meta: { total: data.length, page: 1, perPage: data.length, totalPages: 1 } }
    })
  }

  async liftRetraction(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      await this.retractions.lift(actor, this.idParam(ctx, 'retractionId'))
      return { data: { lifted: true } }
    })
  }

  async exportSpace(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const { filename, zip } = await this.exporter.exportSpace(actor, this.idParam(ctx))
      ctx.response.header('content-type', 'application/zip')
      ctx.response.header('content-disposition', `attachment; filename="${filename}"`)
      ctx.response.send(zip)
    })
  }

  // ── 个人空间（v3-llm-wiki-person-space）────────────────────────────────

  /** POST /wiki/me/estimate-calibration/refresh —— 只作用于调用者本人。 */
  async refreshMyEstimate(ctx: HttpContext) {
    return this.run(ctx, async (actor) => ({ data: await this.personalEstimate.refresh(actor) }))
  }

  /** POST /wiki/me/import-memory —— 本人的用户级 AI 记忆 → 偏好页待审提议。 */
  async importMyMemory(ctx: HttpContext) {
    return this.run(ctx, async (actor) => ({
      data: await this.memoryImport.importFromCopilotMemory(actor),
    }))
  }

  /** GET /wiki/shared-with-me —— 成员授权给我（项目经理）的个人页。 */
  async sharedWithMe(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const data = await this.personal.sharedWithMe(actor)
      return { data, meta: { total: data.length, page: 1, perPage: data.length, totalPages: 1 } }
    })
  }

  async clearPersonalSpace(ctx: HttpContext) {
    return this.run(ctx, async (actor) => ({
      data: await this.personal.clear(actor, this.idParam(ctx)),
    }))
  }

  /** POST /wiki/spaces/:id/ingest —— 审阅者触发 AI 编入（异步执行，前端轮询运行记录）。 */
  async triggerIngest(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const space = await this.spaces.getReadable(actor, this.idParam(ctx))
      const run = await this.ingest.trigger(actor, space, 'manual')
      setImmediate(() => {
        void this.ingest.execute(run.id).catch(() => undefined)
      })
      ctx.response.accepted({ data: wikiIngestRunDto(run) })
    })
  }

  async listIngestRuns(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const space = await this.spaces.getReadable(actor, this.idParam(ctx))
      const data = await this.ingest.listRuns(actor, space)
      return { data, meta: { total: data.length, page: 1, perPage: data.length, totalPages: 1 } }
    })
  }

  // ── 查阅：归档回答与影子汇总（v3-llm-wiki-query-navigation）────────────

  async fileBack(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const input = parse(wikiFileBackSchema, ctx.request.body())
      const result = await this.fileBackService.fileBack(actor, input)
      ctx.response.created({ data: result })
    })
  }

  async shadowSummary(ctx: HttpContext) {
    return this.run(ctx, async (actor) => ({ data: await this.shadow.summary(actor) }))
  }

  /** 计划档案刷新（v3-llm-wiki-planning-dossier）：组织维基审阅者；只写确定性派生段，按簿记发布。 */
  async refreshDossier(ctx: HttpContext) {
    return this.run(ctx, async (actor) => ({ data: await this.dossier.refresh(actor) }))
  }

  /** 流程实况刷新（v3-llm-wiki-process-reality）：组织维基审阅者；只写确定性派生段，按簿记发布。 */
  async refreshProcess(ctx: HttpContext) {
    return this.run(ctx, async (actor) => ({ data: await this.processReality.refresh(actor) }))
  }

  /** POST /wiki/pages/:id/interpret —— 审阅者请 AI 解读流程差异（异步，只产出待审提议；前端轮询运行记录）。 */
  async interpretProcess(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const pageId = this.idParam(ctx)
      const run = await this.processInterpret.trigger(actor, pageId)
      setImmediate(() => {
        void this.processInterpret.execute(run.id, pageId).catch(() => undefined)
      })
      ctx.response.accepted({ data: wikiIngestRunDto(run) })
    })
  }

  // ── 页面与修订 ─────────────────────────────────────────────────────────

  async showPage(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const { asOf } = parse(wikiAsOfSchema, ctx.request.qs())
      const at = asOf ? DateTime.fromISO(asOf) : null
      return { data: await this.reader.getPageView(actor, this.idParam(ctx), at) }
    })
  }

  async listRevisions(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const { page, perPage } = parse(wikiPagingSchema, ctx.request.qs())
      return this.reader.listRevisions(actor, this.idParam(ctx), page, perPage)
    })
  }

  async createRevision(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const input = parse(wikiCreateRevisionSchema, ctx.request.body())
      const { page, space } = await this.reader.loadReadablePage(actor, this.idParam(ctx))
      const result = await this.revisions.submitHumanRevision(
        actor,
        space,
        page,
        input.body,
        input.baseRevisionId,
        input.changeSummary,
      )
      ctx.response.created({
        data: { revision: revisionDto(result.revision), published: result.published },
      })
    })
  }

  async rollback(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const { revisionId } = parse(wikiRollbackSchema, ctx.request.body())
      const revision = await this.revisions.rollback(actor, this.idParam(ctx), revisionId)
      return { data: revisionDto(revision) }
    })
  }

  async updateSharing(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const { projectIds } = parse(wikiSharingSchema, ctx.request.body())
      return {
        data: {
          projectIds: await this.personal.updateSharing(actor, this.idParam(ctx), projectIds),
        },
      }
    })
  }

  async showRevision(ctx: HttpContext) {
    return this.run(ctx, async (actor) => ({
      data: await this.reader.getRevisionDetail(actor, this.idParam(ctx)),
    }))
  }

  async publishRevision(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const revision = await this.revisions.publish(this.idParam(ctx), actor.organizationId, {
        kind: 'user',
        actor,
      })
      return { data: revisionDto(revision) }
    })
  }

  async rejectRevision(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const { reason } = parse(wikiReasonSchema, ctx.request.body())
      return { data: revisionDto(await this.revisions.reject(actor, this.idParam(ctx), reason)) }
    })
  }

  async reviewQueue(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const { spaceId } = parse(wikiQueueSchema, ctx.request.qs())
      const data = await this.reader.reviewQueue(actor, spaceId ?? null)
      return { data, meta: { total: data.length, page: 1, perPage: data.length, totalPages: 1 } }
    })
  }

  async retractClaim(ctx: HttpContext) {
    return this.run(ctx, async (actor) => {
      const { reason } = parse(wikiReasonSchema, ctx.request.body())
      const result = await this.retractions.retract(actor, this.idParam(ctx), reason)
      return {
        data: {
          retractionId: result.retraction.id,
          proposalId: result.proposalId,
          cascadedClaims: result.cascadedClaims,
          cascadedPages: result.cascadedPages,
        },
      }
    })
  }
}
