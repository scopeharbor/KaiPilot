import { test } from '@japa/runner'
import BudgetDecision from '#models/budget_decision'
import CopilotMemoryEntry from '#models/copilot_memory_entry'
import CopilotMessage from '#models/copilot_message'
import CopilotSession from '#models/copilot_session'
import CopilotSuggestionInbox from '#models/copilot_suggestion_inbox'
import CrossProjectAllocationCommit from '#models/cross_project_allocation_commit'
import CrossProjectAllocationItem from '#models/cross_project_allocation_item'
import PmoAiPriorityRecommendation from '#models/pmo_ai_priority_recommendation'
import ProjectRecommendation from '#models/project_recommendation'
import TrizDecisionLog from '#models/triz_decision_log'
import UserViewOverride from '#models/user_view_override'

/**
 * JSON 列读取的跨方言容错。
 *
 * SQLite 驱动把 json 列当文本返回字符串；PostgreSQL 的 pg 驱动已解析成对象/数组。
 * 这些模型原先在 consume/serialize 里无条件 `JSON.parse`，在 PG 上读到数据即抛
 * `"[object Object]" is not valid JSON`，接口整条 500（开发库实测收件箱、PMO 推荐）。
 * 默认测试跑 SQLite 永远发现不了，这里直接调用列定义，两种形态各喂一次。
 */

type AnyModel = { boot(): void; $getColumn(name: string): any }

function columnFn(model: AnyModel, attribute: string, kind: 'consume' | 'serialize') {
  model.boot()
  const column = model.$getColumn(attribute)
  if (!column || typeof column[kind] !== 'function') {
    throw new Error(`${attribute} 缺少 ${kind}`)
  }
  return column[kind] as (value: unknown, ...rest: unknown[]) => unknown
}

const NON_NULLABLE: Array<[string, AnyModel, string, unknown]> = [
  [
    'CopilotSuggestionInbox.dedupeKey',
    CopilotSuggestionInbox,
    'dedupeKey',
    { problemKind: 'other', declaredKey: 'k' },
  ],
  [
    'CopilotSuggestionInbox.sourceRefs',
    CopilotSuggestionInbox,
    'sourceRefs',
    [{ sourceKind: 'smart_recommendation', sourceId: '1' }],
  ],
  ['CopilotMessage.sourceRefs', CopilotMessage, 'sourceRefs', ['a', 'b']],
  ['CopilotMessage.warningCodes', CopilotMessage, 'warningCodes', ['W1']],
  ['CopilotMemoryEntry.tags', CopilotMemoryEntry, 'tags', ['t']],
  ['CopilotMemoryEntry.basis', CopilotMemoryEntry, 'basis', [{ kind: 'turn', id: '1' }]],
  ['CopilotSession.attribution', CopilotSession, 'attribution', { origin: 'panel' }],
  [
    'CrossProjectAllocationCommit.visibleTargetProjectIds',
    CrossProjectAllocationCommit,
    'visibleTargetProjectIds',
    [1, 2],
  ],
  ['CrossProjectAllocationCommit.itemIds', CrossProjectAllocationCommit, 'itemIds', ['i1']],
  [
    'CrossProjectAllocationItem.demandSnapshot',
    CrossProjectAllocationItem,
    'demandSnapshot',
    { hours: 8 },
  ],
  [
    'PmoAiPriorityRecommendation.priorityContext',
    PmoAiPriorityRecommendation,
    'priorityContext',
    { priorityScore: null },
  ],
  [
    'PmoAiPriorityRecommendation.sourceSignals',
    PmoAiPriorityRecommendation,
    'sourceSignals',
    [{ kind: 's' }],
  ],
  ['ProjectRecommendation.targetRef', ProjectRecommendation, 'targetRef', { type: 'task', id: 1 }],
  ['TrizDecisionLog.subjectRefs', TrizDecisionLog, 'subjectRefs', [{ kind: 'task', id: 1 }]],
  ['TrizDecisionLog.sourceRefs', TrizDecisionLog, 'sourceRefs', [{ kind: 'analysis', id: 2 }]],
  ['TrizDecisionLog.artifactHashes', TrizDecisionLog, 'artifactHashes', [{ kind: 'x', hash: 'h' }]],
]

