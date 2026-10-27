/**
 * v3-llm-wiki-rag-retirement —— 答案层评测（design D4，用户 2026-10-27 已明确授权）。
 *
 * 组织维基管理者先估算、确认费用后触发；后台以管理者身份逐题生成「无记忆」与「带维基记忆」两种回答，
 * 按 M8a 同一要点 / 禁止内容规则判定正确与泄露，写一条种类为 answer 的评测记录（只存汇总、每题哈希与布尔）。
 * 与编入共用每日预算、模型端口与运行记录（run_kind=answer_eval）；问题只在内存中传递，不落库；不改维基。
 */
import { createHash } from 'node:crypto'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import {
  WIKI_ANSWER_EVAL_OUTPUT_TOKENS,
  WIKI_ANSWER_EVAL_SYSTEM_PROMPT,
  buildWikiAnswerEvalUserPrompt,
  computeWikiEvalBacktest,
  scoreWikiEvalContext,
  summarizeWikiEvalQa,
  wikiAnswerEvalGate,
  wikiMemoryForModel,
  type WikiAnswerEvalEstimateDto,
  type WikiEvalQaRow,
  type WikiEvalQuestion,
  type WikiMemoryForModel,
} from '@aiproj/types'
import User from '#models/user'
import WikiEvalRun, { type WikiEvalQuestionRecord } from '#models/wiki_eval_run'
import WikiIngestRun from '#models/wiki_ingest_run'
import AuditService, { AuditEvent } from '#services/audit_service'
import MemberDirectoryService, {
  pseudonymizeText,
  resolveAliasesToNames,
  type DirectoryMember,
} from '#services/ai_colleague/member_directory_service'
import type { WikiActor } from '../wiki_access_service.js'
import { sha256 } from '../wiki_revision_service.js'
import WikiSettingsService from '../wiki_settings_service.js'
import WikiSpaceService from '../wiki_space_service.js'
import { WikiError, WikiPermissionError, WikiValidationError } from '../errors.js'
import WikiIngestService, { wikiIngestDailyBudget } from '../ingest/wiki_ingest_service.js'
import WikiIngestModelProvider from '../ingest/wiki_ingest_model_port.js'
import { estimateWikiIngestTokens } from '../ingest/wiki_ingest_prompt.js'
import WikiContextPackBuilder from '../query/wiki_context_pack_builder.js'

export const WIKI_ANSWER_EVAL_PROMPT_NAME = 'wiki.eval.answer'

const bytesOf = (text: string) => Buffer.byteLength(text, 'utf8')

interface PreparedQuestion {
  question: WikiEvalQuestion
  /** 交给模型的问题（姓名已换成代号）。 */
  prompt: string
  memory: WikiMemoryForModel[] | null
  inputTokens: { legacy: number; wiki: number }
}

@inject()
export default class WikiAnswerEvalService {
  constructor(
    private readonly settings: WikiSettingsService,
    private readonly spaces: WikiSpaceService,
    private readonly pack: WikiContextPackBuilder,
    private readonly ingest: WikiIngestService,
    private readonly modelProvider: WikiIngestModelProvider,
    private readonly audit: AuditService,
  ) {}

  private async assertManager(actor: WikiActor) {
    await this.settings.assertEnabled(actor.organizationId)
    if (!(await this.settings.canManage(actor.user, actor.organizationId)))
      throw new WikiPermissionError('只有组织维基的管理者可以运行评测')
  }

  /** 估算调用次数与 token（不调用模型、不建运行）。 */
  async estimate(
    actor: WikiActor,
    questions: readonly WikiEvalQuestion[],
  ): Promise<WikiAnswerEvalEstimateDto> {
    await this.assertManager(actor)
    const prepared = await this.prepare(actor, questions, await this.members(actor.organizationId))
    const estimatedTokens = totalEstimate(prepared)
    const usedTokensToday = await this.ingest.usedTokensToday(actor.organizationId)
    const dailyBudget = wikiIngestDailyBudget()
    return {
      questions: questions.length,
      calls: questions.length * 2,
      estimatedTokens,
      usedTokensToday,
      dailyBudget,
      exceedsBudget: dailyBudget > 0 && usedTokensToday + estimatedTokens > dailyBudget,
    }
  }

