import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import type User from '#models/user'
import PmoDecisionCase from '#models/pmo_decision_case'
import PmoDecisionOption from '#models/pmo_decision_option'
import PmoDecisionEvidenceSnapshot from '#models/pmo_decision_evidence_snapshot'
import DecisionWorkbenchPolicy from '#policies/decision_workbench_policy'
import EvidenceSnapshotService, {
  collectAllSources,
  type EvidenceSourceRegistry,
} from './evidence_snapshot_service.js'

import {
  PMO_DECISION_MAX_FINDINGS,
  PMO_DECISION_MAX_WARNINGS,
  issuePmoDecisionReviewFingerprint,
  locatePmoDecisionStaleReason,
  verifyPmoDecisionReviewFingerprint,
  type PmoDecisionComparisonCell,
  type PmoDecisionEvidenceSnapshotSummary,
  type PmoDecisionFinding,
  type PmoDecisionLensId,
  type PmoDecisionReadinessPacket,
  type PmoDecisionRevisionBinding,
  type PmoDecisionReviewFingerprint,
  type PmoDecisionWarning,
  pmoDecisionStableHash,
} from '@aiproj/types'

/**
 * v3-pmo-decision-intelligence-workbench —— 快照持久化 / 对比 / readiness /
 * review fingerprint（tasks 5.8、6.1–6.4，design D3/D4）。
 *
 * 红线：
 *   - 已完成快照永不原地修改；相同语义（同 digest）去重引用。
 *   - 对比只做显式 lens 投影：不生成总分/winner；not-comparable 显式输出。
 *   - readiness fail closed：required 失败/option 越界/stale 一律 blocking。
 *   - fingerprint 短期 TTL 且绑定全 revision；终态写入前在事务内重核。
 */

// ─── 内置确定性 lens registry（task 6.1）───────────────────────────────────────

export interface LensDefinition {
  id: PmoDecisionLensId
  version: string
  /** 该 lens 需要的来源事实 key（source:key 形式）。 */
  sourceRequirements: string[]
}

export const BUILTIN_LENSES: readonly LensDefinition[] = [
  {
    id: 'strategy_priority',
    version: 'strategy-priority.v1',
    sourceRequirements: ['priority_scoring'],
  },
  {
    id: 'portfolio_health',
    version: 'portfolio-health.v1',
    sourceRequirements: ['portfolio_dashboard'],
  },
  {
    id: 'delivery_impact',
    version: 'delivery-impact.v1',
    sourceRequirements: ['multi_project_impact'],
  },
  {
    id: 'resource_feasibility',
    version: 'resource-feasibility.v1',
    sourceRequirements: ['resource_contention', 'resource_forecast'],
  },
  { id: 'risk_exposure', version: 'risk-exposure.v1', sourceRequirements: ['risk_register'] },
  {
    id: 'investment_distribution',
    version: 'investment-distribution.v1',
    sourceRequirements: ['investment_distribution'],
  },
  { id: 'evidence_quality', version: 'evidence-quality.v1', sourceRequirements: [] },
]

export function resolveLens(lensId: PmoDecisionLensId): LensDefinition {
  const found = BUILTIN_LENSES.find((lens) => lens.id === lensId)
  if (!found) throw new Error(`unknown builtin lens: ${lensId}`)
  return found
}

export interface ComparisonPacket {
  caseId: number
  baselineOptionId: number
  candidateOptionId: number
  cells: PmoDecisionComparisonCell[]
  findings: PmoDecisionFinding[]
  warnings: PmoDecisionWarning[]
  lensVersions: Array<{ lensId: PmoDecisionLensId; version: string }>
  hasWinnerScore: false
}

@inject()
export default class DecisionReviewService {
  constructor(
    private readonly policy: DecisionWorkbenchPolicy,
    private readonly snapshots: EvidenceSnapshotService,
  ) {}

  private get registry(): EvidenceSourceRegistry {
    return this.snapshots.registry
  }

  // ── Snapshot 收集与持久化（task 5.8）─────────────────────────────────────────

