import { test } from '@japa/runner'
import type { V2RouteAdmission } from '#types/api_v2_admission'
import { V2_ROUTE_ADMISSION_MANIFEST, validateAdmissionManifest } from '#types/api_v2_admission'

const MANIFEST_ENTRY = V2_ROUTE_ADMISSION_MANIFEST[0] as V2RouteAdmission

const STRING_FIELDS: (keyof V2RouteAdmission)[] = [
  'id',
  'path',
  'sourceCapability',
  'contractVersion',
  'v1Relationship',
  'auth',
  'rbac',
  'orgIsolation',
  'sideEffectClass',
  'auditBehavior',
  'featureFlag',
  'fallback',
  'verificationCmd',
  'status',
]

const VALID_STATUSES = ['admitted', 'experimental', 'deprecated', 'removed'] as const
const VALID_SIDE_EFFECT_CLASSES = [
  'read',
  'write',
  'ai-action',
  'compiler-action',
  'admin',
] as const
const VALID_AUDIT_BEHAVIORS = ['none', 'read-log', 'write-audit', 'human-confirm'] as const

test.group('validateAdmissionManifest', () => {
  test('当前 V2_ROUTE_ADMISSION_MANIFEST 通过校验', ({ assert }) => {
    const result = validateAdmissionManifest()

    assert.isTrue(result.valid, `Manifest 校验失败: ${result.errors.join('; ')}`)
    assert.isEmpty(result.errors)
  })

  test('缺少 id 的条目报 "条目缺少 id"', ({ assert }) => {
    const [first, ...rest] = V2_ROUTE_ADMISSION_MANIFEST
    const broken = { ...first!, id: '' }
    const result = validateAdmissionManifest([broken, ...rest])

    assert.isFalse(result.valid)
    assert.isTrue(result.errors.some((e) => e.includes('条目缺少 id')))
  })

  test('去除 id 字段（undefined）报 "条目缺少 id"', ({ assert }) => {
    const [first, ...rest] = V2_ROUTE_ADMISSION_MANIFEST
    const { id: _unused, ...noId } = first! // eslint-disable-line @typescript-eslint/naming-convention
    const result = validateAdmissionManifest([
      noId as (typeof V2_ROUTE_ADMISSION_MANIFEST)[number],
      ...rest,
    ])

    assert.isFalse(result.valid)
    assert.isTrue(result.errors.some((e) => e.includes('条目缺少 id')))
  })

  test('非 /api/v2 前缀路径报错', ({ assert }) => {
    const [first, ...rest] = V2_ROUTE_ADMISSION_MANIFEST
    const broken = { ...first!, path: '/api/v1/capabilities' }
    const result = validateAdmissionManifest([broken, ...rest])

    assert.isFalse(result.valid)
    assert.isTrue(result.errors.some((e) => e.includes('路径非 /api/v2 前缀')))
  })

  test('重复 method+path 报错', ({ assert }) => {
    const dup = { ...V2_ROUTE_ADMISSION_MANIFEST[0]!, id: 'duplicate-entry' }
    const result = validateAdmissionManifest([...V2_ROUTE_ADMISSION_MANIFEST, dup])

    assert.isFalse(result.valid)
    assert.isTrue(result.errors.some((e) => e.includes('重复条目')))
  })

  test('无效 status 报错', ({ assert }) => {
    const broken: V2RouteAdmission = {
      ...MANIFEST_ENTRY,
      status: 'invalid-status' as V2RouteAdmission['status'],
    }
    const result = validateAdmissionManifest([broken])

    assert.isFalse(result.valid)
    assert.isTrue(result.errors.some((e) => e.includes('无效 status')))
  })

  test('无效 sideEffectClass 报错', ({ assert }) => {
    const broken: V2RouteAdmission = {
      ...MANIFEST_ENTRY,
      sideEffectClass: 'destroy' as V2RouteAdmission['sideEffectClass'],
    }
    const result = validateAdmissionManifest([broken])

    assert.isFalse(result.valid)
    assert.isTrue(result.errors.some((e) => e.includes('无效 sideEffectClass')))
  })

  test('无效 auditBehavior 报错', ({ assert }) => {
    const broken: V2RouteAdmission = {
      ...MANIFEST_ENTRY,
      auditBehavior: 'full-log' as V2RouteAdmission['auditBehavior'],
    }
    const result = validateAdmissionManifest([broken])

    assert.isFalse(result.valid)
    assert.isTrue(result.errors.some((e) => e.includes('无效 auditBehavior')))
  })
})

