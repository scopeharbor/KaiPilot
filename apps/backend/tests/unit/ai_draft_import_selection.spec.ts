import { test } from '@japa/runner'
import { fixtureDraft } from '#services/ai_draft/fixtures'
import { flattenWbs, validateProjectDraft } from '#services/ai_draft/schema'
import { applyModifications, filterDraftBySelection } from '#services/ai_draft/import_selection'
import type { ProjectDraftSelection } from '@aiproj/types'

test.group('AI 草案字段修改（服务端重算）', () => {
  test('修改高影响字段后来源转 explicit 且不再需确认', ({ assert }) => {
    const draft = fixtureDraft('software')
    const modified = applyModifications(draft, [
      { path: 'charter.startDate', value: '2026-10-01' },
      { path: 'tasks[t-p1-1].durationDays', value: 9 },
    ])

    assert.equal(modified.charter.startDate.value, '2026-10-01')
    assert.equal(modified.charter.startDate.marker.source, 'explicit')
    assert.isFalse(modified.charter.startDate.marker.needsConfirmation)

    const task = modified.tasks.find((t) => t.id === 't-p1-1')!
    assert.equal(task.durationDays.value, 9)
    assert.equal(task.durationDays.marker.source, 'explicit')

    // 入参不被改动（深拷贝）。
    assert.equal(draft.charter.startDate.value, '2026-08-01')
  })

  test('无法定位的路径静默跳过，不抛异常', ({ assert }) => {
    const draft = fixtureDraft('general')
    const modified = applyModifications(draft, [{ path: 'tasks[does-not-exist].name', value: 'x' }])
    assert.deepEqual(
      modified.tasks.map((t) => t.name.value),
      draft.tasks.map((t) => t.name.value),
    )
  })
})

test.group('AI 草案部分选择过滤（服务端重算）', () => {
  test('丢弃末任务：连带移除其叶节点与悬空依赖，保留父链', ({ assert }) => {
    const draft = fixtureDraft('software')
    const selection: ProjectDraftSelection = {
      taskIds: ['t-p1-1', 't-p1-2', 't-p2-1', 't-p2-2'],
      wbsNodeIds: [],
      acceptanceIds: ['a-1', 'a-2'],
      milestoneIds: ['m-1', 'm-2'],
      riskHintIds: [],
      unselectedStrategy: 'discard',
    }
    const { draft: filtered, dropped } = filterDraftBySelection(draft, selection)

    assert.equal(filtered.tasks.length, 4)
    // 选中任务的 WBS 叶 + 父链 = 6 个节点（w-p2-3 被丢弃）。
    assert.equal(flattenWbs(filtered.wbs).length, 6)
    assert.isUndefined(flattenWbs(filtered.wbs).find((n) => n.id === 'w-p2-3'))
    // 指向 t-p2-3 的依赖被移除。
    assert.equal(filtered.dependencies.length, 3)
    assert.isTrue(
      filtered.dependencies.every(
        (d) => d.predecessorId !== 't-p2-3' && d.successorId !== 't-p2-3',
      ),
    )
    assert.equal(dropped.tasks, 1)
    // 过滤后草案仍通过完整性校验。
    assert.isTrue(validateProjectDraft(filtered).ok)
  })

  test('保留无任务的叶节点自动降级为说明节点，仍过完整性校验', ({ assert }) => {
    const draft = fixtureDraft('software')
    const selection: ProjectDraftSelection = {
      taskIds: ['t-p1-1'],
      wbsNodeIds: ['w-p1', 'w-p1-1', 'w-p1-2'],
      acceptanceIds: ['a-1'],
      milestoneIds: [],
      riskHintIds: [],
      unselectedStrategy: 'discard',
    }
    const { draft: filtered, dropped } = filterDraftBySelection(draft, selection)

    const leaf = flattenWbs(filtered.wbs).find((n) => n.id === 'w-p1-2')!
    assert.isTrue(leaf.isNote)
    assert.isAbove(dropped.notedLeaves, 0)
    assert.isTrue(validateProjectDraft(filtered).ok)
  })

  test('全选等价于完整草案', ({ assert }) => {
    const draft = fixtureDraft('event')
    const flat = flattenWbs(draft.wbs)
    const selection: ProjectDraftSelection = {
      taskIds: draft.tasks.map((t) => t.id),
      wbsNodeIds: flat.map((n) => n.id),
      acceptanceIds: draft.acceptanceCriteria.map((a) => a.id),
      milestoneIds: draft.milestoneHints.map((m) => m.id),
      riskHintIds: draft.riskHints.map((h) => h.id),
      unselectedStrategy: 'discard',
    }
    const { draft: filtered } = filterDraftBySelection(draft, selection)
    assert.equal(filtered.tasks.length, draft.tasks.length)
    assert.equal(flattenWbs(filtered.wbs).length, flat.length)
    assert.equal(filtered.dependencies.length, draft.dependencies.length)
  })
})
