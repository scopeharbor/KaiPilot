// AI 同事全自动 —— 草案修正：模型返回的修改只认白名单路径与合法值（防幻觉）。
import { test } from '@japa/runner'
import type { ProjectDraft } from '@aiproj/types'
import {
  applyDraftFixOperations,
  normalizeDraftFixModifications,
  normalizeDraftFixOperations,
} from '#services/ai_draft/ai_draft_fix_service'

const marked = <T>(value: T) => ({
  value,
  marker: { confidence: 0.8, source: 'inferred' as const, reason: '', needsConfirmation: false },
})

const draft = {
  wbs: [{ id: 'w1', parentId: null, outlineCode: '1', isLeaf: true, children: [] }],
  tasks: [
    { id: 't1', wbsNodeId: 'w1', name: marked('一') },
    { id: 't2', wbsNodeId: 'w1', name: marked('二') },
  ],
  dependencies: [
    { id: 'd1', predecessorId: 't1', successorId: 't2', type: 'FS', lagDays: marked(0) },
  ],
  milestoneHints: [
    { id: 'm1', name: marked('上线'), targetDate: marked('2026-11-10'), linkedTaskIds: ['t2'] },
  ],
  acceptanceCriteria: [
    { id: 'a1', statement: marked('可用'), linkedTaskId: 't2', linkedSuccessIndex: null },
  ],
  ganttPreview: { criticalPathTaskIds: ['t1', 't2'] },
} as unknown as ProjectDraft

test.group('草案全自动修正：修改规范化', () => {
  test('白名单路径、冻结结构字段、值类型校验、同路径取最后一条', ({ assert }) => {
    const result = normalizeDraftFixModifications([
      { path: 'tasks[t1].endDate', value: '2026-11-05' },
      { path: 'tasks[t1].endDate', value: '2026-11-06' },
      { path: 'dependencies[d2].predecessorId', value: 't3' },
      { path: 'charter.endDate', value: '2026-12-31' },
      { path: 'tasks[t1].id', value: 'hack' },
      { path: 'wbs[w1].children', value: [] },
      { path: 'meta.provider', value: 'x' },
      { path: 'tasks[t1].durationDays', value: { nested: true } },
      { path: 'tasks[t1].durationDays', value: Number.NaN },
      'garbage',
      null,
    ])
    assert.deepEqual(result, [
      { path: 'tasks[t1].endDate', value: '2026-11-06' },
      { path: 'dependencies[d2].predecessorId', value: 't3' },
      { path: 'charter.endDate', value: '2026-12-31' },
    ])
    assert.deepEqual(normalizeDraftFixModifications('not-array'), [])
  })
})

test.group('草案全自动修正：结构性操作', () => {
  test('只认草案里真有的 id 或同轮新任务的 ref；新任务挂在已有 WBS、日期合法', ({ assert }) => {
    const ops = normalizeDraftFixOperations(
      [
        {
          op: 'add_task',
          ref: 'new1',
          name: '联调',
          wbsNodeId: 'w1',
          startDate: '2026-11-02',
          endDate: '2026-11-04',
        },
        {
          op: 'add_task',
          name: '幽灵',
          wbsNodeId: 'w9',
          startDate: '2026-11-02',
          endDate: '2026-11-04',
        },
        {
          op: 'add_task',
          name: '倒序',
          wbsNodeId: 'w1',
          startDate: '2026-11-05',
          endDate: '2026-11-01',
        },
        { op: 'add_dependency', predecessorId: 't1', successorId: 'new1' },
        { op: 'add_dependency', predecessorId: 't1', successorId: 't1' },
        { op: 'add_dependency', predecessorId: 'tX', successorId: 't2' },
        { op: 'remove_dependency', dependencyId: 'd1' },
        { op: 'remove_dependency', dependencyId: 'd9' },
        { op: 'remove_task', taskId: 't9' },
        { op: 'rm -rf' },
      ],
      draft,
    )
    assert.deepEqual(
      ops.map((op) => op.op),
      ['add_task', 'add_dependency', 'remove_dependency'],
    )
  })

  test('应用：新增任务带推断标记与工期、依赖指向新任务；删除任务清理依赖 / 里程碑 / 验收 / 关键路径', ({
    assert,
  }) => {
    const added = applyDraftFixOperations(draft, [
      {
        op: 'add_task',
        ref: 'new1',
        name: '联调',
        wbsNodeId: 'w1',
        startDate: '2026-11-02',
        endDate: '2026-11-04',
      },
      { op: 'add_dependency', predecessorId: 't1', successorId: 'new1', type: 'FS', lagDays: 0 },
    ])
    const task = added.tasks.at(-1)!
    assert.equal(task.id, 't-ai-1')
    assert.equal(task.durationDays.value, 3)
    assert.equal(task.name.marker.source, 'inferred')
    assert.include(
      added.dependencies.map((dep) => `${dep.predecessorId}>${dep.successorId}`),
      't1>t-ai-1',
    )
    assert.lengthOf(draft.tasks, 2, '不改入参')

    const removed = applyDraftFixOperations(draft, [{ op: 'remove_task', taskId: 't2' }])
    assert.deepEqual(
      removed.tasks.map((t) => t.id),
      ['t1'],
    )
    assert.lengthOf(removed.dependencies, 0)
    assert.deepEqual(removed.milestoneHints[0]!.linkedTaskIds, [])
    assert.isNull(removed.acceptanceCriteria[0]!.linkedTaskId)
    assert.deepEqual(removed.ganttPreview!.criticalPathTaskIds, ['t1'])
  })
})

test.group('草案全自动修正：新增 WBS 节点', () => {
  test('新节点可作为同轮新任务的挂靠点；父节点变为非叶子；不存在的父节点被拒', ({ assert }) => {
    const ops = normalizeDraftFixOperations(
      [
        { op: 'add_wbs_node', ref: 'phase', name: '收尾阶段', parentId: null },
        { op: 'add_wbs_node', name: '幽灵阶段', parentId: 'w9' },
        { op: 'add_wbs_node', ref: 'sub', name: '验收', parentId: 'w1' },
        {
          op: 'add_task',
          name: '上线验收',
          wbsNodeId: 'phase',
          startDate: '2026-11-20',
          endDate: '2026-11-21',
        },
      ],
      draft,
    )
    assert.deepEqual(
      ops.map((op) => op.op),
      ['add_wbs_node', 'add_wbs_node', 'add_task'],
    )
    const next = applyDraftFixOperations(draft, ops)
    const root = next.wbs.find((node) => node.id === 'w-ai-1')!
    assert.equal(root.outlineCode, '2')
    assert.equal(root.name.value, '收尾阶段')
    const parent = next.wbs.find((node) => node.id === 'w1')!
    assert.isFalse(parent.isLeaf)
    assert.equal(parent.children[0]!.id, 'w-ai-2')
    assert.equal(parent.children[0]!.outlineCode, '1.1')
    assert.equal(next.tasks.at(-1)!.wbsNodeId, 'w-ai-1')
  })
})