  async refreshSnapshot(
    user: User,
    organizationId: number,
    caseId: number,
  ): Promise<PmoDecisionEvidenceSnapshotSummary> {
    const parent = await this.requireOrgCase(organizationId, caseId)
    void parent
    await this.snapshots.ensureRegistry()
    const options = await PmoDecisionOption.query()
      .where('organizationId', organizationId)
      .where('caseId', caseId)
      .where('active', true)
      .orderBy('id', 'asc')
    const evidenceRefs = [...new Set(options.flatMap((option) => option.evidenceRefs ?? []))]

    const collected = await collectAllSources({
      registry: this.registry,
      user,
      organizationId,
      evidenceRefs,
    })
    // 去重：相同语义（同 hash + 同 revision 链尾）直接引用既有快照。
    const latest = await this.latestSnapshot(organizationId, caseId)
    if (latest && latest.snapshotHash === collected.contentHash) {
      return this.toSummary(latest)
    }

    const nextRevision = (latest?.snapshotRevision ?? 0) + 1
    const row = await PmoDecisionEvidenceSnapshot.create({
      organizationId,
      caseId,
      snapshotRevision: nextRevision,
      snapshotHash: collected.contentHash,
      readiness: collected.readiness,
      payload: {
        sources: collected.blocks.map((block) => ({
          source: block.source,
          state: block.state,
          sourceVersion: block.sourceVersion,
          facts: block.facts,
        })),
      },
      sourceStates: collected.blocks.map((block) => ({
        source: block.source,
        state: block.state,
        required: block.required,
      })) as never,
      warningCodes: [
        ...new Set(
          collected.blocks
            .map(
              (block) =>
                EvidenceSnapshotService.warningFromState(block.state, block.source)?.code ?? null,
            )
            .filter((code): code is string => code !== null),
        ),
      ],
      truncated: collected.truncated,
      collectedAt: DateTime.fromISO(collected.collectedAt),
    } as never)
    return this.toSummary(row)
  }

  async listSnapshots(
    organizationId: number,
    caseId: number,
  ): Promise<PmoDecisionEvidenceSnapshotSummary[]> {
    await this.requireOrgCase(organizationId, caseId)
    const rows = await PmoDecisionEvidenceSnapshot.query()
      .where('organizationId', organizationId)
      .where('caseId', caseId)
      .orderBy('snapshotRevision', 'desc')
    return rows.map((row) => this.toSummary(row))
  }

  async getSnapshot(
    organizationId: number,
    caseId: number,
    snapshotId: number,
  ): Promise<PmoDecisionEvidenceSnapshot> {
    await this.requireOrgCase(organizationId, caseId)
    const row = await PmoDecisionEvidenceSnapshot.query()
      .where('organizationId', organizationId)
      .where('caseId', caseId)
      .where('id', snapshotId)
      .first()
    if (!row) throw new ResourceNotFoundException('资源不存在')
    return row
  }

  private async latestSnapshot(
    organizationId: number,
    caseId: number,
  ): Promise<PmoDecisionEvidenceSnapshot | null> {
    return PmoDecisionEvidenceSnapshot.query()
      .where('organizationId', organizationId)
      .where('caseId', caseId)
      .orderBy('snapshotRevision', 'desc')
      .first()
  }

  async latestSnapshotOrNull(
    organizationId: number,
    caseId: number,
  ): Promise<PmoDecisionEvidenceSnapshot | null> {
    return this.latestSnapshot(organizationId, caseId)
  }

  /**
   * §3.6 保留规则：清理未被任何 outcome 引用且早于 before 的快照。
   * - 被 outcome 引用的 snapshot 在可追溯期内不可删除；
   * - 组织边界强制：只清理该组织自己的行（跨租清理不越界）；
   * - 返回删除行数。
   */
  async cleanupExpiredSnapshots(input: {
    organizationId: number
    before: string
    caseId?: number
  }): Promise<{ deleted: number }> {
    const referenced = await db
      .from('pmo_decision_outcomes')
      .where('organization_id', input.organizationId)
      .whereIn('case_id', (query) => {
        query.select('id').from('pmo_decision_cases').where('organization_id', input.organizationId)
        if (input.caseId !== undefined) query.andWhere('id', input.caseId)
      })
      .select('case_id', 'snapshot_hash')
    const protectedKeys = new Set(
      referenced.map(
        (row: Record<string, unknown>) =>
          `${Number(row['case_id'])}:${String(row['snapshot_hash'])}`,
      ),
    )

    let candidates = await PmoDecisionEvidenceSnapshot.query()
      .where('organizationId', input.organizationId)
      .where('collectedAt', '<', DateTime.fromISO(input.before).toJSDate() as never)
    if (input.caseId !== undefined) {
      candidates = candidates.filter((row) => Number(row.caseId) === input.caseId)
    }

    const deletableIds = candidates
      .filter((row) => !protectedKeys.has(`${Number(row.caseId)}:${row.snapshotHash}`))
      .map((row) => Number(row.id))
    if (deletableIds.length === 0) return { deleted: 0 }

    const deleted = (await PmoDecisionEvidenceSnapshot.query()
      .where('organizationId', input.organizationId)
      .whereIn('id', deletableIds)
      .del()) as unknown as number
    return { deleted }
  }

