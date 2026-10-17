/**
 * OKR Validator 测试（v3-okr-hierarchy-management tasks 4.2）。
 *
 * 覆盖：
 *   - 无效 scope、status、include、sort、page size、depth
 *   - date window 校验
 *   - measurement value 校验
 *   - evidence target 校验
 *   - 合法输入全通过
 *
 * 纯 validator 层测试，不依赖数据库。
 *
 * @aiproj/backend
 */

import { test } from '@japa/runner'
import {
  okrCycleCreateValidator,
  okrCycleUpdateValidator,
  okrObjectiveCreateValidator,
  okrObjectiveUpdateValidator,
  okrKeyResultCreateValidator,
  okrKeyResultUpdateValidator,
  okrProgressUpdateValidator,
  okrAlignmentCreateValidator,
  okrEvidenceLinkCreateValidator,
  okrAiDraftValidator,
  okrAiDraftConfirmationValidator,
  okrCycleListQueryValidator,
  okrObjectiveListQueryValidator,
  okrTreeQueryValidator,
  okrKeyResultListQueryValidator,
  okrEvidenceListQueryValidator,
} from '#validators/okr'

test.group('OKR Validators - Cycle', () => {
  test('合法 cycle create 通过', async () => {
    const payload = { title: '2026 Q3', startDate: '2026-07-01', endDate: '2026-09-30' }
    const result = await okrCycleCreateValidator.validate(payload)
    assertOk(result)
  })

  test('缺少 title 失败', async () => {
    await assertRejects(
      okrCycleCreateValidator.validate({ startDate: '2026-07-01', endDate: '2026-09-30' }),
    )
  })

  test('date 格式错误失败', async () => {
    await assertRejects(
      okrCycleCreateValidator.validate({
        title: 'Q3',
        startDate: '07-01-2026',
        endDate: '2026-09-30',
      }),
    )
  })

  test('无效 status 失败', async () => {
    await assertRejects(
      okrCycleCreateValidator.validate({
        title: 'Q3',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
        status: 'invalid_status',
      }),
    )
  })

  test('空 title 失败', async () => {
    await assertRejects(
      okrCycleCreateValidator.validate({
        title: '',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
      }),
    )
  })

  test('cycle update 部分字段可选', async () => {
    const result = await okrCycleUpdateValidator.validate({ title: 'Updated Q3' })
    assertOk(result)
  })
})

test.group('OKR Validators - Objective', () => {
  test('合法 objective create 通过', async () => {
    const result = await okrObjectiveCreateValidator.validate({
      scope: 'organization',
      title: '目标',
    })
    assertOk(result)
  })

  test('无效 scope 失败', async () => {
    await assertRejects(okrObjectiveCreateValidator.validate({ scope: 'invalid', title: 'test' }))
  })

  test('无效 status 失败', async () => {
    await assertRejects(
      okrObjectiveCreateValidator.validate({
        scope: 'organization',
        title: 'test',
        status: 'deleted',
      }),
    )
  })

  test('weight 超出范围 0-100 失败', async () => {
    await assertRejects(
      okrObjectiveCreateValidator.validate({ scope: 'organization', title: 'test', weight: 101 }),
    )
  })

  test('weight 负数失败', async () => {
    await assertRejects(
      okrObjectiveCreateValidator.validate({ scope: 'organization', title: 'test', weight: -1 }),
    )
  })

  test('合法 objective update 部分字段通过', async () => {
    const result = await okrObjectiveUpdateValidator.validate({ title: 'Updated', weight: 50 })
    assertOk(result)
  })

  test('date 格式错误失败', async () => {
    await assertRejects(
      okrObjectiveCreateValidator.validate({
        scope: 'organization',
        title: 'test',
        startDate: 'invalid',
      }),
    )
  })
})

test.group('OKR Validators - Key Result', () => {
  test('合法 KR create 通过', async () => {
    const result = await okrKeyResultCreateValidator.validate({
      objectiveId: 1,
      title: 'KR',
      measurementType: 'percent',
      baselineValue: 0,
      targetValue: 100,
    })
    assertOk(result)
  })

  test('无效 measurementType 失败', async () => {
    await assertRejects(
      okrKeyResultCreateValidator.validate({
        objectiveId: 1,
        title: 'KR',
        measurementType: 'invalid',
        baselineValue: 0,
        targetValue: 100,
      }),
    )
  })

  test('无效 confidence 失败', async () => {
    await assertRejects(
      okrKeyResultCreateValidator.validate({
        objectiveId: 1,
        title: 'KR',
        measurementType: 'percent',
        baselineValue: 0,
        targetValue: 100,
        confidence: 'critical',
      }),
    )
  })

  test('KR update 部分字段通过', async () => {
    const result = await okrKeyResultUpdateValidator.validate({
      title: 'Updated KR',
      currentValue: 50,
    })
    assertOk(result)
  })
})

test.group('OKR Validators - Progress', () => {
  test('合法 progress update 通过', async () => {
    const result = await okrProgressUpdateValidator.validate({ currentValue: 50 })
    assertOk(result)
  })

  test('缺少 currentValue 失败', async () => {
    await assertRejects(okrProgressUpdateValidator.validate({}))
  })

  test('无效 confidence 失败', async () => {
    await assertRejects(
      okrProgressUpdateValidator.validate({ currentValue: 50, confidence: 'unknown' }),
    )
  })
})