test.group('V2_ROUTE_ADMISSION_MANIFEST - 结构性完整', () => {
  test('每个条目的所有必需字段不为空字符串', ({ assert }) => {
    const failures: string[] = []

    for (const entry of V2_ROUTE_ADMISSION_MANIFEST) {
      for (const field of STRING_FIELDS) {
        const value = entry[field]
        if (typeof value === 'string' && value.trim() === '') {
          failures.push(`${entry.id}.${field} 为空`)
        }
      }
    }

    assert.isEmpty(failures, failures.join('; '))
  })

  test('每个条目存在且非空的 id', ({ assert }) => {
    const failures = V2_ROUTE_ADMISSION_MANIFEST.filter((e) => !e.id || e.id.trim() === '').map(
      (e) => `条目缺少 id: ${e.method} ${e.path}`,
    )

    assert.isEmpty(failures, failures.join('; '))
  })

  test('每个条目的 status 是合法值之一', ({ assert }) => {
    const failures: string[] = []

    for (const entry of V2_ROUTE_ADMISSION_MANIFEST) {
      if (!VALID_STATUSES.includes(entry.status as (typeof VALID_STATUSES)[number])) {
        failures.push(`${entry.id} => 无效 status: ${entry.status}`)
      }
    }

    assert.isEmpty(failures, failures.join('; '))
  })

  test('每个条目的 sideEffectClass 是合法值之一', ({ assert }) => {
    const failures: string[] = []

    for (const entry of V2_ROUTE_ADMISSION_MANIFEST) {
      if (
        !VALID_SIDE_EFFECT_CLASSES.includes(
          entry.sideEffectClass as (typeof VALID_SIDE_EFFECT_CLASSES)[number],
        )
      ) {
        failures.push(`${entry.id} => 无效 sideEffectClass: ${entry.sideEffectClass}`)
      }
    }

    assert.isEmpty(failures, failures.join('; '))
  })

  test('每个条目的 auditBehavior 是合法值之一', ({ assert }) => {
    const failures: string[] = []

    for (const entry of V2_ROUTE_ADMISSION_MANIFEST) {
      if (
        !VALID_AUDIT_BEHAVIORS.includes(
          entry.auditBehavior as (typeof VALID_AUDIT_BEHAVIORS)[number],
        )
      ) {
        failures.push(`${entry.id} => 无效 auditBehavior: ${entry.auditBehavior}`)
      }
    }

    assert.isEmpty(failures, failures.join('; '))
  })

  test('所有路径以 /api/v2/ 开头', ({ assert }) => {
    const failures = V2_ROUTE_ADMISSION_MANIFEST.filter((e) => !e.path.startsWith('/api/v2/')).map(
      (e) => `${e.id}: ${e.path}`,
    )

    assert.isEmpty(failures, failures.join('; '))
  })

  test('无重复 method+path 对', ({ assert }) => {
    const seen = new Map<string, string>()
    const failures: string[] = []

    for (const entry of V2_ROUTE_ADMISSION_MANIFEST) {
      const key = `${entry.method} ${entry.path}`
      if (seen.has(key)) {
        failures.push(`重复条目: ${key} (${seen.get(key)!} 与 ${entry.id})`)
      }
      seen.set(key, entry.id)
    }

    assert.isEmpty(failures, failures.join('; '))
  })
})

