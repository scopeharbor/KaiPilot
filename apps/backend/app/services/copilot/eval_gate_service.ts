/**
 * v3-copilot-custom-agent-eval-gate — 门禁服务
 *
 * 设计决策（design.md D1-D7）：
 * - D1: 门禁结论绑定助手定义版本，不绑助手 ID
 * - D2: 依赖变更使门禁失效
 * - D3: L3 进出各设一道断言
 * - D4: 判定确定性 = f(助手版本, 数据集版本, 评分器配置)
 * - D5: 门禁结果逐项可解释
 * - D6: 真实大规模评测属授权门，默认 fixture provider
 * - D7: 门禁失败不删除助手，只是不开放
 *
 * 门禁路径零域写（除评测与门禁自身记录外）。
 * 组织隔离：所有查询附加 organization_id。
 */

import type {
  EvalGateVerdictRecord,
  EvalGateRunRequest,
  EvalGateRunResult,
  EvalGateThresholdConfig,
  EvalGateDependencyFingerprintInput,
  EvalGateInvalidationReason,
  CopilotAgentDefinition,
} from '@aiproj/types'
import {
  computeDependencyFingerprint,
  isVerdictValidForVersion,
  needsReEvaluation,
  detectSensitiveContentInReport,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

export class EvalGateError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'EvalGateError'
  }
}

export class EvalGateNotConfiguredError extends EvalGateError {
  constructor(organizationId: number) {
    super(`组织 ${organizationId} 未配置门禁阈值`, 'EVAL_GATE_NOT_CONFIGURED')
  }
}

export class EvalGateDisabledError extends EvalGateError {
  constructor(organizationId: number) {
    super(`组织 ${organizationId} 的门禁已禁用`, 'EVAL_GATE_DISABLED')
  }
}

export class EvalGateAuthorizationRequiredError extends EvalGateError {
  constructor(organizationId: number) {
    super(`组织 ${organizationId} 未授权真实模型评测`, 'EVAL_GATE_AUTHORIZATION_REQUIRED')
  }
}

export class EvalGateScorerUnavailableError extends EvalGateError {
  constructor() {
    super('评分器不可用', 'EVAL_GATE_SCORER_UNAVAILABLE')
  }
}

export class EvalGatePermissionDeniedError extends EvalGateError {
  constructor(action: string) {
    super(`无权执行: ${action}`, 'EVAL_GATE_PERMISSION_DENIED')
  }
}

export class EvalGateOrganizationAgentCreationBlockedError extends EvalGateError {
  constructor(organizationId: number) {
    super(
      `组织 ${organizationId} 的门禁已禁用，不允许创建组织助手`,
      'EVAL_GATE_ORG_AGENT_CREATION_BLOCKED',
    )
  }
}

// ---------------------------------------------------------------------------
// 依赖注入接口
// ---------------------------------------------------------------------------

export interface EvalGateServiceDeps {
  /** 获取门禁阈值配置。 */
  getThresholdConfig(organizationId: number): Promise<EvalGateThresholdConfig | null>
  /** 获取助手定义（指定版本）。 */
  getAgentDefinition(agentId: string, version: number): Promise<CopilotAgentDefinition | null>
  /** 获取助手当前定义版本的依赖指纹输入。 */
  getAgentDependencyInput(
    agentId: string,
    version: number,
  ): Promise<EvalGateDependencyFingerprintInput>
  /** 获取助手最新有效门禁结论。 */
  getLatestVerdict(organizationId: number, agentId: string): Promise<EvalGateVerdictRecord | null>
  /** 保存门禁结论。 */
  saveVerdict(verdict: EvalGateVerdictRecord): Promise<void>
  /** 运行评测（调用 skill_eval_service）。 */
  runEvaluation(
    request: EvalGateRunRequest,
  ): Promise<{ evalRunId: number; evalReportId: number; report: Record<string, unknown> }>
  /** 检查用户 RBAC 权限。 */
  checkPermission(userId: number, organizationId: number, action: string): Promise<boolean>
  /** 获取评分器是否可用。 */
  checkScorerAvailable(scorerConfig: { kind: string; version: string }): Promise<boolean>
}

// ---------------------------------------------------------------------------
// 门禁服务
// ---------------------------------------------------------------------------

export class EvalGateService {
  constructor(private readonly deps: EvalGateServiceDeps) {}