test.group('OKR Validators - Alignment', () => {
  test('合法 alignment 通过', async () => {
    const result = await okrAlignmentCreateValidator.validate({
      childObjectiveId: 1,
      parentObjectiveId: 2,
    })
    assertOk(result)
  })

  test('child 和 parent 相同也通过（validator 层不做业务校验）', async () => {
    const result = await okrAlignmentCreateValidator.validate({
      childObjectiveId: 1,
      parentObjectiveId: 1,
    })
    assertOk(result)
  })
})

test.group('OKR Validators - Evidence', () => {
  test('合法 evidence link 通过', async () => {
    const result = await okrEvidenceLinkCreateValidator.validate({
      targetType: 'objective',
      targetId: 1,
      sourceKind: 'project',
      sourceId: 1,
      summary: '证据摘要',
    })
    assertOk(result)
  })

  test('无效 targetType 失败', async () => {
    await assertRejects(
      okrEvidenceLinkCreateValidator.validate({
        targetType: 'invalid',
        targetId: 1,
        sourceKind: 'project',
        sourceId: 1,
        summary: '证据',
      }),
    )
  })

  test('无效 sourceKind 失败', async () => {
    await assertRejects(
      okrEvidenceLinkCreateValidator.validate({
        targetType: 'objective',
        targetId: 1,
        sourceKind: 'unknown',
        sourceId: 1,
        summary: '证据',
      }),
    )
  })

  test('空 summary 失败', async () => {
    await assertRejects(
      okrEvidenceLinkCreateValidator.validate({
        targetType: 'objective',
        targetId: 1,
        sourceKind: 'project',
        sourceId: 1,
        summary: '',
      }),
    )
  })
})

test.group('OKR Validators - AI Draft', () => {
  test('合法 AI draft 通过', async () => {
    const result = await okrAiDraftValidator.validate({ scope: 'organization' })
    assertOk(result)
  })

  test('无参数也通过', async () => {
    const result = await okrAiDraftValidator.validate({})
    assertOk(result)
  })

  test('无效 scope 失败', async () => {
    await assertRejects(okrAiDraftValidator.validate({ scope: 'invalid' }))
  })

  test('合法 confirmation 通过', async () => {
    const result = await okrAiDraftConfirmationValidator.validate({
      draftId: 'draft-123',
      accepted: [{ kind: 'objective', data: { title: 'test' } }],
    })
    assertOk(result)
  })

  test('confirmation 缺少 draftId 失败', async () => {
    await assertRejects(okrAiDraftConfirmationValidator.validate({ accepted: [] }))
  })

  test('confirmation 无效 kind 失败', async () => {
    await assertRejects(
      okrAiDraftConfirmationValidator.validate({
        draftId: 'x',
        accepted: [{ kind: 'invalid', data: {} }],
      }),
    )
  })
})

test.group('OKR Validators - Query', () => {
  test('合法 cycle list query 通过', async () => {
    const result = await okrCycleListQueryValidator.validate({ page: 1, perPage: 25 })
    assertOk(result)
  })

  test('无效 page 失败', async () => {
    await assertRejects(okrCycleListQueryValidator.validate({ page: 0 }))
  })

  test('超大 perPage 失败', async () => {
    await assertRejects(okrCycleListQueryValidator.validate({ perPage: 101 }))
  })

  test('无效 sort 失败', async () => {
    await assertRejects(okrObjectiveListQueryValidator.validate({ sort: 'invalid_sort' }))
  })

  test('合法 objective list query 通过', async () => {
    const result = await okrObjectiveListQueryValidator.validate({
      page: 1,
      perPage: 50,
      sort: 'createdAt',
      order: 'asc',
    })
    assertOk(result)
  })

  test('无效 include 失败', async () => {
    await assertRejects(okrObjectiveListQueryValidator.validate({ include: ['nonexistent'] }))
  })

  test('tree query depth 超出范围失败', async () => {
    await assertRejects(okrTreeQueryValidator.validate({ depth: 10 }))
  })

  test('tree query depth 为 0 失败', async () => {
    await assertRejects(okrTreeQueryValidator.validate({ depth: 0 }))
  })

  test('合法 tree query 通过', async () => {
    const result = await okrTreeQueryValidator.validate({
      depth: 3,
      scope: 'organization',
      status: 'active',
    })
    assertOk(result)
  })

  test('evidence list query 合法通过', async () => {
    const result = await okrEvidenceListQueryValidator.validate({
      targetType: 'objective',
      page: 1,
      perPage: 10,
    })
    assertOk(result)
  })

  test('KR list query 合法通过', async () => {
    const result = await okrKeyResultListQueryValidator.validate({
      objectiveId: 1,
      status: 'active',
      sort: 'progress',
      order: 'desc',
    })
    assertOk(result)
  })
})

// ─── Helpers ────────────────────────────────────────────────────────────

function assertOk(result: any) {
  // vine 验证通过返回已验证的值对象，不抛异常即成功
  if (!result || typeof result !== 'object') {
    throw new Error(`Expected valid result, got ${JSON.stringify(result)}`)
  }
}

async function assertRejects(promise: Promise<any>) {
  try {
    await promise
    throw new Error('Expected validation to reject, but it passed')
  } catch (err: any) {
    // 预期内——vine 验证失败会抛异常
    if (err.message === 'Expected validation to reject, but it passed') throw err
  }
}