const NULLABLE: Array<[string, AnyModel, string, unknown]> = [
  [
    'CrossProjectAllocationCommit.warnings',
    CrossProjectAllocationCommit,
    'warnings',
    [{ code: 'W' }],
  ],
  [
    'CrossProjectAllocationCommit.applyResult',
    CrossProjectAllocationCommit,
    'applyResult',
    { ok: true },
  ],
  [
    'CrossProjectAllocationCommit.auditReferences',
    CrossProjectAllocationCommit,
    'auditReferences',
    [1],
  ],
  [
    'CrossProjectAllocationItem.candidateSnapshot',
    CrossProjectAllocationItem,
    'candidateSnapshot',
    { id: 3 },
  ],
  ['CrossProjectAllocationItem.conflicts', CrossProjectAllocationItem, 'conflicts', [{ id: 4 }]],
  [
    'CrossProjectAllocationItem.redactionState',
    CrossProjectAllocationItem,
    'redactionState',
    { masked: true },
  ],
  [
    'PmoAiPriorityRecommendation.evidenceRefs',
    PmoAiPriorityRecommendation,
    'evidenceRefs',
    [{ id: 1 }],
  ],
  [
    'PmoAiPriorityRecommendation.warnings',
    PmoAiPriorityRecommendation,
    'warnings',
    [{ code: 'W' }],
  ],
  [
    'PmoAiPriorityRecommendation.aiMetadata',
    PmoAiPriorityRecommendation,
    'aiMetadata',
    { model: 'm' },
  ],
  ['ProjectRecommendation.evidenceRefs', ProjectRecommendation, 'evidenceRefs', [{ id: 1 }]],
  ['ProjectRecommendation.warnings', ProjectRecommendation, 'warnings', [{ code: 'W' }]],
  ['ProjectRecommendation.aiMetadata', ProjectRecommendation, 'aiMetadata', { model: 'm' }],
]

test.group('JSON 列跨方言容错（SQLite 字符串 / PostgreSQL 已解析）', () => {
  test('{$self}：字符串与已解析值读取结果一致')
    .with(
      NON_NULLABLE.map(([name, model, attribute, value]) => ({ name, model, attribute, value })),
    )
    .run(({ assert }, { model, attribute, value }) => {
      const consume = columnFn(model, attribute, 'consume')
      assert.deepEqual(consume(JSON.stringify(value)), value)
      assert.deepEqual(consume(value), value)
    })

  test('{$self}：可空列兼容 null 与两种形态')
    .with(NULLABLE.map(([name, model, attribute, value]) => ({ name, model, attribute, value })))
    .run(({ assert }, { model, attribute, value }) => {
      const consume = columnFn(model, attribute, 'consume')
      assert.deepEqual(consume(JSON.stringify(value)), value)
      assert.deepEqual(consume(value), value)
      assert.isNull(consume(null))
    })

  test('UserViewOverride.overrideValue：裸字符串值（PG 已解析）原样返回', ({ assert }) => {
    const consume = columnFn(UserViewOverride, 'overrideValue', 'consume')
    assert.equal(consume('"dark"'), 'dark')
    assert.equal(consume('dark'), 'dark')
    assert.deepEqual(consume('{"width":320}'), { width: 320 })
    assert.deepEqual(consume({ width: 320 }), { width: 320 })
    assert.equal(consume(320), 320)
  })

  test('BudgetDecision：serialize 兼容字符串与已解析值', ({ assert }) => {
    const policyRefs = columnFn(BudgetDecision, 'policyRefs', 'serialize')
    assert.deepEqual(policyRefs('["p1"]'), ['p1'])
    assert.deepEqual(policyRefs(['p1']), ['p1'])
    assert.deepEqual(policyRefs(''), [])
    for (const attribute of ['degradation', 'bridgeRef']) {
      const serialize = columnFn(BudgetDecision, attribute, 'serialize')
      assert.deepEqual(serialize('{"a":1}'), { a: 1 })
      assert.deepEqual(serialize({ a: 1 }), { a: 1 })
      assert.isNull(serialize(null))
    }
  })
})
