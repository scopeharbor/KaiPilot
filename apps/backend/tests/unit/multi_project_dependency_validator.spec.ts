// 跨项目依赖 CRUD Validator 测试
// 覆盖 multi_project_dependencies_controller 使用的全部 10 个校验器：
// 枚举白名单、必填、数值边界（positive/withoutDecimals/max/min）、
// 字符串长度上限、数组长度上限与 nullable/optional 语义。
//
// 纯 validator 层测试，不依赖数据库。

import { test } from '@japa/runner'
import {
  listMultiProjectDependenciesValidator,
  graphMultiProjectDependenciesValidator,
  createMultiProjectDependencyPreviewValidator,
  updateMultiProjectDependencyPreviewValidator,
  archiveMultiProjectDependencyPreviewValidator,
  restoreMultiProjectDependencyPreviewValidator,
  confirmMultiProjectDependencyValidator,
  impactAnalysisValidator,
  drillDownValidator,
  listSuggestionsValidator,
} from '../../app/validators/multi_project_dependency.js'

/** 构造超出 maxLength 的字符串。 */
function overLength(max: number): string {
  return 'x'.repeat(max + 1)
}

/** 创建预览的最小合法载荷：三个必填字段。 */
function minimalCreatePayload() {
  return {
    providerEndpointType: 'project',
    consumerEndpointType: 'task',
    category: 'deliverable',
  }
}

// ---------------------------------------------------------------------------
// 列表查询
// ---------------------------------------------------------------------------

test.group('MPD Validator — list', () => {
  test('空 body 通过（所有字段可选）', async ({ assert }) => {
    const result = await listMultiProjectDependenciesValidator.validate({})
    assert.isUndefined(result.page)
    assert.isUndefined(result.status)
  })

  test('合法全字段组合通过', async ({ assert }) => {
    const result = await listMultiProjectDependenciesValidator.validate({
      projectIds: [1, 2, 3],
      endpointType: 'milestone',
      category: 'technical',
      type: 'fs',
      status: ['active', 'at_risk'],
      riskLevel: 'high',
      sourceMode: 'ai_suggestion',
      freshness: 'stale',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      search: '接口联调',
      sort: '-createdAt',
      page: 2,
      perPage: 50,
    })
    assert.deepEqual(result.projectIds, [1, 2, 3])
    assert.deepEqual(result.status, ['active', 'at_risk'])
    assert.equal(result.perPage, 50)
  })

  test('perPage 边界 100 通过', async ({ assert }) => {
    const result = await listMultiProjectDependenciesValidator.validate({ perPage: 100 })
    assert.equal(result.perPage, 100)
  })

  test('perPage 超过 100 被拒绝', async ({ assert }) => {
    await assert.rejects(() => listMultiProjectDependenciesValidator.validate({ perPage: 101 }))
  })

  test('perPage 为 0 被拒绝（positive）', async ({ assert }) => {
    await assert.rejects(() => listMultiProjectDependenciesValidator.validate({ perPage: 0 }))
  })

  test('page 为 0 被拒绝（positive）', async ({ assert }) => {
    await assert.rejects(() => listMultiProjectDependenciesValidator.validate({ page: 0 }))
  })

  test('page 为小数被拒绝（withoutDecimals）', async ({ assert }) => {
    await assert.rejects(() => listMultiProjectDependenciesValidator.validate({ page: 1.5 }))
  })

  test('非法 endpointType 被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      listMultiProjectDependenciesValidator.validate({ endpointType: 'workspace' }),
    )
  })

  test('非法 category 被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      listMultiProjectDependenciesValidator.validate({ category: 'financial' }),
    )
  })

  test('非法 type 被拒绝', async ({ assert }) => {
    await assert.rejects(() => listMultiProjectDependenciesValidator.validate({ type: 'xx' }))
  })

  test('非法 riskLevel 被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      listMultiProjectDependenciesValidator.validate({ riskLevel: 'severe' }),
    )
  })

  test('非法 sourceMode 被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      listMultiProjectDependenciesValidator.validate({ sourceMode: 'imported' }),
    )
  })

  test('非法 freshness 被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      listMultiProjectDependenciesValidator.validate({ freshness: 'unknown' }),
    )
  })

  test('status 数组中混入非法值被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      listMultiProjectDependenciesValidator.validate({ status: ['active', 'deleted'] }),
    )
  })

  test('projectIds 含非正整数被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      listMultiProjectDependenciesValidator.validate({ projectIds: [1, 0] }),
    )
  })

  test('search 超过 200 字符被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      listMultiProjectDependenciesValidator.validate({ search: overLength(200) }),
    )
  })

  test('search 恰好 200 字符通过', async ({ assert }) => {
    const result = await listMultiProjectDependenciesValidator.validate({
      search: 'x'.repeat(200),
    })
    assert.lengthOf(result.search!, 200)
  })

  test('sort 超过 50 字符被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      listMultiProjectDependenciesValidator.validate({ sort: overLength(50) }),
    )
  })

  test('sort 不做字段白名单校验（任意字符串放行，排序安全由 Service 负责）', async ({ assert }) => {
    const result = await listMultiProjectDependenciesValidator.validate({
      sort: 'no_such_column',
    })
    assert.equal(result.sort, 'no_such_column')
  })
})

