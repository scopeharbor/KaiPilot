import { test } from '@japa/runner'
import {
  createOrganization,
  createUser,
  orgBearer,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'
import db from '@adonisjs/lucid/services/db'

const rawQuery = (table: string) => db.from(table as any) as any

/**
 * v3-resource-gap-analysis 审计契约测试（§7.3 补充）。
 */
test.group('ResourceGapAnalysis — Audit Integrity', (group) => {
  useAuthDatabase(group)

  let owner: any
  let org: any

  group.each.setup(async () => {
    owner = await createUser({ email: uniqueEmail('aud-gap') })
    org = await createOrganization(owner)
  })

  test('多次只读查询不产生写入行的副作用', async ({ client, assert }) => {
    for (let i = 0; i < 10; i++) {
      await client
        .get(`/api/v1/organizations/${org.id}/resource-gaps/summary`)
        .header('Authorization', await orgBearer(owner, org.id))
    }

    const resources = await rawQuery('resources').count('* as cnt').first()
    const tasks = await rawQuery('tasks').count('* as cnt').first()

    assert.equal(resources.cnt, 0, '资源表应为空')
    assert.equal(tasks.cnt, 0, '任务表应为空')
  })

  test('认证用户才能访问（未认证返回 401）', async ({ client }) => {
    const res = await client.get(`/api/v1/organizations/${org.id}/resource-gaps/summary`)
    res.assertStatus(401)
  })

  test('空组织 summary 返回有效 meta 但 totalGaps=0', async ({ client, assert }) => {
    const res = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/summary`)
      .header('Authorization', await orgBearer(owner, org.id))
    res.assertStatus(200)
    assert.equal(res.body().data.totalGaps, 0)
    assert.isDefined(res.body().data.meta)
    assert.equal(res.body().data.meta.metricVersion, 'resource-gap-analysis@1')
  })
})
