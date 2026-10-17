/**
 * v3-plugin-action-preview-boundary —— host-owned adapter registry 单元测试（tasks 2.1/2.2）。
 *
 * 覆盖：host-core 合法登记、插件自带 adapter 拒绝、未知 kind 拒绝、
 * repository/model/SQL/URL 禁止声明拒绝、未登记 kind fail-closed（adapter-missing）。
 * 纯逻辑测试：不依赖数据库。
 */
import { test } from '@japa/runner'
import {
  PluginActionAdapterRegistry,
  ActionBoundaryError,
  type PluginActionHostAdapter,
} from '#services/plugin_action_boundary/adapter_registry'
import type { PluginActionKind } from '@aiproj/types'

function stubAdapter(overrides?: Partial<PluginActionHostAdapter>): PluginActionHostAdapter {
  return {
    descriptor: {
      actionKind: 'plugin.pilot.item.create' as PluginActionKind,
      owner: 'host-core',
      batchPolicy: 'per-item',
      reversibility: 'reversible',
      requiredPermissions: ['plugin_action:confirm'],
    },
    preview: async () => ({
      diffEntries: [],
      assumptions: [],
      compatibilitySummary: null,
      dryRunFindings: [],
      reversibility: 'reversible',
      affectedItemRefs: ['plugin_pilot_item:new'],
      targetRevision: 'pilot-items@org1-n0',
    }),
    revalidate: async () => ({ fresh: true, currentRevision: 'pilot-items@org1-n0' }),
    apply: async () => ({ writtenRefs: [] }),
    ...overrides,
  }
}

test.group('plugin-action adapter registry fail-closed', () => {
  test('host-core 合法描述符登记成功并可取回', async ({ assert }) => {
    const registry = new PluginActionAdapterRegistry()
    registry.register(stubAdapter())
    assert.isTrue(registry.has('plugin.pilot.item.create'))
    assert.equal(
      registry.require('plugin.pilot.item.create'),
      registry.get('plugin.pilot.item.create'),
    )
  })

  test('插件自带 adapter（owner 非 host-core）被拒绝且不进入注册表', async ({ assert }) => {
    const registry = new PluginActionAdapterRegistry()
    const evil = stubAdapter({
      descriptor: {
        actionKind: 'plugin.pilot.item.create',
        owner: 'com.aiproj.evil.plugin' as never,
        batchPolicy: 'per-item',
        reversibility: 'reversible',
        requiredPermissions: [],
      },
    })
    let caught: unknown = null
    try {
      registry.register(evil)
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ActionBoundaryError)
    assert.equal((caught as ActionBoundaryError).reasonCode, 'adapter-not-host-owned')
    assert.isFalse(registry.has('plugin.pilot.item.create'))
  })

  test('未知 action kind 的描述符被拒绝', async ({ assert }) => {
    const registry = new PluginActionAdapterRegistry()
    const unknownKind = stubAdapter({
      descriptor: {
        actionKind: 'domain.tasks.bulk-delete' as PluginActionKind,
        owner: 'host-core',
        batchPolicy: 'per-item',
        reversibility: 'reversible',
        requiredPermissions: [],
      },
    })
    let caught: unknown = null
    try {
      registry.register(unknownKind)
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ActionBoundaryError)
    assert.equal((caught as ActionBoundaryError).reasonCode, 'action-kind-unknown')
  })

  test('包含 repository/model/SQL/URL 直写声明的描述符被拒绝', async ({ assert }) => {
    const registry = new PluginActionAdapterRegistry()
    const forbidden = stubAdapter({
      descriptor: {
        actionKind: 'plugin.pilot.item.create',
        owner: 'host-core',
        batchPolicy: 'per-item',
        reversibility: 'reversible',
        requiredPermissions: [],
        repository: 'Database.writeRepository',
        executeSql: 'DELETE FROM tasks',
        callbackUrl: 'https://evil.example.com/exfil',
      } as unknown as PluginActionHostAdapter['descriptor'],
    })
    let caught: unknown = null
    try {
      registry.register(forbidden)
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ActionBoundaryError)
    assert.equal((caught as ActionBoundaryError).reasonCode, 'adapter-descriptor-invalid')
    assert.isFalse(registry.has('plugin.pilot.item.create'))
  })

  test('未登记 kind 的 require 恒 fail-closed（adapter-missing）', async ({ assert }) => {
    const registry = new PluginActionAdapterRegistry()
    let caught: unknown = null
    try {
      registry.require('plugin.pilot.item.create')
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ActionBoundaryError)
    assert.equal((caught as ActionBoundaryError).reasonCode, 'adapter-missing')
  })
})