// ---------------------------------------------------------------------------
// 图谱查询
// ---------------------------------------------------------------------------

test.group('MPD Validator — graph', () => {
  /** graph 的四个必填字段。 */
  function minimalGraphPayload() {
    return { projectIds: [1], maxDepth: 3, nodeLimit: 500, edgeLimit: 1000 }
  }

  test('最小合法载荷通过', async ({ assert }) => {
    const result = await graphMultiProjectDependenciesValidator.validate(minimalGraphPayload())
    assert.deepEqual(result.projectIds, [1])
    assert.equal(result.maxDepth, 3)
  })

  test('projectIds 必填', async ({ assert }) => {
    const { projectIds, ...rest } = minimalGraphPayload()
    void projectIds
    await assert.rejects(() => graphMultiProjectDependenciesValidator.validate(rest))
  })

  test('projectIds 为空数组被拒绝（minLength 1）', async ({ assert }) => {
    await assert.rejects(() =>
      graphMultiProjectDependenciesValidator.validate({
        ...minimalGraphPayload(),
        projectIds: [],
      }),
    )
  })

  test('projectIds 超过 100 个被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      graphMultiProjectDependenciesValidator.validate({
        ...minimalGraphPayload(),
        projectIds: Array.from({ length: 101 }, (_, i) => i + 1),
      }),
    )
  })

  test('maxDepth 必填', async ({ assert }) => {
    const { maxDepth, ...rest } = minimalGraphPayload()
    void maxDepth
    await assert.rejects(() => graphMultiProjectDependenciesValidator.validate(rest))
  })

  test('maxDepth 超过 20 被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      graphMultiProjectDependenciesValidator.validate({
        ...minimalGraphPayload(),
        maxDepth: 21,
      }),
    )
  })

  test('nodeLimit 超过 2000 被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      graphMultiProjectDependenciesValidator.validate({
        ...minimalGraphPayload(),
        nodeLimit: 2001,
      }),
    )
  })

  test('edgeLimit 超过 5000 被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      graphMultiProjectDependenciesValidator.validate({
        ...minimalGraphPayload(),
        edgeLimit: 5001,
      }),
    )
  })

  test('三个上限取边界值均通过', async ({ assert }) => {
    const result = await graphMultiProjectDependenciesValidator.validate({
      projectIds: [1],
      maxDepth: 20,
      nodeLimit: 2000,
      edgeLimit: 5000,
    })
    assert.equal(result.maxDepth, 20)
    assert.equal(result.nodeLimit, 2000)
    assert.equal(result.edgeLimit, 5000)
  })

  test('非法 freshnessThreshold 被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      graphMultiProjectDependenciesValidator.validate({
        ...minimalGraphPayload(),
        freshnessThreshold: 'partial',
      }),
    )
  })

  test('freshnessThreshold 支持 all', async ({ assert }) => {
    const result = await graphMultiProjectDependenciesValidator.validate({
      ...minimalGraphPayload(),
      freshnessThreshold: 'all',
    })
    assert.equal(result.freshnessThreshold, 'all')
  })
})

