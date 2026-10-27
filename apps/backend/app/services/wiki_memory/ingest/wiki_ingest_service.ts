/**
 * v3-llm-wiki-ingest-pipeline —— 编入编排（design D1/D5/D6）。
 *
 * trigger：校验项目空间、审阅权、单空间串行（僵死运行收尾）后创建 queued 运行；
 * execute：收集增量关键事件 → 路由目标页 → 预算预估 → 逐页调用模型 → 解析 → 逐条校验 → 确定性成文 →
 *          proposeRevision(author_kind=ai)（只产待审提议）→ 成功后游标前移 → 低敏审计。
 * 运行记录只存计数与低敏标识。
 */
import { createHash } from 'node:crypto'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import {
  WIKI_INGEST_MAX_PAGES,
  WIKI_SYSTEM_PAGE_TYPES,
  applyWikiClaimOps,
  isoWeekOf,
  parseWikiMarkdown,
  validateWikiIngestOp,
  wikiIngestPageSkeleton,
  wikiIngestSectionsFor,
  type WikiIngestRunDto,
  type WikiPageType,
} from '@aiproj/types'
import WikiIngestRun from '#models/wiki_ingest_run'
import WikiPage from '#models/wiki_page'
import WikiRevision from '#models/wiki_revision'
import type WikiSpace from '#models/wiki_space'
import AuditService, { AuditEvent } from '#services/audit_service'
import WikiAccessService, { type WikiActor } from '../wiki_access_service.js'
import WikiRevisionService from '../wiki_revision_service.js'
import {
  WikiConflictError,
  WikiError,
  WikiPermissionError,
  WikiValidationError,
} from '../errors.js'
import WikiIngestCollector, { type WikiIngestEvent } from './wiki_ingest_collector.js'
import WikiIngestModelProvider from './wiki_ingest_model_port.js'
import {
  WIKI_INGEST_SYSTEM_PROMPT,
  buildWikiIngestUserPrompt,
  estimateWikiIngestTokens,
  parseWikiIngestOutput,
} from './wiki_ingest_prompt.js'

export const WIKI_INGEST_OUTPUT_TOKENS = 1500
export const WIKI_INGEST_STALE_MINUTES = 30
export const WIKI_INGEST_BUDGET_ENV = 'WIKI_INGEST_DAILY_TOKEN_BUDGET'
const DEFAULT_DAILY_BUDGET = 200_000

/** 每组织每日编入 token 上限；0 表示不设上限（个人版使用者自带 Key）。 */
export function wikiIngestDailyBudget(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[WIKI_INGEST_BUDGET_ENV]
  if (raw === undefined || raw.trim() === '') return DEFAULT_DAILY_BUDGET
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_BUDGET
}

const ACTIVE_STATUSES = ['queued', 'running'] as const
const CURSOR_STATUSES = ['succeeded', 'no_events'] as const

interface PagePlan {
  page: WikiPage
  baseRevisionId: number | null
  baseSource: string
  events: WikiIngestEvent[]
  systemPrompt: string
  userPrompt: string
  allowedSections: readonly string[]
  existingKeys: Set<string>
  estimatedTokens: number
}

@inject()
export default class WikiIngestService {
  constructor(
    private readonly access: WikiAccessService,
    private readonly revisions: WikiRevisionService,
    private readonly collector: WikiIngestCollector,
    private readonly modelProvider: WikiIngestModelProvider,
    private readonly audit: AuditService,
  ) {}

  // ── 触发 ───────────────────────────────────────────────────────────────

  async trigger(
    actor: WikiActor | null,
    space: WikiSpace,
    triggerKind: 'manual' | 'command',
  ): Promise<WikiIngestRun> {
    if (space.scopeKind !== 'project') throw new WikiValidationError('只有项目维基支持 AI 编入')
    if (actor && !(await this.access.canReviewSpace(actor, space))) {
      throw new WikiPermissionError('只有本空间的审阅者可以触发 AI 编入')
    }
    await this.assertIdle(space)

    return WikiIngestRun.create({
      organizationId: space.organizationId,
      spaceId: space.id,
      runKind: 'ingest',
      triggerKind,
      status: 'queued',
      cursorFromAuditId: await this.cursorOf(space),
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
      triggeredBy: actor?.user.id ?? null,
      startedAt: null,
      finishedAt: null,
    })
  }

