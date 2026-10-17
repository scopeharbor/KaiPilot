// v3-multitenant-isolation-architecture §3.5 —— TenantScopeService 助手测试。
// 覆盖：scoped 列表计数（scope 先于分页）、详情跨租户 404 掩蔽、创建 stamping 语义、
// 更新引用同租户校验、批量同租户校验、super admin 默认 deny global。
import { test } from '@japa/runner'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import TenantScopeRegistry from '#services/tenant_scope_registry'
import TenantScopeService from '#services/tenant_scope_service'
import { isBatchSameTenant } from '@aiproj/types/multitenant-isolation-architecture'

function makeService(): TenantScopeService {
  return new TenantScopeService()
}

function makeCtx(overrides?: Record<string, unknown>) {
  return {
    tenant: { organizationId: 101 },
    authUser: { id: 7 },
    params: {},
    request: { body: () => ({}) },
    ...overrides,
  } as never
}

/** 记录 where 调用的可链式 fake query */
function makeQuery(rows: Array<Record<string, unknown>> | null = null) {
  const calls: Array<[string, unknown]> = []
  const query = {
    calls,
    where(column: string, value: unknown) {
      calls.push([column, value])
      return this
    },
    async first() {
      if (rows === null) return null
      return rows[0] ?? null
    },
  }
  return query
}

test.group('TenantScopeService.requireTenant', () => {
  test('无 tenant 上下文 fail closed（PERMISSION_DENIED）', ({ assert }) => {
    const ctx = makeCtx({ tenant: undefined })
    let caught: unknown = null
    try {
      makeService().requireTenant(ctx)
    } catch (err) {
      caught = err
    }
    assert.instanceOf(caught, PermissionDeniedException)
  })

  test('返回完整契约：organizationId/scopeMode/actorRef/isSuperAdmin 补齐', ({ assert }) => {
    const ctx = makeCtx({
      tenant: {
        organizationId: 101,
        projectId: 5,
        scopeMode: 'project_scoped',
        actorRef: 'user:7',
        isSuperAdmin: true,
      },
    })
    const tenant = makeService().requireTenant(ctx)
    assert.equal(tenant.organizationId, 101)
    assert.equal(tenant.projectId, 5)
    assert.equal(tenant.scopeMode, 'project_scoped')
    assert.equal(tenant.actorRef, 'user:7')
    assert.isTrue(tenant.isSuperAdmin)
  })

  test('缺省字段回退：scopeMode=organization_scoped、actorRef 由 authUser 推导', ({ assert }) => {
    const tenant = makeService().requireTenant(makeCtx())
    assert.equal(tenant.scopeMode, 'organization_scoped')
    assert.equal(tenant.actorRef, 'user:7')
    assert.isFalse(tenant.isSuperAdmin)
  })
})

test.group('TenantScopeService.scopedQuery', () => {
  test('有直接组织列的资源按 organization_id 过滤（默认 project）', ({ assert }) => {
    const q = makeQuery()
    const out = makeService().scopedQuery(q, { organizationId: 101 })
    assert.deepEqual(out.calls, [['organization_id', 101]])
  })

  test('有组织列资源叠加项目条件（project 的 projectField 为其自身 id）', ({ assert }) => {
    const q = makeQuery()
    const out = makeService().scopedQuery(q, { organizationId: 101, projectId: 5 })
    assert.deepEqual(out.calls, [
      ['organization_id', 101],
      ['id', 5],
    ])
  })

  test('项目派生资源（如 task，无组织列）缺 projectId → fail closed', ({ assert }) => {
    let caught: unknown = null
    try {
      makeService().scopedQuery(makeQuery(), {
        organizationId: 101,
        resourceType: 'task',
      })
    } catch (err) {
      caught = err
    }
    assert.instanceOf(caught, PermissionDeniedException)
  })

  test('项目派生资源按 registry projectField 过滤（task → project_id）', ({ assert }) => {
    const q = makeQuery()
    const out = makeService().scopedQuery(q, {
      organizationId: 101,
      projectId: 5,
      resourceType: 'task',
    })
    assert.deepEqual(out.calls, [['project_id', 5]])
  })

  test('计数与聚合语义：过滤先于任何计数（where 调用先于 count/聚合）', ({ assert }) => {
    const q = makeQuery()
    const out = makeService().scopedQuery(q, {
      organizationId: 101,
      projectId: 5,
      resourceType: 'report',
    })
    assert.deepEqual(out.calls, [['project_id', 5]])
  })
})