// ---------------------------------------------------------------------------
// 创建预览
// ---------------------------------------------------------------------------

test.group('MPD Validator — create preview', () => {
  test('最小合法载荷通过（三个必填字段）', async ({ assert }) => {
    const result =
      await createMultiProjectDependencyPreviewValidator.validate(minimalCreatePayload())
    assert.equal(result.providerEndpointType, 'project')
    assert.equal(result.consumerEndpointType, 'task')
    assert.equal(result.category, 'deliverable')
    assert.isUndefined(result.type)
  })

  test('全部选填字段一并通过', async ({ assert }) => {
    const result = await createMultiProjectDependencyPreviewValidator.validate({
      ...minimalCreatePayload(),
      providerProjectId: 10,
      providerMilestoneId: null,
      providerExternalLabel: '外部供应商',
      providerExternalKey: 'ext-001',
      consumerTaskId: 22,
      consumerExternalLabel: null,
      type: 'ss',
      lagDays: -3,
      strength: 'soft',
      bufferDays: 0,
      riskLevel: 'medium',
      sourceMode: 'rule_suggestion',
    })
    assert.equal(result.providerProjectId, 10)
    assert.isNull(result.providerMilestoneId)
    assert.equal(result.lagDays, -3)
    assert.equal(result.bufferDays, 0)
  })

  test('缺少 providerEndpointType 被拒绝', async ({ assert }) => {
    const { providerEndpointType, ...rest } = minimalCreatePayload()
    void providerEndpointType
    await assert.rejects(() => createMultiProjectDependencyPreviewValidator.validate(rest))
  })

  test('缺少 consumerEndpointType 被拒绝', async ({ assert }) => {
    const { consumerEndpointType, ...rest } = minimalCreatePayload()
    void consumerEndpointType
    await assert.rejects(() => createMultiProjectDependencyPreviewValidator.validate(rest))
  })

  test('缺少 category 被拒绝', async ({ assert }) => {
    const { category, ...rest } = minimalCreatePayload()
    void category
    await assert.rejects(() => createMultiProjectDependencyPreviewValidator.validate(rest))
  })

  test('非法 providerEndpointType 被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      createMultiProjectDependencyPreviewValidator.validate({
        ...minimalCreatePayload(),
        providerEndpointType: 'epic',
      }),
    )
  })

  test('endpointType 支持 external', async ({ assert }) => {
    const result = await createMultiProjectDependencyPreviewValidator.validate({
      ...minimalCreatePayload(),
      providerEndpointType: 'external',
    })
    assert.equal(result.providerEndpointType, 'external')
  })

  test('非法 strength 被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      createMultiProjectDependencyPreviewValidator.validate({
        ...minimalCreatePayload(),
        strength: 'strong',
      }),
    )
  })

  test('bufferDays 为负被拒绝（min 0）', async ({ assert }) => {
    await assert.rejects(() =>
      createMultiProjectDependencyPreviewValidator.validate({
        ...minimalCreatePayload(),
        bufferDays: -1,
      }),
    )
  })

  test('lagDays 允许负数（无 min 约束，表示提前量）', async ({ assert }) => {
    const result = await createMultiProjectDependencyPreviewValidator.validate({
      ...minimalCreatePayload(),
      lagDays: -10,
    })
    assert.equal(result.lagDays, -10)
  })

  test('lagDays 为小数被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      createMultiProjectDependencyPreviewValidator.validate({
        ...minimalCreatePayload(),
        lagDays: 1.5,
      }),
    )
  })

  test('providerProjectId 为 0 被拒绝（positive）', async ({ assert }) => {
    await assert.rejects(() =>
      createMultiProjectDependencyPreviewValidator.validate({
        ...minimalCreatePayload(),
        providerProjectId: 0,
      }),
    )
  })

  test('providerExternalLabel 超过 255 字符被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      createMultiProjectDependencyPreviewValidator.validate({
        ...minimalCreatePayload(),
        providerExternalLabel: overLength(255),
      }),
    )
  })

  test('consumerExternalKey 允许显式 null', async ({ assert }) => {
    const result = await createMultiProjectDependencyPreviewValidator.validate({
      ...minimalCreatePayload(),
      consumerExternalKey: null,
    })
    assert.isNull(result.consumerExternalKey)
  })
})

