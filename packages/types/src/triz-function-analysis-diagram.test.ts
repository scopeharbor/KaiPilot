import { describe, it, expect } from 'vitest'
import {
  // 常量
  FUNCTION_ANALYSIS_RUN_STATUSES,
  FUNCTION_EDGE_TYPES,
  COMPONENT_NODE_TYPES,
  COMPONENT_SCOPES,
  NODE_STATUSES,
  FUNCTION_ISSUE_TYPES,
  FUNCTION_ISSUE_SEVERITIES,
  FUNCTION_ISSUE_CANDIDATE_STATUSES,
  FUNCTION_ANALYSIS_WARNING_CODES,
  FUNCTION_ANALYSIS_RULESET_VERSION,
  FUNCTION_ANALYSIS_LAYOUT_VERSION,
  // 纯函数
  computeFunctionAnalysisInputSignature,
  computeFunctionAnalysisIdempotencyKey,
  computeFunctionNodeKey,
  computeFunctionEdgeKey,
  computeFunctionIssueKey,
  computeFunctionAnalysisOutputHash,
  functionIssueSeverityToScore,
  computeFunctionIssueImpactScore,
  compareFunctionIssueCandidate,
  aggregateFunctionAnalysisWarnings,
  summarizeFunctionAnalysisWarnings,
  isFunctionAnalysisStale,
  generateLowSensitivitySummary,
  // 夹具
  makeFunctionAnalysisCollectorOutput,
  makeFunctionComponentNodeFixture,
  makeFunctionRelationEdgeFixture,
  makeFunctionIssueCandidateFixture,
  makeFunctionAnalysisRunFixture,
  makeFunctionAnalysisHandoffInputFixture,
} from './triz-function-analysis-diagram.js'

// ---------------------------------------------------------------------------
// 常量枚举测试
// ---------------------------------------------------------------------------