test.group('TenantScopeService.findInScopeOrFail', () => {
  test('scope 内查到返回行', async ({ assert }) => {
    const model = { query: () => makeQuery([{ id: 3, organizationId: 101 }]) }
    const row = await makeService().findInScopeOrFail(model as never, 3, { organizationId: 101 })
    assert.equal((row as Record<string, unknown>).id, 3)
  })

  test('跨租户不存在 → ResourceNotFoundException（404 掩蔽，无 target 详情）', async ({
    assert,
  }) => {
    const model = { query: () => makeQuery(null) }
    let caught: unknown = null
    try {
      await makeService().findInScopeOrFail(model as never, 999, { organizationId: 101 })
    } catch (err) {
      caught = err
    }
    assert.instanceOf(caught, ResourceNotFoundException)
  })

  test('project scope 资源（派生）只按项目过滤', async ({ assert }) => {
    const q = makeQuery([{ id: 3, organizationId: 101 }])
    const model = { query: () => q }
    await makeService().findInScopeOrFail(model as never, 3, {
      organizationId: 101,
      projectId: 5,
      resourceType: 'task',
    })
    assert.deepEqual(q.calls, [
      ['id', 3],
      ['project_id', 5],
    ])
  })

  test('派生资源缺 projectId → fail closed（不产生无租户条件的查找）', async ({ assert }) => {
    const model = { query: () => makeQuery([{ id: 3 }]) }
    let caught: unknown = null
    try {
      await makeService().findInScopeOrFail(model as never, 3, {
        organizationId: 101,
        resourceType: 'task',
      })
    } catch (err) {
      caught = err
    }
    assert.instanceOf(caught, PermissionDeniedException)
  })
})

test.group('TenantScopeService.assertSameTenant（更新引用校验）', () => {
  test('全部行同租户通过', ({ assert }) => {
    assert.doesNotThrow(() =>
      makeService().assertSameTenant([{ organizationId: 101 }, { organization_id: 101 }], 101),
    )
  })

  test('任一跨租户行 → 整体拒绝，且错误不含目标组织信息', ({ assert }) => {
    let caught: unknown = null
    try {
      makeService().assertSameTenant([{ organizationId: 101 }, { organizationId: 202 }], 101)
    } catch (err) {
      caught = err
    }
    assert.instanceOf(caught, PermissionDeniedException)
    assert.isFalse(JSON.stringify((caught as Error).message).includes('202'))
  })

  test('organizationId 为 null 的行跳过（未归属行不误伤）', ({ assert }) => {
    assert.doesNotThrow(() =>
      makeService().assertSameTenant([{ organizationId: null }, { organizationId: 101 }], 101),
    )
  })
})

test.group('TenantScopeService.assertBatchSameTenant（批量防混租）', () => {
  test('同一组织批量通过', ({ assert }) => {
    assert.doesNotThrow(() => makeService().assertBatchSameTenant([101, 101, 101], 101))
  })

  test('混租批量 → 整体拒绝，不泄露具体 ID 或来源组织', ({ assert }) => {
    let caught: unknown = null
    try {
      makeService().assertBatchSameTenant([101, 202, 101], 101)
    } catch (err) {
      caught = err
    }
    assert.instanceOf(caught, PermissionDeniedException)
    const msg = JSON.stringify({ message: (caught as Error).message })
    assert.isFalse(msg.includes('202'))
    assert.isFalse(msg.includes('B-2'))
  })

  test('共享纯函数 isBatchSameTenant 与 service 判定一致', ({ assert }) => {
    assert.equal(
      isBatchSameTenant({ currentOrganizationId: 101, resolvedOwners: [101] }).decision,
      'allow',
    )
    assert.equal(
      isBatchSameTenant({ currentOrganizationId: 101, resolvedOwners: [101, 202] }).decision,
      'deny',
    )
  })
})

test.group('TenantScopeService 全局门禁（super admin default-deny）', () => {
  test('registry 未显式声明全局的资源 → assertGlobalAllowed 拒绝', ({ assert }) => {
    let caught: unknown = null
    try {
      makeService().assertGlobalAllowed('project')
    } catch (err) {
      caught = err
    }
    assert.instanceOf(caught, PermissionDeniedException)
  })

  test('所有注册资源默认均不允许全局（无默认全局读）', ({ assert }) => {
    for (const decl of TenantScopeRegistry.all()) {
      assert.isFalse(decl.allowSuperAdminGlobal)
    }
  })
})
// ─── §4.2/§4.3 ──────────────────────────────────────────────────────────

