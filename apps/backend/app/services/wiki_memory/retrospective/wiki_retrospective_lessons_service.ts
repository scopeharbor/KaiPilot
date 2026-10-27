/**
 * v3-llm-wiki-retrospective-lessons —— 复盘页 AI 提炼教训（design D3）。
 *
 * trigger：组织已开启维基、页面为项目空间已发布的复盘页、调用者为该空间审阅者、单空间串行 → 创建 queued 运行（run_kind=retrospective_lessons）。
 * execute：证据 = 复盘派生段 + 本项目风险与变更请求的标题与状态 → 预算预估 → 模型 → 逐条校验（只许「教训」章节、来源在证据中、
 *          数字出自证据）→ 确定性成文 → proposeRevision(author_kind=ai)（只产待审提议，绝不发布）→ 低敏审计。
 */
import { createHash } from 'node:crypto'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import {
  WIKI_RETROSPECTIVE_GENERATOR,
  WIKI_RETROSPECTIVE_LESSONS_HEADING,
  WIKI_RETROSPECTIVE_SLUG,
  applyWikiClaimOps,
  parseWikiMarkdown,
  validateWikiIngestOp,
  wikiSectionOfLine,
} from '@aiproj/types'
import WikiIngestRun from '#models/wiki_ingest_run'
import WikiPage from '#models/wiki_page'
import WikiRevision from '#models/wiki_revision'
import WikiSpace from '#models/wiki_space'
import AuditService, { AuditEvent } from '#services/audit_service'
import WikiAccessService, { type WikiActor } from '../wiki_access_service.js'
import WikiRevisionService from '../wiki_revision_service.js'
import WikiSettingsService from '../wiki_settings_service.js'
import {
  WikiError,
  WikiNotFoundError,
  WikiPermissionError,
  WikiValidationError,
} from '../errors.js'
import WikiIngestService, {
  WIKI_INGEST_OUTPUT_TOKENS,
  wikiIngestDailyBudget,
} from '../ingest/wiki_ingest_service.js'
import WikiIngestModelProvider from '../ingest/wiki_ingest_model_port.js'
import { estimateWikiIngestTokens, parseWikiIngestOutput } from '../ingest/wiki_ingest_prompt.js'
import {
  WIKI_RETROSPECTIVE_LESSONS_PROMPT_NAME,
  WIKI_RETROSPECTIVE_LESSONS_SYSTEM_PROMPT,
  buildWikiRetrospectiveLessonsUserPrompt,
} from './wiki_retrospective_lessons_prompt.js'

/** 每类证据最多条数。 */
const EVIDENCE_LIMIT = 30
const clip = (text: string, max = 60) =>
  Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, max).join('')

@inject()
export default class WikiRetrospectiveLessonsService {
  constructor(
    private readonly settings: WikiSettingsService,
    private readonly access: WikiAccessService,
    private readonly revisions: WikiRevisionService,
    private readonly ingest: WikiIngestService,
    private readonly modelProvider: WikiIngestModelProvider,
    private readonly audit: AuditService,
  ) {}