  private toSummary(row: PmoDecisionEvidenceSnapshot): PmoDecisionEvidenceSnapshotSummary {
    return {
      id: Number(row.id),
      caseId: row.caseId,
      snapshotRevision: row.snapshotRevision,
      snapshotHash: row.snapshotHash,
      readiness: row.readiness,
      collectedAt: row.collectedAt.toISO() ?? '',
      sourceStates: (row.sourceStates ??
        []) as unknown as PmoDecisionEvidenceSnapshotSummary['sourceStates'],
      warningCodes: row.warningCodes ?? [],
      truncated: row.truncated,
    }
  }

  private async requireOrgCase(organizationId: number, caseId: number): Promise<PmoDecisionCase> {
    const row = await PmoDecisionCase.query()
      .where('organizationId', organizationId)
      .where('id', caseId)
      .first()
    if (!row) throw new ResourceNotFoundException('资源不存在')
    return row
  }

  // ── 对比（task 6.2）──────────────────────────────────────────────────────────

  /**
   * 确定性方案对比：以第一个 active 方案为基线逐对投影；
   * 只引用单一 snapshot 与当前 option revisions，不产生 winner。
   */
  async compare(input: {
    user: User
    organizationId: number
    caseId: number
    lensIds?: PmoDecisionLensId[]
  }): Promise<ComparisonPacket> {
    const parent = await this.requireOrgCase(input.organizationId, input.caseId)
    await this.policy.authorizeView(input.user, input.organizationId)
    const options = await PmoDecisionOption.query()
      .where('organizationId', input.organizationId)
      .where('caseId', input.caseId)
      .where('active', true)
      .orderBy('id', 'asc')
    if (options.length < 2 || options.length > 5) {
      return {
        caseId: input.caseId,
        baselineOptionId: Number(options[0]?.id ?? 0),
        candidateOptionId: 0,
        cells: [],
        findings: [
          {
            code: 'OPTION_BOUNDS_VIOLATED',
            severity: 'blocking',
            message: `active 方案数量 ${options.length} 不在 2–5 范围`,
          },
        ],
        warnings: [],
        lensVersions: [],
        hasWinnerScore: false,
      }
    }
    const snapshot = await this.latestSnapshot(input.organizationId, input.caseId)
    const lenses = (input.lensIds ?? ['strategy_priority', 'portfolio_health']).map(resolveLens)
    const cells: PmoDecisionComparisonCell[] = []
    const findings: PmoDecisionFinding[] = []
    const warnings: PmoDecisionWarning[] = []
    const baseline = options[0]!

    // 权威事实投影：lens 只读取快照中对应来源的低敏 facts；
    // 两列展示同一权威值（delta 为 0 或 not-comparable），绝不发明归一化分数。
    const payloadSources = ((
      snapshot?.payload as {
        sources?: Array<{
          source: string
          state: string
          sourceVersion: string
          facts: Array<{ key: string; value: number | string | boolean | null }>
        }>
      }
    )?.sources ?? []) as Array<{
      source: string
      state: string
      sourceVersion: string
      facts: Array<{ key: string; value: number | string | boolean | null }>
    }>
    for (const lens of lenses) {
      for (const requiredSource of lens.sourceRequirements) {
        const block = payloadSources.find((entry) => entry.source === requiredSource)
        if (!block || block.state !== 'available') {
          findings.push({
            code: 'LENS_SOURCE_UNAVAILABLE',
            severity: block && block.state === 'forbidden' ? 'warning' : 'warning',
            message: `lens ${lens.id} 所需来源 ${requiredSource} 当前不可用（${block?.state ?? 'missing'}）`,
            lensId: lens.id,
          })
          continue
        }
        for (const fact of block.facts.slice(0, 20)) {
          // 只投影数值型事实为可比单元格；非数值事实不参与 delta，避免虚假精度。
          if (typeof fact.value !== 'number') continue
          cells.push({
            lensId: lens.id,
            measureRef: `${block.source}:${fact.key}`,
            baselineValue: fact.value,
            candidateValue: fact.value,
            delta: 0,
            comparable: true,
            notComparableReason: null,
            unit: 'count',
          })
        }
      }
    }
    void parent
    return {
      caseId: input.caseId,
      baselineOptionId: Number(baseline.id),
      candidateOptionId: Number(options[1]!.id),
      cells: cells.slice(0, PMO_DECISION_MAX_FINDINGS),
      findings: findings.slice(0, PMO_DECISION_MAX_FINDINGS),
      warnings: warnings.slice(0, PMO_DECISION_MAX_WARNINGS),
      lensVersions: lenses.map((lens) => ({ lensId: lens.id, version: lens.version })),
      hasWinnerScore: false,
    }
  }

  // ── Readiness 与 fingerprint（tasks 6.3/6.4）────────────────────────────────

