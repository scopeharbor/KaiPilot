import { test } from '@japa/runner'
import {
  aggregateInstallationBuckets,
  buildCompatibilitySummary,
  directoryError,
  isDistributableStatus,
  selectReleasesForViewer,
  sortReleasesDeterministic,
  type DirectoryViewerRole,
} from '#services/plugin_registry/directory_projection_core'
import type { RegistryReleaseStatus } from '@aiproj/types'

/**
 * v3-organization-private-plugin-directory — 目录投影纯核心契约测试（tasks 2.2/2.4）。
 *
 * 覆盖：成员/管理员视图可见性、确定性排序契约、兼容性摘要 fail-closed、
 * 影响桶聚合数学、低敏错误契约。零数据库，纯函数直跑。
 */

interface Row {
  id: string
  version: string
  status: RegistryReleaseStatus
}

function row(id: string, version: string, status: RegistryReleaseStatus): Row {
  return { id, version, status }
}

const ALL_STATUSES: RegistryReleaseStatus[] = [
  'draft',
  'pending_review',
  'approved',
  'rejected',
  'deprecated',
  'withdrawn',
]

test.group('目录投影 · 视图可见性', () => {
  test('普通成员只看到 approved（approved/pending/withdrawn/deprecated 混合场景）', ({
    assert,
  }) => {
    const releases = [
      row('r1', '1.0.0', 'approved'),
      row('r2', '1.1.0', 'pending_review'),
      row('r3', '0.9.0', 'withdrawn'),
      row('r4', '0.8.0', 'deprecated'),
      row('r5', '0.7.0', 'draft'),
      row('r6', '0.6.0', 'rejected'),
    ]
    const visible = selectReleasesForViewer(releases, 'member')
    assert.deepEqual(
      visible.map((item) => item.id),
      ['r1'],
      '成员视图必须只暴露可分发的 approved release',
    )
  })

  test('管理员视图可见全部状态（权限过滤由 Policy 决定角色）', ({ assert }) => {
    const releases = ALL_STATUSES.map((status, index) => row(`r${index}`, '1.0.0', status))
    const visible = selectReleasesForViewer(releases, 'manager')
    assert.lengthOf(visible, ALL_STATUSES.length)
  })

  test('不发明第二套 disabled 状态：禁用语义 ≙ withdrawn/deprecated，成员均不可分发', ({
    assert,
  }) => {
    assert.isTrue(isDistributableStatus('approved'))
    for (const status of [
      'pending_review',
      'draft',
      'rejected',
      'deprecated',
      'withdrawn',
    ] as const) {
      assert.isFalse(isDistributableStatus(status), `${status} 对成员不可分发`)
    }
  })

  test('空集合与单元素集合筛选稳定', ({ assert }) => {
    assert.deepEqual(selectReleasesForViewer([], 'member'), [])
    assert.lengthOf(selectReleasesForViewer([row('r1', '1.0.0', 'approved')], 'member'), 1)
  })
})

test.group('目录投影 · 确定性排序', () => {
  test('-version 按 semver 数值降序：10.0.0 排在 9.0.0 之前（拒绝字符串序）', ({ assert }) => {
    const releases = [row('a', '9.0.0', 'approved'), row('b', '10.0.0', 'approved')]
    const ordered = sortReleasesDeterministic(releases, '-version')
    assert.deepEqual(
      ordered.map((item) => item.version),
      ['10.0.0', '9.0.0'],
    )
  })

  test('+version 为升序且同版本以 id 升序 tiebreak', ({ assert }) => {
    const releases = [
      row('b2', '2.0.0', 'approved'),
      row('a1', '1.0.0', 'approved'),
      row('a2', '1.0.0', 'approved'),
    ]
    const ordered = sortReleasesDeterministic(releases, '+version')
    assert.deepEqual(
      ordered.map((item) => item.id),
      ['a1', 'a2', 'b2'],
    )
  })

  test('输入乱序不影响输出（确定性契约）', ({ assert }) => {
    const releases = [
      row('r1', '1.2.0', 'approved'),
      row('r2', '10.0.0', 'approved'),
      row('r3', '2.0.0', 'approved'),
      row('r4', '10.0.0', 'approved'),
    ]
    const first = sortReleasesDeterministic(releases, '-version').map((item) => item.id)
    const shuffled = sortReleasesDeterministic([...releases].reverse(), '-version').map(
      (item) => item.id,
    )
    assert.deepEqual(first, shuffled)
    assert.deepEqual(first, ['r2', 'r4', 'r3', 'r1'])
  })

  test('createdAt 排序带 id tiebreak（同时间戳稳定）', ({ assert }) => {
    const withTime = [
      { id: 'b', version: '1.0.0', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'a', version: '2.0.0', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'c', version: '3.0.0', createdAt: '2026-02-01T00:00:00Z' },
    ]
    const desc = sortReleasesDeterministic(withTime, '-createdAt').map((item) => item.id)
    assert.deepEqual(desc, ['c', 'a', 'b'])
  })
})

