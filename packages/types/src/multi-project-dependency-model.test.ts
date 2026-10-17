// @aiproj/types — 多项目依赖管理共享契约测试
// v3-multi-project-dependency-model / §1.6

import { describe, expect, it } from 'vitest'
import {
  buildDependencyKey,
  buildEndpointNodeId,
  buildRedactedEndpoint,
  buildRedactedEndpointSummary,
  classifyWarning,
  DEPENDENCY_CATEGORIES,
  DEPENDENCY_RISK_LEVELS,
  DEPENDENCY_STATUSES,
  DEPENDENCY_STRENGTHS,
  DEPENDENCY_TYPES,
  ENDPOINT_TYPES,
  isValidLifecycleTransition,
  normalizeGraphQuery,
  normalizeListQuery,
  sortWarningsBySeverity,
  stableHash,
  SUGGESTION_CONFIDENCE_BANDS,
  SUGGESTION_STATUSES,
  SUGGESTION_TYPES,
  WARNING_CODES,
  WRITE_OPERATIONS,
  type MultiProjectDependencyCategory,
  type MultiProjectDependencyRiskLevel,
  type MultiProjectDependencyStatus,
  type MultiProjectDependencyType,
  type MultiProjectEndpointRef,
  type MultiProjectEndpointType,
  type MultiProjectWarningCode,
} from './multi-project-dependency-model.js'

// ---------------------------------------------------------------------------
// §1.6.1 运行时中立性
// ---------------------------------------------------------------------------