  /** 确认费用后建运行（queued）；未确认不建运行、不调用模型。 */
  async trigger(
    actor: WikiActor,
    questions: readonly WikiEvalQuestion[],
    confirmed: boolean,
  ): Promise<WikiIngestRun> {
    await this.assertManager(actor)
    if (!confirmed) throw new WikiValidationError('回答评测会调用 AI 并产生费用，请先估算并确认')
    const space = await this.spaces.resolve(actor, 'organization', actor.organizationId)
    await this.ingest.assertIdle(space)
    return WikiIngestRun.create({
      organizationId: actor.organizationId,
      spaceId: space.id,
      runKind: 'answer_eval',
      triggerKind: 'manual',
      status: 'queued',
      cursorFromAuditId: 0,
      cursorToAuditId: null,
      eventsCount: questions.length,
      pagesTouched: 0,
      proposalsCreated: 0,
      opsAccepted: 0,
      opsRejected: 0,
      pagesFailed: 0,
      hasMore: false,
      tokensUsed: 0,
      modelProvider: null,
      modelName: null,
      errorCode: null,
      idempotencyKey: null,
      triggeredBy: actor.user.id,
      startedAt: null,
      finishedAt: null,
    })
  }

  /** 后台执行；返回结束后的运行（评测记录只在成功时写入）。 */
  async execute(runId: number, questions: readonly WikiEvalQuestion[]): Promise<WikiIngestRun> {
    const run = await WikiIngestRun.findOrFail(runId)
    run.status = 'running'
    run.startedAt = DateTime.now()
    await run.save()
    let evalRun: WikiEvalRun | null = null
    try {
      evalRun = await this.executeInner(run, questions)
    } catch (error) {
      run.status = 'failed'
      run.errorCode = error instanceof WikiError ? error.code : 'INTERNAL_ERROR'
    }
    run.finishedAt = DateTime.now()
    await run.save()
    await this.audit.log({
      event: AuditEvent.WIKI_ANSWER_EVAL_RUN,
      userId: run.triggeredBy,
      organizationId: run.organizationId,
      entityType: 'wiki_eval_run',
      entityId: evalRun?.id ?? null,
      metadata: {
        status: run.status,
        gate: evalRun?.status ?? null,
        questions: questions.length,
        calls: run.opsAccepted,
        tokensUsed: run.tokensUsed,
      },
    })
    return run
  }

  /** 最近一次答案层评测运行（管理者）。 */
  async latest(actor: WikiActor): Promise<WikiIngestRun | null> {
    await this.assertManager(actor)
    return WikiIngestRun.query()
      .where('organization_id', actor.organizationId)
      .where('run_kind', 'answer_eval')
      .orderBy('id', 'desc')
      .first()
  }