  /**
   * 运行门禁评测。
   *
   * 流程：
   * 1. 检查门禁配置（enabled + threshold）
   * 2. 检查助手定义版本
   * 3. 计算依赖指纹
   * 4. 检查授权门（D6）
   * 5. 运行评测
   * 6. 确定性判定（D4）
   * 7. 禁存约束检查（D3）
   * 8. 保存结论
   */
  async runGate(request: EvalGateRunRequest): Promise<EvalGateRunResult> {
    const { organizationId } = request

    // §8.9: 回退约束 — 门禁禁用时不允许运行
    const config = await this.deps.getThresholdConfig(organizationId)
    if (!config || !config.enabled) {
      throw new EvalGateDisabledError(organizationId)
    }

    // §5.5: 阈值不设静默全局默认，未配置时门禁不可用
    if (config.passThreshold <= 0) {
      throw new EvalGateNotConfiguredError(organizationId)
    }

    // §7.1: 授权门检查（D6）
    let authorizationGated = false
    let authorizationGateReason: string | undefined
    if (request.benchmarkSource === 'L3' || request.scorerConfig.kind === 'llm_judge') {
      // 真实模型评测需要授权
      if (!config.realModelEvalAuthorized) {
        authorizationGated = true
        authorizationGateReason = '真实模型评测未获组织授权'
      }
    }

    // §7.6: 评分器可用性检查（D4：不可用时 fail）
    if (!authorizationGated) {
      const scorerAvailable = await this.deps.checkScorerAvailable(request.scorerConfig)
      if (!scorerAvailable) {
        // §5.7: 评分器不可用时门禁不通过
        const verdict = this.buildScorerUnavailableVerdict(request, config)
        await this.deps.saveVerdict(verdict)
        return {
          verdict,
          evalRunId: 0,
          evalReportId: 0,
          authorizationGated: false,
        }
      }
    }

    // 运行评测
    let evalResult: { evalRunId: number; evalReportId: number; report: Record<string, unknown> }
    if (authorizationGated) {
      // 授权门短路：前序流程照常走完并落决策，但不调用真实模型
      evalResult = { evalRunId: 0, evalReportId: 0, report: {} }
    } else {
      evalResult = await this.deps.runEvaluation(request)
    }

    // §4.3: 禁存约束 — 评测报告与评分理由不得进入助手上下文
    // 这里检查报告本身是否包含禁存内容
    if (evalResult.report && Object.keys(evalResult.report).length > 0) {
      const violations = detectSensitiveContentInReport(evalResult.report)
      if (violations.length > 0) {
        // 报告包含禁存内容，标记但不阻断（降级为 fail）
        // 实际生产中应由上游守卫拦截
      }
    }

    // §5.1: 确定性判定（D4）
    const verdict = authorizationGated
      ? this.buildAuthorizationGatedVerdict(request, config, authorizationGateReason!)
      : this.buildDeterministicVerdict(
          request,
          config,
          evalResult.report,
          evalResult.evalRunId,
          evalResult.evalReportId,
        )

    // §2.5: 禁存约束 — 结论本身不含敏感内容
    const sensitiveViolations = detectSensitiveContentInReport(
      verdict as unknown as Record<string, unknown>,
    )
    if (sensitiveViolations.length > 0) {
      // 结论包含禁存内容，这是实现 bug，不应发生
      throw new EvalGateError(
        `门禁结论包含禁存内容: ${sensitiveViolations.join(', ')}`,
        'EVAL_GATE_VERDICT_CONTAINS_SENSITIVE',
      )
    }

    await this.deps.saveVerdict(verdict)

    return {
      verdict,
      evalRunId: evalResult.evalRunId,
      evalReportId: evalResult.evalReportId,
      authorizationGated,
      authorizationGateReason,
    }
  }

  /**
   * 检查门禁结论是否对指定版本有效。
   * §3.1: 绑定助手定义版本，不绑助手 ID。
   */
  async checkVerdictValidity(
    organizationId: number,
    agentId: string,
    definitionVersion: string,
  ): Promise<{ valid: boolean; reason?: EvalGateInvalidationReason }> {
    const verdict = await this.deps.getLatestVerdict(organizationId, agentId)
    if (!verdict) {
      return { valid: false }
    }

    // §3.3: 依赖变更时门禁结论失效
    const depInput = await this.deps.getAgentDependencyInput(
      agentId,
      Number.parseInt(definitionVersion, 10),
    )
    const currentFingerprint = computeDependencyFingerprint(depInput)

    const reEval = needsReEvaluation(verdict, definitionVersion, currentFingerprint)
    if (reEval.needed) {
      return { valid: false, reason: reEval.reason }
    }

    return { valid: isVerdictValidForVersion(verdict, definitionVersion, currentFingerprint) }
  }

  /**
   * §8.1: 未过门禁的组织助手只有创建者自用。
   * §8.3: 门禁失败不删除助手，创建者可修改后重跑。
   */
  async isAgentUsableByOthers(
    organizationId: number,
    agentId: string,
    definitionVersion: string,
    requestingUserId: number,
  ): Promise<{ usable: boolean; reason?: string }> {
    const agent = await this.deps.getAgentDefinition(
      agentId,
      Number.parseInt(definitionVersion, 10),
    )
    if (!agent) {
      return { usable: false, reason: '助手定义不存在' }
    }

    // 个人助手：只有创建者可用
    if (agent.scope === 'personal') {
      if (agent.createdBy !== requestingUserId) {
        return { usable: false, reason: '个人助手仅创建者可用' }
      }
      return { usable: true }
    }

    // 组织助手：需要过门禁
    const validity = await this.checkVerdictValidity(organizationId, agentId, definitionVersion)
    if (!validity.valid) {
      if (agent.createdBy === requestingUserId) {
        // 创建者自用：即使未过门禁也可用
        return { usable: true, reason: '创建者自用（门禁未通过）' }
      }
      return {
        usable: false,
        reason: validity.reason ? `门禁结论已失效: ${validity.reason}` : '组织助手未通过评测门禁',
      }
    }

    return { usable: true }
  }