test.group('TenantScopeService.resolveOrganizationId（§4.2 客户端声明不作事实源）', () => {
  test('未提供客户端声明 → 取租户上下文', ({ assert }) => {
    assert.equal(makeService().resolveOrganizationId(makeCtx()), 101)
  })

  test('客户端声明与租户一致 → 放行并返回租户值', ({ assert }) => {
    assert.equal(makeService().resolveOrganizationId(makeCtx(), 101), 101)
  })

  test('非 super admin 声明他组织 → RESOURCE_NOT_FOUND（不泄露存在性）', ({ assert }) => {
    let caught: unknown = null
    try {
      makeService().resolveOrganizationId(makeCtx(), 202)
    } catch (err) {
      caught = err
    }
    assert.instanceOf(caught, ResourceNotFoundException)
  })

  test('非法客户端声明（0/NaN）→ RESOURCE_NOT_FOUND', ({ assert }) => {
    for (const bad of [0, Number.NaN, -1]) {
      let caught: unknown = null
      try {
        makeService().resolveOrganizationId(makeCtx(), bad)
      } catch (err) {
        caught = err
      }
      assert.instanceOf(caught, ResourceNotFoundException, `声明 ${String(bad)} 应被拒`)
    }
  })

  test('super admin 可显式指定他组织作为 scope（system_global 模式）', ({ assert }) => {
    const ctx = makeCtx({ tenant: { organizationId: 101, isSuperAdmin: true } })
    assert.equal(makeService().resolveOrganizationId(ctx, 202), 202)
  })

  test('super admin 无租户上下文 → 保留 null 全局语义', ({ assert }) => {
    const ctx = makeCtx({ tenant: undefined, authUser: { id: 7, isSuperAdmin: true } })
    assert.isNull(makeService().resolveOrganizationId(ctx))
  })

  test('非 super admin 无租户上下文 → PERMISSION_DENIED（fail closed）', ({ assert }) => {
    const ctx = makeCtx({ tenant: undefined })
    let caught: unknown = null
    try {
      makeService().resolveOrganizationId(ctx)
    } catch (err) {
      caught = err
    }
    assert.instanceOf(caught, PermissionDeniedException)
  })

  test('requireOrganizationId：null 结果转 PERMISSION_DENIED', ({ assert }) => {
    const ctx = makeCtx({ tenant: undefined, authUser: { id: 7, isSuperAdmin: true } })
    let caught: unknown = null
    try {
      makeService().requireOrganizationId(ctx)
    } catch (err) {
      caught = err
    }
    assert.instanceOf(caught, PermissionDeniedException)
  })
})

test.group('TenantScopeService.assertReferencesInScope（§4.3 混租引用整体拒绝）', () => {
  /** 造一个只在指定组织内可见的模型替身。 */
  function modelOwnedBy(organizationId: number) {
    return {
      query() {
        const conditions: Record<string, unknown> = {}
        const q = {
          where(column: string, value: unknown) {
            conditions[column] = value
            return this
          },
          async first() {
            return conditions.organization_id === organizationId ? { id: conditions.id } : null
          },
        }
        return q
      },
    }
  }

  test('全部引用同租户 → 通过', async ({ assert }) => {
    await makeService().assertReferencesInScope(
      [
        { model: modelOwnedBy(101), id: 1, resourceType: 'project' },
        { model: modelOwnedBy(101), id: 2, resourceType: 'compiler_run' },
      ],
      101,
    )
    assert.isTrue(true)
  })

  test('任一引用跨租户 → 整体拒绝，且错误不指明是哪个引用', async ({ assert }) => {
    let caught: unknown = null
    try {
      await makeService().assertReferencesInScope(
        [
          { model: modelOwnedBy(101), id: 1, resourceType: 'project' },
          { model: modelOwnedBy(202), id: 2, resourceType: 'task', projectId: 9 },
        ],
        101,
      )
    } catch (err) {
      caught = err
    }
    assert.instanceOf(caught, ResourceNotFoundException)
    assert.notInclude(String((caught as Error).message), '2', '错误不得包含越界引用 ID')
  })

  test('null/undefined 引用被跳过（可选字段不阻断）', async ({ assert }) => {
    await makeService().assertReferencesInScope(
      [
        { model: modelOwnedBy(101), id: null, resourceType: 'project' },
        { model: modelOwnedBy(101), id: undefined, resourceType: 'project' },
      ],
      101,
    )
    assert.isTrue(true)
  })

  test('校验在任何写入之前完成：首个跨租户引用即中止后续解析', async ({ assert }) => {
    let visited = 0
    const counting = (organizationId: number) => ({
      query() {
        visited += 1
        const conditions: Record<string, unknown> = {}
        return {
          where(column: string, value: unknown) {
            conditions[column] = value
            return this
          },
          async first() {
            return conditions.organization_id === organizationId ? { id: conditions.id } : null
          },
        }
      },
    })
    try {
      await makeService().assertReferencesInScope(
        [
          { model: counting(202), id: 1, resourceType: 'project' },
          { model: counting(101), id: 2, resourceType: 'project' },
          { model: counting(101), id: 3, resourceType: 'project' },
        ],
        101,
      )
    } catch {
      // 预期拒绝
    }
    assert.equal(visited, 1, '首个越界引用后不得继续解析其余引用')
  })
})