// ---------------------------------------------------------------------------
// 更新预览
// ---------------------------------------------------------------------------

test.group('MPD Validator — update preview', () => {
  test('只传 dependencyId 通过（其余全选填）', async ({ assert }) => {
    const result = await updateMultiProjectDependencyPreviewValidator.validate({
      dependencyId: 7,
    })
    assert.equal(result.dependencyId, 7)
    assert.isUndefined(result.category)
  })

  test('缺少 dependencyId 被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      updateMultiProjectDependencyPreviewValidator.validate({ category: 'technical' }),
    )
  })

  test('空 body 被拒绝', async ({ assert }) => {
    await assert.rejects(() => updateMultiProjectDependencyPreviewValidator.validate({}))
  })

  test('dependencyId 为 0 被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      updateMultiProjectDependencyPreviewValidator.validate({ dependencyId: 0 }),
    )
  })

  test('部分字段更新通过', async ({ assert }) => {
    const result = await updateMultiProjectDependencyPreviewValidator.validate({
      dependencyId: 7,
      status: 'blocked',
      riskLevel: 'critical',
      ownerUserId: 42,
    })
    assert.equal(result.status, 'blocked')
    assert.equal(result.riskLevel, 'critical')
    assert.equal(result.ownerUserId, 42)
  })

  test('ownerUserId 允许显式 null（解除负责人）', async ({ assert }) => {
    const result = await updateMultiProjectDependencyPreviewValidator.validate({
      dependencyId: 7,
      ownerUserId: null,
    })
    assert.isNull(result.ownerUserId)
  })

  test('非法 status 被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      updateMultiProjectDependencyPreviewValidator.validate({
        dependencyId: 7,
        status: 'cancelled',
      }),
    )
  })

  test('status 支持 archived', async ({ assert }) => {
    const result = await updateMultiProjectDependencyPreviewValidator.validate({
      dependencyId: 7,
      status: 'archived',
    })
    assert.equal(result.status, 'archived')
  })

  test('bufferDays 为负被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      updateMultiProjectDependencyPreviewValidator.validate({
        dependencyId: 7,
        bufferDays: -1,
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// 归档 / 恢复预览（同形）
// ---------------------------------------------------------------------------

test.group('MPD Validator — archive / restore preview', () => {
  test('archive：合法 dependencyId 通过', async ({ assert }) => {
    const result = await archiveMultiProjectDependencyPreviewValidator.validate({
      dependencyId: 5,
    })
    assert.equal(result.dependencyId, 5)
  })

  test('archive：缺少 dependencyId 被拒绝', async ({ assert }) => {
    await assert.rejects(() => archiveMultiProjectDependencyPreviewValidator.validate({}))
  })

  test('archive：dependencyId 为负被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      archiveMultiProjectDependencyPreviewValidator.validate({ dependencyId: -1 }),
    )
  })

  test('restore：合法 dependencyId 通过', async ({ assert }) => {
    const result = await restoreMultiProjectDependencyPreviewValidator.validate({
      dependencyId: 5,
    })
    assert.equal(result.dependencyId, 5)
  })

  test('restore：缺少 dependencyId 被拒绝', async ({ assert }) => {
    await assert.rejects(() => restoreMultiProjectDependencyPreviewValidator.validate({}))
  })

  test('restore：dependencyId 为小数被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      restoreMultiProjectDependencyPreviewValidator.validate({ dependencyId: 2.5 }),
    )
  })
})

