import { inject } from '@adonisjs/core'
import type User from '#models/user'
import AuditService from '#services/audit_service'
import DecisionWorkbenchPolicy from '#policies/decision_workbench_policy'
import {
  decisionAiLensIsolatedAudit,
  decisionAiLensRequestedAudit,
} from './decision_workbench_audit.js'
import {
  PMO_DECISION_MAX_BYTES_PER_SOURCE,
  pmoDecisionStableHash,
  scanPmoDecisionSensitive,
  type PmoDecisionFinding,
} from '@aiproj/types'

/**
 * v3-pmo-decision-intelligence-workbench —— 用户显式触发的 AI 叙述服务
 * （task 8.3，design D6）。
 *
 * 红线：
 *   - 仅由当前已认证人类 actor 显式触发；AI 输出不参与 digest、排序、readiness、
 *     outcome 或 handoff，持久化只留低敏元数据/hash。
 *   - provider 走可注入 seam（测试用 fake，默认 deterministic fallback）；
 *     budget/rate-limit 按 org 计数 fail closed。
 *   - 反幻觉：输出引用的 fact key 必须全部来自输入 bounded packet；否则隔离。
 */

export interface AiNarrativeInput {
  organizationId: number
  caseId: number
  comparisonDigest: string
  /** 允许引用的事实键（低敏键名）。 */
  allowedFactKeys: string[]
}

export interface AiNarrativeResult {
  status: 'ok' | 'fallback' | 'isolated'
  narrative: string | null
  finding: PmoDecisionFinding | null
  provider: string
  outputHash: string
}

/** AI provider seam：生产实现接 AIGateway；测试注入 fake。 */
export type AiNarrativeProvider = (
  input: AiNarrativeInput,
) => Promise<{ narrative: string; provider: string; model: string }>

const MAX_NARRATIVE_CHARS = 2000
/** 每 org 每小时叙述请求预算（fail closed）。 */
const ORG_HOURLY_BUDGET = 20

@inject()
export default class DecisionAiNarrativeService {
  private provider: AiNarrativeProvider | null = null
  private readonly hourlyCounters = new Map<string, { windowStart: number; count: number }>()

  constructor(
    private readonly policy: DecisionWorkbenchPolicy,
    private readonly audit: AuditService,
  ) {}

  setProvider(provider: AiNarrativeProvider): void {
    this.provider = provider
  }

  async narrate(user: User, input: AiNarrativeInput): Promise<AiNarrativeResult> {
    if (!(await this.policy.can(user, 'pmo_decision:request_ai' as never, input.organizationId))) {
      throw new PermissionDeniedForAi()
    }

    // budget / rate limit（fail closed）
    const windowKey = `${input.organizationId}:${Math.floor(Date.now() / 3_600_000)}`
    const counter = this.hourlyCounters.get(windowKey) ?? { windowStart: Date.now(), count: 0 }
    if (counter.count >= ORG_HOURLY_BUDGET) {
      await this.audit.log(
        decisionAiLensIsolatedAudit({
          organizationId: input.organizationId,
          actorId: user.id,
          caseId: input.caseId,
          reasonCode: 'AI_BUDGET_EXHAUSTED',
          provider: 'none',
        }),
      )
      return this.fallback(input, 'AI_BUDGET_EXHAUSTED')
    }
    counter.count += 1
    this.hourlyCounters.set(windowKey, counter)

    await this.audit.log(
      decisionAiLensRequestedAudit({
        organizationId: input.organizationId,
        actorId: user.id,
        caseId: input.caseId,
        lensId: 'comparison-narrative',
      }),
    )

    let narrative: string
    let providerName = 'deterministic-fallback'
    try {
      if (this.provider) {
        const result = await this.provider(input)
        narrative = String(result?.narrative ?? '')
        providerName = `${result.provider}/${result.model}`
      } else {
        narrative = this.deterministicFallback(input)
      }
    } catch {
      return this.fallback(input, 'PROVIDER_ERROR', user, input.caseId)
    }

    // 反幻觉校验 + 大小预算 + 二次扫描
    const referencedKeys = [...narrative.matchAll(/fact:([a-zA-Z0-9_]+)/g)].map(
      (match) => match[1]!,
    )
    const unknownRefs = referencedKeys.filter((key) => !input.allowedFactKeys.includes(key))
    if (
      unknownRefs.length > 0 ||
      narrative.length > MAX_NARRATIVE_CHARS ||
      JSON.stringify(narrative).length > PMO_DECISION_MAX_BYTES_PER_SOURCE ||
      !scanPassesText(narrative)
    ) {
      await this.audit.log(
        decisionAiLensIsolatedAudit({
          organizationId: input.organizationId,
          actorId: user.id,
          caseId: input.caseId,
          reasonCode: 'AI_OUTPUT_INVALID',
          provider: providerName,
        }),
      )
      return this.fallback(input, 'AI_OUTPUT_INVALID', user, input.caseId)
    }

    return {
      status: this.provider ? 'ok' : 'fallback',
      narrative,
      finding: null,
      provider: providerName,
      outputHash: pmoDecisionStableHash(narrative),
    }
  }

  /** 确定性回退摘要：仅基于输入事实键生成规则化中文说明。 */
  private deterministicFallback(input: AiNarrativeInput): string {
    const keys = input.allowedFactKeys
      .slice(0, 5)
      .map((key) => `「${key}」`)
      .join('、')
    return `确定性摘要：本议题对比基于证据快照 ${input.comparisonDigest.slice(0, 8)}；可用事实维度：${keys || '（无）'}。结论须由人工作出，本摘要不构成 winner 判断。`
  }

  private fallback(
    input: AiNarrativeInput,
    reasonCode: string,
    user?: User,
    caseId?: number,
  ): AiNarrativeResult {
    void user
    void caseId
    const narrative = this.deterministicFallback(input)
    return {
      status: 'isolated',
      narrative,
      finding: {
        code: reasonCode,
        severity: 'warning',
        message: 'AI 叙述不可用，已回退确定性摘要',
      },
      provider: 'deterministic-fallback',
      outputHash: pmoDecisionStableHash(narrative),
    }
  }
}

function scanPassesText(text: string): boolean {
  return scanPmoDecisionSensitive({ text }).length === 0
}

export class PermissionDeniedForAi extends Error {}