test.group('V2_ROUTE_ADMISSION_MANIFEST - 字段语义约束', () => {
  test('每个 admitted/experimental 条目有非空的 verificationCmd', ({ assert }) => {
    const activeStatuses = new Set(['admitted', 'experimental'])
    const failures: string[] = []

    for (const entry of V2_ROUTE_ADMISSION_MANIFEST) {
      if (activeStatuses.has(entry.status)) {
        if (!entry.verificationCmd || entry.verificationCmd.trim() === '') {
          failures.push(`${entry.id} (${entry.status}) verificationCmd 为空`)
        }
      }
    }

    assert.isEmpty(failures, failures.join('; '))
  })

  test('write/compiler-action/human-confirm 的条目 auditBehavior !== "none"', ({ assert }) => {
    const failures: string[] = []

    for (const entry of V2_ROUTE_ADMISSION_MANIFEST) {
      const hasSignificantAuditBehavior =
        entry.auditBehavior === 'write-audit' || entry.auditBehavior === 'human-confirm'
      if (!hasSignificantAuditBehavior) continue

      if (entry.auditBehavior === 'none') {
        failures.push(`${entry.id} 的 auditBehavior 为 'none' 但应记录显著审计`)
      }
    }

    assert.isEmpty(failures, failures.join('; '))
  })

  test('sideEffectClass="write" 的条目 auditBehavior 为 write-audit 或 human-confirm', ({
    assert,
  }) => {
    const allowed = new Set(['write-audit', 'human-confirm'])
    const failures: string[] = []

    for (const entry of V2_ROUTE_ADMISSION_MANIFEST) {
      if (entry.sideEffectClass === 'write' && !allowed.has(entry.auditBehavior)) {
        failures.push(
          `${entry.id} sideEffectClass=write 但 auditBehavior=${entry.auditBehavior}（应为 write-audit 或 human-confirm）`,
        )
      }
    }

    assert.isEmpty(failures, failures.join('; '))
  })

  test('sideEffectClass="compiler-action" 的条目 auditBehavior 为 write-audit 或 human-confirm', ({
    assert,
  }) => {
    const allowed = new Set(['write-audit', 'human-confirm'])
    const failures: string[] = []

    for (const entry of V2_ROUTE_ADMISSION_MANIFEST) {
      if (entry.sideEffectClass === 'compiler-action' && !allowed.has(entry.auditBehavior)) {
        failures.push(
          `${entry.id} sideEffectClass=compiler-action 但 auditBehavior=${entry.auditBehavior}（应为 write-audit 或 human-confirm）`,
        )
      }
    }

    assert.isEmpty(failures, failures.join('; '))
  })
})

test.group('V2_ROUTE_ADMISSION_MANIFEST - 注册表完整性', () => {
  test('注册表非空', ({ assert }) => {
    assert.isAbove(V2_ROUTE_ADMISSION_MANIFEST.length, 0)
  })

  test('每个条目的 method 是合法 HTTP 方法', ({ assert }) => {
    const validMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
    const failures = V2_ROUTE_ADMISSION_MANIFEST.filter((e) => !validMethods.has(e.method)).map(
      (e) => `${e.id}: 无效 method ${e.method}`,
    )

    assert.isEmpty(failures, failures.join('; '))
  })

  test('每个条目的 id 是 kebab-case', ({ assert }) => {
    const kebabCaseRe = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
    const failures = V2_ROUTE_ADMISSION_MANIFEST.filter((e) => !kebabCaseRe.test(e.id)).map(
      (e) => `${e.id}: 非 kebab-case 格式`,
    )

    assert.isEmpty(failures, failures.join('; '))
  })

  test('GET 条目 sideEffectClass 为 read 或 admin', ({ assert }) => {
    const failures: string[] = []

    for (const entry of V2_ROUTE_ADMISSION_MANIFEST) {
      if (
        entry.method === 'GET' &&
        entry.sideEffectClass !== 'read' &&
        entry.sideEffectClass !== 'admin'
      ) {
        failures.push(
          `${entry.id} GET 方法但 sideEffectClass=${entry.sideEffectClass}（应为 read 或 admin）`,
        )
      }
    }

    assert.isEmpty(failures, failures.join('; '))
  })

  test('POST/PUT/PATCH/DELETE 条目 sideEffectClass 不为 read', ({ assert }) => {
    const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
    const failures: string[] = []

    for (const entry of V2_ROUTE_ADMISSION_MANIFEST) {
      if (writeMethods.has(entry.method) && entry.sideEffectClass === 'read') {
        failures.push(`${entry.id} ${entry.method} 方法但 sideEffectClass=read（应为非 read）`)
      }
    }

    assert.isEmpty(failures, failures.join('; '))
  })
})