// ---------------------------------------------------------------------------
// 确认（通用）
// ---------------------------------------------------------------------------

test.group('MPD Validator — confirm', () => {
  /** confirm 的三个必填字段。 */
  function confirmPayload() {
    return {
      previewId: 'mpdp-0001',
      confirmationHash: 'a'.repeat(64),
      idempotencyKey: 'idem-0001',
    }
  }

  test('三字段齐全通过', async ({ assert }) => {
    const result = await confirmMultiProjectDependencyValidator.validate(confirmPayload())
    assert.equal(result.previewId, 'mpdp-0001')
    assert.lengthOf(result.confirmationHash, 64)
  })

  test('缺少 previewId 被拒绝', async ({ assert }) => {
    const { previewId, ...rest } = confirmPayload()
    void previewId
    await assert.rejects(() => confirmMultiProjectDependencyValidator.validate(rest))
  })

  test('缺少 confirmationHash 被拒绝', async ({ assert }) => {
    const { confirmationHash, ...rest } = confirmPayload()
    void confirmationHash
    await assert.rejects(() => confirmMultiProjectDependencyValidator.validate(rest))
  })

  test('缺少 idempotencyKey 被拒绝', async ({ assert }) => {
    const { idempotencyKey, ...rest } = confirmPayload()
    void idempotencyKey
    await assert.rejects(() => confirmMultiProjectDependencyValidator.validate(rest))
  })

  test('confirmationHash 超过 64 字符被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      confirmMultiProjectDependencyValidator.validate({
        ...confirmPayload(),
        confirmationHash: overLength(64),
      }),
    )
  })

  test('idempotencyKey 超过 64 字符被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      confirmMultiProjectDependencyValidator.validate({
        ...confirmPayload(),
        idempotencyKey: overLength(64),
      }),
    )
  })

  test('空 body 被拒绝', async ({ assert }) => {
    await assert.rejects(() => confirmMultiProjectDependencyValidator.validate({}))
  })
})

// ---------------------------------------------------------------------------
// 影响分析
// ---------------------------------------------------------------------------