  private async executeInner(
    run: WikiIngestRun,
    questions: readonly WikiEvalQuestion[],
  ): Promise<WikiEvalRun | null> {
    const user = run.triggeredBy ? await User.find(run.triggeredBy) : null
    if (!user) {
      run.status = 'failed'
      run.errorCode = 'ACTOR_MISSING'
      return null
    }
    const actor: WikiActor = { user, organizationId: run.organizationId }
    const members = await this.members(run.organizationId)
    const prepared = await this.prepare(actor, questions, members)
    const estimate = totalEstimate(prepared)
    const budget = wikiIngestDailyBudget()
    if (budget > 0 && (await this.ingest.usedTokensToday(run.organizationId)) + estimate > budget) {
      run.status = 'budget_exhausted'
      return null
    }
    run.idempotencyKey = createHash('sha256')
      .update(`answer_eval:${run.organizationId}:${run.id}`)
      .digest('hex')
    const port = await this.modelProvider.create({
      organizationId: run.organizationId,
      projectId: null,
      userId: user.id,
      idempotencyKey: run.idempotencyKey,
      // 限流预检按单次调用的上界估算（与编入同口径）；总量已在上面对每日预算检查过
      estimatedTokens:
        Math.max(0, ...prepared.map((p) => Math.max(p.inputTokens.legacy, p.inputTokens.wiki))) +
        WIKI_ANSWER_EVAL_OUTPUT_TOKENS,
    })
    if (!port) {
      run.status = 'model_unavailable'
      return null
    }
    run.modelProvider = port.provider
    run.modelName = port.model

    const namesByCode = new Map(members.map((m) => [m.aliasCode, m.name]))
    const answer = async (prompt: string, inputTokens: number) => {
      const response = await port.generate({
        systemPrompt: WIKI_ANSWER_EVAL_SYSTEM_PROMPT,
        userPrompt: prompt,
        maxOutputTokens: WIKI_ANSWER_EVAL_OUTPUT_TOKENS,
        promptName: WIKI_ANSWER_EVAL_PROMPT_NAME,
      })
      run.tokensUsed +=
        inputTokens + (response.outputTokens ?? Math.ceil(response.rawText.length / 2))
      run.opsAccepted++
      // 回答里的代号换回姓名再判定（要点与禁止内容按真实姓名书写）
      return resolveAliasesToNames(response.rawText, namesByCode)
    }

    const rows: WikiEvalQaRow[] = []
    const items: WikiEvalQuestionRecord[] = []
    for (const p of prepared) {
      const legacyText = await answer(
        buildWikiAnswerEvalUserPrompt(p.prompt, null),
        p.inputTokens.legacy,
      )
      const wikiText = await answer(
        buildWikiAnswerEvalUserPrompt(p.prompt, p.memory ?? []),
        p.inputTokens.wiki,
      )
      // 每题后保存：更新进度与时间（避免被判为卡住的运行）
      await run.save()
      const legacy = { ...scoreWikiEvalContext(legacyText, p.question), bytes: bytesOf(legacyText) }
      const wiki = { ...scoreWikiEvalContext(wikiText, p.question), bytes: bytesOf(wikiText) }
      rows.push({ legacy, wiki })
      items.push({
        hash: sha256(p.question.question),
        legacy: { hit: legacy.hit, leaked: legacy.leaked, recall: legacy.recall },
        wiki: { hit: wiki.hit, leaked: wiki.leaked, recall: wiki.recall },
      })
    }
    const qa = summarizeWikiEvalQa(rows)
    const gate = wikiAnswerEvalGate(qa)
    const evalRun = await WikiEvalRun.create({
      organizationId: run.organizationId,
      triggeredBy: user.id,
      evalKind: 'answer',
      status: gate.status,
      questionsCount: questions.length,
      qa: { ...qa, items },
      backtest: computeWikiEvalBacktest([]),
      reasons: gate.reasons,
      tokensUsed: run.tokensUsed,
      modelName: run.modelName,
    })
    run.status = 'succeeded'
    return evalRun
  }

  /** 以管理者身份逐题装配维基记忆，问题与记忆里的姓名换成代号，并估算两条提示的输入 token。 */
  private async prepare(
    actor: WikiActor,
    questions: readonly WikiEvalQuestion[],
    members: readonly DirectoryMember[],
  ): Promise<PreparedQuestion[]> {
    const rewrite = (text: string) => pseudonymizeText(text, members)
    const out: PreparedQuestion[] = []
    for (const question of questions) {
      const pack = await this.pack.build(actor, {
        projectId: question.projectId ?? null,
        query: question.question,
      })
      const memory = wikiMemoryForModel(pack, rewrite)
      const prompt = rewrite(question.question)
      out.push({
        question,
        prompt,
        memory: memory.length > 0 ? memory : null,
        inputTokens: {
          legacy: estimateWikiIngestTokens(
            WIKI_ANSWER_EVAL_SYSTEM_PROMPT,
            buildWikiAnswerEvalUserPrompt(prompt, null),
          ),
          wiki: estimateWikiIngestTokens(
            WIKI_ANSWER_EVAL_SYSTEM_PROMPT,
            buildWikiAnswerEvalUserPrompt(prompt, memory),
          ),
        },
      })
    }
    return out
  }

  /** 组织内在职成员（代号化用）：管理者评测时按全组织项目取。 */
  private async members(organizationId: number): Promise<DirectoryMember[]> {
    const rows = await db
      .from('projects')
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .select('id')
    const projectIds = rows.map((r) => Number(r.id))
    return new MemberDirectoryService().listMembers(organizationId, projectIds)
  }
}

function totalEstimate(prepared: readonly PreparedQuestion[]): number {
  return prepared.reduce(
    (n, p) => n + p.inputTokens.legacy + p.inputTokens.wiki + 2 * WIKI_ANSWER_EVAL_OUTPUT_TOKENS,
    0,
  )
}
