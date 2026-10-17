import testUtils from '@adonisjs/core/services/test_utils'

/**
 * 单元/服务测试的最小应用装配。
 *
 * 只做数据库迁移（幂等），不引导 HTTP 层——用于纯 Service/Policy 测试。
 * 需要 HTTP client 的功能测试请用 `tests/functional/auth/_helpers.ts` 的
 * `useAuthDatabase(group)`（它额外做逐用例 truncate 与限流器清零）。
 */
export async function setupApp(): Promise<void> {
  await testUtils.db().migrate()
}