describe('TRIZ 功能分析图常量', () => {
  it('运行状态包含所有期望值', () => {
    expect(FUNCTION_ANALYSIS_RUN_STATUSES).toEqual([
      'queued',
      'completed',
      'completed_with_warnings',
      'failed',
      'stale',
      'archived',
    ])
  })

  it('功能边类型包含全部 4 种', () => {
    expect(FUNCTION_EDGE_TYPES).toEqual(['useful', 'harmful', 'insufficient', 'excessive'])
  })

  it('组件节点类型包含全部 4 种', () => {
    expect(COMPONENT_NODE_TYPES).toEqual([
      'system_component',
      'supersystem_component',
      'user_supplied',
      'inferred',
    ])
  })

  it('组件作用域包含 3 种', () => {
    expect(COMPONENT_SCOPES).toEqual(['internal', 'external', 'environment'])
  })

  it('节点状态包含 3 种', () => {
    expect(NODE_STATUSES).toEqual(['active', 'deprecated', 'external'])
  })

  it('问题候选类型包含全部 7 种', () => {
    expect(FUNCTION_ISSUE_TYPES).toEqual([
      'trim_candidate',
      'harmful_function',
      'insufficient_function',
      'excessive_function',
      'duplicate_function',
      'isolated_component',
      'single_point_dependency',
    ])
  })

  it('问题严重度包含 4 级', () => {
    expect(FUNCTION_ISSUE_SEVERITIES).toEqual(['critical', 'high', 'medium', 'low'])
  })

  it('候选状态包含全部 5 种', () => {
    expect(FUNCTION_ISSUE_CANDIDATE_STATUSES).toEqual([
      'unreviewed',
      'reviewed',
      'dismissed',
      'needs_more_info',
      'blocked_stale',
    ])
  })

  it('警告代码包含全部 9 种', () => {
    expect(FUNCTION_ANALYSIS_WARNING_CODES).toEqual([
      'INSUFFICIENT_COMPONENT_SOURCE',
      'SOURCE_UNAVAILABLE',
      'SOURCE_STALE',
      'PERMISSION_RESTRICTED',
      'INSUFFICIENT_EVIDENCE',
      'AI_EXPLANATION_FALLBACK',
      'AI_EXPLANATION_BLOCKED',
      'HANDOFF_BLOCKED_STALE',
      'LARGE_GRAPH_TRUNCATED',
    ])
  })

  it('规则集与布局版本为非空字符串', () => {
    expect(FUNCTION_ANALYSIS_RULESET_VERSION).toBeTruthy()
    expect(FUNCTION_ANALYSIS_LAYOUT_VERSION).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// 确定性纯函数测试（§2.3）
// ---------------------------------------------------------------------------

describe('computeFunctionAnalysisInputSignature', () => {
  it('相同输入产生相同签名', () => {
    const output = makeFunctionAnalysisCollectorOutput()
    const sig1 = computeFunctionAnalysisInputSignature(output)
    const sig2 = computeFunctionAnalysisInputSignature(output)
    expect(sig1).toBe(sig2)
  })

  it('不同输入产生不同签名', () => {
    const a = makeFunctionAnalysisCollectorOutput()
    const b = makeFunctionAnalysisCollectorOutput({ projectName: '不同项目' })
    expect(computeFunctionAnalysisInputSignature(a)).not.toBe(
      computeFunctionAnalysisInputSignature(b),
    )
  })

  it('签名以 fad- 开头', () => {
    const output = makeFunctionAnalysisCollectorOutput()
    expect(computeFunctionAnalysisInputSignature(output)).toMatch(/^fad-/)
  })

  it('warnings 排序不影响签名', () => {
    const a = makeFunctionAnalysisCollectorOutput({
      warnings: [
        { code: 'DATA_SOURCE_UNAVAILABLE', message: 'B', source: 'tasks' },
        { code: 'DATA_SOURCE_UNAVAILABLE', message: 'A', source: 'resources' },
      ],
    })
    const b = makeFunctionAnalysisCollectorOutput({
      warnings: [
        { code: 'DATA_SOURCE_UNAVAILABLE', message: 'A', source: 'resources' },
        { code: 'DATA_SOURCE_UNAVAILABLE', message: 'B', source: 'tasks' },
      ],
    })
    expect(computeFunctionAnalysisInputSignature(a)).toBe(computeFunctionAnalysisInputSignature(b))
  })

  it('task hashes 排序不影响签名', () => {
    const a = makeFunctionAnalysisCollectorOutput({
      taskComponents: [
        { taskId: 2, title: 'B', hash: 'b' },
        { taskId: 1, title: 'A', hash: 'a' },
      ],
    })
    const b = makeFunctionAnalysisCollectorOutput({
      taskComponents: [
        { taskId: 1, title: 'A', hash: 'a' },
        { taskId: 2, title: 'B', hash: 'b' },
      ],
    })
    expect(computeFunctionAnalysisInputSignature(a)).toBe(computeFunctionAnalysisInputSignature(b))
  })
})

describe('computeFunctionAnalysisIdempotencyKey', () => {
  it('相同参数产生相同 key', () => {
    const sig = 'fad-test'
    const k1 = computeFunctionAnalysisIdempotencyKey(1, 2, 3, sig)
    const k2 = computeFunctionAnalysisIdempotencyKey(1, 2, 3, sig)
    expect(k1).toBe(k2)
  })

  it('以 fad-idem- 开头', () => {
    const k = computeFunctionAnalysisIdempotencyKey(1, 2, 3, 'sig')
    expect(k).toMatch(/^fad-idem-/)
  })

  it('用户提供的 key 影响结果', () => {
    const sig = 'fad-test'
    const a = computeFunctionAnalysisIdempotencyKey(1, 2, 3, sig, 'user-key-a')
    const b = computeFunctionAnalysisIdempotencyKey(1, 2, 3, sig, 'user-key-b')
    expect(a).not.toBe(b)
  })

  it('不同签名产生不同 key', () => {
    const a = computeFunctionAnalysisIdempotencyKey(1, 2, 3, 'sig-a')
    const b = computeFunctionAnalysisIdempotencyKey(1, 2, 3, 'sig-b')
    expect(a).not.toBe(b)
  })
})

describe('computeFunctionNodeKey', () => {
  it('相同输入产生相同 key', () => {
    expect(computeFunctionNodeKey('system_component', '前端', 0)).toBe(
      computeFunctionNodeKey('system_component', '前端', 0),
    )
  })

  it('不同标签产生不同 key', () => {
    expect(computeFunctionNodeKey('system_component', '前端', 0)).not.toBe(
      computeFunctionNodeKey('system_component', '后端', 0),
    )
  })

  it('不同类型产生不同 key', () => {
    expect(computeFunctionNodeKey('system_component', '组件', 0)).not.toBe(
      computeFunctionNodeKey('user_supplied', '组件', 0),
    )
  })

  it('以 fcn- 开头', () => {
    expect(computeFunctionNodeKey('system_component', 'X', 0)).toMatch(/^fcn-/)
  })
})

describe('computeFunctionEdgeKey', () => {
  it('相同输入产生相同 key', () => {
    expect(computeFunctionEdgeKey('n1', 'n2', 'useful')).toBe(
      computeFunctionEdgeKey('n1', 'n2', 'useful'),
    )
  })

  it('不同功能类型产生不同 key', () => {
    expect(computeFunctionEdgeKey('n1', 'n2', 'useful')).not.toBe(
      computeFunctionEdgeKey('n1', 'n2', 'harmful'),
    )
  })

  it('反向节点产生不同 key', () => {
    expect(computeFunctionEdgeKey('n1', 'n2', 'useful')).not.toBe(
      computeFunctionEdgeKey('n2', 'n1', 'useful'),
    )
  })

  it('以 fce- 开头', () => {
    expect(computeFunctionEdgeKey('n1', 'n2', 'useful')).toMatch(/^fce-/)
  })
})

describe('computeFunctionIssueKey', () => {
  it('相同输入产生相同 key', () => {
    expect(computeFunctionIssueKey('harmful_function', ['n1', 'n2'], ['e1'])).toBe(
      computeFunctionIssueKey('harmful_function', ['n1', 'n2'], ['e1']),
    )
  })

  it('node refs 排序不影响 key', () => {
    expect(computeFunctionIssueKey('harmful_function', ['n2', 'n1'], ['e1'])).toBe(
      computeFunctionIssueKey('harmful_function', ['n1', 'n2'], ['e1']),
    )
  })

  it('不同问题类型产生不同 key', () => {
    expect(computeFunctionIssueKey('harmful_function', ['n1'], [])).not.toBe(
      computeFunctionIssueKey('trim_candidate', ['n1'], []),
    )
  })

  it('以 fci- 开头', () => {
    expect(computeFunctionIssueKey('harmful_function', ['n1'], [])).toMatch(/^fci-/)
  })
})

describe('computeFunctionAnalysisOutputHash', () => {
  it('相同 keys 产生相同 hash', () => {
    const h1 = computeFunctionAnalysisOutputHash(['n1', 'n2'], ['e1', 'e2'], ['i1'])
    const h2 = computeFunctionAnalysisOutputHash(['n2', 'n1'], ['e1', 'e2'], ['i1'])
    expect(h1).toBe(h2)
  })

  it('以 fao- 开头', () => {
    expect(computeFunctionAnalysisOutputHash(['n1'], ['e1'], ['i1'])).toMatch(/^fao-/)
  })

  it('不同 keys 产生不同 hash', () => {
    expect(computeFunctionAnalysisOutputHash(['n1'], ['e1'], ['i1'])).not.toBe(
      computeFunctionAnalysisOutputHash(['n2'], ['e2'], ['i2']),
    )
  })
})

describe('functionIssueSeverityToScore', () => {
  it('critical = 1.0', () => {
    expect(functionIssueSeverityToScore('critical')).toBe(1.0)
  })
  it('high = 0.75', () => {
    expect(functionIssueSeverityToScore('high')).toBe(0.75)
  })
  it('medium = 0.5', () => {
    expect(functionIssueSeverityToScore('medium')).toBe(0.5)
  })
  it('low = 0.25', () => {
    expect(functionIssueSeverityToScore('low')).toBe(0.25)
  })
})

describe('computeFunctionIssueImpactScore', () => {
  it('critical high-conf 多关联节点 = 高分', () => {
    const score = computeFunctionIssueImpactScore('critical', 0.95, 5, 4)
    expect(score).toBeGreaterThanOrEqual(0.7)
    expect(score).toBeLessThanOrEqual(1.0)
  })

  it('low low-conf 零关联 = 低分', () => {
    const score = computeFunctionIssueImpactScore('low', 0.3, 0, 0)
    expect(score).toBeLessThan(0.4)
  })

  it('分值始终在 0–1 范围', () => {
    for (const sev of ['critical', 'high', 'medium', 'low'] as const) {
      const score = computeFunctionIssueImpactScore(sev, 0.5, 3, 3)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    }
  })
})

describe('compareFunctionIssueCandidate', () => {
  it('按严重度优先排序', () => {
    const critical = makeFunctionIssueCandidateFixture({
      issueKey: 'fci-crit',
      severity: 'critical',
    })
    const low = makeFunctionIssueCandidateFixture({
      issueKey: 'fci-low',
      severity: 'low',
    })
    expect(compareFunctionIssueCandidate(critical, low)).toBeLessThan(0)
    expect(compareFunctionIssueCandidate(low, critical)).toBeGreaterThan(0)
  })

  it('相同严重度按置信度排序', () => {
    const high = makeFunctionIssueCandidateFixture({
      issueKey: 'fci-high',
      severity: 'high',
      confidence: 0.9,
    })
    const low = makeFunctionIssueCandidateFixture({
      issueKey: 'fci-low',
      severity: 'high',
      confidence: 0.5,
    })
    expect(compareFunctionIssueCandidate(high, low)).toBeLessThan(0)
  })

  it('全相同按 issueKey 字母排序', () => {
    const a = makeFunctionIssueCandidateFixture({
      issueKey: 'fci-a',
      severity: 'high',
      confidence: 0.8,
      impactScore: 0.7,
    })
    const b = makeFunctionIssueCandidateFixture({
      issueKey: 'fci-b',
      severity: 'high',
      confidence: 0.8,
      impactScore: 0.7,
    })
    expect(compareFunctionIssueCandidate(a, b)).toBeLessThan(0)
  })

  it('相同候选排序相等', () => {
    const fixture = makeFunctionIssueCandidateFixture()
    expect(compareFunctionIssueCandidate(fixture, fixture)).toBe(0)
  })
})

describe('aggregateFunctionAnalysisWarnings', () => {
  it('合并去重 collector 与 additional', () => {
    const collectorWarnings = [
      { code: 'DATA_SOURCE_UNAVAILABLE', message: 'X', source: 'tasks' },
      { code: 'DATA_SOURCE_UNAVAILABLE', message: 'Y', source: 'resources' },
    ]
    const result = aggregateFunctionAnalysisWarnings(collectorWarnings, [
      'INSUFFICIENT_COMPONENT_SOURCE',
    ])
    // DATA_SOURCE_UNAVAILABLE 不在 FUNCTION_ANALYSIS_WARNING_CODES 中，但会被 set.add 包容
    expect(result).toContain('INSUFFICIENT_COMPONENT_SOURCE')
    expect(result).toContain('DATA_SOURCE_UNAVAILABLE')
    expect(result).toHaveLength(2)
  })

  it('additional 重复去重', () => {
    const result = aggregateFunctionAnalysisWarnings(
      [],
      ['AI_EXPLANATION_FALLBACK', 'AI_EXPLANATION_FALLBACK'],
    )
    expect(result).toEqual(['AI_EXPLANATION_FALLBACK'])
  })

  it('空输入返回空', () => {
    expect(aggregateFunctionAnalysisWarnings([], [])).toEqual([])
  })
})

describe('summarizeFunctionAnalysisWarnings', () => {
  it('空数组返回空字符串', () => {
    expect(summarizeFunctionAnalysisWarnings([])).toBe('')
  })

  it('单个警告返回标签', () => {
    const s = summarizeFunctionAnalysisWarnings(['SOURCE_UNAVAILABLE'])
    expect(s).toBe('来源模块不可用')
  })

  it('多个警告以中文分号连接', () => {
    const s = summarizeFunctionAnalysisWarnings([
      'SOURCE_UNAVAILABLE',
      'INSUFFICIENT_COMPONENT_SOURCE',
    ])
    expect(s).toContain('；')
    expect(s).toContain('来源模块不可用')
    expect(s).toContain('组件来源不足')
  })
})

describe('isFunctionAnalysisStale', () => {
  it('hash 全部匹配 = 不陈旧', () => {
    expect(isFunctionAnalysisStale({ a: '1', b: '2' }, { a: '1', b: '2' })).toBe(false)
  })

  it('任一 hash 不匹配 = 陈旧', () => {
    expect(isFunctionAnalysisStale({ a: '1', b: '2' }, { a: '1', b: '3' })).toBe(true)
  })

  it('current 缺少 key = 不陈旧（宽松处理）', () => {
    expect(isFunctionAnalysisStale({ a: '1', b: '2' }, { a: '1' })).toBe(false)
  })

  it('source 多 key = 按 current 已有 key 比对', () => {
    expect(isFunctionAnalysisStale({ a: '1', b: '2', c: '3' }, { a: '1', b: '2' })).toBe(false)
  })
})

describe('generateLowSensitivitySummary', () => {
  it('不含敏感字段', () => {
    const run = makeFunctionAnalysisRunFixture()
    const summary = generateLowSensitivitySummary(run, 5, 8, 3)
    expect(summary).toContain('#1')
    expect(summary).toContain('5')
    expect(summary).toContain('8')
    expect(summary).toContain('3')
    // 不含完整证据
    expect(summary).not.toContain('abc')
    expect(summary).not.toContain('def')
  })

  it('含警告时显示警告数量', () => {
    const run = makeFunctionAnalysisRunFixture({
      warningSummary: [{ code: 'INSUFFICIENT_COMPONENT_SOURCE', message: '组件来源不足' }],
    })
    const summary = generateLowSensitivitySummary(run, 3, 4, 1)
    expect(summary).toContain('1 条警告')
  })
})

// ---------------------------------------------------------------------------
// 夹具测试（§2.4）
// ---------------------------------------------------------------------------

describe('makeFunctionAnalysisCollectorOutput', () => {
  it('返回完整默认 fixture', () => {
    const output = makeFunctionAnalysisCollectorOutput()
    expect(output.organizationId).toBe(1)
    expect(output.projectName).toBe('测试项目')
    expect(output.taskComponents).toHaveLength(3)
    expect(output.dependencySummary).toHaveLength(2)
    expect(output.resourceSummary).toHaveLength(2)
    expect(output.riskSummary).toHaveLength(2)
    expect(output.manualComponents).toHaveLength(1)
  })

  it('overrides 合并到默认值', () => {
    const output = makeFunctionAnalysisCollectorOutput({ projectName: '覆盖项目' })
    expect(output.projectName).toBe('覆盖项目')
    expect(output.organizationId).toBe(1)
  })

  it('collectedAt 为 ISO 字符串', () => {
    const output = makeFunctionAnalysisCollectorOutput()
    expect(output.collectedAt).toBeTruthy()
    expect(new Date(output.collectedAt).getTime()).toBeGreaterThan(0)
  })
})

describe('makeFunctionComponentNodeFixture', () => {
  it('返回完整默认 fixture', () => {
    const node = makeFunctionComponentNodeFixture()
    expect(node.nodeKey).toBe('fcn-test001')
    expect(node.componentType).toBe('system_component')
    expect(node.scope).toBe('internal')
    expect(node.metrics.inDegree).toBe(1)
    expect(node.metrics.outDegree).toBe(3)
  })

  it('overrides 生效', () => {
    const node = makeFunctionComponentNodeFixture({ label: '自定义', status: 'deprecated' })
    expect(node.label).toBe('自定义')
    expect(node.status).toBe('deprecated')
  })
})

describe('makeFunctionRelationEdgeFixture', () => {
  it('返回完整默认 fixture', () => {
    const edge = makeFunctionRelationEdgeFixture()
    expect(edge.edgeKey).toBe('fce-test001')
    expect(edge.functionType).toBe('useful')
    expect(edge.strength).toBe(0.9)
    expect(edge.confidence).toBe(0.85)
  })

  it('harmful 边正确设置', () => {
    const edge = makeFunctionRelationEdgeFixture({
      functionType: 'harmful',
      label: '延迟影响',
      strength: 0.6,
    })
    expect(edge.functionType).toBe('harmful')
    expect(edge.label).toBe('延迟影响')
    expect(edge.strength).toBe(0.6)
  })

  it('insufficient 边正确设置', () => {
    const edge = makeFunctionRelationEdgeFixture({
      functionType: 'insufficient',
      confidence: 0.4,
    })
    expect(edge.functionType).toBe('insufficient')
    expect(edge.confidence).toBe(0.4)
  })

  it('excessive 边正确设置', () => {
    const edge = makeFunctionRelationEdgeFixture({ functionType: 'excessive' })
    expect(edge.functionType).toBe('excessive')
  })
})

describe('makeFunctionIssueCandidateFixture', () => {
  it('返回完整默认 fixture', () => {
    const issue = makeFunctionIssueCandidateFixture()
    expect(issue.issueKey).toBe('fci-test001')
    expect(issue.issueType).toBe('harmful_function')
    expect(issue.severity).toBe('high')
    expect(issue.status).toBe('unreviewed')
    expect(issue.suggestedActions).toHaveLength(2)
  })

  it('trim_candidate 正确', () => {
    const issue = makeFunctionIssueCandidateFixture({
      issueType: 'trim_candidate',
      severity: 'medium',
    })
    expect(issue.issueType).toBe('trim_candidate')
    expect(issue.severity).toBe('medium')
  })

  it('isolated_component 正确', () => {
    const issue = makeFunctionIssueCandidateFixture({
      issueType: 'isolated_component',
      nodeRefs: ['single-node'],
      edgeRefs: [],
    })
    expect(issue.issueType).toBe('isolated_component')
    expect(issue.nodeRefs).toEqual(['single-node'])
    expect(issue.edgeRefs).toEqual([])
  })

  it('blocked_stale 状态正确', () => {
    const issue = makeFunctionIssueCandidateFixture({ status: 'blocked_stale' })
    expect(issue.status).toBe('blocked_stale')
  })

  it('reviewed 状态含审查元数据', () => {
    const issue = makeFunctionIssueCandidateFixture({
      status: 'reviewed',
      reviewedBy: 1,
      reviewedAt: new Date().toISOString(),
    })
    expect(issue.status).toBe('reviewed')
    expect(issue.reviewedBy).toBe(1)
    expect(issue.reviewedAt).toBeTruthy()
  })
})

describe('makeFunctionAnalysisRunFixture', () => {
  it('返回完整默认 fixture', () => {
    const run = makeFunctionAnalysisRunFixture()
    expect(run.id).toBe(1)
    expect(run.status).toBe('completed_with_warnings')
    expect(run.nodeCount).toBe(5)
    expect(run.edgeCount).toBe(8)
    expect(run.issueCount).toBe(3)
    expect(run.inputSignature).toBe('fad-test-sig')
  })

  it('failed 状态 fixture', () => {
    const run = makeFunctionAnalysisRunFixture({ status: 'failed' })
    expect(run.status).toBe('failed')
  })
})

describe('makeFunctionAnalysisHandoffInputFixture', () => {
  it('返回完整默认 fixture', () => {
    const hi = makeFunctionAnalysisHandoffInputFixture()
    expect(hi.runId).toBe(1)
    expect(hi.issueKey).toBe('fci-test001')
    expect(hi.issueType).toBe('harmful_function')
    expect(hi.nodeRefs).toHaveLength(2)
    expect(hi.edgeRefs).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 跨场景测试（permission denials / stale / large graph / AI fallback）
// ---------------------------------------------------------------------------

describe('跨场景：权限脱敏', () => {
  it('空 sourceHashes 的 stale 判定为不陈旧', () => {
    expect(isFunctionAnalysisStale({}, { a: '1' })).toBe(false)
  })

  it('generateLowSensitivitySummary 不泄露 hash 值', () => {
    const run = makeFunctionAnalysisRunFixture({
      sourceSummary: {
        secret_module: { count: 3, hash: 'should_not_appear' },
      },
    })
    const summary = generateLowSensitivitySummary(run, 5, 8, 3)
    expect(summary).not.toContain('should_not_appear')
    expect(summary).not.toContain('secret_module')
  })
})

describe('跨场景：stale 检测', () => {
  it('多 hash 逐个比对', () => {
    const source = { a: '1', b: '2', c: '3' }
    const current = { a: '1', b: '2', c: '3' }
    expect(isFunctionAnalysisStale(source, current)).toBe(false)
  })

  it('第三个 hash 变更为陈旧', () => {
    const source = { a: '1', b: '2', c: '3' }
    const current = { a: '1', b: '2', c: '99' }
    expect(isFunctionAnalysisStale(source, current)).toBe(true)
  })
})

describe('跨场景：大图性能', () => {
  it('250 nodes 输入签名稳定（性能探针）', () => {
    const tasks = Array.from({ length: 250 }, (_, i) => ({
      taskId: i + 1,
      title: `任务${i + 1}`,
      hash: `hash${i}`,
    }))
    const output = makeFunctionAnalysisCollectorOutput({ taskComponents: tasks })
    const sig = computeFunctionAnalysisInputSignature(output)
    expect(sig).toMatch(/^fad-/)
    expect(sig.length).toBeGreaterThan(8)
  })

  it('500 edges 的 output hash 稳定（性能探针）', () => {
    const nodeKeys = Array.from({ length: 250 }, (_, i) => `fcn-${i}`)
    const edgeKeys = Array.from({ length: 500 }, (_, i) => `fce-${i}`)
    const h1 = computeFunctionAnalysisOutputHash(nodeKeys, edgeKeys, [])
    const h2 = computeFunctionAnalysisOutputHash([...nodeKeys].sort(), [...edgeKeys].sort(), [])
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^fao-/)
  })

  it('250 nodes / 500 edges summary 不超时', () => {
    const run = makeFunctionAnalysisRunFixture({ nodeCount: 250, edgeCount: 500 })
    const summary = generateLowSensitivitySummary(run, 250, 500, 10)
    expect(summary).toContain('250')
    expect(summary).toContain('500')
  })
})

describe('跨场景：AI fallback', () => {
  it('AI_EXPLANATION_FALLBACK 警告可聚合', () => {
    const result = aggregateFunctionAnalysisWarnings(
      [{ code: 'DATA_SOURCE_UNAVAILABLE', message: 'x', source: 'tasks' }],
      ['AI_EXPLANATION_FALLBACK'],
    )
    expect(result).toContain('AI_EXPLANATION_FALLBACK')
  })

  it('AI_EXPLANATION_BLOCKED 警告可聚合', () => {
    const result = aggregateFunctionAnalysisWarnings([], ['AI_EXPLANATION_BLOCKED'])
    expect(result).toEqual(['AI_EXPLANATION_BLOCKED'])
  })
})

describe('跨场景：handoff', () => {
  it('handoff fixture 包含所需字段', () => {
    const hi = makeFunctionAnalysisHandoffInputFixture()
    expect(hi.runId).toBeGreaterThan(0)
    expect(hi.issueKey).toBeTruthy()
    expect(hi.idempotencyKey).toBeTruthy()
    expect(hi.organizationId).toBeGreaterThan(0)
    expect(hi.projectId).toBeGreaterThan(0)
    expect(hi.actorId).toBeGreaterThan(0)
    expect(hi.sourceHashes).toBeDefined()
    expect(hi.suggestedActions.length).toBeGreaterThan(0)
  })

  it('HANDOFF_BLOCKED_STALE 可聚合', () => {
    const result = aggregateFunctionAnalysisWarnings([], ['HANDOFF_BLOCKED_STALE'])
    expect(result).toEqual(['HANDOFF_BLOCKED_STALE'])
  })
})
