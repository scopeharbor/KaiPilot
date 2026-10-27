/**
 * v3-llm-wiki-eval-gate —— 维基评测（design D4）：问答集（旧检索 vs 维基上下文包）+ 计划回测 + 切换门禁。
 *
 * 只读、确定性、不调用模型：不创建空间 / 页面 / 修订，只写一条评测记录（汇总与每题哈希，不存原文）与低敏审计。
 */
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import {
  WIKI_EVAL_MAX_PROJECTS,
  computeWikiEvalBacktest,
  parseWikiReferenceClassBlock,
  scoreWikiEvalContext,
  summarizeWikiEvalQa,
  wikiDossierSlug,
  wikiEvalGate,
  wikiMedian,
  wikiPercentile,
  type ProjectType,
  type WikiEvalBacktestProject,
  type WikiEvalEstimate,
  type WikiEvalQaRow,
  type WikiEvalQuestion,
  type WikiEvalRunDto,
} from '@aiproj/types'
import WikiEvalRun, { type WikiEvalQuestionRecord } from '#models/wiki_eval_run'
import AuditService, { AuditEvent } from '#services/audit_service'
import KnowledgeService from '#services/knowledge/knowledge_service'
import {
  clampFactor,
  collectExecutionSamples,
  executionFactorFromSamples,
} from '#services/ai_draft/planning_memory'
import type { WikiActor } from '../wiki_access_service.js'
import { sha256 } from '../wiki_revision_service.js'
import WikiSettingsService from '../wiki_settings_service.js'
import WikiSpaceService from '../wiki_space_service.js'
import { WikiPermissionError } from '../errors.js'
import WikiContextPackBuilder from '../query/wiki_context_pack_builder.js'

const bytesOf = (text: string) => Buffer.byteLength(text, 'utf8')

/** 数据库日期值 → luxon（无效为 null）。 */
function toDate(value: unknown): DateTime | null {
  if (value === null || value === undefined) return null
  const d =
    value instanceof Date
      ? DateTime.fromJSDate(value)
      : DateTime.fromSQL(String(value)).isValid
        ? DateTime.fromSQL(String(value))
        : DateTime.fromISO(String(value))
  return d.isValid ? d : null
}

function p80RatioOf(samples: ReadonlyArray<{ plannedDays: number; actualDays: number }>) {
  const plannedMedian = wikiMedian(samples.map((s) => s.plannedDays))
  return plannedMedian > 0
    ? wikiPercentile(
        samples.map((s) => s.actualDays),
        0.8,
      ) / plannedMedian
    : null
}

@inject()
export default class WikiEvalService {
  constructor(
    private readonly settings: WikiSettingsService,
    private readonly spaces: WikiSpaceService,
    private readonly knowledge: KnowledgeService,
    private readonly pack: WikiContextPackBuilder,
    private readonly audit: AuditService,
  ) {}

  private async assertManager(actor: WikiActor) {
    await this.settings.assertEnabled(actor.organizationId)
    if (!(await this.settings.canManage(actor.user, actor.organizationId)))
      throw new WikiPermissionError('只有组织维基的管理者可以运行评测')
  }

  async run(actor: WikiActor, questions: readonly WikiEvalQuestion[]): Promise<WikiEvalRunDto> {
    await this.assertManager(actor)

    // ── 问答集 ──
    const rows: WikiEvalQaRow[] = []
    const items: WikiEvalQuestionRecord[] = []
    for (const q of questions) {
      const legacyText = await this.legacyContext(actor, q.question)
      const wikiText = await this.wikiContext(actor, q)
      const legacy = { ...scoreWikiEvalContext(legacyText, q), bytes: bytesOf(legacyText) }
      const wiki = { ...scoreWikiEvalContext(wikiText, q), bytes: bytesOf(wikiText) }
      rows.push({ legacy, wiki })
      items.push({
        hash: sha256(q.question),
        legacy: { hit: legacy.hit, leaked: legacy.leaked, recall: legacy.recall },
        wiki: { hit: wiki.hit, leaked: wiki.leaked, recall: wiki.recall },
      })
    }
    const qa = summarizeWikiEvalQa(rows)

    // ── 计划回测 ──
    const backtest = computeWikiEvalBacktest(await this.backtestProjects(actor.organizationId))
    const gate = wikiEvalGate(qa, backtest)

    const run = await WikiEvalRun.create({
      organizationId: actor.organizationId,
      triggeredBy: actor.user.id,
      evalKind: 'retrieval',
      status: gate.status,
      questionsCount: questions.length,
      qa: { ...qa, items },
      backtest,
      reasons: gate.reasons,
      tokensUsed: 0,
      modelName: null,
    })
    await this.audit.log({
      event: AuditEvent.WIKI_EVAL_RUN,
      userId: actor.user.id,
      organizationId: actor.organizationId,
      entityType: 'wiki_eval_run',
      entityId: run.id,
      metadata: {
        status: gate.status,
        questions: qa.questions,
        wikiCorrect: qa.wiki.correct,
        legacyCorrect: qa.legacy.correct,
        wikiLeaks: qa.wiki.leaks,
        backtestProjects: backtest.projects,
      },
    })
    return runDto(run)
  }