  /** 单空间串行：先把僵死的运行收尾为失败，仍有进行中的运行则 409（编入与流程解读共用）。 */
  async assertIdle(space: WikiSpace): Promise<void> {
    const staleBefore = DateTime.now().minus({ minutes: WIKI_INGEST_STALE_MINUTES })
    await WikiIngestRun.query()
      .where('organization_id', space.organizationId)
      .where('space_id', space.id)
      .whereIn('status', [...ACTIVE_STATUSES])
      .where('updated_at', '<', staleBefore.toSQL()!)
      .update({ status: 'failed', error_code: 'STALE_RUN', finished_at: DateTime.now().toSQL() })
    const active = await WikiIngestRun.query()
      .where('organization_id', space.organizationId)
      .where('space_id', space.id)
      .whereIn('status', [...ACTIVE_STATUSES])
      .first()
    if (active)
      throw new WikiConflictError('本空间已有编入在进行中，请稍后再试', 'WIKI_INGEST_BUSY')
  }

  private async cursorOf(space: WikiSpace): Promise<number> {
    const row = await db
      .from('wiki_ingest_runs')
      .where('organization_id', space.organizationId)
      .where('space_id', space.id)
      .whereIn('status', [...CURSOR_STATUSES])
      .max('cursor_to_audit_id as cursor')
      .first()
    return Number(row?.cursor ?? 0)
  }

  async usedTokensToday(organizationId: number, now = DateTime.now()): Promise<number> {
    const row = await db
      .from('wiki_ingest_runs')
      .where('organization_id', organizationId)
      .where('created_at', '>=', now.toUTC().startOf('day').toSQL()!)
      .sum('tokens_used as total')
      .first()
    return Number(row?.total ?? 0)
  }

  // ── 执行 ───────────────────────────────────────────────────────────────

  async execute(runId: number): Promise<WikiIngestRun> {
    const run = await WikiIngestRun.findOrFail(runId)
    const { default: WikiSpaceModel } = await import('#models/wiki_space')
    const space = await WikiSpaceModel.query()
      .where('organization_id', run.organizationId)
      .where('id', run.spaceId)
      .firstOrFail()
    run.status = 'running'
    run.startedAt = DateTime.now()
    await run.save()
    try {
      await this.executeInner(run, space)
    } catch (error) {
      run.status = 'failed'
      run.errorCode = error instanceof WikiError ? error.code : 'INTERNAL_ERROR'
    }
    run.finishedAt = DateTime.now()
    await run.save()
    await this.audit.log({
      event: AuditEvent.WIKI_INGEST_RUN,
      userId: run.triggeredBy,
      organizationId: run.organizationId,
      projectId: Number(space.scopeRefId),
      entityType: 'wiki_ingest_run',
      entityId: run.id,
      metadata: {
        status: run.status,
        eventsCount: run.eventsCount,
        pagesTouched: run.pagesTouched,
        proposalsCreated: run.proposalsCreated,
        opsRejected: run.opsRejected,
        tokensUsed: run.tokensUsed,
      },
    })
    return run
  }

