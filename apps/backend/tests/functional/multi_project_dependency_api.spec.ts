/**
 * 跨项目依赖 API 功能测试
 * v3-multi-project-dependency-crud §7.3-7.4
 *
 * 认证走真实登录换 bearer token（全仓 112 个 functional spec 的既有范式）。
 * 不能用 `.loginAs()`：它签发的身份不带活动组织，`tenant_middleware` 于是
 * 按 NO_ACTIVE_ORGANIZATION 放行且不挂 `ctx.tenant`，每个用例都拿不到组织上下文。
 *
 * 端点一律用 `external` 类型：`resolveEndpoint` 对 external 直接返回，
 * 不需要预先播种 project/task。
 */
import Project from '#models/project'
import { test } from '@japa/runner'
import { createTestOrg, createTestUser, setupTest } from '../helpers/index.js'

/** `createTestUser` 固定使用的密码。 */
const STRONG_PASSWORD = 'Passw0rd!'

function base(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/multi-project-dependencies`
}

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

/** 合法的 preview-create 载荷（两端均为 external，免播种）。 */
function previewPayload(suffix: string) {
  return {
    providerEndpointType: 'external',
    providerExternalKey: `ext-provider-${suffix}`,
    providerExternalLabel: `外部供应方-${suffix}`,
    consumerEndpointType: 'external',
    consumerExternalKey: `ext-consumer-${suffix}`,
    consumerExternalLabel: `外部消费方-${suffix}`,
    category: 'deliverable',
    type: 'fs',
  }
}

/**
 * 跨项目载荷：provider 与 consumer 落在**不同项目**。
 *
 * 不能两端都用 external：`detectCrossProjectCycle` 的图键只到项目级
 * （`${endpointType}:${projectId}`），两个 external 端点的 projectId 都是 null，
 * pKey 与 cKey 于是相同，`hasPath` 的 `from === to` 立即判定成环 →
 * confirm 被 "将形成循环依赖，无法创建" 拒绝。同一项目内的两个 task 端点同理。
 * 这是既存缺陷（`buildEndpointNodeId` 已正确纳入 externalKey，环检测却没用它），
 * 已单独上报；此处用真实跨项目端点绕开，以覆盖 confirm 的正常写入路径。
 */
function crossProjectPayload(providerProjectId: number, consumerProjectId: number) {
  return {
    providerEndpointType: 'project',
    providerProjectId,
    consumerEndpointType: 'project',
    consumerProjectId,
    category: 'deliverable',
    type: 'fs',
  }
}

test.group('Multi-Project Dependency API', (group) => {
  let org: any
  let pmoUser: any
  let observerUser: any
  let outsiderUser: any
  let projectA: any
  let projectB: any

  group.each.setup(async () => {
    // 门禁中间件读 process.env.FEATURE_MPD_CRUD（不是 env 服务），测试环境默认未开，
    // 不开则每个用例都撞 FeatureDisabledException。改的是进程级全局，必须还原——
    // 且还原只能靠 setup 返回 cleanup，在 setup 内部调 group.each.teardown() 不会执行。
    const previousFeatureFlag = process.env.FEATURE_MPD_CRUD
    process.env.FEATURE_MPD_CRUD = 'true'

    const s = await setupTest()
    org = await createTestOrg(s.db)
    // 'pmo' 经 ROLE_ALIAS 映射为组织 admin，满足 policy.authorizeManage 的 isOrgAdmin 要求
    pmoUser = await createTestUser(s.db, org, { role: 'pmo' })
    observerUser = await createTestUser(s.db, org, { role: 'observer' })
    outsiderUser = await createTestUser(s.db, null)

    projectA = await Project.create({
      organizationId: org.id,
      name: '跨项目依赖-上游',
      code: `MPDA${Date.now()}`,
      createdBy: pmoUser.id,
    })
    projectB = await Project.create({
      organizationId: org.id,
      name: '跨项目依赖-下游',
      code: `MPDB${Date.now()}`,
      createdBy: pmoUser.id,
    })

    return () => {
      if (previousFeatureFlag === undefined) delete process.env.FEATURE_MPD_CRUD
      else process.env.FEATURE_MPD_CRUD = previousFeatureFlag
    }
  })

  // ── 列表 ──

  test('GET / 返回分页信封（组织管理员）', async ({ assert, client }) => {
    const token = await login(client, pmoUser.email)
    const res = await client.get(base(org.id)).bearerToken(token)

    res.assertStatus(200)
    const body = res.body()
    assert.property(body, 'data')
    assert.property(body, 'meta')
    assert.isArray(body.data)
    for (const key of ['total', 'page', 'perPage', 'totalPages']) {
      assert.property(body.meta, key)
    }
  })

  test('GET / 观察者可读', async ({ assert, client }) => {
    const token = await login(client, observerUser.email)
    const res = await client.get(base(org.id)).bearerToken(token)

    // 读取不要求组织管理员；若策略收紧则为 403
    assert.include([200, 403], res.status())
  })

  test('GET / 无组织上下文的外部用户被拒（403 而非 500）', async ({ assert, client }) => {
    const token = await login(client, outsiderUser.email)
    const res = await client.get(base(org.id)).bearerToken(token)

    // controller.orgId 用 ctx.tenant?. + PermissionDeniedException，
    // 不再因 ctx.tenant! 的非空断言在运行期抛 TypeError → 500
    assert.notEqual(res.status(), 500)
    assert.include([403, 404], res.status())
  })

  test('GET / 未认证返回 401', async ({ client }) => {
    const res = await client.get(base(org.id))
    res.assertStatus(401)
  })

  // ── 创建预览 ──

  test('POST /preview-create 返回预览快照', async ({ assert, client }) => {
    const token = await login(client, pmoUser.email)
    const res = await client
      .post(`${base(org.id)}/preview-create`)
      .bearerToken(token)
      .json(previewPayload('a'))

    res.assertStatus(200)
    const data = res.body().data
    assert.property(data, 'previewId')
    assert.property(data, 'confirmationHash')
    assert.property(data, 'expiresAt')
  })

  test('POST /preview-create 拒绝非组织管理员', async ({ assert, client }) => {
    const token = await login(client, observerUser.email)
    const res = await client
      .post(`${base(org.id)}/preview-create`)
      .bearerToken(token)
      .json(previewPayload('b'))

    res.assertStatus(403)
    assert.equal(res.body().error.code, 'PERMISSION_DENIED')
  })

  test('POST /preview-create 校验失败返回 422', async ({ assert, client }) => {
    const token = await login(client, pmoUser.email)
    const res = await client
      .post(`${base(org.id)}/preview-create`)
      .bearerToken(token)
      .json({ providerEndpointType: 'external' }) // 缺 consumerEndpointType 与 category

    assert.equal(res.status(), 422)
  })

  // ── 确认（唯一落地的写入分支）──

  /**
   * confirm 的写入路径：端点取自预览落库的 `endpoints` 列
   * （迁移 1992000000000 加入）。此前该分支把端点写死为 1/101、2/201，
   * 无视用户输入并撞外键约束——本用例正是防其复发。
   */
  test('POST /confirm 用有效预览写入依赖并返回 201', async ({ assert, client }) => {
    const token = await login(client, pmoUser.email)
    const previewRes = await client
      .post(`${base(org.id)}/preview-create`)
      .bearerToken(token)
      .json(crossProjectPayload(projectA.id, projectB.id))
    previewRes.assertStatus(200)
    const preview = previewRes.body().data

    const res = await client
      .post(`${base(org.id)}/confirm`)
      .bearerToken(token)
      .json({
        previewId: preview.previewId,
        confirmationHash: preview.confirmationHash,
        idempotencyKey: preview.idempotencyKey,
      })

    res.assertStatus(201)
    assert.property(res.body(), 'data')
  })

  test('POST /confirm 拒绝不存在的预览', async ({ assert, client }) => {
    const token = await login(client, pmoUser.email)
    const res = await client
      .post(`${base(org.id)}/confirm`)
      .bearerToken(token)
      .json({
        previewId: 'mpdp-does-not-exist',
        confirmationHash: 'x'.repeat(32),
        idempotencyKey: 'idem-missing-preview',
      })

    assert.include([400, 404, 422], res.status())
  })

  test('POST /confirm 允许两端均为 external 的依赖（环检测不再误判）', async ({
    assert,
    client,
  }) => {
    // 缺陷回归：detectCrossProjectCycle 的节点键原为 `${endpointType}:${projectId}`，
    // 两个 external 端点 projectId 均为 null → 键相同 → hasPath 的 from === to
    // 立即判定成环，任何一端为 external 的依赖都建不成。
    const token = await login(client, pmoUser.email)
    const previewRes = await client
      .post(`${base(org.id)}/preview-create`)
      .bearerToken(token)
      .json(previewPayload('ext-pair'))
    previewRes.assertStatus(200)
    const preview = previewRes.body().data

    assert.isFalse(preview.cycleCheck.wouldCreateCycle, '两个不同的外部端点之间不应判定成环')
    assert.notInclude(preview.warningCodes, 'DEPENDENCY_CYCLE_BLOCKED')

    const res = await client
      .post(`${base(org.id)}/confirm`)
      .bearerToken(token)
      .json({
        previewId: preview.previewId,
        confirmationHash: preview.confirmationHash,
        idempotencyKey: preview.idempotencyKey,
      })

    res.assertStatus(201)
    // 端点如实落库，不再是占位的 1/101、2/201
    const dep = res.body().data
    assert.equal(dep.providerEndpoint.endpointType, 'external')
    assert.equal(dep.consumerEndpoint.endpointType, 'external')
  })

  test('POST /preview-create 仍然拒绝真实的跨项目环', async ({ assert, client }) => {
    // 语义守卫：规范把环定义在项目粒度（P1→P2、P2→P3，新建 P3→P1 判为环）。
    // 修复节点键时不得把这条一并放开。此处用最短的环：A→B 已存在，再建 B→A。
    const token = await login(client, pmoUser.email)

    const firstPreview = await client
      .post(`${base(org.id)}/preview-create`)
      .bearerToken(token)
      .json(crossProjectPayload(projectA.id, projectB.id))
    firstPreview.assertStatus(200)
    const p1 = firstPreview.body().data
    const created = await client
      .post(`${base(org.id)}/confirm`)
      .bearerToken(token)
      .json({
        previewId: p1.previewId,
        confirmationHash: p1.confirmationHash,
        idempotencyKey: p1.idempotencyKey,
      })
    created.assertStatus(201)

    // 反向边应被判定成环
    const reverse = await client
      .post(`${base(org.id)}/preview-create`)
      .bearerToken(token)
      .json(crossProjectPayload(projectB.id, projectA.id))
    reverse.assertStatus(200)
    assert.isTrue(reverse.body().data.cycleCheck.wouldCreateCycle, 'B→A 应判定成环')
    assert.include(reverse.body().data.warningCodes, 'DEPENDENCY_CYCLE_BLOCKED')
  })

  // ── 生命周期分支的 HTTP 端到端 ──
  //
  // 这九个端点曾统一返回 501（service 未实现 update/archive/restore/delete）。
  // 现已落地，改为验证真实语义。

  /** 经 preview-create → confirm 造一条活跃依赖，返回其 id。 */
  async function seedDependency(client: any, token: string, suffix: string): Promise<number> {
    const preview = await client
      .post(`${base(org.id)}/preview-create`)
      .bearerToken(token)
      .json(previewPayload(suffix))
    preview.assertStatus(200)
    const p = preview.body().data
    const confirmed = await client
      .post(`${base(org.id)}/confirm`)
      .bearerToken(token)
      .json({
        previewId: p.previewId,
        confirmationHash: p.confirmationHash,
        idempotencyKey: p.idempotencyKey,
      })
    confirmed.assertStatus(201)
    return confirmed.body().data.id
  }

  /** preview → confirm 一次生命周期操作。 */
  async function lifecycle(
    client: any,
    token: string,
    previewPath: string,
    confirmPath: string,
    body: Record<string, unknown>,
  ) {
    const preview = await client
      .post(`${base(org.id)}/${previewPath}`)
      .bearerToken(token)
      .json(body)
    preview.assertStatus(200)
    const p = preview.body().data
    const confirmed = await client
      .post(`${base(org.id)}/${confirmPath}`)
      .bearerToken(token)
      .json({
        previewId: p.previewId,
        confirmationHash: p.confirmationHash,
        idempotencyKey: p.idempotencyKey,
      })
    return { preview: p, confirmed }
  }

  test('preview-update / confirm-update 落库变更字段', async ({ assert, client }) => {
    const token = await login(client, pmoUser.email)
    const id = await seedDependency(client, token, 'http-upd')

    const { preview, confirmed } = await lifecycle(
      client,
      token,
      'preview-update',
      'confirm-update',
      { dependencyId: id, riskLevel: 'high' },
    )

    assert.deepEqual(preview.diff.changedFields, ['riskLevel'])
    confirmed.assertStatus(201)
    assert.equal(confirmed.body().data.riskLevel, 'high')
  })

  test('preview-archive / confirm-archive 转归档且保留行', async ({ assert, client }) => {
    const token = await login(client, pmoUser.email)
    const id = await seedDependency(client, token, 'http-arc')

    const { confirmed } = await lifecycle(client, token, 'preview-archive', 'confirm-archive', {
      dependencyId: id,
    })
    confirmed.assertStatus(201)
    assert.equal(confirmed.body().data.status, 'archived')

    const detail = await client.get(`${base(org.id)}/${id}`).bearerToken(token)
    detail.assertStatus(200)
    assert.equal(detail.body().data.status, 'archived')
  })

  test('preview-restore / confirm-restore 转回活跃', async ({ assert, client }) => {
    const token = await login(client, pmoUser.email)
    const id = await seedDependency(client, token, 'http-res')
    await lifecycle(client, token, 'preview-archive', 'confirm-archive', { dependencyId: id })

    const { confirmed } = await lifecycle(client, token, 'preview-restore', 'confirm-restore', {
      dependencyId: id,
    })
    confirmed.assertStatus(201)
    assert.equal(confirmed.body().data.status, 'active')
  })

  test('preview-delete 对活跃依赖给出不可确认的预览', async ({ assert, client }) => {
    const token = await login(client, pmoUser.email)
    const id = await seedDependency(client, token, 'http-delact')

    const preview = await client
      .post(`${base(org.id)}/preview-delete`)
      .bearerToken(token)
      .json({ dependencyId: id })
    preview.assertStatus(200)
    // 预览如实给出「不可执行」而不是直接报错——两段式的意义在于先让用户看到判定
    assert.isFalse(preview.body().data.lifecycleCheck.isValid)

    const p = preview.body().data
    const confirmed = await client
      .post(`${base(org.id)}/confirm-delete`)
      .bearerToken(token)
      .json({
        previewId: p.previewId,
        confirmationHash: p.confirmationHash,
        idempotencyKey: p.idempotencyKey,
      })
    assert.include([400, 422], confirmed.status())
  })

  test('归档后 preview-delete / confirm-delete 移除依赖', async ({ assert, client }) => {
    const token = await login(client, pmoUser.email)
    const id = await seedDependency(client, token, 'http-del')
    await lifecycle(client, token, 'preview-archive', 'confirm-archive', { dependencyId: id })

    // 先确认删除前查得到——否则「删除后 404」会因详情端点本身坏掉而假通过
    const beforeDelete = await client.get(`${base(org.id)}/${id}`).bearerToken(token)
    beforeDelete.assertStatus(200)

    const { confirmed } = await lifecycle(client, token, 'preview-delete', 'confirm-delete', {
      dependencyId: id,
    })
    confirmed.assertStatus(201)

    const detail = await client.get(`${base(org.id)}/${id}`).bearerToken(token)
    assert.equal(detail.status(), 404, '删除后详情应 404')
  })

  test('confirm-* 端点拒绝操作不匹配的预览', async ({ assert, client }) => {
    const token = await login(client, pmoUser.email)
    const id = await seedDependency(client, token, 'http-mismatch')

    const preview = await client
      .post(`${base(org.id)}/preview-archive`)
      .bearerToken(token)
      .json({ dependencyId: id })
    preview.assertStatus(200)
    const p = preview.body().data

    // 拿 archive 预览走 confirm-delete：端点声明与预览操作不符，必须拒绝
    const res = await client
      .post(`${base(org.id)}/confirm-delete`)
      .bearerToken(token)
      .json({
        previewId: p.previewId,
        confirmationHash: p.confirmationHash,
        idempotencyKey: p.idempotencyKey,
      })
    assert.include([400, 422], res.status())
    assert.include(JSON.stringify(res.body()), '预览操作与端点不匹配')
  })

  test('confirm-create 端点与通用 confirm 等价', async ({ assert, client }) => {
    const token = await login(client, pmoUser.email)
    const preview = await client
      .post(`${base(org.id)}/preview-create`)
      .bearerToken(token)
      .json(previewPayload('http-cc'))
    preview.assertStatus(200)
    const p = preview.body().data

    const res = await client
      .post(`${base(org.id)}/confirm-create`)
      .bearerToken(token)
      .json({
        previewId: p.previewId,
        confirmationHash: p.confirmationHash,
        idempotencyKey: p.idempotencyKey,
      })
    res.assertStatus(201)
    assert.property(res.body().data, 'id')
  })

  // ── 查询参数契约（数组形态与静态段路由）──
  //
  // 本文件此前对 query 参数与 `/graph` 零覆盖。vine 的 array 规则不做字符串强制
  // 转换，裸单值 `?status=active` 到 validator 手上就是字符串 'active' → 422；
  // 重复键 `?status[]=active` 才稳定解析成真数组——前端序列化据此改为重复键。
  //
  // 注意：AdonisJS 的 qs 解析默认 `parse.comma = true`，多值逗号串也会被拆成数组，
  // 但单元素数组经逗号拼接后必然退化成裸字符串，故前端一律用重复键。
  //
  // `/graph` 与 `/suggestions` 另有一层前提：静态段路由必须声明在 `/:dependencyId`
  // 之前（见 start/routes.ts），否则被 show 吞掉（dependencyId='graph' → NaN）。

  test('GET / 数组形态 status[] 被接受且过滤生效', async ({ assert, client }) => {
    const token = await login(client, pmoUser.email)
    const seededId = await seedDependency(client, token, 'query-array')

    const active = await client.get(`${base(org.id)}?status[]=active`).bearerToken(token)
    active.assertStatus(200)
    assert.isArray(active.body().data)
    assert.lengthOf(active.body().data, 1)
    // 过滤真的落到 SQL，而不是被静默忽略——否则 200 只是假绿
    assert.equal(active.body().meta.total, 1)
    assert.equal(active.body().data[0].id, seededId)

    const draft = await client.get(`${base(org.id)}?status[]=draft`).bearerToken(token)
    draft.assertStatus(200)
    assert.equal(draft.body().meta.total, 0)

    // 多元素重复键（前端序列化多元素数组的产物）同样成立
    const both = await client
      .get(`${base(org.id)}?status[]=active&status[]=draft`)
      .bearerToken(token)
    both.assertStatus(200)
    assert.equal(both.body().meta.total, 1)
  })

  test('GET / 字符串形态 status 被 vine 拒绝为 422', async ({ assert, client }) => {
    const token = await login(client, pmoUser.email)

    // 单元素数组经逗号拼接后就是这个形态（裸值不是数组）→ 必 422。
    // 这是前端改重复键序列化前 buildQuery 的真实产物，本用例防其回退。
    const res = await client.get(`${base(org.id)}?status=active`).bearerToken(token)

    assert.equal(res.status(), 422)
    assert.equal(res.body().error.code, 'VALIDATION_ERROR')
  })

  test('GET /graph 真数组形态返回图谱结构', async ({ assert, client }) => {
    // 图谱只收 active/at_risk/blocked 且按 projectIds 过滤；external 两端的
    // projectId 均为 null、滤不出来，故用跨项目端点播种。
    const token = await login(client, pmoUser.email)
    const preview = await client
      .post(`${base(org.id)}/preview-create`)
      .bearerToken(token)
      .json(crossProjectPayload(projectA.id, projectB.id))
    preview.assertStatus(200)
    const p = preview.body().data
    const confirmed = await client
      .post(`${base(org.id)}/confirm`)
      .bearerToken(token)
      .json({
        previewId: p.previewId,
        confirmationHash: p.confirmationHash,
        idempotencyKey: p.idempotencyKey,
      })
    confirmed.assertStatus(201)
    const depId = confirmed.body().data.id

    const res = await client
      .get(
        `${base(org.id)}/graph?projectIds[]=${projectA.id}&projectIds[]=${projectB.id}` +
          `&maxDepth=3&nodeLimit=100&edgeLimit=200`,
      )
      .bearerToken(token)

    res.assertStatus(200)
    const graph = res.body().data
    assert.isArray(graph.nodes)
    assert.isArray(graph.edges)
    assert.equal(graph.visibleEdgeCount, 1)
    assert.equal(graph.visibleNodeCount, 2)
    assert.equal(graph.edges[0].edgeId, depId)
    assert.equal(graph.edges[0].status, 'active')
    assert.isFalse(graph.truncated)
    assert.equal(graph.truncationReason, null)
    assert.property(graph.freshnessMeta, 'checkedAt')
  })

  test('GET /suggestions 返回列表信封而非落 show', async ({ assert, client }) => {
    const token = await login(client, pmoUser.email)
    const res = await client.get(`${base(org.id)}/suggestions`).bearerToken(token)

    // 若被 `/:dependencyId` 吞掉，这里会是 show 的 404，不会是列表信封
    res.assertStatus(200)
    const body = res.body()
    assert.isArray(body.data)
    assert.property(body, 'meta')
    assert.equal(body.meta.total, body.data.length)
    for (const key of ['total', 'page', 'perPage', 'totalPages']) {
      assert.property(body.meta, key)
    }
  })

  // ── 特性开关 ──

  test('特性开关关闭时返回 503 FEATURE_DISABLED', async ({ assert, client }) => {
    const token = await login(client, pmoUser.email)
    const previous = process.env.FEATURE_MPD_CRUD
    process.env.FEATURE_MPD_CRUD = 'false'
    try {
      const res = await client.get(base(org.id)).bearerToken(token)
      assert.equal(res.status(), 503)
    } finally {
      if (previous === undefined) delete process.env.FEATURE_MPD_CRUD
      else process.env.FEATURE_MPD_CRUD = previous
    }
  })

  // ── 任务 1.6：dateFrom/dateTo 过滤与排序键防退化（§7-10 & §7-11）──

  test('GET / dateFrom 与 dateTo 对 created_at 真实生效（§7-10 方案 A）', async ({
    assert,
    client,
  }) => {
    const token = await login(client, pmoUser.email)
    const seededId = await seedDependency(client, token, 'date-filter')

    // 1. 命中区间（过去到未来）：应查出该记录
    const hitRes = await client
      .get(`${base(org.id)}?dateFrom=2020-01-01&dateTo=2099-12-31`)
      .bearerToken(token)
    hitRes.assertStatus(200)
    assert.isAtLeast(hitRes.body().meta.total, 1)
    const hitIds = hitRes.body().data.map((d: any) => d.id)
    assert.include(hitIds, seededId)

    // 2. 排除区间：dateFrom 设在遥远未来
    const futureRes = await client.get(`${base(org.id)}?dateFrom=2099-01-01`).bearerToken(token)
    futureRes.assertStatus(200)
    assert.equal(futureRes.body().meta.total, 0)

    // 3. 排除区间：dateTo 设在遥远过去
    const pastRes = await client.get(`${base(org.id)}?dateTo=2020-01-01`).bearerToken(token)
    pastRes.assertStatus(200)
    assert.equal(pastRes.body().meta.total, 0)
  })

  test('GET / sort=riskLevel 与 sort=-riskLevel 真实按 risk_level 排序（§7-11 防退化）', async ({
    assert,
    client,
  }) => {
    const token = await login(client, pmoUser.email)
    const projectC = await Project.create({
      organizationId: org.id,
      name: '跨项目依赖-C',
      code: `MPDC${Date.now()}`,
      createdBy: pmoUser.id,
    })
    const projectD = await Project.create({
      organizationId: org.id,
      name: '跨项目依赖-D',
      code: `MPDD${Date.now()}`,
      createdBy: pmoUser.id,
    })

    const preview1 = await client
      .post(`${base(org.id)}/preview-create`)
      .bearerToken(token)
      .json(crossProjectPayload(projectA.id, projectB.id))
    preview1.assertStatus(200)
    const p1 = preview1.body().data
    const conf1 = await client
      .post(`${base(org.id)}/confirm`)
      .bearerToken(token)
      .json({
        previewId: p1.previewId,
        confirmationHash: p1.confirmationHash,
        idempotencyKey: p1.idempotencyKey,
      })
    conf1.assertStatus(201)
    const idLow = conf1.body().data.id

    const preview2 = await client
      .post(`${base(org.id)}/preview-create`)
      .bearerToken(token)
      .json({ ...crossProjectPayload(projectC.id, projectD.id), category: 'technical' })
    preview2.assertStatus(200)
    const p2 = preview2.body().data
    const conf2 = await client
      .post(`${base(org.id)}/confirm`)
      .bearerToken(token)
      .json({
        previewId: p2.previewId,
        confirmationHash: p2.confirmationHash,
        idempotencyKey: p2.idempotencyKey,
      })
    conf2.assertStatus(201)
    const idHigh = conf2.body().data.id

    // 更新第二条的风险为 high
    await lifecycle(client, token, 'preview-update', 'confirm-update', {
      dependencyId: idHigh,
      riskLevel: 'high',
    })

    // 按 riskLevel 升序（'high' < 'low'）
    const ascRes = await client.get(`${base(org.id)}?sort=riskLevel`).bearerToken(token)
    ascRes.assertStatus(200)
    const ascItems = ascRes.body().data
    const highIdxAsc = ascItems.findIndex((d: any) => d.id === idHigh)
    const lowIdxAsc = ascItems.findIndex((d: any) => d.id === idLow)
    assert.isTrue(highIdxAsc !== -1 && lowIdxAsc !== -1)
    assert.isBelow(highIdxAsc, lowIdxAsc, '升序下 high 应排在 low 前面')

    // 按 riskLevel 降序（'low' 应排在 'high' 前面）
    const descRes = await client.get(`${base(org.id)}?sort=-riskLevel`).bearerToken(token)
    descRes.assertStatus(200)
    const descItems = descRes.body().data
    const highIdxDesc = descItems.findIndex((d: any) => d.id === idHigh)
    const lowIdxDesc = descItems.findIndex((d: any) => d.id === idLow)
    assert.isTrue(highIdxDesc !== -1 && lowIdxDesc !== -1)
    assert.isAbove(highIdxDesc, lowIdxDesc, '降序下 high 应排在 low 后面')

    // 兼容测试：sort=risk 与 sort=-risk 也不再退化
    const compatRes = await client.get(`${base(org.id)}?sort=-risk`).bearerToken(token)
    compatRes.assertStatus(200)
    const compatItems = compatRes.body().data
    const highIdxCompat = compatItems.findIndex((d: any) => d.id === idHigh)
    const lowIdxCompat = compatItems.findIndex((d: any) => d.id === idLow)
    assert.isAbove(highIdxCompat, lowIdxCompat, '兼容 sort=-risk 下 high 亦应排在 low 后面')
  })
})