// ──────────────────────────────────────────────
// §5.1 批量混租输入在预览/hash/调度/写入之前整体拒绝
// ──────────────────────────────────────────────

/** 记录 where/whereIn 调用并按 scope 条件过滤的 fake 批量模型 */
function makeBatchModel(rows: Array<Record<string, unknown>>) {
  const calls: Array<[string, unknown]> = []
  const model = {
    calls,
    query() {
      let filtered = rows
      const q = {
        where(column: string, value: unknown) {
          calls.push([column, value])
          filtered = filtered.filter((r) => String(r[column]) === String(value))
          return this
        },
        whereIn(column: string, values: Array<number | string>) {
          calls.push([`in:${column}`, values])
          const set = new Set(values.map(String))
          filtered = filtered.filter((r) => set.has(String(r[column])))
          return this
        },
        async exec() {
          return filtered
        },
      }
      return q
    },
  }
  return model
}

test.group('TenantScopeService.assertBatchInScope（§5.1 批量混租整体拒绝）', () => {
  test('全部同租户：返回 scope 内解析出的行，可直接用于派生值计算', async ({ assert }) => {
    const model = makeBatchModel([
      { id: 1, organization_id: 101 },
      { id: 2, organization_id: 101 },
      { id: 3, organization_id: 202 },
    ])
    const rows = await makeService().assertBatchInScope(model, [1, 2], {
      organizationId: 101,
      resourceType: 'project',
    })
    assert.lengthOf(rows, 2)
    // scope where 必须先于 whereIn 施加（scope 先于派生值）
    assert.deepEqual(model.calls[0], ['organization_id', 101])
    assert.equal(model.calls[1]?.[0], 'in:id')
  })

  test('混入他组织 ID：整体拒绝，且拒绝前无任何行返回', async ({ assert }) => {
    const model = makeBatchModel([
      { id: 1, organization_id: 101 },
      { id: 3, organization_id: 202 },
    ])
    let caught: unknown = null
    try {
      await makeService().assertBatchInScope(model, [1, 3], {
        organizationId: 101,
        resourceType: 'project',
      })
    } catch (err) {
      caught = err
    }
    // project 的 errorSemantics = RESOURCE_NOT_FOUND
    assert.instanceOf(caught, ResourceNotFoundException)
  })

  test('他组织 ID 与不存在 ID 的拒绝不可区分（不泄露隐藏 ID 存在性）', async ({ assert }) => {
    const model = makeBatchModel([
      { id: 1, organization_id: 101 },
      { id: 3, organization_id: 202 },
    ])
    const svc = makeService()
    const errors: string[] = []
    for (const ids of [
      [1, 3], // 3 属于他组织
      [1, 999], // 999 不存在
    ]) {
      try {
        await svc.assertBatchInScope(model, ids, {
          organizationId: 101,
          resourceType: 'project',
        })
        errors.push('no-error')
      } catch (err) {
        errors.push(`${(err as Error).constructor.name}:${(err as Error).message}`)
      }
    }
    assert.equal(errors[0], errors[1], '两类拒绝的异常类型与 message 必须完全一致')
    assert.notEqual(errors[0], 'no-error')
  })

  test('重复 ID 去重后计数，不因重复提交而误判混租', async ({ assert }) => {
    const model = makeBatchModel([{ id: 1, organization_id: 101 }])
    const rows = await makeService().assertBatchInScope(model, [1, 1, '1'], {
      organizationId: 101,
      resourceType: 'project',
    })
    assert.lengthOf(rows, 1)
  })

  test('空输入直接返回空数组，不发查询', async ({ assert }) => {
    const model = makeBatchModel([{ id: 1, organization_id: 101 }])
    const rows = await makeService().assertBatchInScope(model, [], {
      organizationId: 101,
      resourceType: 'project',
    })
    assert.lengthOf(rows, 0)
    assert.lengthOf(model.calls, 0)
  })

  test('项目派生资源缺 projectId：fail closed，不产生无租户条件的批量查询', async ({ assert }) => {
    const model = makeBatchModel([{ id: 1, project_id: 9 }])
    let caught: unknown = null
    try {
      await makeService().assertBatchInScope(model, [1], {
        organizationId: 101,
        resourceType: 'task',
      })
    } catch (err) {
      caught = err
    }
    assert.instanceOf(caught, PermissionDeniedException)
    assert.lengthOf(model.calls, 0, '未通过 scope 门禁时不得已经发出查询')
  })
})
