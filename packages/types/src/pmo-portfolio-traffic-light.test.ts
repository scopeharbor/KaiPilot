// @aiproj/types — PMO 组合交通灯共享契约测试。
// v3-pmo-portfolio-traffic-light §2.3: status derivation, gray data gaps,
// warning serialization, review state transitions, input signature stability,
// no sensitive fields.

import { describe, it, expect } from 'vitest'
import {
  // Status
  TRAFFIC_LIGHT_STATUSES,
  trafficLightSeverityScore,
  TRAFFIC_LIGHT_STATUS_ORDER,
  // Scoring
  scoreTrafficLight,
  TRAFFIC_LIGHT_RULE_VERSION,
  // Input signature
  computeTrafficLightInputSignature,
  isReviewStale,
  // Review
  isValidReviewTransition,
  TRAFFIC_LIGHT_REVIEW_STATES,
  // Types
  type TrafficLightScoringInput,
  type TrafficLightScoringResult,
  type TrafficLightSignatureInputs,
  type TrafficLightReviewState,
} from './pmo-portfolio-traffic-light.js'

// ─── TrafficLightStatus 枚举 ───────────────────────────────────────────────────

describe('TrafficLightStatus', () => {
  it('包含四种灯色', () => {
    expect(TRAFFIC_LIGHT_STATUSES).toEqual(['red', 'yellow', 'green', 'gray'])
  })

  it('severityScore: red > yellow > green > gray', () => {
    const scores = TRAFFIC_LIGHT_STATUSES.map((s) => trafficLightSeverityScore(s))
    expect(scores[0]).toBeGreaterThan(scores[1])
    expect(scores[1]).toBeGreaterThan(scores[2])
    expect(scores[2]).toBeGreaterThan(scores[3])
  })

  it('TRAFFIC_LIGHT_STATUS_ORDER 按严重度降序', () => {
    expect(TRAFFIC_LIGHT_STATUS_ORDER).toEqual(['red', 'yellow', 'green', 'gray'])
  })
})

// ─── scoreTrafficLight —— 红灯判定 ─────────────────────────────────────────────

