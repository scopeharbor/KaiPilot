import { test } from '@japa/runner'
import { PROJECT_TYPES, type ProjectType } from '@aiproj/types'
import {
  fixtureDraft,
  DRAFT_BLUEPRINTS,
  buildDraftFromBlueprint,
} from '#services/ai_draft/fixtures'
import {
  parseProjectDraft,
  validateDraftIntegrity,
  validateProjectDraft,
  flattenWbs,
} from '#services/ai_draft/schema'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

test.group('AI 草案 schema 与引用完整性', () => {
  test('五类固定夹具都通过完整校验', ({ assert }) => {
    for (const projectType of PROJECT_TYPES) {
      const result = validateProjectDraft(fixtureDraft(projectType as ProjectType))
      assert.isTrue(result.ok, `${projectType} 夹具应通过校验`)
    }
  })

  test('夹具覆盖全部五类输入', ({ assert }) => {
    assert.deepEqual(Object.keys(DRAFT_BLUEPRINTS).sort(), [...PROJECT_TYPES].sort())
  })

  test('高影响字段缺 AIMarker 时 schema 校验失败', ({ assert }) => {
    const draft = clone(fixtureDraft('software'))
    // 删除任务工期字段的 marker
    delete (draft.tasks[0].durationDays as { marker?: unknown }).marker
    const result = parseProjectDraft(draft)
    assert.isFalse(result.ok)
    if (!result.ok) {
      assert.isTrue(result.errors.some((e) => e.path.includes('tasks[0].durationDays')))
    }
  })

  test('显式来源的高影响字段允许 needsConfirmation=false（豁免规则）', ({ assert }) => {
    const draft = clone(fixtureDraft('software'))
    // 模拟用户显式提供的开始日期：source=explicit + needsConfirmation=false 应通过。
    draft.charter.startDate.marker = {
      source: 'explicit',
      reason: '用户明确指定',
      confidence: 1,
      needsConfirmation: false,
    }
    const result = parseProjectDraft(draft)
    assert.isTrue(result.ok, '显式高影响字段无需确认应通过 schema')
  })

  test('高影响推断字段 needsConfirmation 必须为 true', ({ assert }) => {
    const draft = clone(fixtureDraft('event'))
    draft.tasks[0].startDate.marker.needsConfirmation = false
    const result = parseProjectDraft(draft)
    assert.isFalse(result.ok)
    if (!result.ok) {
      assert.isTrue(
        result.errors.some((e) => e.path.startsWith('tasks[0].startDate')),
        '应报告 tasks[0].startDate marker 路径错误',
      )
    }
  })

  test('依赖引用不存在任务时校验失败', ({ assert }) => {
    const draft = clone(fixtureDraft('research'))
    draft.dependencies.push({
      id: 'd-bad',
      predecessorId: draft.tasks[0].id,
      successorId: 'task-does-not-exist',
      type: 'FS',
      lagDays: {
        value: 0,
        marker: { source: 'inferred', reason: '测试', confidence: 0.5, needsConfirmation: true },
      },
    })
    const errors = validateDraftIntegrity(draft)
    assert.isTrue(errors.some((e) => e.message.includes('task-does-not-exist')))
  })

  test('可执行 WBS 叶节点未映射任务时校验失败', ({ assert }) => {
    const draft = clone(fixtureDraft('product'))
    const leaves = flattenWbs(draft.wbs).filter((n) => n.isLeaf && !n.isNote)
    const orphan = leaves[leaves.length - 1]
    const other = leaves[0]
    // 把最后一个叶节点的任务改指向第一个叶节点，使 orphan 叶节点失去任务映射
    for (const task of draft.tasks) {
      if (task.wbsNodeId === orphan.id) task.wbsNodeId = other.id
    }
    const errors = validateDraftIntegrity(draft)
    assert.isTrue(
      errors.some((e) => e.message.includes(orphan.id) || e.path.includes(orphan.outlineCode)),
    )
  })

  test('标记为说明节点的 WBS 叶节点无需任务', ({ assert }) => {
    const bp = clone(DRAFT_BLUEPRINTS.general)
    const draft = buildDraftFromBlueprint(bp)
    // 追加一个纯说明叶节点，不加任务，应仍通过
    draft.wbs[0].children.push({
      id: 'note-1',
      parentId: draft.wbs[0].id,
      outlineCode: '1.9',
      name: {
        value: '说明节点',
        marker: { source: 'inferred', reason: '测试', confidence: 0.6, needsConfirmation: false },
      },
      description: {
        value: '',
        marker: { source: 'inferred', reason: '测试', confidence: 0.6, needsConfirmation: false },
      },
      isLeaf: true,
      isNote: true,
      children: [],
    })
    const result = validateProjectDraft(draft)
    assert.isTrue(result.ok)
  })

  test('依赖不能自环', ({ assert }) => {
    const draft = clone(fixtureDraft('software'))
    draft.dependencies.push({
      id: 'd-self',
      predecessorId: draft.tasks[0].id,
      successorId: draft.tasks[0].id,
      type: 'FS',
      lagDays: {
        value: 0,
        marker: { source: 'inferred', reason: '测试', confidence: 0.5, needsConfirmation: true },
      },
    })
    const errors = validateDraftIntegrity(draft)
    assert.isTrue(errors.some((e) => e.message.includes('自环')))
  })
})