test.group('目录投影 · 兼容性摘要', () => {
  const compatibleMetadata = JSON.stringify({
    compatibilityMatrix: {
      pluginVersion: '1.0.0',
      hostRange: '>=3.0.0 <4.0.0',
      manifestSchemaVersion: '1.0',
      permissionModelVersion: '1.0',
      channel: 'stable',
      requiredSeams: [{ seamKey: 'skill-adapter.skill-bundle', seamVersion: '1.0.0' }],
    },
  })

  test('合法声明 → allowed=true 且携带 digest 与空 reasonCodes', ({ assert }) => {
    const summary = buildCompatibilitySummary(compatibleMetadata)
    assert.isTrue(summary.allowed)
    assert.isNotEmpty(summary.digest)
    assert.deepEqual(summary.reasonCodes, [])
  })

  test('缺失声明 fail-closed：allowed=false + input-unknown', ({ assert }) => {
    const summary = buildCompatibilitySummary(null)
    assert.isFalse(summary.allowed)
    assert.include(summary.reasonCodes, 'input-unknown')
  })

  test('越界宿主声明 fail-closed 并给出 reasonCodes', ({ assert }) => {
    const summary = buildCompatibilitySummary(
      JSON.stringify({
        compatibilityMatrix: {
          pluginVersion: '1.0.0',
          hostRange: '>=9.0.0',
          manifestSchemaVersion: '1.0',
          permissionModelVersion: '1.0',
          channel: 'stable',
          requiredSeams: [{ seamKey: 'skill-adapter.skill-bundle', seamVersion: '1.0.0' }],
        },
      }),
    )
    assert.isFalse(summary.allowed)
    assert.include(summary.reasonCodes, 'host-version-out-of-range')
  })

  test('损坏 metadata 不抛异常（目录查询永不因脏数据失败）', ({ assert }) => {
    const summary = buildCompatibilitySummary('{not-json')
    assert.isFalse(summary.allowed)
  })
})

test.group('目录投影 · 影响桶聚合', () => {
  test('GROUP BY 行折叠为 active/uninstalled 计数', ({ assert }) => {
    const map = aggregateInstallationBuckets([
      { releaseId: 1, status: 'installed', total: 3 },
      { releaseId: 1, status: 'enabled', total: 2 },
      { releaseId: 1, status: 'uninstalled', total: 5 },
      { releaseId: '2', status: 'enabled', total: 1 },
    ])
    assert.equal(map.get('1')?.activeCount, 5)
    assert.equal(map.get('1')?.uninstalledCount, 5)
    assert.equal(map.get('2')?.activeCount, 1)
    assert.equal(map.get('2')?.uninstalledCount, 0)
  })

  test('未知状态归入非活动桶（fail-closed，不计入活跃影响）', ({ assert }) => {
    const map = aggregateInstallationBuckets([{ releaseId: 7, status: 'weird', total: 2 }])
    assert.equal(map.get('7')?.activeCount, 0)
    assert.equal(map.get('7')?.uninstalledCount, 2)
  })

  test('空输入返回空映射', ({ assert }) => {
    assert.equal(aggregateInstallationBuckets([]).size, 0)
  })
})

test.group('目录投影 · 低敏错误契约', () => {
  test('not-found 错误体固定文案，不携带目标标识/digest/数量', ({ assert }) => {
    const body = directoryError('directory-release-not-found')
    const serialized = JSON.stringify(body)
    assert.equal(body.error.code, 'directory-release-not-found')
    assert.notInclude(serialized, 'sha256:')
    assert.notInclude(serialized, 'com.example')
    assert.notProperty(body.error, 'details')
  })

  test('错误码封闭：非法查询与未发现两类', ({ assert }) => {
    assert.equal(directoryError('directory-invalid-query').error.code, 'directory-invalid-query')
  })
})

test.group('目录投影 · 视图角色类型契约', () => {
  test('角色只有 member/manager 两档', ({ assert }) => {
    const roles: DirectoryViewerRole[] = ['member', 'manager']
    assert.lengthOf(roles, 2)
  })
})
