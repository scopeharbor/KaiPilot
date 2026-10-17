import ProgressDeviationDetector from './progress_deviation_detector.js'
import RiskSurgeDetector from './risk_surge_detector.js'
import ResourceOverloadDetector from './resource_overload_detector.js'
import MilestoneSlipDetector from './milestone_slip_detector.js'
import {
  buildSignalEvidence,
  buildSignalIdempotencyKey,
  evaluateSignalTier,
} from './confidence_tier.js'
import {
  resolveSignalObservationWindows,
  type DetectedProjectSignal,
  type ProjectSignalDetectionResult,
  type ProjectSignalType,
  type SignalInsufficientConclusion,
  type SignalObservation,
} from './signal_contracts.js'
import { SIGNAL_OBSERVATION_WINDOW_DAYS } from './signal_thresholds.js'

/**
 * v3-triz-contradiction-copilot W3 任务 3.2 —— 被动雷达检测编排（**只读**）。
 *
 * 一次检测 = 四个检测器各评一次 → 汇总同观测窗命中类型（复合证据）→ 四条件分层 → 产候选信号。
 * 本服务**不落库**：候选交给 `ProjectSignalService` 持久化；检测链路零业务表写入
 * （静态扫描 + 探针自检见 `tests/unit/project_signal_redlines.spec.ts`，真库实证见
 * `tests/functional/project_signals_api.spec.ts` 的业务表计数不变断言）。
 *
 * 依赖全部可注入（单测用 fixture 假件，零 DB、零模型、零网络）。
 */
export interface ProjectSignalDetectionDeps {
  progressDetector?: Pick<ProgressDeviationDetector, 'evaluate'>
  riskDetector?: Pick<RiskSurgeDetector, 'evaluate'>
  resourceDetector?: Pick<ResourceOverloadDetector, 'evaluate'>
  milestoneDetector?: Pick<MilestoneSlipDetector, 'evaluate'>
}

export interface ProjectSignalDetectionRequest {
  organizationId: number
  projectId: number
  /** 观测窗结束日 `YYYY-MM-DD`（缺省为今日 UTC；检测可由计划任务或 AI 工具触发） */
  asOfDate?: string
  /** 观测窗长度（天）；缺省取阈值常量，只允许在常量模块内调整 */
  windowDays?: number
  /** 分层时间戳（测试可固定以保证可复算；缺省为当前 ISO 时刻） */
  evaluatedAt?: string
}

interface ResolvedDeps {
  progress: Pick<ProgressDeviationDetector, 'evaluate'>
  risk: Pick<RiskSurgeDetector, 'evaluate'>
  resource: Pick<ResourceOverloadDetector, 'evaluate'>
  milestone: Pick<MilestoneSlipDetector, 'evaluate'>
}

export default class ProjectSignalDetectionService {
  readonly #deps: ProjectSignalDetectionDeps

  constructor(deps: ProjectSignalDetectionDeps = {}) {
    this.#deps = deps
  }

  async detect(request: ProjectSignalDetectionRequest): Promise<ProjectSignalDetectionResult> {
    const deps = this.#resolveDeps()
    const asOfDate = request.asOfDate ?? new Date().toISOString().slice(0, 10)
    const windows = resolveSignalObservationWindows(
      asOfDate,
      request.windowDays ?? SIGNAL_OBSERVATION_WINDOW_DAYS,
    )
    const evaluatedAt = request.evaluatedAt ?? new Date().toISOString()

    const observations = await Promise.all([
      deps.progress.evaluate({
        organizationId: request.organizationId,
        projectId: request.projectId,
        windows,
      }),
      deps.risk.evaluate({
        organizationId: request.organizationId,
        projectId: request.projectId,
        windows,
      }),
      deps.resource.evaluate({
        organizationId: request.organizationId,
        projectId: request.projectId,
        windows,
      }),
      deps.milestone.evaluate({
        organizationId: request.organizationId,
        projectId: request.projectId,
        windows,
      }),
    ])

    const insufficient: SignalInsufficientConclusion[] = observations
      .filter((observation) => observation.dataInsufficient)
      .map((observation) => ({
        signalType: observation.signalType,
        reason: observation.insufficientReason ?? 'DATA_INSUFFICIENT',
        window: windows.current.key,
      }))

    const triggered = observations.filter(
      (observation) => observation.triggered && !observation.dataInsufficient,
    )
    const compositeTypes: ProjectSignalType[] = triggered.map(
      (observation) => observation.signalType,
    )

    const signals: DetectedProjectSignal[] = triggered.map((observation) => {
      const { tier, reasons } = evaluateSignalTier({
        observation,
        compositeTypes,
        window: windows.current,
        previousTier: null,
        evaluatedAt,
      })
      return {
        signalType: observation.signalType,
        confidenceTier: tier,
        tierReasons: reasons,
        severity: observation.severity,
        evidence: buildSignalEvidence({ observation, windows, compositeTypes }),
        idempotencyKey: buildSignalIdempotencyKey({
          organizationId: request.organizationId,
          projectId: request.projectId,
          signalType: observation.signalType,
          window: windows.current,
          entityRefs: observation.entityRefs,
        }),
        observationWindow: windows.current,
      }
    })

    return {
      organizationId: request.organizationId,
      projectId: request.projectId,
      asOfDate,
      windows,
      signals,
      skipped: observations.map((observation) => ({
        signalType: observation.signalType,
        triggered: observation.triggered,
        dataInsufficient: observation.dataInsufficient,
        reason: skipReason(observation),
      })),
      insufficient,
      detectorRuns: observations.length,
    }
  }

  #resolveDeps(): ResolvedDeps {
    return {
      progress: this.#deps.progressDetector ?? new ProgressDeviationDetector(),
      risk: this.#deps.riskDetector ?? new RiskSurgeDetector(),
      resource: this.#deps.resourceDetector ?? new ResourceOverloadDetector(),
      milestone: this.#deps.milestoneDetector ?? new MilestoneSlipDetector(),
    }
  }
}

/** 未命中原因码（不可读长文本，便于断言与诊断「雷达为什么没动静」）。 */
function skipReason(observation: SignalObservation): string {
  if (observation.dataInsufficient) return observation.insufficientReason ?? 'DATA_INSUFFICIENT'
  if (observation.triggered) return 'TRIGGERED'
  return observation.hitConditions.length > 0 ? 'TRIGGERED_PARTIAL' : 'BELOW_THRESHOLD'
}
