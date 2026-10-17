import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'

/**
 * 任务 7.2 — User 模型扩展字段读写、preferences JSON 序列化往返、is_active 默认 true。
 */
test.group('User 模型', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('preferences 以 JSON 对象读写往返', async ({ assert }) => {
    const user = new User()
    user.fullName = '测试用户'
    user.email = `pref-${Date.now()}@test.local`
    user.password = 'hashed-secret'
    user.preferences = { theme: 'dark', density: 'compact', lang: 'zh-CN' }
    await user.save()

    const fetched = await User.find(user.id)
    assert.isNotNull(fetched)
    assert.deepEqual(fetched!.preferences, { theme: 'dark', density: 'compact', lang: 'zh-CN' })
  })

  test('扩展字段默认值与可读写', async ({ assert }) => {
    const user = new User()
    user.email = `active-${Date.now()}@test.local`
    user.password = 'hashed-secret'
    await user.save()

    const fetched = await User.find(user.id)
    // SQLite 布尔以 0/1 整数存储（sec7.5 注 2），默认为真即 1
    assert.ok(fetched!.isActive, 'is_active 默认应为真')
    assert.equal(fetched!.authProvider, 'local', 'auth_provider 默认 local')
    assert.isNull(fetched!.emailVerifiedAt)
    assert.isNull(fetched!.providerId)
    assert.isNull(fetched!.deletedAt)
  })

  test('preferences 可更新并持久化', async ({ assert }) => {
    const user = new User()
    user.email = `up-${Date.now()}@test.local`
    user.password = 'hashed-secret'
    user.preferences = { theme: 'light' }
    await user.save()

    user.preferences = { theme: 'dark', tabs: ['a', 'b'] }
    await user.save()

    const fetched = await User.find(user.id)
    assert.deepEqual(fetched!.preferences, { theme: 'dark', tabs: ['a', 'b'] })
  })
})