  async trigger(actor: WikiActor, pageId: number): Promise<WikiIngestRun> {
    await this.settings.assertEnabled(actor.organizationId)
    const page = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .where('id', pageId)
      .first()
    if (!page) throw new WikiNotFoundError()
    const space = await WikiSpace.query()
      .where('organization_id', actor.organizationId)
      .where('id', page.spaceId)
      .first()
    if (!space || !(await this.access.canReadPage(actor, space, page)))
      throw new WikiNotFoundError()
    if (!(await this.access.canReviewSpace(actor, space)))
      throw new WikiPermissionError('只有本空间的审阅者可以请 AI 提炼教训')
    if (
      space.scopeKind !== 'project' ||
      page.slug !== WIKI_RETROSPECTIVE_SLUG ||
      page.status !== 'active' ||
      page.publishedRevisionId === null
    )
      throw new WikiValidationError('只有已发布的项目复盘页支持 AI 提炼教训')
    await this.ingest.assertIdle(space)

    return WikiIngestRun.create({
      organizationId: space.organizationId,
      spaceId: space.id,
      runKind: 'retrospective_lessons',
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

  async execute(runId: number, pageId: number): Promise<WikiIngestRun> {
    const run = await WikiIngestRun.findOrFail(runId)
    run.status = 'running'
    run.startedAt = DateTime.now()
    await run.save()
    try {
      await this.executeInner(run, pageId)
    } catch (error) {
      run.status = 'failed'
      run.errorCode = error instanceof WikiError ? error.code : 'INTERNAL_ERROR'
    }
    run.finishedAt = DateTime.now()
    await run.save()
    await this.audit.log({
      event: AuditEvent.WIKI_RETROSPECTIVE_LESSONS_DRAFTED,
      userId: run.triggeredBy,
      organizationId: run.organizationId,
      entityType: 'wiki_page',
      entityId: pageId,
      metadata: {
        status: run.status,
        proposalsCreated: run.proposalsCreated,
        opsAccepted: run.opsAccepted,
        opsRejected: run.opsRejected,
        tokensUsed: run.tokensUsed,
      },
    })
    return run
  }

  private async executeInner(run: WikiIngestRun, pageId: number) {
    const space = await WikiSpace.query()
      .where('organization_id', run.organizationId)
      .where('id', run.spaceId)
      .firstOrFail()
    const page = await WikiPage.query()
      .where('organization_id', run.organizationId)
      .where('space_id', space.id)
      .where('id', pageId)
      .where('status', 'active')
      .first()
    const revision = page?.publishedRevisionId
      ? await WikiRevision.find(page.publishedRevisionId)
      : null
    const parsed = revision ? parseWikiMarkdown(revision.bodyMarkdown) : null
    const block =
      parsed?.ok === true
        ? parsed.doc.derivedBlocks.find((b) => b.generatorId === WIKI_RETROSPECTIVE_GENERATOR)
        : undefined
    if (!page || !revision || !parsed?.ok || !block) {
      run.status = 'no_events'
      return
    }
    const projectId = Number(space.scopeRefId)
    const project = await db
      .from('projects')
      .where('organization_id', run.organizationId)
      .where('id', projectId)
      .first()

    const evidenceByRef = new Map<string, string>([
      [`derived_query#${WIKI_RETROSPECTIVE_GENERATOR}`, block.content],
    ])
    const risks = await db
      .from('risks')
      .where('organization_id', run.organizationId)
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .orderBy('id', 'asc')
      .limit(EVIDENCE_LIMIT)
      .select('id', 'title', 'status')
    for (const r of risks)
      evidenceByRef.set(`risk#${r.id}`, `风险「${clip(String(r.title ?? ''))}」，状态 ${r.status}`)
    const changes = await db
      .from('change_requests')
      .where('organization_id', run.organizationId)
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .whereNot('status', 'draft')
      .orderBy('id', 'asc')
      .limit(EVIDENCE_LIMIT)
      .select('id', 'title', 'status')
    for (const c of changes)
      evidenceByRef.set(
        `change_request#${c.id}`,
        `变更「${clip(String(c.title ?? ''))}」，状态 ${c.status}`,
      )

    const source = revision.bodyMarkdown
    const lessons = parsed.doc.claims.filter(
      (c) => !c.derived && wikiSectionOfLine(source, c.line) === WIKI_RETROSPECTIVE_LESSONS_HEADING,
    )
    run.eventsCount = evidenceByRef.size
    run.idempotencyKey = createHash('sha256')
      .update(`lessons:${page.id}:${revision.id}:${run.id}`)
      .digest('hex')

    const systemPrompt = WIKI_RETROSPECTIVE_LESSONS_SYSTEM_PROMPT
    const userPrompt = buildWikiRetrospectiveLessonsUserPrompt({
      project: String(project?.name ?? ''),
      facts: block.content,
      lessons: lessons.map((c) => ({ key: c.key, statement: c.statement })),
      evidence: [...evidenceByRef.entries()].map(([ref, text]) => ({ ref, text })),
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
      projectId,
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
      promptName: WIKI_RETROSPECTIVE_LESSONS_PROMPT_NAME,
    })
    run.tokensUsed +=
      inputTokens + (response.outputTokens ?? Math.ceil(response.rawText.length / 2))
    const output = parseWikiIngestOutput(response.rawText)
    if (!output) {
      run.status = 'failed'
      run.errorCode = 'MODEL_OUTPUT_INVALID'
      run.pagesFailed = 1
      return
    }
    run.opsRejected += output.overflow
    const existingClaimKeys = new Set(lessons.map((c) => c.key))
    const accepted = output.ops.filter((op) => {
      const verdict = validateWikiIngestOp(op, {
        evidenceByRef,
        existingClaimKeys,
        allowedSections: [WIKI_RETROSPECTIVE_LESSONS_HEADING],
      })
      if (!verdict.ok) run.opsRejected += 1
      return verdict.ok
    })
    run.opsAccepted = accepted.length
    run.status = 'succeeded'
    if (accepted.length === 0) return
    try {
      const { source: body, applied } = applyWikiClaimOps(source, accepted)
      if (applied === 0) return
      await this.revisions.proposeRevision({
        page,
        space,
        body,
        authorKind: 'ai',
        authorUserId: null,
        baseRevisionId: revision.id,
        changeSummary: `AI 提炼教训：${output.summary || '结项复盘'}`.slice(0, 500),
      })
      run.pagesTouched = 1
      run.proposalsCreated = 1
    } catch {
      // 写入校验失败（如命中撤回墓碑、来源刚被删除）：不产生提议，计数可观测
      run.pagesFailed = 1
      run.status = 'failed'
      run.errorCode = 'PROPOSAL_REJECTED'
    }
  }
}