test.group('MPD Validator — impact analysis', () => {
  /** 影响分析的三个必填字段。 */
  function impactPayload() {
    return { sourceType: 'endpoint', maxDepth: 5, edgeLimit: 1000 }
  }

  test('最小合法载荷通过', async ({ assert }) => {
    const result = await impactAnalysisValidator.validate(impactPayload())
    assert.equal(result.sourceType, 'endpoint')
    assert.isUndefined(result.sourceEndpoint)
  })

  test('带 sourceEndpoint 嵌套对象通过', async ({ assert }) => {
    const result = await impactAnalysisValidator.validate({
      ...impactPayload(),
      sourceEndpoint: {
        endpointType: 'task',
        projectId: 3,
        taskId: 88,
        milestoneId: null,
        externalKey: null,
      },
    })
    assert.equal(result.sourceEndpoint?.endpointType, 'task')
    assert.equal(result.sourceEndpoint?.taskId, 88)
    assert.isNull(result.sourceEndpoint?.milestoneId)
  })

  test('sourceEndpoint 内非法 endpointType 被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      impactAnalysisValidator.validate({
        ...impactPayload(),
        sourceEndpoint: { endpointType: 'sprint' },
      }),
    )
  })

  test('sourceType 支持 hypothetical 并携带假设参数', async ({ assert }) => {
    const result = await impactAnalysisValidator.validate({
      ...impactPayload(),
      sourceType: 'hypothetical',
      hypotheticalDelayDays: 7,
      hypotheticalDescription: '供应商延期',
      includeLocalContext: true,
    })
    assert.equal(result.sourceType, 'hypothetical')
    assert.equal(result.hypotheticalDelayDays, 7)
    assert.isTrue(result.includeLocalContext)
  })

  test('非法 sourceType 被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      impactAnalysisValidator.validate({ ...impactPayload(), sourceType: 'guess' }),
    )
  })

  test('sourceType 必填', async ({ assert }) => {
    const { sourceType, ...rest } = impactPayload()
    void sourceType
    await assert.rejects(() => impactAnalysisValidator.validate(rest))
  })

  test('maxDepth 超过 20 被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      impactAnalysisValidator.validate({ ...impactPayload(), maxDepth: 21 }),
    )
  })

  test('edgeLimit 超过 5000 被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      impactAnalysisValidator.validate({ ...impactPayload(), edgeLimit: 5001 }),
    )
  })

  test('hypotheticalDelayDays 为 0 被拒绝（positive）', async ({ assert }) => {
    await assert.rejects(() =>
      impactAnalysisValidator.validate({ ...impactPayload(), hypotheticalDelayDays: 0 }),
    )
  })

  test('hypotheticalDescription 超过 500 字符被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      impactAnalysisValidator.validate({
        ...impactPayload(),
        hypotheticalDescription: overLength(500),
      }),
    )
  })

  test('projectIds 超过 100 个被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      impactAnalysisValidator.validate({
        ...impactPayload(),
        projectIds: Array.from({ length: 101 }, (_, i) => i + 1),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// 下钻
// ---------------------------------------------------------------------------

test.group('MPD Validator — drill down', () => {
  /** 下钻的三个必填字段。 */
  function drillPayload() {
    return { opaqueToken: 'tok-abc', refType: 'task', targetId: 9 }
  }

  test('三字段齐全通过', async ({ assert }) => {
    const result = await drillDownValidator.validate(drillPayload())
    assert.equal(result.opaqueToken, 'tok-abc')
    assert.equal(result.targetId, 9)
  })

  test('缺少 opaqueToken 被拒绝', async ({ assert }) => {
    const { opaqueToken, ...rest } = drillPayload()
    void opaqueToken
    await assert.rejects(() => drillDownValidator.validate(rest))
  })

  test('opaqueToken 超过 128 字符被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      drillDownValidator.validate({ ...drillPayload(), opaqueToken: overLength(128) }),
    )
  })

  test('refType 超过 20 字符被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      drillDownValidator.validate({ ...drillPayload(), refType: overLength(20) }),
    )
  })

  test('targetId 为 0 被拒绝', async ({ assert }) => {
    await assert.rejects(() => drillDownValidator.validate({ ...drillPayload(), targetId: 0 }))
  })

  test('refType 不做枚举白名单（任意短字符串放行）', async ({ assert }) => {
    const result = await drillDownValidator.validate({ ...drillPayload(), refType: 'whatever' })
    assert.equal(result.refType, 'whatever')
  })
})

// ---------------------------------------------------------------------------
// 建议列表
// ---------------------------------------------------------------------------

test.group('MPD Validator — list suggestions', () => {
  test('空 body 通过（全字段可选）', async ({ assert }) => {
    const result = await listSuggestionsValidator.validate({})
    assert.isUndefined(result.suggestionType)
  })

  test('合法组合通过', async ({ assert }) => {
    const result = await listSuggestionsValidator.validate({
      suggestionType: 'ai',
      status: 'pending',
      page: 1,
      perPage: 20,
    })
    assert.equal(result.suggestionType, 'ai')
    assert.equal(result.status, 'pending')
  })

  test('非法 suggestionType 被拒绝', async ({ assert }) => {
    await assert.rejects(() => listSuggestionsValidator.validate({ suggestionType: 'manual' }))
  })

  test('非法 status 被拒绝', async ({ assert }) => {
    await assert.rejects(() => listSuggestionsValidator.validate({ status: 'archived' }))
  })

  test('四个合法 status 全部放行', async ({ assert }) => {
    for (const status of ['pending', 'accepted', 'dismissed', 'expired']) {
      const result = await listSuggestionsValidator.validate({ status })
      assert.equal(result.status, status)
    }
  })

  test('perPage 超过 100 被拒绝', async ({ assert }) => {
    await assert.rejects(() => listSuggestionsValidator.validate({ perPage: 101 }))
  })
})
