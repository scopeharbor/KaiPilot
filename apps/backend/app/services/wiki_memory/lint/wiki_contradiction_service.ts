/**
 * v3-llm-wiki-lint-consolidation —— AI 矛盾体检（design D2）。
 *
 * trigger：组织已开启维基、空间可读且调用者是审阅者、单空间串行 → 创建 queued 运行（run_kind=contradiction_check）。
 * execute：证据 = 本空间已发布、非受限页面上有效的非派生主张（最多 150 条）→ 预算预估 → 模型 → 确定性校验 →
 *          写成体检发现 `contradiction`。**不调用 proposeRevision、不改任何页面**。与编入共用每日预算、模型端口与运行记录表。
 */
import { createHash } from 'node:crypto'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import {
  WIKI_CONTRADICTION_MAX_CLAIMS,
  WIKI_CONTRADICTION_STATEMENT_MAX_CHARS,
  parseWikiContradictionOutput,
  wikiContradictionDedupeKey,
  wikiContradictionRef,
} from '@aiproj/types'
import WikiClaim from '#models/wiki_claim'
import WikiIngestRun from '#models/wiki_ingest_run'
import WikiPage from '#models/wiki_page'
import WikiSpace from '#models/wiki_space'
import AuditService, { AuditEvent } from '#services/audit_service'
import WikiAccessService, { type WikiActor } from '../wiki_access_service.js'
import WikiLintService from '../wiki_lint_service.js'
import WikiSettingsService from '../wiki_settings_service.js'
import { WikiError, WikiNotFoundError, WikiPermissionError } from '../errors.js'
import WikiIngestService, {
  WIKI_INGEST_OUTPUT_TOKENS,
  wikiIngestDailyBudget,
} from '../ingest/wiki_ingest_service.js'
import WikiIngestModelProvider from '../ingest/wiki_ingest_model_port.js'
import { estimateWikiIngestTokens } from '../ingest/wiki_ingest_prompt.js'
import {
  WIKI_CONTRADICTION_PROMPT_NAME,
  WIKI_CONTRADICTION_SYSTEM_PROMPT,
  buildWikiContradictionUserPrompt,
} from './wiki_contradiction_prompt.js'

const clip = (text: string) =>
  Array.from(text).slice(0, WIKI_CONTRADICTION_STATEMENT_MAX_CHARS).join('')

@inject()
export default class WikiContradictionService {
  constructor(
    private readonly settings: WikiSettingsService,
    private readonly access: WikiAccessService,
    private readonly ingest: WikiIngestService,
    private readonly lint: WikiLintService,
    private readonly modelProvider: WikiIngestModelProvider,
    private readonly audit: AuditService,
  ) {}