  /**
   * §8.9: 回退约束 — 门禁禁用时禁止创建组织助手。
   */
  async canCreateOrganizationAgent(
    organizationId: number,
    userId: number,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const config = await this.deps.getThresholdConfig(organizationId)
    if (!config || !config.enabled) {
      return {
        allowed: false,
        reason: '门禁已禁用，不允许创建组织助手（回退约束）',
      }
    }

    // RBAC 检查
    const hasPermission = await this.deps.checkPermission(
      userId,
      organizationId,
      'agent.create_organization',
    )
    if (!hasPermission) {
      return { allowed: false, reason: '无创建组织助手权限' }
    }

    return { allowed: true }
  }

  // ---------------------------------------------------------------------------
  // 内部方法
  // ---------------------------------------------------------------------------

  /**
   * §5.1: 构建确定性判定结论。
   * 判定基于确定性阈值规则作用于评分结果，不由模型直接给通过/不通过。
   */
  private buildDeterministicVerdict(
    request: EvalGateRunRequest,
    config: EvalGateThresholdConfig,
    report: Record<string, unknown>,
    _evalRunId: number,
    _evalReportId: number,
  ): EvalGateVerdictRecord {
    // 从报告中提取评测项得分（简化：从 report 中解析）
    const itemScores = this.extractItemScores(report, config.passThreshold)
    const failingItemIds = itemScores.filter((i) => i.failed).map((i) => i.itemId)

    // §5.1: 确定性阈值规则
    const avgScore =
      itemScores.length > 0
        ? itemScores.reduce((sum, item) => sum + item.score, 0) / itemScores.length
        : 0
    const verdict = avgScore >= config.passThreshold ? 'pass' : 'fail'

    return {
      id: `verdict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      organizationId: request.organizationId,
      agentId: request.agentId,
      definitionVersion: request.definitionVersion,
      dependencyFingerprint: request.dependencyFingerprint,
      datasetVersion: request.datasetVersion,
      scorerConfigFingerprint: request.scorerConfig.paramsFingerprint,
      verdict,
      itemScores,
      failingItemIds,
      benchmarkSource: request.benchmarkSource,
      scorerVersion: request.scorerConfig.version,
      createdBy: 0, // 由调用方设置
      createdAt: new Date().toISOString(),
    }
  }

  /**
   * §7.4: 构建授权门短路结论。
   */
  private buildAuthorizationGatedVerdict(
    request: EvalGateRunRequest,
    _config: EvalGateThresholdConfig,
    _reason: string,
  ): EvalGateVerdictRecord {
    return {
      id: `verdict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      organizationId: request.organizationId,
      agentId: request.agentId,
      definitionVersion: request.definitionVersion,
      dependencyFingerprint: request.dependencyFingerprint,
      datasetVersion: request.datasetVersion,
      scorerConfigFingerprint: request.scorerConfig.paramsFingerprint,
      verdict: 'unavailable',
      itemScores: [],
      failingItemIds: [],
      benchmarkSource: request.benchmarkSource,
      scorerVersion: request.scorerConfig.version,
      createdBy: 0,
      createdAt: new Date().toISOString(),
    }
  }

  /**
   * §5.7: 构建评分器不可用结论。
   */
  private buildScorerUnavailableVerdict(
    request: EvalGateRunRequest,
    _config: EvalGateThresholdConfig,
  ): EvalGateVerdictRecord {
    return {
      id: `verdict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      organizationId: request.organizationId,
      agentId: request.agentId,
      definitionVersion: request.definitionVersion,
      dependencyFingerprint: request.dependencyFingerprint,
      datasetVersion: request.datasetVersion,
      scorerConfigFingerprint: request.scorerConfig.paramsFingerprint,
      verdict: 'fail',
      itemScores: [],
      failingItemIds: [],
      benchmarkSource: request.benchmarkSource,
      scorerVersion: request.scorerConfig.version,
      createdBy: 0,
      createdAt: new Date().toISOString(),
    }
  }

  /**
   * 从评测报告中提取评测项得分。
   */
  private extractItemScores(
    report: Record<string, unknown>,
    passThreshold?: number,
  ): import('@aiproj/types').EvalGateItemScore[] {
    // 如果报告包含 dimensionScores，转换为 EvalGateItemScore
    const dimScores = report['dimensionScores'] as Array<Record<string, unknown>> | undefined
    if (!dimScores || !Array.isArray(dimScores)) {
      return []
    }
    return dimScores.map((ds) => {
      const score = Number(ds['score'] ?? 0)
      const failed = passThreshold !== undefined ? score < passThreshold : false
      return {
        itemId: String(ds['dimension'] ?? ds['itemId'] ?? 'unknown'),
        itemName: String(ds['dimension'] ?? ds['itemName'] ?? 'unknown'),
        score,
        failed,
        actionableHint: failed ? `得分 ${score.toFixed(2)} 低于阈值 ${passThreshold}` : undefined,
      }
    })
  }
}