  private async executeInner(run: WikiIngestRun, space: WikiSpace) {
    const projectId = Number(space.scopeRefId)
    const batch = await this.collector.collect({
      organizationId: space.organizationId,
      projectId,
      cursorAuditId: Number(run.cursorFromAuditId),
    })
    run.eventsCount = batch.events.length
    run.hasMore = batch.hasMore
    const cursorTo = batch.scannedToAuditId ?? Number(run.cursorFromAuditId)
    run.idempotencyKey = createHash('sha256')
      .update(`${space.id}:${run.cursorFromAuditId}:${cursorTo}`)
      .digest('hex')
    if (batch.events.length === 0) {
      run.status = 'no_events'
      run.cursorToAuditId = cursorTo
      return
    }
    const duplicate = await WikiIngestRun.query()
      .where('organization_id', space.organizationId)
      .where('space_id', space.id)
      .where('idempotency_key', run.idempotencyKey)
      .where('status', 'succeeded')
      .whereNot('id', run.id)
      .first()
    if (duplicate) {
      run.status = 'no_events'
      run.cursorToAuditId = cursorTo
      return
    }

    const plans = await this.plan(space, batch.events)
    const budget = wikiIngestDailyBudget()
    const estimate = plans.reduce((n, p) => n + p.estimatedTokens, 0)
    if (budget > 0 && (await this.usedTokensToday(space.organizationId)) + estimate > budget) {
      run.status = 'budget_exhausted'
      return
    }
    const port = await this.modelProvider.create({
      organizationId: space.organizationId,
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

    for (const plan of plans) {
      const response = await port.generate({
        systemPrompt: plan.systemPrompt,
        userPrompt: plan.userPrompt,
        maxOutputTokens: WIKI_INGEST_OUTPUT_TOKENS,
      })
      run.tokensUsed +=
        estimateWikiIngestTokens(plan.systemPrompt, plan.userPrompt) +
        (response.outputTokens ?? Math.ceil(response.rawText.length / 2))
      const output = parseWikiIngestOutput(response.rawText)
      if (!output) {
        run.pagesFailed += 1
        run.errorCode = 'MODEL_OUTPUT_INVALID'
        continue
      }
      run.opsRejected += output.overflow
      const evidenceByRef = new Map(plan.events.map((e) => [e.ref, e.text]))
      const accepted = output.ops.filter((op) => {
        const verdict = validateWikiIngestOp(op, {
          evidenceByRef,
          existingClaimKeys: plan.existingKeys,
          allowedSections: plan.allowedSections,
        })
        if (!verdict.ok) run.opsRejected += 1
        return verdict.ok
      })
      run.opsAccepted += accepted.length
      if (accepted.length === 0) continue
      try {
        const { source, applied } = applyWikiClaimOps(plan.baseSource, accepted)
        if (applied === 0) continue
        await this.revisions.proposeRevision({
          page: plan.page,
          space,
          body: source,
          authorKind: 'ai',
          authorUserId: null,
          baseRevisionId: plan.baseRevisionId,
          changeSummary:
            `AI 编入：${output.summary || `依据 ${plan.events.length} 条项目动态`}`.slice(0, 500),
        })
        run.pagesTouched += 1
        run.proposalsCreated += 1
      } catch {
        // 写入校验失败（如命中撤回墓碑、来源刚被删除）或成文失败：本页不产生提议，计数可观测
        run.pagesFailed += 1
      }
    }
    if (plans.length > 0 && run.proposalsCreated === 0 && run.pagesFailed === plans.length) {
      // 全部页面都失败：整次失败、游标不前移，下次重试
      run.status = 'failed'
      run.errorCode = run.errorCode ?? 'ALL_PAGES_FAILED'
      return
    }
    run.status = 'succeeded'
    run.cursorToAuditId = cursorTo
  }

  // ── 路由 ───────────────────────────────────────────────────────────────

  private async plan(space: WikiSpace, events: WikiIngestEvent[]): Promise<PagePlan[]> {
    const latest = events.reduce((d, e) => (e.when > d ? e.when : d), events[0]!.when)
    const { year, week } = isoWeekOf(new Date(`${latest}T00:00:00Z`))
    const targets: Array<{ page: WikiPage; events: WikiIngestEvent[] }> = [
      {
        page: await this.ensurePage(
          space,
          'project-brief',
          'project-brief',
          '项目简报',
          'AI 根据项目动态整理，审阅后生效',
        ),
        events,
      },
      {
        page: await this.ensurePage(
          space,
          `digest-${year}-w${String(week).padStart(2, '0')}`,
          'digest',
          `${year} 年第 ${week} 周摘要`,
          `第 ${week} 周项目动态摘要`,
        ),
        events,
      },
    ]
    const refs = events.map((e) => e.source)
    const cited = refs.length
      ? await db
          .from('wiki_claim_sources as s')
          .join('wiki_claims as c', 'c.id', 's.claim_id')
          .join('wiki_pages as p', 'p.id', 'c.page_id')
          .where('s.organization_id', space.organizationId)
          .where('p.space_id', space.id)
          .where('p.status', 'active')
          .where('p.sensitivity', 'normal')
          .where('c.status', 'active')
          .whereNotIn('p.page_type', [...WIKI_SYSTEM_PAGE_TYPES])
          .where((w) => {
            for (const r of refs)
              w.orWhere((x) => x.where('s.source_kind', r.kind).where('s.source_id', r.id))
          })
          .select('p.id as page_id', 's.source_kind', 's.source_id')
      : []
    const byPage = new Map<number, Set<string>>()
    for (const row of cited) {
      const id = Number(row.page_id)
      if (targets.some((t) => t.page.id === id)) continue
      if (!byPage.has(id)) byPage.set(id, new Set())
      byPage.get(id)!.add(`${row.source_kind}#${row.source_id}`)
    }
    for (const [pageId, keys] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
      if (targets.length >= WIKI_INGEST_MAX_PAGES) break
      const page = await WikiPage.query()
        .where('organization_id', space.organizationId)
        .where('id', pageId)
        .first()
      if (page) targets.push({ page, events: events.filter((e) => keys.has(e.ref)) })
    }

    const plans: PagePlan[] = []
    for (const t of targets) {
      const published = t.page.publishedRevisionId
        ? await WikiRevision.find(t.page.publishedRevisionId)
        : null
      const baseSource =
        published?.bodyMarkdown ??
        wikiIngestPageSkeleton(t.page.pageType, t.page.title, t.page.summaryLine)
      const parsed = parseWikiMarkdown(baseSource)
      if (!parsed.ok) continue
      const allowedSections = wikiIngestSectionsFor(t.page.pageType)
      const userPrompt = buildWikiIngestUserPrompt({
        doc: parsed.doc,
        pageType: t.page.pageType,
        events: t.events,
        allowedSections,
      })
      plans.push({
        page: t.page,
        baseRevisionId: t.page.publishedRevisionId,
        baseSource,
        events: t.events,
        systemPrompt: WIKI_INGEST_SYSTEM_PROMPT,
        userPrompt,
        allowedSections,
        existingKeys: new Set(parsed.doc.claims.filter((c) => !c.derived).map((c) => c.key)),
        estimatedTokens:
          estimateWikiIngestTokens(WIKI_INGEST_SYSTEM_PROMPT, userPrompt) +
          WIKI_INGEST_OUTPUT_TOKENS,
      })
    }
    return plans
  }

  private async ensurePage(
    space: WikiSpace,
    slug: string,
    pageType: WikiPageType,
    title: string,
    summary: string,
  ): Promise<WikiPage> {
    const existing = await WikiPage.query()
      .where('organization_id', space.organizationId)
      .where('space_id', space.id)
      .where('slug', slug)
      .first()
    if (existing) return existing
    return WikiPage.create({
      organizationId: space.organizationId,
      spaceId: space.id,
      slug,
      pageType,
      title,
      summaryLine: summary,
      status: 'active',
      ownerUserId: null,
      publishedRevisionId: null,
      sensitivity: 'normal',
      staleAfterDays: null,
      sharedWithProjectIds: null,
      lastPublishedAt: null,
      createdBy: null,
    })
  }

  // ── 读取 ───────────────────────────────────────────────────────────────

  async listRuns(actor: WikiActor, space: WikiSpace): Promise<WikiIngestRunDto[]> {
    if (!(await this.access.canReviewSpace(actor, space))) {
      throw new WikiPermissionError('只有本空间的审阅者可以查看编入记录')
    }
    const runs = await WikiIngestRun.query()
      .where('organization_id', actor.organizationId)
      .where('space_id', space.id)
      .orderBy('id', 'desc')
      .limit(50)
    return runs.map((r) => wikiIngestRunDto(r))
  }
}

export function wikiIngestRunDto(r: WikiIngestRun): WikiIngestRunDto {
  return {
    id: r.id,
    spaceId: r.spaceId,
    runKind: r.runKind ?? 'ingest',
    triggerKind: r.triggerKind,
    status: r.status,
    eventsCount: r.eventsCount,
    pagesTouched: r.pagesTouched,
    proposalsCreated: r.proposalsCreated,
    opsAccepted: r.opsAccepted,
    opsRejected: r.opsRejected,
    pagesFailed: r.pagesFailed,
    hasMore: Boolean(r.hasMore),
    tokensUsed: r.tokensUsed,
    modelName: r.modelName,
    errorCode: r.errorCode,
    createdAt: r.createdAt.toUTC().toISO()!,
    finishedAt: r.finishedAt ? r.finishedAt.toUTC().toISO() : null,
  }
}
