/**
 * v3-personal-edition-open-source-export §3.1 —— 个人版语义下的 Copilot 回合。
 *
 * 未注册企业 DLP 与水印实现时（个人版），回合正常完成：
 * - 不出现「DLP 判定不可用」的阻断；
 * - 不写任何 DLP 或水印记录。
 *
 * 私有仓库里这些记录表存在，用来证明「零写入」；个人版产物里表不存在，断言自动跳过。
 */
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { ProjectRoleName } from '#rbac'
import {
  registerEditionHooks,
  resetEditionHooksForTests,
  type EditionHooks,
} from '#services/edition/edition_registry'
import {
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

/** 企业版的 DLP 与水印记录表（私有仓库存在，个人版不存在）。 */
const ENTERPRISE_RECORD_TABLES = ['dlp_events', 'watermark_plans', 'watermark_events']

async function countRows(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of ENTERPRISE_RECORD_TABLES) {
    if (!(await db.connection().schema.hasTable(table))) continue
    const [row] = await db.from(table).count('* as total')
    counts[table] = Number(row.total)
  }
  return counts
}

test.group('Copilot 回合 —— 个人版扩展点默认实现', (group) => {
  useAuthDatabase(group)

  let previous: EditionHooks
  group.each.setup(() => {
    previous = resetEditionHooksForTests()
    return () => registerEditionHooks(previous)
  })

  test('未注册企业实现时回合正常完成，且不写 DLP 与水印记录', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('turn-personal') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: owner.email, password: STRONG_PASSWORD })
    login.assertStatus(200)
    const token = login.body().data.accessToken as string

    const before = await countRows()
    const res = await client
      .post('/api/v1/copilot/turns')
      .bearerToken(token)
      .json({
        sessionId: null,
        scope: 'project',
        attribution: { organizationId: org.id, projectId: project.id },
        text: '帮我看看这个项目当前的风险',
        mentions: [],
      })

    // DLP 阻断会返回 422 PERMISSION_DENIED（reason=unavailable）；个人版必须正常完成
    res.assertStatus(200)
    assert.isString(res.body().data.sessionId)
    assert.deepEqual(await countRows(), before)
  })
})
