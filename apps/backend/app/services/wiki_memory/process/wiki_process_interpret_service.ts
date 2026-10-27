/**
 * v3-llm-wiki-process-reality —— 流程页 AI 解读差异（design D5）。
 *
 * trigger：组织已开启维基、页面为可读的流程实况页、调用者为该空间审阅者、单空间串行 → 创建 queued 运行（run_kind=process_interpret）。
 * execute：证据 = 派生段文本 + 声明段主张（按来源归档）→ 预算预估 → 模型 → 解析 → 逐条校验（只许「差异与解读」章节、
 *          来源在证据中、数字出自证据）→ 确定性成文 → proposeRevision(author_kind=ai)（只产待审提议，绝不发布）→ 低敏审计。
 * 与编入共用每日预算、模型端口与运行记录表。
 */
import { createHash } from 'node:crypto'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import {
  WIKI_PROCESS_DECLARED_HEADING,
  WIKI_PROCESS_GENERATORS,
  WIKI_PROCESS_INTERPRETATION_HEADING,
  applyWikiClaimOps,
  parseWikiMarkdown,
  validateWikiIngestOp,
  wikiProcessKindOfSlug,
  wikiSectionOfLine,
  type WikiParsedDocument,
} from '@aiproj/types'
import WikiIngestRun from '#models/wiki_ingest_run'
import WikiPage from '#models/wiki_page'
import WikiRevision from '#models/wiki_revision'
import WikiSpace from '#models/wiki_space'
import AuditService, { AuditEvent } from '#services/audit_service'
import WikiAccessService, { type WikiActor } from '../wiki_access_service.js'
import WikiRevisionService from '../wiki_revision_service.js'
import { sourceKey } from '../wiki_source_registry.js'
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
  WIKI_PROCESS_INTERPRET_PROMPT_NAME,
  WIKI_PROCESS_INTERPRET_SYSTEM_PROMPT,
  buildWikiProcessInterpretUserPrompt,
} from './wiki_process_interpret_prompt.js'

interface Target {
  space: WikiSpace
  page: WikiPage
  revision: WikiRevision
  doc: WikiParsedDocument
  generatorId: string
}

@inject()
export default class WikiProcessInterpretService {
  constructor(
    private readonly settings: WikiSettingsService,
    private readonly access: WikiAccessService,
    private readonly revisions: WikiRevisionService,
    private readonly ingest: WikiIngestService,
    private readonly modelProvider: WikiIngestModelProvider,
    private readonly audit: AuditService,
  ) {}

  // ── 触发 ───────────────────────────────────────────────────────────────

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
    if (!space || !(await this.access.canReadSpace(actor, space))) throw new WikiNotFoundError()
    if (!(await this.access.canReviewSpace(actor, space)))
      throw new WikiPermissionError('只有本空间的审阅者可以请 AI 解读流程')
    if (
      space.scopeKind !== 'organization' ||
      page.pageType !== 'process' ||
      page.status !== 'active' ||
      wikiProcessKindOfSlug(page.slug) === null ||
      page.publishedRevisionId === null
    )
      throw new WikiValidationError('只有已发布的流程实况页支持 AI 解读')
    await this.ingest.assertIdle(space)

    return WikiIngestRun.create({
      organizationId: space.organizationId,
      spaceId: space.id,
      runKind: 'process_interpret',
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

  // ── 执行 ───────────────────────────────────────────────────────────────

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
      event: AuditEvent.WIKI_PROCESS_INTERPRETED,
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

  private async target(run: WikiIngestRun, pageId: number): Promise<Target | null> {
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
    const kind = page ? wikiProcessKindOfSlug(page.slug) : null
    if (!page || !kind || page.publishedRevisionId === null) return null
    const revision = await WikiRevision.find(page.publishedRevisionId)
    if (!revision) return null
    const parsed = parseWikiMarkdown(revision.bodyMarkdown)
    if (!parsed.ok) return null
    return { space, page, revision, doc: parsed.doc, generatorId: WIKI_PROCESS_GENERATORS[kind] }
  }

  private async executeInner(run: WikiIngestRun, pageId: number) {
    const t = await this.target(run, pageId)
    const block = t?.doc.derivedBlocks.find((b) => b.generatorId === t.generatorId)
    if (!t || !block) {
      run.status = 'no_events'
      return
    }
    const source = t.revision.bodyMarkdown
    const sectionOf = (line: number) => wikiSectionOfLine(source, line)
    const authored = t.doc.claims.filter((c) => !c.derived)
    const declared = authored.filter((c) => sectionOf(c.line) === WIKI_PROCESS_DECLARED_HEADING)
    const interpretation = authored.filter(
      (c) => sectionOf(c.line) === WIKI_PROCESS_INTERPRETATION_HEADING,
    )

    // 证据：派生段（按生成器）+ 声明段主张（按其每个来源归档）
    const evidenceByRef = new Map<string, string>([
      [`derived_query#${t.generatorId}`, block.content],
    ])
    for (const claim of declared) {
      for (const s of claim.sources) {
        const ref = sourceKey(s)
        const prev = evidenceByRef.get(ref)
        evidenceByRef.set(ref, prev ? `${prev}\n${claim.statement}` : claim.statement)
      }
    }
    run.eventsCount = evidenceByRef.size
    run.idempotencyKey = createHash('sha256')
      .update(`interpret:${t.page.id}:${t.revision.id}:${run.id}`)
      .digest('hex')

    const userPrompt = buildWikiProcessInterpretUserPrompt({
      title: t.page.title,
      declared: declared.map((c) => ({ key: c.key, statement: c.statement })),
      actual: block.content,
      interpretation: interpretation.map((c) => ({ key: c.key, statement: c.statement })),
      evidence: [...evidenceByRef.entries()].map(([ref, text]) => ({ ref, text })),
    })
    const systemPrompt = WIKI_PROCESS_INTERPRET_SYSTEM_PROMPT
    const estimate = estimateWikiIngestTokens(systemPrompt, userPrompt) + WIKI_INGEST_OUTPUT_TOKENS
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
      promptName: WIKI_PROCESS_INTERPRET_PROMPT_NAME,
    })
    run.tokensUsed +=
      estimateWikiIngestTokens(systemPrompt, userPrompt) +
      (response.outputTokens ?? Math.ceil(response.rawText.length / 2))
    const output = parseWikiIngestOutput(response.rawText)
    if (!output) {
      run.status = 'failed'
      run.errorCode = 'MODEL_OUTPUT_INVALID'
      run.pagesFailed = 1
      return
    }
    run.opsRejected += output.overflow
    const existingClaimKeys = new Set(interpretation.map((c) => c.key))
    const accepted = output.ops.filter((op) => {
      const verdict = validateWikiIngestOp(op, {
        evidenceByRef,
        existingClaimKeys,
        allowedSections: [WIKI_PROCESS_INTERPRETATION_HEADING],
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
        page: t.page,
        space: t.space,
        body,
        authorKind: 'ai',
        authorUserId: null,
        baseRevisionId: t.revision.id,
        changeSummary: `AI 解读：${output.summary || '声明与实际的差异'}`.slice(0, 500),
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