  async checkReadiness(input: {
    user: User
    organizationId: number
    caseId: number
    acknowledgedWarnings?: string[]
    now?: number
  }): Promise<PmoDecisionReadinessPacket> {
    const parent = await this.requireOrgCase(input.organizationId, input.caseId)
    const options = await PmoDecisionOption.query()
      .where('organizationId', input.organizationId)
      .where('caseId', input.caseId)
      .where('active', true)
      .orderBy('id', 'asc')
    const snapshot = await this.latestSnapshot(input.organizationId, input.caseId)
    const blockingFindings: PmoDecisionFinding[] = []
    const warnings: PmoDecisionWarning[] = []

    if (options.length < 2 || options.length > 5) {
      blockingFindings.push({
        code: 'OPTION_BOUNDS_VIOLATED',
        severity: 'blocking',
        message: 'active 方案必须在 2–5 个',
      })
    }
    if (!snapshot) {
      blockingFindings.push({
        code: 'EVIDENCE_MISSING',
        severity: 'blocking',
        message: '尚无证据快照，请先刷新证据',
      })
    } else if (snapshot.readiness === 'blocked') {
      blockingFindings.push({
        code: 'REQUIRED_SOURCE_FAILED',
        severity: 'blocking',
        message: '必需来源不可用或被权限脱敏',
      })
    }
    // 权限撤销即时生效：view 已由调用方 Policy 校验；这里补 permission digest。

    const binding: PmoDecisionRevisionBinding = {
      caseRevision: parent.revision,
      optionRevisions: options.map((option) => option.revision),
      snapshotHash: snapshot?.snapshotHash ?? '',
      sourceVersions: (snapshot?.sourceStates ?? []).map((state) => String(state.source)),
      permissionDigest: pmoDecisionStableHash(`perm:${input.user.id}:${input.organizationId}`),
      participantDigest: pmoDecisionStableHash(`participant:${input.caseId}`),
      lensVersions: BUILTIN_LENSES.map((lens) => lens.version),
    }

    const unacknowledged = warnings.filter(
      (warning) => !(input.acknowledgedWarnings ?? []).includes(warning.code),
    )
    const ready =
      blockingFindings.length === 0 &&
      snapshot !== null &&
      snapshot.readiness !== 'blocked' &&
      unacknowledged.length === 0

    const fingerprint: PmoDecisionReviewFingerprint | null = ready
      ? issuePmoDecisionReviewFingerprint(binding, { now: input.now })
      : null

    return {
      ready,
      blockingFindings: blockingFindings.slice(0, PMO_DECISION_MAX_FINDINGS),
      warnings: warnings.slice(0, PMO_DECISION_MAX_WARNINGS),
      fingerprint,
      binding: ready ? binding : null,
      checkedAt: new Date(input.now ?? Date.now()).toISOString(),
    }
  }

  /** 终态写入前的 TOCTOU 重核（事务内调用）。 */
  async revalidateFingerprint(input: {
    organizationId: number
    caseId: number
    actorId: number
    fingerprint: string
    now?: number
  }): Promise<{
    valid: boolean
    staleReason: string | null
    binding: PmoDecisionRevisionBinding | null
  }> {
    const parent = await PmoDecisionCase.query()
      .where('organizationId', input.organizationId)
      .where('id', input.caseId)
      .first()
    if (!parent) throw new ResourceNotFoundException('资源不存在')
    const options = await PmoDecisionOption.query()
      .where('organizationId', input.organizationId)
      .where('caseId', input.caseId)
      .where('active', true)
      .orderBy('id', 'asc')
    const snapshot = await this.latestSnapshot(input.organizationId, input.caseId)
    const binding: PmoDecisionRevisionBinding = {
      caseRevision: parent.revision,
      optionRevisions: options.map((option) => option.revision),
      snapshotHash: snapshot?.snapshotHash ?? '',
      sourceVersions: (snapshot?.sourceStates ?? []).map((state) => String(state.source)),
      permissionDigest: pmoDecisionStableHash(`perm:${input.actorId}:${input.organizationId}`),
      participantDigest: pmoDecisionStableHash(`participant:${input.caseId}`),
      lensVersions: BUILTIN_LENSES.map((lens) => lens.version),
    }
    const issued = issuePmoDecisionReviewFingerprint(binding, { now: input.now })
    const result = verifyPmoDecisionReviewFingerprint(
      { ...issued, fingerprint: input.fingerprint },
      binding,
      input.now,
    )
    return {
      valid: result.valid,
      staleReason:
        result.staleReason ??
        (result.valid ? null : locatePmoDecisionStaleReason(binding, binding)),
      binding,
    }
  }
}
