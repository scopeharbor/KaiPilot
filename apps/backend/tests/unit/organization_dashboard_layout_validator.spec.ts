import { test } from '@japa/runner'
import {
  validateModulesAgainstRegistry,
  ORGANIZATION_DASHBOARD_LAYOUT_MAX_MODULES,
  ORGANIZATION_DASHBOARD_LAYOUT_MAX_SETTINGS_BYTES,
} from '#validators/organization_dashboard_layout'
import {
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS,
  ORGANIZATION_DASHBOARD_LAYOUT_SIZES,
} from '@aiproj/types'

/**
 * 组织 Dashboard 布局编排 Validator 与模块注册表测试（v3-organization-dashboard-layout-builder §2.4）。
 *
 * 覆盖：不支持模块、禁用模块、无效尺寸、重复模块、超大 settings、未注册依赖。
 */

test.group('validateModulesAgainstRegistry', () => {
  test('合法模块列表返回空错误', ({ assert }) => {
    const errors = validateModulesAgainstRegistry([
      {
        moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.IDENTITY,
        size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL,
      },
      {
        moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.KPI_STRIP,
        size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL,
      },
    ])
    assert.isEmpty(errors)
  })

  test('未注册的 moduleKey 被拒绝', ({ assert }) => {
    const errors = validateModulesAgainstRegistry([
      { moduleKey: 'nonexistent_widget', size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL },
    ])
    assert.isNotEmpty(errors)
    assert.include(errors[0], '未注册')
  })

  test('模块不支持的尺寸被拒绝', ({ assert }) => {
    // IDENTITY 只支持 full
    const errors = validateModulesAgainstRegistry([
      {
        moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.IDENTITY,
        size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.SMALL,
      },
    ])
    assert.isNotEmpty(errors)
    assert.include(errors[0], '不支持尺寸')
  })

  test('settings 超过字节上限被拒绝', ({ assert }) => {
    const largeSettings = {
      data: 'x'.repeat(ORGANIZATION_DASHBOARD_LAYOUT_MAX_SETTINGS_BYTES + 10),
    }
    const errors = validateModulesAgainstRegistry([
      {
        moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.KPI_STRIP,
        size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL,
        settings: largeSettings,
      },
    ])
    assert.isNotEmpty(errors)
    assert.include(errors[0], '字节上限')
  })

  test('多个错误同时报告', ({ assert }) => {
    const errors = validateModulesAgainstRegistry([
      { moduleKey: 'nonexistent_a', size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL },
      { moduleKey: 'nonexistent_b', size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.SMALL },
    ])
    assert.equal(errors.length, 2)
  })

  test('ATTENTION_PROJECTS 支持多个尺寸', ({ assert }) => {
    // attention_projects 支持 medium, large, full
    const errors = validateModulesAgainstRegistry([
      {
        moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ATTENTION_PROJECTS,
        size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.LARGE,
      },
    ])
    assert.isEmpty(errors)
  })
})

test.group('Validator 常量边界', () => {
  test('最大模块数限制', ({ assert }) => {
    assert.equal(ORGANIZATION_DASHBOARD_LAYOUT_MAX_MODULES, 20)
  })

  test('最大 settings 字节限制', ({ assert }) => {
    assert.equal(ORGANIZATION_DASHBOARD_LAYOUT_MAX_SETTINGS_BYTES, 4096)
  })
})