  async trigger(actor: WikiActor, spaceId: number): Promise<WikiIngestRun> {
    await this.settings.assertEnabled(actor.organizationId)
    const space = await WikiSpace.query()
      .where('organization_id', actor.organizationId)
      .where('id', spaceId)
      .first()
    if (!space || !(await this.access.canReadSpace(actor, space))) throw new WikiNotFoundError()
    if (!(await this.access.canReviewSpace(actor, space)))
      throw new WikiPermissionError('只有本空间的审阅者可以运行 AI 矛盾体检')
    await this.ingest.assertIdle(space)

    return WikiIngestRun.create({
      organizationId: space.organizationId,
      spaceId: space.id,
      runKind: 'contradiction_check',
      triggerKind: 'manual',
      status: 'queued',
      cursorFromAuditId: 0,
      cursorToAuditId: null,
      eventsCount: 0,
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

  async execute(runId: number): Promise<WikiIngestRun> {
    const run = await WikiIngestRun.findOrFail(runId)
    run.status = 'running'
    run.startedAt = DateTime.now()
    await run.save()
    try {
      await this.executeInner(run)
    } catch (error) {
      run.status = 'failed'
      run.errorCode = error instanceof WikiError ? error.code : 'INTERNAL_ERROR'
    }
    run.finishedAt = DateTime.now()
    await run.save()
    await this.audit.log({
      event: AuditEvent.WIKI_CONTRADICTION_CHECKED,
      userId: run.triggeredBy,
      organizationId: run.organizationId,
      entityType: 'wiki_space',
      entityId: run.spaceId,
      metadata: {
        status: run.status,
        claimsChecked: run.eventsCount,
        contradictions: run.opsAccepted,
        rejected: run.opsRejected,
        tokensUsed: run.tokensUsed,
      },
    })
    return run
  }

  /** 送检主张：已发布、非受限、活动页面上有效的非派生主张；页面按最近发布倒序，主张按 id 升序。 */
  private async evidence(space: WikiSpace, now: DateTime) {
    const pages = await WikiPage.query()
      .where('organization_id', space.organizationId)
      .where('space_id', space.id)
      .where('status', 'active')
      .where('sensitivity', 'normal')
      .whereNotNull('published_revision_id')
      .orderBy('last_published_at', 'desc')
      .orderBy('id', 'asc')
    if (pages.length === 0) return { pages, claims: [] as WikiClaim[] }
    const order = new Map(pages.map((p, i) => [p.id, i]))
    const claims = await WikiClaim.query()
      .where('organization_id', space.organizationId)
      .whereIn(
        'page_id',
        pages.map((p) => p.id),
      )
      .where('status', 'active')
      .whereNull('invalid_reason')
      .whereNot('claim_kind', 'derived')
      .where((q) => q.whereNull('valid_to').orWhere('valid_to', '>', now.toSQL()!))
      .orderBy('id', 'asc')
    claims.sort((x, y) => order.get(x.pageId)! - order.get(y.pageId)! || x.id - y.id)
    return { pages, claims: claims.slice(0, WIKI_CONTRADICTION_MAX_CLAIMS) }
  }

  private async executeInner(run: WikiIngestRun) {
    const space = await WikiSpace.query()
      .where('organization_id', run.organizationId)
      .where('id', run.spaceId)
      .firstOrFail()
    const { pages, claims } = await this.evidence(space, DateTime.now())
    run.eventsCount = claims.length
    if (claims.length < 2) {
      run.status = 'no_events'
      return
    }
    const titleOf = new Map(pages.map((p) => [p.id, p.title]))
    const byRef = new Map(claims.map((c) => [wikiContradictionRef(c.id), c]))
    run.idempotencyKey = createHash('sha256')
      .update(`contradiction:${space.id}:${claims.map((c) => c.id).join(',')}:${run.id}`)
      .digest('hex')

    const systemPrompt = WIKI_CONTRADICTION_SYSTEM_PROMPT
    const userPrompt = buildWikiContradictionUserPrompt({
      claims: claims.map((c) => ({
        ref: wikiContradictionRef(c.id),
        page: titleOf.get(c.pageId) ?? '',
        statement: c.statement,
      })),
    })
    const inputTokens = estimateWikiIngestTokens(systemPrompt, userPrompt)
    const estimate = inputTokens + WIKI_INGEST_OUTPUT_TOKENS
    const budget = wikiIngestDailyBudget()
    if (budget > 0 && (await this.ingest.usedTokensToday(run.organizationId)) + estimate > budget) {
      run.status = 'budget_exhausted'
      return
    }
    const port = await this.modelProvider.create({
      organizationId: run.organizationId,
      projectId: null,
      userId: run.triggeredBy,
      idempotencyKey: run.idempotencyKey,
      estimatedTokens: estimate,
    })
    if (!port) {
      run.status = 'model_unavailable'
      return
    }
    run.modelProvider = port.provider
    run.modelName = port.model

    const response = await port.generate({
      systemPrompt,
      userPrompt,
      maxOutputTokens: WIKI_INGEST_OUTPUT_TOKENS,
      promptName: WIKI_CONTRADICTION_PROMPT_NAME,
    })
    run.tokensUsed +=
      inputTokens + (response.outputTokens ?? Math.ceil(response.rawText.length / 2))
    const output = parseWikiContradictionOutput(response.rawText, new Set(byRef.keys()))
    if (!output) {
      run.status = 'failed'
      run.errorCode = 'MODEL_OUTPUT_INVALID'
      return
    }
    run.opsRejected = output.rejected
    for (const conflict of output.conflicts) {
      const a = byRef.get(wikiContradictionRef(conflict.a))!
      const b = byRef.get(wikiContradictionRef(conflict.b))!
      await this.lint.recordContradiction(space, a.pageId, wikiContradictionDedupeKey(a.id, b.id), {
        claimA: a.id,
        claimB: b.id,
        pageA: a.pageId,
        pageB: b.pageId,
        statementA: clip(a.statement),
        statementB: clip(b.statement),
        reason: conflict.reason,
      })
    }
    run.opsAccepted = output.conflicts.length
    run.status = 'succeeded'
  }
}