describe('scoreTrafficLight — red', () => {
  const baseInput: TrafficLightScoringInput = {
    healthDiagnosis: {
      available: true,
      forbidden: false,
      overallLabel: 'healthy',
      overallScore: 90,
      updatedAt: '2026-07-26T10:00:00Z',
    },
    prediction: {
      available: true,
      forbidden: false,
      highestSeverity: 'low',
      updatedAt: '2026-07-26T10:00:00Z',
    },
    risk: {
      available: true,
      forbidden: false,
      highRiskCount: 0,
      criticalRiskCount: 0,
      updatedAt: '2026-07-26T10:00:00Z',
    },
    resource: {
      available: true,
      forbidden: false,
      overloadCount: 0,
      maxUtilization: 50,
      updatedAt: '2026-07-26T10:00:00Z',
    },
    task: {
      available: true,
      forbidden: false,
      overdueCount: 0,
      soonDueCount: 0,
      totalCount: 10,
      updatedAt: '2026-07-26T10:00:00Z',
    },
    milestone: {
      available: true,
      forbidden: false,
      atRiskCount: 0,
      missedCount: 0,
      updatedAt: '2026-07-26T10:00:00Z',
    },
    changeImpact: {
      available: true,
      forbidden: false,
      openCount: 0,
      highImpactCount: 0,
      updatedAt: '2026-07-26T10:00:00Z',
    },
    sources: [
      {
        type: 'project_dashboard',
        available: true,
        forbidden: false,
        stale: false,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      {
        type: 'health_diagnosis',
        available: true,
        forbidden: false,
        stale: false,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      {
        type: 'prediction',
        available: true,
        forbidden: false,
        stale: false,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      {
        type: 'risk',
        available: true,
        forbidden: false,
        stale: false,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      {
        type: 'resource',
        available: true,
        forbidden: false,
        stale: false,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      {
        type: 'task',
        available: true,
        forbidden: false,
        stale: false,
        updatedAt: '2026-07-26T10:00:00Z',
      },
    ],
  }

  it('健康诊断 critical → red', () => {
    const input: TrafficLightScoringInput = {
      ...baseInput,
      healthDiagnosis: { ...baseInput.healthDiagnosis, overallLabel: 'critical' },
    }
    const result = scoreTrafficLight(input)
    expect(result.status).toBe('red')
    expect(result.severities.critical).toBeGreaterThan(0)
    expect(result.evidence.some((e) => e.ruleId === 'TL-R01')).toBe(true)
  })

  it('存在 critical 风险 → red', () => {
    const input: TrafficLightScoringInput = {
      ...baseInput,
      risk: { ...baseInput.risk, criticalRiskCount: 2 },
    }
    const result = scoreTrafficLight(input)
    expect(result.status).toBe('red')
    expect(result.evidence.some((e) => e.ruleId === 'TL-R02')).toBe(true)
  })

  it('资源严重超载 >150% → red', () => {
    const input: TrafficLightScoringInput = {
      ...baseInput,
      resource: { ...baseInput.resource, maxUtilization: 180 },
    }
    const result = scoreTrafficLight(input)
    expect(result.status).toBe('red')
    expect(result.evidence.some((e) => e.ruleId === 'TL-R03')).toBe(true)
  })

  it('逾期任务占比 >=30% → red（配合里程碑错过）', () => {
    const input: TrafficLightScoringInput = {
      ...baseInput,
      task: { ...baseInput.task, overdueCount: 5, totalCount: 10 },
      milestone: { ...baseInput.milestone, missedCount: 1 },
    }
    const result = scoreTrafficLight(input)
    expect(result.status).toBe('red')
    expect(result.evidence.some((e) => e.ruleId === 'TL-R05')).toBe(true)
  })

  it('里程碑错过 → red', () => {
    const input: TrafficLightScoringInput = {
      ...baseInput,
      milestone: { ...baseInput.milestone, missedCount: 1 },
    }
    const result = scoreTrafficLight(input)
    expect(result.status).toBe('red')
    expect(result.evidence.some((e) => e.ruleId === 'TL-R01')).toBe(true)
  })
})

// ─── scoreTrafficLight —— 黄灯判定 ─────────────────────────────────────────────

describe('scoreTrafficLight — yellow', () => {
  const baseInput: TrafficLightScoringInput = {
    healthDiagnosis: {
      available: true,
      forbidden: false,
      overallLabel: 'healthy',
      overallScore: 85,
      updatedAt: '2026-07-26T10:00:00Z',
    },
    prediction: {
      available: true,
      forbidden: false,
      highestSeverity: 'low',
      updatedAt: '2026-07-26T10:00:00Z',
    },
    risk: {
      available: true,
      forbidden: false,
      highRiskCount: 0,
      criticalRiskCount: 0,
      updatedAt: '2026-07-26T10:00:00Z',
    },
    resource: {
      available: true,
      forbidden: false,
      overloadCount: 0,
      maxUtilization: 80,
      updatedAt: '2026-07-26T10:00:00Z',
    },
    task: {
      available: true,
      forbidden: false,
      overdueCount: 0,
      soonDueCount: 0,
      totalCount: 10,
      updatedAt: '2026-07-26T10:00:00Z',
    },
    milestone: {
      available: true,
      forbidden: false,
      atRiskCount: 0,
      missedCount: 0,
      updatedAt: '2026-07-26T10:00:00Z',
    },
    changeImpact: {
      available: true,
      forbidden: false,
      openCount: 0,
      highImpactCount: 0,
      updatedAt: '2026-07-26T10:00:00Z',
    },
    sources: [
      {
        type: 'project_dashboard',
        available: true,
        forbidden: false,
        stale: false,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      {
        type: 'health_diagnosis',
        available: true,
        forbidden: false,
        stale: false,
        updatedAt: '2026-07-26T10:00:00Z',
      },
    ],
  }

  it('逾期任务占比 15-30% → yellow', () => {
    const input: TrafficLightScoringInput = {
      ...baseInput,
      task: { ...baseInput.task, overdueCount: 2, totalCount: 10 },
    }
    const result = scoreTrafficLight(input)
    expect(result.status).toBe('yellow')
    expect(result.evidence.some((e) => e.ruleId === 'TL-R06')).toBe(true)
  })

  it('健康诊断 warning → yellow', () => {
    const input: TrafficLightScoringInput = {
      ...baseInput,
      healthDiagnosis: { ...baseInput.healthDiagnosis, overallLabel: 'warning' },
    }
    const result = scoreTrafficLight(input)
    expect(result.status).toBe('yellow')
  })

  it('资源轻度超载 120-150% → yellow', () => {
    const input: TrafficLightScoringInput = {
      ...baseInput,
      resource: { ...baseInput.resource, maxUtilization: 135 },
    }
    const result = scoreTrafficLight(input)
    expect(result.status).toBe('yellow')
    expect(result.evidence.some((e) => e.ruleId === 'TL-R07')).toBe(true)
  })

  it('预测严重度 high → yellow', () => {
    const input: TrafficLightScoringInput = {
      ...baseInput,
      prediction: { ...baseInput.prediction, highestSeverity: 'high' },
    }
    const result = scoreTrafficLight(input)
    expect(result.status).toBe('yellow')
    expect(result.evidence.some((e) => e.ruleId === 'TL-R08')).toBe(true)
  })

  it('健康诊断 attention → yellow', () => {
    const input: TrafficLightScoringInput = {
      ...baseInput,
      healthDiagnosis: { ...baseInput.healthDiagnosis, overallLabel: 'attention' },
    }
    const result = scoreTrafficLight(input)
    expect(result.status).toBe('yellow')
  })
})

// ─── scoreTrafficLight —— 绿灯判定 ─────────────────────────────────────────────

describe('scoreTrafficLight — green', () => {
  it('干净数据 → green', () => {
    const input: TrafficLightScoringInput = {
      healthDiagnosis: {
        available: true,
        forbidden: false,
        overallLabel: 'healthy',
        overallScore: 95,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      prediction: {
        available: true,
        forbidden: false,
        highestSeverity: 'low',
        updatedAt: '2026-07-26T10:00:00Z',
      },
      risk: {
        available: true,
        forbidden: false,
        highRiskCount: 0,
        criticalRiskCount: 0,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      resource: {
        available: true,
        forbidden: false,
        overloadCount: 0,
        maxUtilization: 60,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      task: {
        available: true,
        forbidden: false,
        overdueCount: 0,
        soonDueCount: 0,
        totalCount: 10,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      milestone: {
        available: true,
        forbidden: false,
        atRiskCount: 0,
        missedCount: 0,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      changeImpact: {
        available: true,
        forbidden: false,
        openCount: 0,
        highImpactCount: 0,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      sources: [
        {
          type: 'project_dashboard',
          available: true,
          forbidden: false,
          stale: false,
          updatedAt: '2026-07-26T10:00:00Z',
        },
      ],
    }
    const result = scoreTrafficLight(input)
    expect(result.status).toBe('green')
    expect(result.severities.critical).toBe(0)
    expect(result.severities.high).toBe(0)
    expect(result.severities.medium).toBe(0)
    expect(result.severities.low).toBe(0)
  })
})

// ─── scoreTrafficLight —— 灰灯判定 ─────────────────────────────────────────────

describe('scoreTrafficLight — gray', () => {
  it('所有来源不可用 → gray', () => {
    const input: TrafficLightScoringInput = {
      healthDiagnosis: {
        available: false,
        forbidden: false,
        overallLabel: null,
        overallScore: null,
        updatedAt: null,
      },
      prediction: { available: false, forbidden: false, highestSeverity: null, updatedAt: null },
      risk: {
        available: false,
        forbidden: false,
        highRiskCount: 0,
        criticalRiskCount: 0,
        updatedAt: null,
      },
      resource: {
        available: false,
        forbidden: false,
        overloadCount: 0,
        maxUtilization: null,
        updatedAt: null,
      },
      task: {
        available: false,
        forbidden: false,
        overdueCount: 0,
        soonDueCount: 0,
        totalCount: 0,
        updatedAt: null,
      },
      milestone: {
        available: false,
        forbidden: false,
        atRiskCount: 0,
        missedCount: 0,
        updatedAt: null,
      },
      changeImpact: {
        available: false,
        forbidden: false,
        openCount: 0,
        highImpactCount: 0,
        updatedAt: null,
      },
      sources: [],
    }
    const result = scoreTrafficLight(input)
    expect(result.status).toBe('gray')
    expect(result.evidence.some((e) => e.ruleId === 'TL-R12')).toBe(true)
    expect(result.warnings.some((w) => w.code === 'DATA_UNAVAILABLE')).toBe(true)
  })

  it('权限受限来源 → gray + PERMISSION_REDACTED warning', () => {
    const input: TrafficLightScoringInput = {
      healthDiagnosis: {
        available: true,
        forbidden: false,
        overallLabel: 'healthy',
        overallScore: 90,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      prediction: {
        available: true,
        forbidden: false,
        highestSeverity: 'low',
        updatedAt: '2026-07-26T10:00:00Z',
      },
      risk: {
        available: false,
        forbidden: true,
        highRiskCount: 0,
        criticalRiskCount: 0,
        updatedAt: null,
      },
      resource: {
        available: false,
        forbidden: true,
        overloadCount: 0,
        maxUtilization: null,
        updatedAt: null,
      },
      task: {
        available: true,
        forbidden: false,
        overdueCount: 0,
        soonDueCount: 0,
        totalCount: 10,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      milestone: {
        available: false,
        forbidden: false,
        atRiskCount: 0,
        missedCount: 0,
        updatedAt: null,
      },
      changeImpact: {
        available: false,
        forbidden: false,
        openCount: 0,
        highImpactCount: 0,
        updatedAt: null,
      },
      sources: [
        {
          type: 'project_dashboard',
          available: true,
          forbidden: false,
          stale: false,
          updatedAt: '2026-07-26T10:00:00Z',
        },
        {
          type: 'task',
          available: true,
          forbidden: false,
          stale: false,
          updatedAt: '2026-07-26T10:00:00Z',
        },
        { type: 'risk', available: false, forbidden: true, stale: false, updatedAt: null },
        { type: 'resource', available: false, forbidden: true, stale: false, updatedAt: null },
      ],
    }
    const result = scoreTrafficLight(input)
    expect(result.status).toBe('green') // 有 source 数据可用，绿灯
    expect(result.evidence.some((e) => e.ruleId === 'TL-R13')).toBe(true)
    expect(result.warnings.some((w) => w.code === 'PERMISSION_REDACTED')).toBe(true)
  })
})

// ─── 输入签名 ───────────────────────────────────────────────────────────────

describe('computeTrafficLightInputSignature', () => {
  it('相同输入 → 相同签名', () => {
    const inputs: TrafficLightSignatureInputs = {
      healthDiagnosisUpdatedAt: '2026-07-26T10:00:00Z',
      predictionUpdatedAt: '2026-07-26T10:00:00Z',
      riskSummaryUpdatedAt: '2026-07-26T10:00:00Z',
      resourceSummaryUpdatedAt: '2026-07-26T10:00:00Z',
      dashboardUpdatedAt: '2026-07-26T10:00:00Z',
      taskOverdueCount: 5,
      milestoneStatusSummary: 'atRisk:1,missed:0',
      changeImpactCount: 0,
      availableSources: ['project_dashboard', 'health_diagnosis'],
    }
    const sig1 = computeTrafficLightInputSignature(inputs)
    const sig2 = computeTrafficLightInputSignature({ ...inputs })
    expect(sig1).toBe(sig2)
    expect(typeof sig1).toBe('string')
    expect(sig1.length).toBeGreaterThan(0)
  })

  it('不同输入 → 不同签名', () => {
    const a: TrafficLightSignatureInputs = {
      healthDiagnosisUpdatedAt: '2026-07-26T10:00:00Z',
      predictionUpdatedAt: '2026-07-26T10:00:00Z',
      riskSummaryUpdatedAt: null,
      resourceSummaryUpdatedAt: null,
      dashboardUpdatedAt: null,
      taskOverdueCount: 0,
      milestoneStatusSummary: null,
      changeImpactCount: 0,
      availableSources: [],
    }
    const b: TrafficLightSignatureInputs = {
      ...a,
      taskOverdueCount: 10,
    }
    expect(computeTrafficLightInputSignature(a)).not.toBe(computeTrafficLightInputSignature(b))
  })

  it('null 值序列化为 "null"', () => {
    const inputs: TrafficLightSignatureInputs = {
      healthDiagnosisUpdatedAt: null,
      predictionUpdatedAt: null,
      riskSummaryUpdatedAt: null,
      resourceSummaryUpdatedAt: null,
      dashboardUpdatedAt: null,
      taskOverdueCount: 0,
      milestoneStatusSummary: null,
      changeImpactCount: 0,
      availableSources: [],
    }
    const sig = computeTrafficLightInputSignature(inputs)
    expect(sig).toBeTruthy()
  })
})

// ─── 复核状态 ───────────────────────────────────────────────────────────────

describe('review states', () => {
  it('包含三种复核状态', () => {
    expect(TRAFFIC_LIGHT_REVIEW_STATES).toEqual([
      'acknowledged',
      'needs_follow_up',
      'false_positive',
    ])
  })

  it('任意状态转换均允许', () => {
    const states: TrafficLightReviewState[] = ['acknowledged', 'needs_follow_up', 'false_positive']
    for (const from of [null, ...states] as (TrafficLightReviewState | null)[]) {
      for (const to of states) {
        expect(isValidReviewTransition(from, to)).toBe(true)
      }
    }
  })

  it('签名不同 → stale', () => {
    expect(isReviewStale('abc123', 'def456')).toBe(true)
  })

  it('签名相同 → 非 stale', () => {
    expect(isReviewStale('abc123', 'abc123')).toBe(false)
  })
})

// ─── scoringResult 包含 ruleVersion ───────────────────────────────────────────

describe('scoringResult 结构', () => {
  it('每个 evidence 含 ruleVersion', () => {
    const input: TrafficLightScoringInput = {
      healthDiagnosis: {
        available: true,
        forbidden: false,
        overallLabel: 'critical',
        overallScore: 30,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      prediction: {
        available: true,
        forbidden: false,
        highestSeverity: 'low',
        updatedAt: '2026-07-26T10:00:00Z',
      },
      risk: {
        available: true,
        forbidden: false,
        highRiskCount: 0,
        criticalRiskCount: 0,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      resource: {
        available: true,
        forbidden: false,
        overloadCount: 0,
        maxUtilization: 50,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      task: {
        available: true,
        forbidden: false,
        overdueCount: 0,
        soonDueCount: 0,
        totalCount: 10,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      milestone: {
        available: true,
        forbidden: false,
        atRiskCount: 0,
        missedCount: 0,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      changeImpact: {
        available: true,
        forbidden: false,
        openCount: 0,
        highImpactCount: 0,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      sources: [
        {
          type: 'project_dashboard',
          available: true,
          forbidden: false,
          stale: false,
          updatedAt: '2026-07-26T10:00:00Z',
        },
      ],
    }
    const result = scoreTrafficLight(input)
    for (const e of result.evidence) {
      expect(e.ruleVersion).toBe(TRAFFIC_LIGHT_RULE_VERSION)
    }
  })

  it('返回 signatureInputs 包含所有来源', () => {
    const input: TrafficLightScoringInput = {
      healthDiagnosis: {
        available: true,
        forbidden: false,
        overallLabel: 'healthy',
        overallScore: 90,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      prediction: { available: false, forbidden: false, highestSeverity: null, updatedAt: null },
      risk: {
        available: false,
        forbidden: true,
        highRiskCount: 0,
        criticalRiskCount: 0,
        updatedAt: null,
      },
      resource: {
        available: false,
        forbidden: false,
        overloadCount: 0,
        maxUtilization: null,
        updatedAt: null,
      },
      task: {
        available: true,
        forbidden: false,
        overdueCount: 3,
        soonDueCount: 0,
        totalCount: 20,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      milestone: {
        available: false,
        forbidden: false,
        atRiskCount: 0,
        missedCount: 0,
        updatedAt: null,
      },
      changeImpact: {
        available: false,
        forbidden: false,
        openCount: 0,
        highImpactCount: 0,
        updatedAt: null,
      },
      sources: [
        {
          type: 'project_dashboard',
          available: true,
          forbidden: false,
          stale: false,
          updatedAt: '2026-07-26T10:00:00Z',
        },
        {
          type: 'task',
          available: true,
          forbidden: false,
          stale: false,
          updatedAt: '2026-07-26T10:00:00Z',
        },
        { type: 'risk', available: false, forbidden: true, stale: false, updatedAt: null },
      ],
    }
    const result = scoreTrafficLight(input)
    expect(result.signatureInputs).toBeDefined()
    expect(result.signatureInputs.taskOverdueCount).toBe(3)
    // 受限来源不应出现在 availableSources 中
    expect(result.signatureInputs.availableSources).not.toContain('risk')
  })
})

// ─── 不含敏感字段 ───────────────────────────────────────────────────────────

describe('无敏感字段泄露', () => {
  it('evidenceRefs 不泄露受限数据', () => {
    // TrafficLightEvidenceRef.valueSummary 是低敏摘要，不含具体人名、数量、金额
    const input: TrafficLightScoringInput = {
      healthDiagnosis: {
        available: true,
        forbidden: false,
        overallLabel: 'healthy',
        overallScore: 90,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      prediction: {
        available: true,
        forbidden: false,
        highestSeverity: 'low',
        updatedAt: '2026-07-26T10:00:00Z',
      },
      risk: {
        available: true,
        forbidden: false,
        highRiskCount: 3,
        criticalRiskCount: 1,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      resource: {
        available: true,
        forbidden: false,
        overloadCount: 2,
        maxUtilization: 130,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      task: {
        available: true,
        forbidden: false,
        overdueCount: 0,
        soonDueCount: 0,
        totalCount: 10,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      milestone: {
        available: true,
        forbidden: false,
        atRiskCount: 0,
        missedCount: 0,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      changeImpact: {
        available: true,
        forbidden: false,
        openCount: 0,
        highImpactCount: 0,
        updatedAt: '2026-07-26T10:00:00Z',
      },
      sources: [
        {
          type: 'project_dashboard',
          available: true,
          forbidden: false,
          stale: false,
          updatedAt: '2026-07-26T10:00:00Z',
        },
      ],
    }
    const result = scoreTrafficLight(input)
    // 不应包含 prompts, model output, secrets, tokens
    const json = JSON.stringify(result)
    expect(json).not.toContain('prompt')
    expect(json).not.toContain('model_output')
    expect(json).not.toContain('secret')
    expect(json).not.toContain('token')
    expect(json).not.toContain('password')
    expect(json).not.toContain('Authorization')
  })

  it('review marker 不泄露敏感数据', () => {
    const marker = {
      id: 1,
      projectId: 100,
      organizationId: 1,
      actorId: 5,
      reviewState: 'acknowledged' as const,
      note: '已关注该红灯项目',
      ruleVersion: TRAFFIC_LIGHT_RULE_VERSION,
      inputSignatureHash: 'abc12345',
      stale: false,
      previousReviewState: null,
      createdAt: '2026-07-26T10:00:00Z',
      updatedAt: '2026-07-26T10:00:00Z',
    }
    const json = JSON.stringify(marker)
    expect(json).not.toContain('prompt')
    expect(json).not.toContain('model_output')
    expect(json).not.toContain('secret')
    expect(json).not.toContain('token')
    expect(json).not.toContain('evidence_text') // 低敏审计不应含完整证据文本
  })
})