  async list(actor: WikiActor): Promise<WikiEvalRunDto[]> {
    await this.assertManager(actor)
    const rows = await WikiEvalRun.query()
      .where('organization_id', actor.organizationId)
      .orderBy('id', 'desc')
      .limit(10)
    return rows.map(runDto)
  }

  /** 旧检索：知识底座生产路径（L3 已排除）返回的低敏投影拼成文本。 */
  private async legacyContext(actor: WikiActor, question: string): Promise<string> {
    try {
      const result = await this.knowledge.query(actor.organizationId, {
        keyword: question,
        evalContext: false,
      })
      return result.data.map((k) => [k.title, k.domain, k.purpose].join(' ')).join('\n')
    } catch {
      return ''
    }
  }

  /** 维基：以运行者身份装配的上下文包（页标题 + 可见主张）拼成文本。 */
  private async wikiContext(actor: WikiActor, q: WikiEvalQuestion): Promise<string> {
    const pack = await this.pack.build(actor, {
      projectId: q.projectId ?? null,
      query: q.question,
    })
    return pack.pages
      .map((p) => [p.title, ...p.claims.map((c) => c.statement)].join('\n'))
      .join('\n')
  }

  private async backtestProjects(organizationId: number): Promise<WikiEvalBacktestProject[]> {
    const projects = await db
      .from('projects')
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .where('status', 'completed')
      .whereNotNull('start_date')
      .orderByRaw('coalesce(actual_end_date, updated_at) desc')
      .orderBy('id', 'desc')
      .limit(WIKI_EVAL_MAX_PROJECTS)
      .select('id', 'start_date')
    const orgSpaceId = await this.spaces.organizationSpaceId(organizationId)
    const out: WikiEvalBacktestProject[] = []
    for (const p of projects) {
      const start = toDate(p.start_date)
      if (!start) continue
      const projectType = await this.projectTypeOf(organizationId, Number(p.id))
      const tasks = await collectExecutionSamples(organizationId, null, { projectId: Number(p.id) })
      // 现场计算与草案生成时的旧规划记忆同口径：全组织样本（不按类型），只取启动前完成的
      const before = await collectExecutionSamples(organizationId, null, {
        completedBefore: start,
      })
      const legacyFactor = executionFactorFromSamples(before)
      out.push({
        tasks,
        legacy: {
          factor: legacyFactor?.factor ?? null,
          p80Ratio: legacyFactor ? p80RatioOf(before) : null,
        },
        wiki: orgSpaceId
          ? await this.wikiEstimateAt(organizationId, orgSpaceId, projectType, start)
          : { factor: null, p80Ratio: null },
      })
    }
    return out
  }

  /** 启动当天已发布的参照类页版本（项目类型页优先、回落全组织）。 */
  private async wikiEstimateAt(
    organizationId: number,
    orgSpaceId: number,
    projectType: ProjectType | null,
    at: DateTime,
  ): Promise<WikiEvalEstimate> {
    const slugs = [
      ...(projectType ? [wikiDossierSlug('reference-class', projectType)] : []),
      wikiDossierSlug('reference-class', 'all'),
    ]
    for (const slug of slugs) {
      const revision = await db
        .from('wiki_revisions as r')
        .join('wiki_pages as p', 'p.id', 'r.page_id')
        .where('p.organization_id', organizationId)
        .where('p.space_id', orgSpaceId)
        .where('p.slug', slug)
        .whereIn('r.status', ['published', 'superseded'])
        .whereNotNull('r.reviewed_at')
        .where('r.reviewed_at', '<=', at.endOf('day').toSQL()!)
        .orderBy('r.reviewed_at', 'desc')
        .orderBy('r.id', 'desc')
        .select('r.body_markdown')
        .first()
      const stats = revision ? parseWikiReferenceClassBlock(String(revision.body_markdown)) : null
      if (stats)
        return {
          factor: clampFactor(stats.bias),
          p80Ratio:
            stats.plannedMedianDays > 0 ? stats.actualP80Days / stats.plannedMedianDays : null,
        }
    }
    return { factor: null, p80Ratio: null }
  }

  private async projectTypeOf(
    organizationId: number,
    projectId: number,
  ): Promise<ProjectType | null> {
    const row = await db
      .from('ai_project_drafts')
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereNotNull('project_type')
      .orderBy('id', 'desc')
      .first()
    return (row?.project_type as ProjectType | undefined) ?? null
  }
}

export function runDto(run: WikiEvalRun): WikiEvalRunDto {
  return {
    id: run.id,
    kind: run.evalKind,
    status: run.status,
    reasons: run.reasons,
    qa: { questions: run.qa.questions, legacy: run.qa.legacy, wiki: run.qa.wiki },
    backtest: run.backtest,
    tokensUsed: run.tokensUsed,
    modelName: run.modelName,
    createdAt: run.createdAt.toUTC().toISO()!,
  }
}
