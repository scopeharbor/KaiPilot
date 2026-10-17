import { test } from '@japa/runner'
import { CLARIFICATION_FIELDS } from '@aiproj/types'
import {
  buildGroundingManifest,
  CLARIFICATION_FIELD_CATEGORY,
} from '#services/ai_draft/grounding_manifest'
import {
  correctInternalTicketDraft,
  INTERNAL_TICKET_QUALITY_CONTEXT,
  wrongOaDraftForTicketContext,
} from '#services/ai_draft/quality_fixtures'
import { validateSemanticGrounding } from '#services/ai_draft/semantic_grounding_gate'
import { DRAFT_STAGE_CATALOG, DraftStageToolGate } from '#services/ai_draft/stage_catalog'

test.group('AI 草案 grounding 与阶段隔离', () => {
  test('工单 fixture 覆盖角色、150 名员工、SLA、升级、看板与验收日期且无凭据', ({ assert }) => {
    const serialized = JSON.stringify(INTERNAL_TICKET_QUALITY_CONTEXT)
    for (const token of ['5 人运营团队', '150 名', 'SLA', '升级', '数据看板', '2026-10-30']) {
      assert.include(serialized, token)
    }
    assert.notMatch(serialized, /sk-[a-z0-9]{12,}|authorization|api[_-]?key/i)
  })

  test('manifest 稳定、有界、包含全部确认答案来源且不复制完整 prompt', ({ assert }) => {
    const first = buildGroundingManifest(INTERNAL_TICKET_QUALITY_CONTEXT)
    const second = buildGroundingManifest(INTERNAL_TICKET_QUALITY_CONTEXT)
    assert.deepEqual(first, second)
    assert.isAtMost(first.facts.length, 32)
    assert.isTrue(first.facts.every((fact) => fact.normalizedValue.length <= 120))
    assert.isTrue(first.facts.some((fact) => fact.source === 'confirmed'))
    assert.notInclude(JSON.stringify(first), INTERNAL_TICKET_QUALITY_CONTEXT.rawInput)
  })

  test('方法论与沟通频率使用人类可读语义，委托团队选择不构成阻断事实', ({ assert }) => {
    const context = structuredClone(INTERNAL_TICKET_QUALITY_CONTEXT)
    const marker = context.resolvedFields.projectGoal!.marker
    context.resolvedFields.methodology = { value: 'scrum', marker }
    context.resolvedFields.communicationFreq = { value: 'weekly', marker }
    context.resolvedFields.techStack = { value: '由团队按现有能力选择', marker }

    const manifest = buildGroundingManifest(context)
    const scrum = manifest.facts.find((fact) => fact.normalizedValue === 'Scrum')
    const weekly = manifest.facts.find((fact) => fact.normalizedValue === '每周')
    const delegated = manifest.facts.find((fact) => fact.normalizedValue === '由团队按现有能力选择')
    assert.equal(scrum?.category, 'business_concept')
    assert.equal(weekly?.category, 'business_concept')
    assert.isFalse(delegated?.required ?? true)
  })

  test('正确工单草案通过，结构合法但错误的 OA 草案被 HL-001/HL-010 阻断', ({ assert }) => {
    const manifest = buildGroundingManifest(INTERNAL_TICKET_QUALITY_CONTEXT)
    const correct = validateSemanticGrounding(correctInternalTicketDraft(), manifest)
    const wrong = validateSemanticGrounding(wrongOaDraftForTicketContext(), manifest)

    assert.isTrue(
      correct.valid,
      JSON.stringify({
        missing: correct.missingFactIds,
        facts: manifest.facts,
        blocking: correct.blocking,
      }),
    )
    assert.isFalse(wrong.valid)
    assert.isTrue(wrong.blocking.some((issue) => issue.ruleId === 'HL-001'))
    assert.isTrue(wrong.blocking.some((issue) => issue.ruleId === 'HL-010'))
  })

  test('已确认事实可分散在不同草案字段并合理改写，但量化阈值不可丢失', ({ assert }) => {
    const manifest = buildGroundingManifest(INTERNAL_TICKET_QUALITY_CONTEXT)
    const paraphrased = correctInternalTicketDraft()
    paraphrased.charter.successCriteria.value = [
      '验收最晚在 2026-10-30 完成。',
      '上线后遗漏率必须控制在 1% 以下。',
      '核心页面响应时间需低于 2 秒，并覆盖 150 名员工。',
    ]
    const valid = validateSemanticGrounding(paraphrased, manifest)
    assert.isTrue(valid.valid, JSON.stringify(valid))

    paraphrased.charter.successCriteria.value = ['完成验收并确保页面响应流畅。']
    paraphrased.acceptanceCriteria = []
    const withoutThresholds = JSON.parse(
      JSON.stringify(paraphrased)
        .replaceAll('1%', '百分之一')
        .replaceAll('2 秒', '两秒')
        .replaceAll('2秒', '两秒'),
    )
    const missingThresholds = validateSemanticGrounding(withoutThresholds, manifest)
    assert.isFalse(missingThresholds.valid)
    assert.isTrue(missingThresholds.missingFactIds.length > 0)
  })

  test('行业级大草案：前段超过 2 万字时，后段字段里的事实仍计入覆盖', ({ assert }) => {
    const manifest = buildGroundingManifest(INTERNAL_TICKET_QUALITY_CONTEXT)
    const large = correctInternalTicketDraft()
    large.charter.title.value = `${'需求调研与方案评审。'.repeat(4_000)}${large.charter.title.value}`
    const result = validateSemanticGrounding(large, manifest)
    assert.isTrue(result.valid, JSON.stringify(result.missingFactIds))
  })

  test('遗漏事实时阻断信息列出事实原文，便于审查定位', ({ assert }) => {
    const manifest = buildGroundingManifest(INTERNAL_TICKET_QUALITY_CONTEXT)
    const draft = JSON.parse(
      JSON.stringify(correctInternalTicketDraft()).replaceAll('2026-10-30', '2026-11-30'),
    )
    const result = validateSemanticGrounding(draft, manifest)
    const issue = result.blocking.find((item) => item.message.startsWith('草案遗漏'))
    assert.exists(issue)
    assert.include(issue!.message, '「2026-10-30」')
  })

  test('每阶段只暴露最小 0–2 个工具，目录外调用 fail closed', ({ assert }) => {
    const gate = new DraftStageToolGate()
    for (const definition of DRAFT_STAGE_CATALOG) {
      assert.isAtMost(gate.resolve(definition).length, 2)
      assert.notInclude(gate.resolve(definition), 'project.write')
    }
    assert.throws(
      () => gate.assertInvocation(DRAFT_STAGE_CATALOG[0]!, 'project.write'),
      'DRAFT_STAGE_TOOL_NOT_ALLOWED',
    )
  })

  test('最终一致性阶段能看到已确认的范围边界，但仍只暴露一个工具', ({ assert }) => {
    const reconcile = DRAFT_STAGE_CATALOG.find((item) => item.stage === 'reconcile_review')!
    assert.includeMembers(reconcile.contextScope, ['in_scope', 'out_of_scope'])
    assert.lengthOf(new DraftStageToolGate().resolve(reconcile), 1)
  })
})

test('ClarificationField 全量显式类别映射：无 fallback 到 deliverable 的遗漏字段', ({ assert }) => {
  for (const field of CLARIFICATION_FIELDS) {
    const category = CLARIFICATION_FIELD_CATEGORY[field]
    assert.exists(category, `field ${field} 缺少显式类别映射`)
    assert.notEqual(category, 'deliverable', `${field} 不应被误分类为 deliverable`)
  }
  assert.lengthOf(Object.keys(CLARIFICATION_FIELD_CATEGORY), CLARIFICATION_FIELDS.length)
})

test('选项内部值转换为人类可读文本（scrum→Scrum、weekly→每周）', ({ assert }) => {
  const context = structuredClone(INTERNAL_TICKET_QUALITY_CONTEXT)
  const marker = context.resolvedFields.projectGoal!.marker
  context.resolvedFields.methodology = { value: 'scrum', marker }
  context.resolvedFields.communicationFreq = { value: 'weekly', marker }
  const manifest = buildGroundingManifest(context)
  assert.isTrue(manifest.facts.some((fact) => fact.normalizedValue === 'Scrum'))
  assert.isTrue(manifest.facts.some((fact) => fact.normalizedValue === '每周'))
})