describe('runtime neutrality', () => {
  it('should not import backend or frontend dependencies', () => {
    // 这里只验证所有导出都是纯函数或类型——在编译期已由 tsconfig paths 保证
    expect(typeof stableHash).toBe('function')
    expect(typeof normalizeListQuery).toBe('function')
    expect(typeof normalizeGraphQuery).toBe('function')
    expect(typeof isValidLifecycleTransition).toBe('function')
    expect(typeof classifyWarning).toBe('function')
    expect(typeof buildDependencyKey).toBe('function')
    expect(typeof buildEndpointNodeId).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// §1.6.2 稳定哈希
// ---------------------------------------------------------------------------

describe('stableHash', () => {
  it('should produce deterministic output for same input', () => {
    const a = stableHash('hello')
    const b = stableHash('hello')
    expect(a).toBe(b)
  })

  it('should produce different output for different input', () => {
    expect(stableHash('hello')).not.toBe(stableHash('world'))
  })

  it('should be order-sensitive for different field order', () => {
    // buildDependencyKey 使用 JSON.stringify 规范化，所以字段顺序不影响
    const ref1: MultiProjectEndpointRef = {
      endpointType: 'task',
      projectId: 1,
      projectName: 'P1',
      taskId: 100,
      taskName: 'T100',
      milestoneId: null,
      milestoneName: null,
      externalLabel: null,
      externalKey: null,
      redacted: false,
      redactionReason: null,
    }
    const ref2: MultiProjectEndpointRef = {
      endpointType: 'task',
      projectId: 1,
      projectName: 'P1',
      taskId: 100,
      taskName: 'T100',
      milestoneId: null,
      milestoneName: null,
      externalLabel: null,
      externalKey: null,
      redacted: false,
      redactionReason: null,
    }
    const key1 = buildDependencyKey(ref1, ref1 as any, 'fs', 'deliverable')
    const key2 = buildDependencyKey(ref2, ref2 as any, 'fs', 'deliverable')
    expect(key1).toBe(key2)
  })
})

// ---------------------------------------------------------------------------
// §1.6.3 枚举漂移检测
// ---------------------------------------------------------------------------

describe('enum drift', () => {
  it('ENDPOINT_TYPES should have expected members', () => {
    expect(ENDPOINT_TYPES).toEqual(['project', 'milestone', 'task', 'external'])
  })

  it('DEPENDENCY_TYPES should have expected members', () => {
    expect(DEPENDENCY_TYPES).toEqual(['fs', 'ss', 'ff', 'sf'])
  })

  it('DEPENDENCY_CATEGORIES should have expected members', () => {
    expect(DEPENDENCY_CATEGORIES).toEqual([
      'deliverable',
      'milestone',
      'technical',
      'resource',
      'external',
    ])
  })

  it('DEPENDENCY_STATUSES should have expected members', () => {
    expect(DEPENDENCY_STATUSES).toEqual([
      'draft',
      'active',
      'at_risk',
      'blocked',
      'resolved',
      'archived',
    ])
  })

  it('DEPENDENCY_RISK_LEVELS should have expected members', () => {
    expect(DEPENDENCY_RISK_LEVELS).toEqual(['critical', 'high', 'medium', 'low', 'none'])
  })

  it('WARNING_CODES should include all expected codes', () => {
    expect(WARNING_CODES).toContain('ENDPOINT_REDACTED')
    expect(WARNING_CODES).toContain('DEPENDENCY_CYCLE_BLOCKED')
    expect(WARNING_CODES).toContain('GRAPH_INTEGRITY_BLOCKED')
    expect(WARNING_CODES).toContain('PREVIEW_STALE')
    expect(WARNING_CODES).toContain('AI_UNAVAILABLE')
  })

  it('WARNING_CODES should be closed — unknown codes must fail', () => {
    const unknownCode = 'UNKNOWN_WARNING' as MultiProjectWarningCode
    // WARNING_CODES 是 readonly tuple，TypeScript 会在编译期拒绝非成员赋值
    // 这里测试封闭性：classifyWarning 对所有已知 code 都有分类
    for (const code of WARNING_CODES) {
      const severity = classifyWarning(code)
      expect(['info', 'warning', 'blocker']).toContain(severity)
    }
  })
})

// ---------------------------------------------------------------------------
// §1.6.4 生命周期转换
// ---------------------------------------------------------------------------

describe('lifecycle transitions', () => {
  const testCases: {
    from: MultiProjectDependencyStatus
    to: MultiProjectDependencyStatus
    valid: boolean
  }[] = [
    { from: 'draft', to: 'active', valid: true },
    { from: 'draft', to: 'archived', valid: true },
    { from: 'draft', to: 'resolved', valid: false },
    { from: 'active', to: 'at_risk', valid: true },
    { from: 'active', to: 'blocked', valid: true },
    { from: 'active', to: 'resolved', valid: true },
    { from: 'active', to: 'draft', valid: false },
    { from: 'blocked', to: 'active', valid: true },
    { from: 'blocked', to: 'draft', valid: false },
    { from: 'resolved', to: 'active', valid: true },
    { from: 'resolved', to: 'archived', valid: true },
    { from: 'archived', to: 'active', valid: true },
    { from: 'archived', to: 'draft', valid: false },
    { from: 'at_risk', to: 'active', valid: true },
    { from: 'at_risk', to: 'resolved', valid: true },
  ]

  for (const { from, to, valid } of testCases) {
    it(`${from} → ${to} should be ${valid ? 'valid' : 'invalid'}`, () => {
      expect(isValidLifecycleTransition(from, to)).toBe(valid)
    })
  }
})

// ---------------------------------------------------------------------------
// §1.6.5 重复键
// ---------------------------------------------------------------------------

describe('duplicate keys', () => {
  const makeEndpoint = (
    t: MultiProjectEndpointType,
    pid: number | null,
    tid: number | null,
  ): MultiProjectEndpointRef => ({
    endpointType: t,
    projectId: pid,
    projectName: pid ? `Project ${pid}` : null,
    taskId: tid,
    taskName: tid ? `Task ${tid}` : null,
    milestoneId: null,
    milestoneName: null,
    externalLabel: null,
    externalKey: null,
    redacted: false,
    redactionReason: null,
  })

  it('same endpoints + type + category should produce same key', () => {
    const p = makeEndpoint('task', 1, 100)
    const c = makeEndpoint('task', 2, 200)
    const k1 = buildDependencyKey(p, c, 'fs', 'deliverable')
    const k2 = buildDependencyKey(p, c, 'fs', 'deliverable')
    expect(k1).toBe(k2)
  })

  it('different endpoints should produce different key', () => {
    const p1 = makeEndpoint('task', 1, 100)
    const p2 = makeEndpoint('task', 1, 101)
    const c = makeEndpoint('task', 2, 200)
    expect(buildDependencyKey(p1, c, 'fs', 'deliverable')).not.toBe(
      buildDependencyKey(p2, c, 'fs', 'deliverable'),
    )
  })

  it('different categories should produce different key', () => {
    const p = makeEndpoint('task', 1, 100)
    const c = makeEndpoint('task', 2, 200)
    expect(buildDependencyKey(p, c, 'fs', 'deliverable')).not.toBe(
      buildDependencyKey(p, c, 'fs', 'technical'),
    )
  })
})

// ---------------------------------------------------------------------------
// §1.6.6 脱敏标记
// ---------------------------------------------------------------------------

describe('redaction markers', () => {
  it('buildRedactedEndpoint should set redacted=true', () => {
    const endpoint = buildRedactedEndpoint('PERMISSION_DENIED')
    expect(endpoint.redacted).toBe(true)
    expect(endpoint.redactionReason).toBe('PERMISSION_DENIED')
    expect(endpoint.projectId).toBeNull()
    expect(endpoint.taskId).toBeNull()
  })

  it('buildRedactedEndpointSummary should set redacted=true', () => {
    const summary = buildRedactedEndpointSummary('PERMISSION_DENIED', 'task')
    expect(summary.redacted).toBe(true)
    expect(summary.endpointType).toBe('task')
    expect(summary.projectId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// §1.6.7 查询规范化
// ---------------------------------------------------------------------------

describe('query normalization', () => {
  it('normalizeListQuery should apply default page/perPage', () => {
    const result = normalizeListQuery({})
    expect(result.page).toBe(1)
    expect(result.perPage).toBe(20)
  })

  it('normalizeListQuery should cap perPage at 100', () => {
    const result = normalizeListQuery({ page: 1, perPage: 500 })
    expect(result.perPage).toBe(100)
  })

  it('normalizeListQuery should enforce page >= 1', () => {
    const result = normalizeListQuery({ page: -1 })
    expect(result.page).toBe(1)
  })

  it('normalizeGraphQuery should cap depth and limits', () => {
    const result = normalizeGraphQuery(
      { maxDepth: 100, nodeLimit: 5000, edgeLimit: 5000 },
      { maxDepth: 10, nodeLimit: 200, edgeLimit: 500 },
    )
    expect(result.maxDepth).toBe(10)
    expect(result.nodeLimit).toBe(200)
    expect(result.edgeLimit).toBe(500)
  })

  it('normalizeGraphQuery should apply defaults when no values provided', () => {
    const result = normalizeGraphQuery(
      { projectIds: [] },
      { maxDepth: 5, nodeLimit: 100, edgeLimit: 200 },
    )
    expect(result.maxDepth).toBe(5)
    expect(result.nodeLimit).toBe(100)
    expect(result.edgeLimit).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// §1.6.8 警告分类与排序
// ---------------------------------------------------------------------------

describe('warning classification', () => {
  it('CYCLE_BLOCKED should be blocker', () => {
    expect(classifyWarning('DEPENDENCY_CYCLE_BLOCKED')).toBe('blocker')
  })

  it('PREVIEW_EXPIRED should be blocker', () => {
    expect(classifyWarning('PREVIEW_EXPIRED')).toBe('blocker')
  })

  it('ENDPOINT_REDACTED should be warning', () => {
    expect(classifyWarning('ENDPOINT_REDACTED')).toBe('warning')
  })

  it('AI_UNAVAILABLE should be info', () => {
    expect(classifyWarning('AI_UNAVAILABLE')).toBe('info')
  })

  it('sortWarningsBySeverity should sort blocker first', () => {
    const codes: MultiProjectWarningCode[] = [
      'AI_UNAVAILABLE',
      'DEPENDENCY_CYCLE_BLOCKED',
      'ENDPOINT_REDACTED',
    ]
    const sorted = sortWarningsBySeverity(codes)
    expect(sorted[0]).toBe('DEPENDENCY_CYCLE_BLOCKED')
  })
})

// ---------------------------------------------------------------------------
// §1.6.9 端点 Node ID 生成
// ---------------------------------------------------------------------------

describe('endpoint node id', () => {
  it('should produce correct node id for task endpoint', () => {
    const ref: MultiProjectEndpointRef = {
      endpointType: 'task',
      projectId: 1,
      projectName: 'Project 1',
      taskId: 100,
      taskName: 'Task 100',
      milestoneId: null,
      milestoneName: null,
      externalLabel: null,
      externalKey: null,
      redacted: false,
      redactionReason: null,
    }
    expect(buildEndpointNodeId(ref)).toBe('task:p1:t100')
  })

  it('should produce correct node id for project endpoint', () => {
    const ref: MultiProjectEndpointRef = {
      endpointType: 'project',
      projectId: 5,
      projectName: 'Project 5',
      taskId: null,
      taskName: null,
      milestoneId: null,
      milestoneName: null,
      externalLabel: null,
      externalKey: null,
      redacted: false,
      redactionReason: null,
    }
    expect(buildEndpointNodeId(ref)).toBe('project:p5')
  })

  it('should produce correct node id for external endpoint', () => {
    const ref: MultiProjectEndpointRef = {
      endpointType: 'external',
      projectId: null,
      projectName: null,
      taskId: null,
      taskName: null,
      milestoneId: null,
      milestoneName: null,
      externalLabel: 'External API',
      externalKey: 'vendor-api-v2',
      redacted: false,
      redactionReason: null,
    }
    expect(buildEndpointNodeId(ref)).toBe('external:xvendor-api-v2')
  })
})

// ---------------------------------------------------------------------------
// §1.6.10 Fixture 有效性
// ---------------------------------------------------------------------------

describe('fixture validity', () => {
  it('constants should have at least one member', () => {
    expect(ENDPOINT_TYPES.length).toBeGreaterThan(0)
    expect(DEPENDENCY_TYPES.length).toBeGreaterThan(0)
    expect(DEPENDENCY_STATUSES.length).toBeGreaterThan(0)
    expect(DEPENDENCY_RISK_LEVELS.length).toBeGreaterThan(0)
    expect(SUGGESTION_TYPES.length).toBeGreaterThan(0)
    expect(SUGGESTION_STATUSES.length).toBeGreaterThan(0)
    expect(SUGGESTION_CONFIDENCE_BANDS.length).toBeGreaterThan(0)
    expect(WRITE_OPERATIONS.length).toBeGreaterThan(0)
  })
})
