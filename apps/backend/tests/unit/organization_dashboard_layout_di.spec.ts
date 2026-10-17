import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'

/**
 * 回归测试（个人/无组织账号修复）：
 * 组织 Dashboard 布局编排 Controller 依赖链必须能被容器完整构造——
 * 曾因 Service 缺少 @inject() 且依赖用 import type 引入，导致
 * `Cannot inject "[Function: Object]"`，所有用户访问 /organization 页面都 500。
 */
test.group('OrganizationDashboardLayout DI 可构造性回归', () => {
  test('容器能构造 OrganizationDashboardLayoutService 及其依赖链', async ({ assert }) => {
    const { default: OrganizationDashboardLayoutService } =
      await import('#services/organization_dashboard_layout_service')
    const service = await app.container.make(OrganizationDashboardLayoutService)
    assert.isObject(service)
    assert.property(service, 'getSystemDefault')
  })

  test('构造器依赖元数据指向具体类而非 Object', async ({ assert }) => {
    const { default: OrganizationDashboardLayoutService } =
      await import('#services/organization_dashboard_layout_service')
    const paramTypes = Reflect.getMetadata('design:paramtypes', OrganizationDashboardLayoutService)
    assert.isArray(paramTypes)
    assert.isTrue(
      paramTypes.every((t: unknown) => typeof t === 'function'),
      'paramtypes 必须是具体类（import type 会让它退化成 Object）',
    )
  })
})
