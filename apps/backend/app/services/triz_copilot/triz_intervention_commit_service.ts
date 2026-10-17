// v3-triz-contradiction-copilot 任务 2.4 —— 干预方案落库的两阶段确认服务。
//
// 职责（spec「人工确认落库（预览—确认两阶段）」+ RL-01 / RL-06）：
// - `preview`：把**某次分析记录的第 N 条 Top 3 方案**折算成目标业务实体（任务 / 风险 /
//   变更请求）的字段草案，产出差异预览 + 防篡改 SHA-256 `previewToken`；业务表零写入。
// - `commit`：在**单个数据库事务**内重算快照哈希并比对令牌 → 落库目标实体 → 写领域审计；
//   预览与确认之间源分析或绑定实体发生变更时抛 409 `SCHEDULE_STALE` 并整体回滚。
//
// 为什么令牌由快照哈希给出（与既有写试点 `GanttSchedulingService` 同一算法）：
// 令牌不是随机串而是「本次预览所依据的事实 + 将要写入的字段」的摘要，因此
// ① 任何字段被篡改都验不过；② 令牌天然一次性——落库后源分析记录 / 目标表事实改变，
// 同一令牌第二次确认必然失配（spec 第 2 条「写入成功后令牌立即失效」）。
//
// 分层边界：本服务只被 `app/services/ai_tools/handlers/create_*_from_intervention.ts` 调用，
// 不持有 HTTP 概念；权限门（`ai:trigger` / `ai:confirm` + 目标实体写权限）由既有
// `AiToolsPolicy` + `AiToolsExecutorService` 施加（不新造执行通道，spec 第 6 条）。
//
// 与领域服务的关系：落库字段口径与 `TaskService.create` / `RiskService.create` /
// `ChangeRequestService.createDraft` 保持一致（状态 / 优先级 / 评分 / 变更编号规则），
// 但写入必须与「快照比对」同处一个事务，故此处以 `{ client: trx }` 直接落库
// （既有写试点 `GanttSchedulingService.execute` 的 commit 分支是同一范式）；
// 风险等级不复制规则，改为注入 `RiskLevelService` 计算。
//
// 红线：RL-01（execute 阶段绝无落库路径，确认后才写）；RL-12（审计只留哈希 / 编号 / 枚举，
// 陈述原文与 prompt 从不进入本服务）；RL-05（组织 + 项目双隔离，跨组织统一 404）。

import { createHash } from 'node:crypto'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import {
  ConflictException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import ChangeRequest from '#models/change_request'
import Milestone from '#models/milestone'
import Risk from '#models/risk'
import Task from '#models/task'
import TrizCopilotAnalysis from '#models/triz_copilot_analysis'
import { stableStringify } from '#services/ai_tools/ai_tools_audit_helper'
import AuditService, { AuditEvent, type AuditEventType } from '#services/audit_service'
import RiskLevelService from '#services/risk_level_service'
import { TASK_PRIORITIES } from '#services/task_status_machine'
import TenantScope from '#services/tenant_scope'
import { normalizeStoredSolutions } from './triz_copilot_analysis_service.js'
import { toTrizParameterRef } from './triz_contradiction_mapping_service.js'
import {
  clampTrizSolutionText,
  toTrizSolutionPrincipleRef,
  type TrizSolutionPrincipleRef,
} from './triz_solution_draft_service.js'

// ---------------------------------------------------------------------------
// 常量（闭集与默认值）
// ---------------------------------------------------------------------------

/** 落库目标闭集：三类之外 MUST NOT 由本能力生成可执行动作（spec 第 4 条）。 */
export const TRIZ_INTERVENTION_TARGETS = ['task', 'risk', 'change_request'] as const
export type TrizInterventionTarget = (typeof TRIZ_INTERVENTION_TARGETS)[number]

/** 目标 → 编排层工具名（审计与预览令牌都绑定工具名）。 */
export const TRIZ_INTERVENTION_TOOL_NAMES: Readonly<Record<TrizInterventionTarget, string>> = {
  task: 'create_task_from_intervention',
  risk: 'create_risk_from_intervention',
  change_request: 'create_change_request_from_intervention',
}

/** 目标 → 领域审计事件（落库产物自身要留痕，与领域服务的 event 口径一致）。 */
const TARGET_AUDIT_EVENTS: Readonly<Record<TrizInterventionTarget, AuditEventType>> = {
  task: AuditEvent.TASK_CREATED,
  risk: AuditEvent.RISK_CREATED,
  change_request: AuditEvent.CHANGE_REQUEST_CREATED,
}

/** 目标 → 数据表（登记册水位与落库共用同一张表，杜绝两处口径漂移）。 */
const TARGET_TABLES: Readonly<Record<TrizInterventionTarget, string>> = {
  task: 'tasks',
  risk: 'risks',
  change_request: 'change_requests',
}

/** 来源标注取值：任何由本能力落库的产物都带它（可反查来源分析记录）。 */
export const TRIZ_INTERVENTION_SOURCE = 'triz_intervention'

/** 预览令牌形态（SHA-256 十六进制）；与编排层 `PREVIEW_TOKEN_PATTERN` 同一口径。 */
export const TRIZ_INTERVENTION_PREVIEW_TOKEN_PATTERN = /^[0-9a-f]{64}$/

/** 落库描述文本上限（有界摘要，RL-12：绝不落 PM 陈述原文或模型输出全文）。 */
export const TRIZ_INTERVENTION_DESCRIPTION_MAX_CHARS = 600
/** 落库标题上限（方案标题本身有界，此处再兜一层）。 */
export const TRIZ_INTERVENTION_TITLE_MAX_CHARS = 120

/** 任务默认值（与 `TaskService.create` 的默认口径一致）。 */
export const TRIZ_INTERVENTION_TASK_DEFAULTS = {
  status: 'not_started',
  priority: 'medium',
  taskType: 'task',
} as const

/** 风险默认值（与 `RiskService.create` 的默认口径一致；等级由 RiskLevelService 计算）。 */
export const TRIZ_INTERVENTION_RISK_DEFAULTS = {
  category: 'other',
  status: 'identified',
  priority: 'normal',
  probability: 3,
  impact: 3,
} as const

/** 变更请求默认值（与 `ChangeRequestService.createDraft` 的默认口径一致）。 */
export const TRIZ_INTERVENTION_CHANGE_REQUEST_DEFAULTS = {
  changeType: 'other',
  status: 'draft',
  priority: 'medium',
} as const

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// ---------------------------------------------------------------------------
// 契约
// ---------------------------------------------------------------------------

/** 来源可追溯字段（spec 第 5 条：分析记录 ID / 方案序号 / 原则编号 / 确认人 ID）。 */
export interface TrizInterventionProvenance {
  source: typeof TRIZ_INTERVENTION_SOURCE
  analysisId: number
  solutionIndex: number
  principleNumber: number
  knowledgePackVersion: string
  path: string
  confirmedByUserId: number
}

/** 绑定实体（方案动作要点引用的项目实体；同时是快照比对的对象）。 */
export interface TrizInterventionBoundLink {
  ref: string
  kind: string
  id: number
  label: string | null
}

export interface TrizInterventionTaskEntity {
  name: string
  description: string
  status: string
  priority: string
  taskType: string
  startDate: string | null
  endDate: string | null
  milestoneId: number | null
}

export interface TrizInterventionRiskEntity {
  title: string
  description: string
  category: string
  probability: number
  impact: number
  score: number
  status: string
  priority: string
  riskLevel: string
  relatedTaskId: number | null
}

export interface TrizInterventionChangeRequestEntity {
  crCode: string
  title: string
  description: string
  changeType: string
  status: string
  priority: string
}

interface TrizInterventionDraftBase {
  /** 一期只支持新建（删除 / 改基线 / 调预算一律不生成可执行动作，spec 第 4 条） */
  operation: 'create'
  provenance: TrizInterventionProvenance
  links: TrizInterventionBoundLink[]
  notes: string[]
}

export interface TrizInterventionTaskDraft extends TrizInterventionDraftBase {
  target: 'task'
  entity: TrizInterventionTaskEntity
}

export interface TrizInterventionRiskDraft extends TrizInterventionDraftBase {
  target: 'risk'
  entity: TrizInterventionRiskEntity
}

export interface TrizInterventionChangeRequestDraft extends TrizInterventionDraftBase {
  target: 'change_request'
  entity: TrizInterventionChangeRequestEntity
}

export type TrizInterventionDraft =
  TrizInterventionTaskDraft | TrizInterventionRiskDraft | TrizInterventionChangeRequestDraft

/** 预览所依据的事实摘要：源分析记录 + 绑定实体（任一变化都让令牌失配）。 */
export interface TrizInterventionStalenessSnapshot {
  analysis: {
    id: number
    updatedAt: string | null
    path: string
    confidence: number
    contradictionType: string
    improvingParameter: number | null
    worseningParameter: number | null
    candidatePrinciples: number[]
    topSolutionsDigest: string
    contextRefs: string[]
    humanOverride: boolean
    overrideAt: string | null
  }
  links: Array<{ ref: string; exists: boolean; updatedAt: string | null; label: string | null }>
  /**
   * 目标登记册水位：目标表在「组织 + 项目」范围内的当前行数。
   * 用途：确认落库后行数必然变化 ⇒ 同一令牌第二次确认必然失配（spec 第 2 条
   * 「写入成功后令牌立即失效」），且期间他人新增同类登记条目也能被察觉。
   */
  registry: { target: TrizInterventionTarget; table: string; count: number }
}

export interface TrizInterventionTaskOptions {
  startDate?: string | null
  endDate?: string | null
  priority?: string | null
}

export interface TrizInterventionPreviewRequest {
  organizationId: number
  projectId: number
  analysisId: number
  /** Top 3 内序号（1 起，对应分析记录 `top_solutions.solutions[].index`） */
  solutionIndex: number
  actorUserId: number
  /** 仅任务目标使用：起止日期与优先级（未给则取默认值） */
  taskOptions?: TrizInterventionTaskOptions
}

export interface TrizInterventionCommitRequest extends TrizInterventionPreviewRequest {
  previewToken: string
}

export interface TrizInterventionPreviewResult {
  status: 'PREVIEW_REQUIRED'
  previewToken: string
  diff: TrizInterventionDraft
}

export interface TrizInterventionCommitResult {
  target: TrizInterventionTarget
  committed: true
  entityId: number
  entity: TrizInterventionDraft['entity']
  provenance: TrizInterventionProvenance
}

export interface TrizInterventionCommitDeps {
  audit?: AuditService
  riskLevelService?: RiskLevelService
}

/** 方案记录条目（1.5 落库的低敏投影：序号 / 原则编号 / 有界标题 / 实体引用 / 排序分）。 */
interface SelectedSolution {
  index: number
  principleNumber: number
  title: string
  entityRefs: string[]
}

// ---------------------------------------------------------------------------
// 纯函数：令牌与文本
// ---------------------------------------------------------------------------

/**
 * 预览令牌 = SHA-256(稳定序列化(目标 + 范围 + 标识 + 字段草案 + 事实快照))。
 * 防篡改（改任一字段令牌即失配）且天然一次性（确认落库后事实改变）。
 */
export function computeTrizInterventionPreviewToken(args: {
  target: TrizInterventionTarget
  organizationId: number
  projectId: number
  analysisId: number
  solutionIndex: number
  draft: TrizInterventionDraft
  snapshot: TrizInterventionStalenessSnapshot
}): string {
  return createHash('sha256').update(stableStringify(args)).digest('hex')
}

/** 有界描述：折叠行内空白、保留换行、超限截断（RL-12 的有界摘要口径）。 */
export function boundInterventionDescription(value: string): string {
  const collapsed = value
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
  const characters = Array.from(collapsed)
  if (characters.length <= TRIZ_INTERVENTION_DESCRIPTION_MAX_CHARS) return collapsed
  return `${characters.slice(0, TRIZ_INTERVENTION_DESCRIPTION_MAX_CHARS - 1).join('')}…`
}

/** 落库描述文案（确定性：来源 / 原则释义 / 命中参数 / 关联实体 / 人工确认边界）。 */
export function buildInterventionDescription(args: {
  target: TrizInterventionTarget
  record: TrizCopilotAnalysis
  solution: SelectedSolution
  principle: TrizSolutionPrincipleRef
  links: TrizInterventionBoundLink[]
}): string {
  const { target, record, solution, principle, links } = args
  const improving =
    record.improvingParameter === null ? null : toTrizParameterRef(record.improvingParameter)
  const worsening =
    record.worseningParameter === null ? null : toTrizParameterRef(record.worseningParameter)
  const lines: string[] = [
    `由矛盾求解干预生成：分析记录 #${record.id} 第 ${solution.index} 条方案，来源原则 #${principle.number} ${principle.nameZh}（来源章节：${principle.source}）。`,
    `原则释义：${principle.pmInterpretation}`,
    `软件/管理实例：${principle.softwareExamples}`,
  ]
  if (improving && worsening) {
    lines.push(
      `命中参数：改善 #${improving.number} ${improving.nameZh} → 恶化 #${worsening.number} ${worsening.nameZh}。`,
    )
  }
  if (links.length > 0) {
    lines.push(
      `关联实体：${links
        .map((link) => `${link.ref}${link.label ? `（${link.label}）` : ''}`)
        .join('、')}。`,
    )
  }
  lines.push(
    `本条目经人工确认后落库（目标类型：${target}），AI 只建议不自动执行；如需调整请直接在业务视图修改。`,
  )
  return boundInterventionDescription(lines.join('\n'))
}

/** 上下文引用解析：`<kind>:<id>`（id 必须为正整数）。 */
export function parseContextRef(ref: string): { ref: string; kind: string; id: number } | null {
  const separator = ref.indexOf(':')
  if (separator <= 0) return null
  const kind = ref.slice(0, separator)
  const rawId = ref.slice(separator + 1)
  if (!/^\d+$/.test(rawId)) return null
  const id = Number.parseInt(rawId, 10)
  if (!Number.isInteger(id) || id <= 0) return null
  return { ref, kind, id }
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export default class TrizInterventionCommitService {
  readonly #deps: TrizInterventionCommitDeps

  constructor(deps: TrizInterventionCommitDeps = {}) {
    this.#deps = deps
  }

  /** 阶段一：产出差异预览 + previewToken；业务表零写入。 */
  async preview(
    target: TrizInterventionTarget,
    request: TrizInterventionPreviewRequest,
  ): Promise<TrizInterventionPreviewResult> {
    this.#assertTarget(target)
    const record = await this.#requireAnalysis(request)
    const solution = this.#selectSolution(record, request.solutionIndex)
    const riskLevel =
      target === 'risk'
        ? await this.#computeRiskLevel(
            request,
            TRIZ_INTERVENTION_RISK_DEFAULTS.probability,
            TRIZ_INTERVENTION_RISK_DEFAULTS.impact,
          )
        : null
    const { draft, snapshot } = await this.#prepare(target, request, record, solution, {
      riskLevel,
    })
    return {
      status: 'PREVIEW_REQUIRED',
      previewToken: this.#token(target, request, draft, snapshot),
      diff: draft,
    }
  }

  /**
   * 阶段二：单事务内比对快照 → 落库 → 领域审计。
   * 令牌失配（预览后事实被改 / 令牌被篡改 / 复用已消费令牌）→ 409 `SCHEDULE_STALE` 全量回滚。
   */
  async commit(
    target: TrizInterventionTarget,
    request: TrizInterventionCommitRequest,
  ): Promise<TrizInterventionCommitResult> {
    this.#assertTarget(target)
    if (!TRIZ_INTERVENTION_PREVIEW_TOKEN_PATTERN.test(request.previewToken ?? '')) {
      throw new ValidationException('previewToken 必须是 64 位十六进制 SHA-256 哈希')
    }

    // 风险等级来自项目配置读取（`RiskLevelService`）。必须在事务**之前**取值：
    // 事务已占用连接，事务内再走全局 `db` 会向连接池申请第二条连接 —— SQLite 单文件
    // 池下会直接超时（实测 KnexTimeoutError），且同事务内读自己未提交的快照也无意义。
    const riskLevel =
      target === 'risk'
        ? await this.#computeRiskLevel(
            request,
            TRIZ_INTERVENTION_RISK_DEFAULTS.probability,
            TRIZ_INTERVENTION_RISK_DEFAULTS.impact,
          )
        : null

    return db.transaction(async (trx) => {
      const record = await this.#requireAnalysis(request, trx)
      const solution = this.#selectSolution(record, request.solutionIndex)
      const { draft, snapshot } = await this.#prepare(
        target,
        request,
        record,
        solution,
        { riskLevel },
        trx,
      )
      if (this.#token(target, request, draft, snapshot) !== request.previewToken) {
        throw new ConflictException('干预预览已过期，请重新预览', { code: 'SCHEDULE_STALE' })
      }

      const entityId = await this.#insert(target, request, draft, trx)
      const audit = await this.#resolveAudit()
      if (audit) {
        await audit.log({
          event: TARGET_AUDIT_EVENTS[target],
          userId: request.actorUserId,
          organizationId: request.organizationId,
          projectId: request.projectId,
          entityType: draft.target,
          entityId,
          metadata: {
            source: TRIZ_INTERVENTION_SOURCE,
            analysisId: draft.provenance.analysisId,
            solutionIndex: draft.provenance.solutionIndex,
            principleNumber: draft.provenance.principleNumber,
            confirmedByUserId: draft.provenance.confirmedByUserId,
            // 低敏：只留编号 / 枚举 / 有界标题，不留 PM 陈述原文与 prompt（RL-12）。
            title: this.#titleOf(draft),
          },
          client: trx,
          strict: true,
        })
      }

      return {
        target,
        committed: true,
        entityId,
        entity: draft.entity,
        provenance: draft.provenance,
      }
    })
  }

  // ── 装配（读取 → 校验 → 字段草案 → 快照） ──────────────────────────

  async #prepare(
    target: TrizInterventionTarget,
    request: TrizInterventionPreviewRequest,
    record: TrizCopilotAnalysis,
    solution: SelectedSolution,
    precomputed: { riskLevel: string | null },
    client?: TransactionClientContract,
  ): Promise<{ draft: TrizInterventionDraft; snapshot: TrizInterventionStalenessSnapshot }> {
    const principle = toTrizSolutionPrincipleRef(solution.principleNumber)
    if (!principle) {
      throw new ValidationException(
        `方案来源原则 #${solution.principleNumber} 不在 TRIZ 知识包内，无法落库`,
      )
    }
    const links = await this.#buildLinks(record, solution, client)
    const provenance: TrizInterventionProvenance = {
      source: TRIZ_INTERVENTION_SOURCE,
      analysisId: Number(record.id),
      solutionIndex: solution.index,
      principleNumber: principle.number,
      knowledgePackVersion: String(record.knowledgePackVersion),
      path: String(record.path),
      confirmedByUserId: request.actorUserId,
    }
    const common = {
      operation: 'create' as const,
      provenance,
      links,
      notes: [
        'AI 只建议不自动执行：本预览未写入任何业务表，须显式确认后才落库（RL-01）。',
        ...(links.length === 0
          ? ['本方案未绑定白名单项目实体，落库产物不含实体关联（反幻觉降级，不编造实体）。']
          : []),
      ],
    }
    const snapshot = await this.#snapshot(target, request, record, links, client)

    if (target === 'task') {
      const milestone = links.find((link) => link.kind === 'milestone')
      return {
        draft: {
          ...common,
          target: 'task',
          entity: this.#buildTaskEntity(request, record, solution, principle, links, milestone),
        },
        snapshot,
      }
    }
    if (target === 'risk') {
      const relatedTask = links.find((link) => link.kind === 'task')
      return {
        draft: {
          ...common,
          target: 'risk',
          entity: this.#buildRiskEntity(
            record,
            solution,
            principle,
            links,
            relatedTask,
            precomputed.riskLevel ?? 'medium',
          ),
        },
        snapshot,
      }
    }
    return {
      draft: {
        ...common,
        target: 'change_request',
        entity: {
          crCode: await this.#nextCrCode(client),
          title: clampTrizSolutionText(solution.title, TRIZ_INTERVENTION_TITLE_MAX_CHARS).text,
          description: buildInterventionDescription({
            target,
            record,
            solution,
            principle,
            links,
          }),
          ...TRIZ_INTERVENTION_CHANGE_REQUEST_DEFAULTS,
        },
      },
      snapshot,
    }
  }

  #buildTaskEntity(
    request: TrizInterventionPreviewRequest,
    record: TrizCopilotAnalysis,
    solution: SelectedSolution,
    principle: TrizSolutionPrincipleRef,
    links: TrizInterventionBoundLink[],
    milestone: TrizInterventionBoundLink | undefined,
  ): TrizInterventionTaskEntity {
    const { startDate, endDate } = normalizeTaskDates(request.taskOptions)
    const priority = normalizeTaskPriority(request.taskOptions?.priority)
    return {
      name: clampTrizSolutionText(solution.title, TRIZ_INTERVENTION_TITLE_MAX_CHARS).text,
      description: buildInterventionDescription({
        target: 'task',
        record,
        solution,
        principle,
        links,
      }),
      status: TRIZ_INTERVENTION_TASK_DEFAULTS.status,
      priority,
      taskType: TRIZ_INTERVENTION_TASK_DEFAULTS.taskType,
      startDate,
      endDate,
      milestoneId: milestone?.id ?? null,
    }
  }

  #buildRiskEntity(
    record: TrizCopilotAnalysis,
    solution: SelectedSolution,
    principle: TrizSolutionPrincipleRef,
    links: TrizInterventionBoundLink[],
    relatedTask: TrizInterventionBoundLink | undefined,
    riskLevel: string,
  ): TrizInterventionRiskEntity {
    const { probability, impact } = TRIZ_INTERVENTION_RISK_DEFAULTS
    return {
      title: clampTrizSolutionText(solution.title, TRIZ_INTERVENTION_TITLE_MAX_CHARS).text,
      description: buildInterventionDescription({
        target: 'risk',
        record,
        solution,
        principle,
        links,
      }),
      category: TRIZ_INTERVENTION_RISK_DEFAULTS.category,
      probability,
      impact,
      // 与 `RiskService.create` 同一评分公式（同表同列口径，服务端计算）
      score: probability * impact,
      status: TRIZ_INTERVENTION_RISK_DEFAULTS.status,
      priority: TRIZ_INTERVENTION_RISK_DEFAULTS.priority,
      riskLevel,
      relatedTaskId: relatedTask?.id ?? null,
    }
  }

  async #computeRiskLevel(
    request: TrizInterventionPreviewRequest,
    probability: number,
    impact: number,
  ): Promise<string> {
    const service = await this.#resolveRiskLevel()
    if (!service) return 'medium'
    return service.computeInherent(request.organizationId, request.projectId, {
      probability,
      impact,
      residualProbability: null,
      residualImpact: null,
    })
  }

  /** 变更编号：与 `ChangeRequestService.createDraft` 同一规则（CR-YYYY-NNNN，表内 max+1）。 */
  async #nextCrCode(client?: TransactionClientContract): Promise<string> {
    const prefix = `CR-${new Date().getFullYear()}-`
    const runner = client ?? db
    const last = await runner
      .from('change_requests')
      .whereLike('cr_code', `${prefix}%`)
      .orderBy('cr_code', 'desc')
      .first()
    if (!last) return `${prefix}0001`
    const suffix = String(last.cr_code).slice(prefix.length)
    const parsed = Number.parseInt(suffix, 10)
    if (!Number.isFinite(parsed)) return `${prefix}0001`
    return `${prefix}${String(parsed + 1).padStart(4, '0')}`
  }

  // ── 快照与令牌 ─────────────────────────────────────────────────────

  /**
   * 事实快照：源分析记录的关键字段摘要 + 每个绑定实体的存在性与 `updated_at`。
   * 预览与确认之间任一变化 → 令牌失配 → 409（不静默覆盖他人改动）。
   */
  async #snapshot(
    target: TrizInterventionTarget,
    request: TrizInterventionPreviewRequest,
    record: TrizCopilotAnalysis,
    links: TrizInterventionBoundLink[],
    client?: TransactionClientContract,
  ): Promise<TrizInterventionStalenessSnapshot> {
    const facts: TrizInterventionStalenessSnapshot['links'] = []
    for (const link of links) {
      facts.push({
        ref: link.ref,
        exists: true,
        updatedAt: await this.#entityUpdatedAt(link, client),
        // 实体有界标签一并入快照：改名/改标题也算「预览后目标被改」（时间戳精度不参与判定）
        label: link.label,
      })
    }
    return {
      analysis: {
        id: Number(record.id),
        updatedAt: record.updatedAt ? record.updatedAt.toISO() : null,
        path: String(record.path),
        confidence: Number(record.confidence),
        contradictionType: String(record.contradictionType),
        improvingParameter:
          record.improvingParameter === null ? null : Number(record.improvingParameter),
        worseningParameter:
          record.worseningParameter === null ? null : Number(record.worseningParameter),
        candidatePrinciples: Array.isArray(record.candidatePrinciples)
          ? record.candidatePrinciples.map((value) => Number(value))
          : [],
        topSolutionsDigest: createHash('sha256')
          .update(stableStringify(record.topSolutions ?? []))
          .digest('hex'),
        contextRefs: Array.isArray(record.contextRefs) ? record.contextRefs.map(String) : [],
        humanOverride: Boolean(record.humanOverride),
        overrideAt: record.overrideAt ? record.overrideAt.toISO() : null,
      },
      links: facts,
      registry: {
        target,
        table: TARGET_TABLES[target],
        count: await this.#registryCount(target, request, client),
      },
    }
  }

  /** 目标登记册水位：目标表在「组织 + 项目」范围内的当前行数。 */
  async #registryCount(
    target: TrizInterventionTarget,
    request: TrizInterventionPreviewRequest,
    client?: TransactionClientContract,
  ): Promise<number> {
    const runner = client ?? db
    const query = runner.from(TARGET_TABLES[target]).where('project_id', request.projectId)
    if (target === 'task') query.whereNull('deleted_at')
    if (target !== 'task') query.where('organization_id', request.organizationId)
    const row = (await query.count('* as total').first()) as { total?: number | string } | null
    return Number(row?.total ?? 0)
  }

  /** 绑定实体的 `updated_at`（表内读不到该实体时返回 null ⇒ 只按存在性参与比对）。 */
  async #entityUpdatedAt(
    link: TrizInterventionBoundLink,
    client?: TransactionClientContract,
  ): Promise<string | null> {
    if (link.kind === 'task') {
      const row = await (client ? Task.query({ client }) : Task.query())
        .where('id', link.id)
        .whereNull('deleted_at')
        .first()
      return row?.updatedAt ? row.updatedAt.toISO() : null
    }
    if (link.kind === 'risk') {
      const row = await (client ? Risk.query({ client }) : Risk.query())
        .where('id', link.id)
        .first()
      return row?.updatedAt ? row.updatedAt.toISO() : null
    }
    if (link.kind === 'milestone') {
      const row = await (client ? Milestone.query({ client }) : Milestone.query())
        .where('id', link.id)
        .first()
      return row?.updatedAt ? row.updatedAt.toISO() : null
    }
    if (link.kind === 'change_request') {
      const row = await (client ? ChangeRequest.query({ client }) : ChangeRequest.query())
        .where('id', link.id)
        .first()
      return row?.updatedAt ? row.updatedAt.toISO() : null
    }
    return null
  }

  #token(
    target: TrizInterventionTarget,
    request: TrizInterventionPreviewRequest,
    draft: TrizInterventionDraft,
    snapshot: TrizInterventionStalenessSnapshot,
  ): string {
    return computeTrizInterventionPreviewToken({
      target,
      organizationId: request.organizationId,
      projectId: request.projectId,
      analysisId: request.analysisId,
      solutionIndex: request.solutionIndex,
      draft,
      snapshot,
    })
  }

  // ── 落库（事务内，`{ client: trx }`） ──────────────────────────────

  async #insert(
    target: TrizInterventionTarget,
    request: TrizInterventionPreviewRequest,
    draft: TrizInterventionDraft,
    trx: TransactionClientContract,
  ): Promise<number> {
    if (target === 'task' && draft.target === 'task') {
      const entity = draft.entity
      const maxRank = await trx
        .from('tasks')
        .where('project_id', request.projectId)
        .whereNull('deleted_at')
        .max('kanban_rank as maxRank')
        .first()
      const created = await Task.create(
        {
          projectId: request.projectId,
          name: entity.name,
          description: entity.description,
          status: entity.status,
          priority: entity.priority,
          taskType: entity.taskType,
          startDate: entity.startDate ? DateTime.fromISO(entity.startDate) : null,
          endDate: entity.endDate ? DateTime.fromISO(entity.endDate) : null,
          milestoneId: entity.milestoneId,
          aiMetadata: JSON.stringify(draft.provenance),
          kanbanRank: Number(maxRank?.maxRank ?? 0) + 1024,
        },
        { client: trx },
      )
      return Number(created.id)
    }

    if (target === 'risk' && draft.target === 'risk') {
      const entity = draft.entity
      const created = await Risk.create(
        {
          organizationId: request.organizationId,
          projectId: request.projectId,
          riskCode: null,
          title: entity.title,
          description: entity.description,
          category: entity.category,
          probability: entity.probability,
          impact: entity.impact,
          score: entity.score,
          status: entity.status,
          riskLevel: entity.riskLevel,
          priority: entity.priority,
          identifiedAt: DateTime.now(),
          relatedTaskId: entity.relatedTaskId,
          ownerId: null,
          createdBy: request.actorUserId,
          updatedBy: request.actorUserId,
          aiMetadata: JSON.stringify(draft.provenance),
        },
        { client: trx },
      )
      return Number(created.id)
    }

    if (target === 'change_request' && draft.target === 'change_request') {
      const entity = draft.entity
      const created = await ChangeRequest.create(
        {
          crCode: entity.crCode,
          organizationId: request.organizationId,
          projectId: request.projectId,
          requesterId: request.actorUserId,
          requestedBy: request.actorUserId,
          title: entity.title,
          description: entity.description,
          changeType: entity.changeType,
          status: entity.status,
          priority: entity.priority,
          aiMetadata: { ...draft.provenance },
        },
        { client: trx },
      )
      return Number(created.id)
    }

    throw new ValidationException(`不支持的干预落库目标：${target}`)
  }

  // ── 读取与校验 ─────────────────────────────────────────────────────

  async #requireAnalysis(
    request: TrizInterventionPreviewRequest,
    client?: TransactionClientContract,
  ): Promise<TrizCopilotAnalysis> {
    const query = TenantScope.forOrganization(
      client ? TrizCopilotAnalysis.query({ client }) : TrizCopilotAnalysis.query(),
      request.organizationId,
    )
      .where('project_id', request.projectId)
      .where('id', request.analysisId)
      .whereNull('deleted_at')
    const record = await query.first()
    if (!record) {
      // 跨组织 / 不存在 / 已软删统一同一响应（RL-05：不泄露存在性）
      throw new ResourceNotFoundException('分析记录不存在')
    }
    return record
  }

  #selectSolution(record: TrizCopilotAnalysis, solutionIndex: number): SelectedSolution {
    const stored = normalizeStoredSolutions(record.topSolutions)
    const selected = stored.solutions.find((entry) => Number(entry.index) === solutionIndex)
    if (!selected) {
      const available = stored.solutions.map((entry) => entry.index).join('、')
      throw new ValidationException(
        `分析记录中不存在第 ${solutionIndex} 条方案（可选：${available || '无'}）`,
      )
    }
    if (!selected.principleNumber) {
      throw new ValidationException(`第 ${solutionIndex} 条方案缺少来源原则编号，无法落库`)
    }
    return {
      index: Number(selected.index),
      principleNumber: Number(selected.principleNumber),
      title: String(selected.title ?? ''),
      entityRefs: Array.isArray(selected.entityRefs) ? selected.entityRefs.map(String) : [],
    }
  }

  /**
   * 绑定实体：只接受**同时**出现在方案引用与分析记录 `context_refs` 内的引用
   * （反幻觉白名单不为落库放宽；被丢弃的引用只计数量，不进入任何落库字段）。
   */
  async #buildLinks(
    record: TrizCopilotAnalysis,
    solution: SelectedSolution,
    client?: TransactionClientContract,
  ): Promise<TrizInterventionBoundLink[]> {
    const whitelist = Array.isArray(record.contextRefs) ? record.contextRefs.map(String) : []
    const links: TrizInterventionBoundLink[] = []
    for (const ref of solution.entityRefs) {
      if (!whitelist.includes(ref)) continue
      const parsed = parseContextRef(ref)
      if (!parsed) continue
      links.push({ ...parsed, label: await this.#entityLabel(parsed.kind, parsed.id, client) })
    }
    return links
  }

  async #entityLabel(
    kind: string,
    id: number,
    client?: TransactionClientContract,
  ): Promise<string | null> {
    if (kind === 'task') {
      const row = await (client ? Task.query({ client }) : Task.query())
        .where('id', id)
        .whereNull('deleted_at')
        .first()
      return row ? boundLabel(row.name) : null
    }
    if (kind === 'risk') {
      const row = await (client ? Risk.query({ client }) : Risk.query()).where('id', id).first()
      return row ? boundLabel(row.title) : null
    }
    if (kind === 'milestone') {
      const row = await (client ? Milestone.query({ client }) : Milestone.query())
        .where('id', id)
        .first()
      return row ? boundLabel(row.name) : null
    }
    return null
  }

  async #resolveAudit(): Promise<AuditService | null> {
    if (this.#deps.audit) return this.#deps.audit
    try {
      return await app.container.make(AuditService)
    } catch {
      return null
    }
  }

  async #resolveRiskLevel(): Promise<RiskLevelService | null> {
    if (this.#deps.riskLevelService) return this.#deps.riskLevelService
    try {
      return await app.container.make(RiskLevelService)
    } catch {
      return null
    }
  }

  #assertTarget(target: TrizInterventionTarget): void {
    if (!(TRIZ_INTERVENTION_TARGETS as readonly string[]).includes(target)) {
      throw new ValidationException(`不支持的干预落库目标：${target}`)
    }
  }

  #titleOf(draft: TrizInterventionDraft): string {
    return draft.target === 'task' ? draft.entity.name : draft.entity.title
  }
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function boundLabel(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (text.length === 0) return null
  return Array.from(text).slice(0, 40).join('')
}

function normalizeTaskDates(options?: TrizInterventionTaskOptions): {
  startDate: string | null
  endDate: string | null
} {
  const startDate = normalizeDate(options?.startDate, 'startDate')
  const endDate = normalizeDate(options?.endDate, 'endDate')
  if ((startDate && !endDate) || (!startDate && endDate)) {
    throw new ValidationException('任务起止日期必须成对提供（startDate 与 endDate）')
  }
  if (startDate && endDate && startDate > endDate) {
    throw new ValidationException('任务开始日期不得晚于结束日期')
  }
  return { startDate, endDate }
}

function normalizeDate(value: unknown, name: string): string | null {
  if (value === null || value === undefined || value === '') return null
  const text = String(value).trim()
  if (!DATE_PATTERN.test(text)) {
    throw new ValidationException(`${name} 必须是 YYYY-MM-DD 格式`)
  }
  return text
}

function normalizeTaskPriority(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return TRIZ_INTERVENTION_TASK_DEFAULTS.priority
  }
  const text = String(value).trim()
  if (!(TASK_PRIORITIES as readonly string[]).includes(text)) {
    throw new ValidationException(`priority 必须是 ${TASK_PRIORITIES.join(' / ')} 之一`)
  }
  return text
}
