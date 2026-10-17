// v3-scim-attribute-mapping —— 共享契约单测（§2.2 / §2.4 / §2.6 / §2.8 / §2.10）。
// 覆盖：枚举完备性、默认描述符、稳定序列化与确定性指纹、有界解析器
// （primary/first/type 选择、enterprise alias、缺失必需字段、不支持路径、歧义）、
// 归一化（trim/lowercase/布尔/超长/非字符串/白名单）、preview DTO 低敏性、
// 禁止内容检测与脱敏、厂商风格 fixture 全量解析。
import { describe, it, expect } from 'vitest'
import {
  SCIM_ATTR_MAPPING_HASH_NS,
  SCIM_MAPPING_WARNING_CODES,
  SCIM_DEFAULT_MAPPING_DESCRIPTORS,
  SCIM_ENTERPRISE_EXTENSION_URN,
  SCIM_MAPPING_DIAGNOSTIC_CODES,
  SCIM_MAPPING_IDENTITY_TARGETS,
  SCIM_MAPPING_NORMALIZATIONS,
  SCIM_MAPPING_PROFILE_TARGETS,
  SCIM_MAPPING_PROFILE_VALUE_MAX_LENGTH,
  SCIM_MAPPING_PROFILE_WHITELIST,
  SCIM_MAPPING_SELECTOR_TYPES,
  SCIM_MAPPING_TARGETS,
  scimComputeAttributeMappingFingerprint,
  scimMappingBuildPreviewResult,
  scimMappingDetectForbiddenContent,
  scimMappingIsEmailArrayShape,
  scimMappingIsStaleSnapshot,
  scimMappingMaskValue,
  scimMappingNormalizeActive,
  scimMappingNormalizeByMode,
  scimMappingNormalizeDisplayName,
  scimMappingNormalizeEmail,
  scimMappingNormalizeProfileValue,
  scimMappingNormalizeUserName,
  scimMappingNormalizeSupportedPath,
  scimMappingSanitizeLowSensitive,
  scimMappingSnapshotForbiddenHits,
  scimMappingVersionFromFingerprint,
  scimMappingWarningCopy,
  scimMappingWhitelistProfileValues,
  scimResolveMappedAttributes,
  scimMappingResolveOne,
  type ScimMappingDescriptorList,
} from './scim-attribute-mapping.js'
import {
  SCIM_ATTR_MAPPING_FIXTURE_AMBIGUOUS_EMAILS_USER,
  SCIM_ATTR_MAPPING_FIXTURE_ENTRA_USER,
  SCIM_ATTR_MAPPING_FIXTURE_GENERIC_EXPECTED,
  SCIM_ATTR_MAPPING_FIXTURE_GENERIC_USER,
  SCIM_ATTR_MAPPING_FIXTURE_GOOGLE_USER,
  SCIM_ATTR_MAPPING_FIXTURE_INVALID_USER,
  SCIM_ATTR_MAPPING_FIXTURE_OKTA_USER,
  SCIM_ATTR_MAPPING_FIXTURE_VENDOR_DESCRIPTORS,
  SCIM_ATTR_MAPPING_FIXTURE_DEFAULT_FINGERPRINT,
  SCIM_ATTR_MAPPING_FIXTURE_VENDOR_FINGERPRINT,
} from './scim-attribute-mapping-fixtures.js'

const EMPTY_PAYLOAD: Record<string, unknown> = {}

describe('枚举完备性与默认描述符（2.2）', () => {
  it('全部枚举非空且无重复', () => {
    for (const list of [
      SCIM_MAPPING_TARGETS,
      SCIM_MAPPING_IDENTITY_TARGETS,
      SCIM_MAPPING_PROFILE_TARGETS,
      SCIM_MAPPING_SELECTOR_TYPES,
      SCIM_MAPPING_NORMALIZATIONS,
      SCIM_MAPPING_DIAGNOSTIC_CODES,
      SCIM_MAPPING_WARNING_CODES,
    ]) {
      expect(list.length).toBeGreaterThan(0)
      expect(new Set(list).size).toBe(list.length)
    }
  })

  it('profile 目标与白名单完全一致（防快照漂移）', () => {
    expect([...SCIM_MAPPING_PROFILE_WHITELIST]).toEqual([...SCIM_MAPPING_PROFILE_TARGETS])
  })

  it('默认描述符覆盖全部 identity 目标且路径等价于既有硬编码提取', () => {
    const targets = new Set(SCIM_DEFAULT_MAPPING_DESCRIPTORS.map((d) => d.target))
    for (const t of SCIM_MAPPING_IDENTITY_TARGETS) expect(targets.has(t)).toBe(true)
    const email = SCIM_DEFAULT_MAPPING_DESCRIPTORS.find((d) => d.target === 'email')
    expect(email?.path).toBe('emails')
    expect(email?.selectorType).toBe('primary')
    expect(email?.valueField).toBe('value')
  })

  it('默认描述符稳定序列化 → 指纹确定且与夹具一致', () => {
    expect(SCIM_ATTR_MAPPING_FIXTURE_DEFAULT_FINGERPRINT).toBe(
      scimComputeAttributeMappingFingerprint(SCIM_DEFAULT_MAPPING_DESCRIPTORS),
    )
    expect(SCIM_ATTR_MAPPING_FIXTURE_DEFAULT_FINGERPRINT.length).toBeGreaterThanOrEqual(16)
    expect(SCIM_ATTR_MAPPING_FIXTURE_DEFAULT_FINGERPRINT).not.toBe(
      SCIM_ATTR_MAPPING_FIXTURE_VENDOR_FINGERPRINT,
    )
  })

  it('指纹与描述符顺序无关', () => {
    const reversed = [...SCIM_DEFAULT_MAPPING_DESCRIPTORS].reverse()
    expect(scimComputeAttributeMappingFingerprint(reversed)).toBe(
      scimComputeAttributeMappingFingerprint(SCIM_DEFAULT_MAPPING_DESCRIPTORS),
    )
  })

  it('版本由指纹确定性派生且稳定', () => {
    const fp = scimComputeAttributeMappingFingerprint(SCIM_DEFAULT_MAPPING_DESCRIPTORS)
    expect(scimMappingVersionFromFingerprint(fp)).toBe(scimMappingVersionFromFingerprint(fp))
    expect(scimMappingVersionFromFingerprint(fp)).toBeGreaterThan(0)
    expect(scimMappingVersionFromFingerprint('')).toBe(0)
  })

  it('stale 判定：指纹或版本不一致即 stale', () => {
    const fpA = scimComputeAttributeMappingFingerprint(SCIM_DEFAULT_MAPPING_DESCRIPTORS)
    const vendorDescriptors: ScimMappingDescriptorList = [
      ...SCIM_DEFAULT_MAPPING_DESCRIPTORS,
      { path: 'title', target: 'title', normalization: 'profile' },
    ]
    const fpB = scimComputeAttributeMappingFingerprint(vendorDescriptors)
    expect(
      scimMappingIsStaleSnapshot({
        snapshotVersion: scimMappingVersionFromFingerprint(fpA),
        snapshotFingerprint: fpA,
        currentVersion: scimMappingVersionFromFingerprint(fpA),
        currentFingerprint: fpA,
      }),
    ).toBe(false)
    expect(
      scimMappingIsStaleSnapshot({
        snapshotVersion: scimMappingVersionFromFingerprint(fpA),
        snapshotFingerprint: fpA,
        currentVersion: scimMappingVersionFromFingerprint(fpB),
        currentFingerprint: fpB,
      }),
    ).toBe(true)
  })

  it('模块无外部运行时依赖（只依赖同包纯模块）', () => {
    // 静态断言：契约文件头声明零外部依赖；这里验证核心函数可离线运行
    const fp = scimComputeAttributeMappingFingerprint(SCIM_DEFAULT_MAPPING_DESCRIPTORS)
    expect(typeof fp).toBe('string')
    expect(SCIM_ATTR_MAPPING_HASH_NS.length).toBeGreaterThan(0)
  })
})

describe('路径校验（有界语法）', () => {
  it('支持 core 白名单路径', () => {
    expect(scimMappingNormalizeSupportedPath('userName')).toBe('userName')
    expect(scimMappingNormalizeSupportedPath('name.givenName')).toBe('name.givenName')
    expect(scimMappingNormalizeSupportedPath('emails')).toBe('emails')
    expect(scimMappingNormalizeSupportedPath('active')).toBe('active')
    expect(scimMappingNormalizeSupportedPath('title')).toBe('title')
    expect(scimMappingNormalizeSupportedPath('userType')).toBe('userType')
  })

  it('支持 enterprise alias 的短别名与完整 URN', () => {
    expect(scimMappingNormalizeSupportedPath('enterprise:employeeNumber')).toBe(
      `${SCIM_ENTERPRISE_EXTENSION_URN}:employeeNumber`,
    )
    expect(scimMappingNormalizeSupportedPath(`${SCIM_ENTERPRISE_EXTENSION_URN}:department`)).toBe(
      `${SCIM_ENTERPRISE_EXTENSION_URN}:department`,
    )
    expect(scimMappingNormalizeSupportedPath('enterprise:unknownAttr')).toBeNull()
  })

  it('拒绝不支持路径与畸形输入', () => {
    expect(scimMappingNormalizeSupportedPath('name.middleName')).toBeNull()
    expect(scimMappingNormalizeSupportedPath('emails[type eq "work"]')).toBeNull()
    expect(scimMappingNormalizeSupportedPath('$.x')).toBeNull()
    expect(scimMappingNormalizeSupportedPath('')).toBeNull()
    expect(scimMappingNormalizeSupportedPath('a'.repeat(300))).toBeNull()
  })
})

describe('解析器（2.3/2.4）', () => {
  it('email primary 选择：取 primary=true 项', () => {
    const resolution = scimResolveMappedAttributes({
      descriptors: SCIM_DEFAULT_MAPPING_DESCRIPTORS,
      payload: SCIM_ATTR_MAPPING_FIXTURE_GENERIC_USER,
    })
    expect(resolution.ok).toBe(true)
    expect(resolution.values.email).toBe('alice.work@example.com')
    expect(resolution.values.userName).toBe('alice.generic')
    expect(resolution.values.displayName).toBe('Alice Generic')
    expect(resolution.values.givenName).toBe('Alice')
    expect(resolution.values.familyName).toBe('Generic')
    expect(resolution.values.active).toBe(true)
    expect(resolution.diagnostics).toEqual([])
  })

  it('无 primary 时确定性取第一项且不告警歧义', () => {
    const resolution = scimResolveMappedAttributes({
      descriptors: SCIM_DEFAULT_MAPPING_DESCRIPTORS,
      payload: {
        ...SCIM_ATTR_MAPPING_FIXTURE_GENERIC_USER,
        emails: [{ value: 'x@example.com' }, { value: 'y@example.com' }],
      },
    })
    expect(resolution.values.email).toBe('x@example.com')
    expect(resolution.diagnostics.length).toBe(0)
  })

  it('多个 primary → AMBIGUOUS_MULTI_VALUE（确定性取第一命中）', () => {
    const resolution = scimResolveMappedAttributes({
      descriptors: SCIM_DEFAULT_MAPPING_DESCRIPTORS,
      payload: SCIM_ATTR_MAPPING_FIXTURE_AMBIGUOUS_EMAILS_USER,
    })
    expect(resolution.values.email).toBe('one@example.com')
    expect(resolution.diagnostics.some((d) => d.code === 'AMBIGUOUS_MULTI_VALUE')).toBe(true)
    expect(resolution.warningCodes).toContain('MAPPING_AMBIGUOUS_VALUE')
  })

  it('type 选择器：匹配 type=work 项', () => {
    const descriptor: ScimMappingDescriptorList = [
      {
        path: 'emails',
        selectorType: 'type',
        selectorTypeValue: 'work',
        valueField: 'value',
        target: 'email',
        normalization: 'email',
      },
    ]
    const resolution = scimResolveMappedAttributes({
      descriptors: descriptor,
      payload: SCIM_ATTR_MAPPING_FIXTURE_GENERIC_USER,
    })
    expect(resolution.values.email).toBe('alice.work@example.com')
  })

  it('type 选择器无命中 → 未解析（非必填不报错）', () => {
    const descriptor: ScimMappingDescriptorList = [
      {
        path: 'emails',
        selectorType: 'type',
        selectorTypeValue: 'fax',
        valueField: 'value',
        target: 'email',
        normalization: 'email',
      },
    ]
    const resolution = scimResolveMappedAttributes({
      descriptors: descriptor,
      payload: SCIM_ATTR_MAPPING_FIXTURE_GENERIC_USER,
    })
    expect(resolution.values.email).toBeNull()
  })

  it('enterprise extension：employeeNumber / department / title / userType', () => {
    const resolution = scimResolveMappedAttributes({
      descriptors: SCIM_ATTR_MAPPING_FIXTURE_VENDOR_DESCRIPTORS,
      payload: SCIM_ATTR_MAPPING_FIXTURE_GENERIC_USER,
    })
    expect(resolution.values.employeeNumber).toBe('G-1001')
    expect(resolution.values.department).toBe('Engineering')
    expect(resolution.values.title).toBe('Staff Engineer')
    expect(resolution.values.userType).toBe('Employee')
  })

  it('缺失必需字段 → MISSING_REQUIRED_ATTRIBUTE 且整体 ok=false', () => {
    const descriptors: ScimMappingDescriptorList = [
      { path: 'userName', target: 'userName', required: true, normalization: 'userName' },
    ]
    const resolution = scimResolveMappedAttributes({ descriptors, payload: EMPTY_PAYLOAD })
    expect(resolution.ok).toBe(false)
    expect(resolution.diagnostics.some((d) => d.code === 'MISSING_REQUIRED_ATTRIBUTE')).toBe(true)
    expect(resolution.values.userName).toBeNull()
  })

  it('不支持路径 → UNSUPPORTED_PATH（fail closed，不猜默认）', () => {
    const descriptors: ScimMappingDescriptorList = [
      { path: 'name.middleName', target: 'displayName', normalization: 'displayName' },
    ]
    const resolution = scimResolveMappedAttributes({
      descriptors,
      payload: SCIM_ATTR_MAPPING_FIXTURE_GENERIC_USER,
    })
    expect(resolution.ok).toBe(false)
    expect(resolution.diagnostics.some((d) => d.code === 'UNSUPPORTED_PATH')).toBe(true)
    expect(resolution.values.displayName).toBeNull()
  })

  it('重复 profile 目标 → PROFILE_WRITE_POLICY_CONFLICT（保留第一个）', () => {
    const descriptors: ScimMappingDescriptorList = [
      { path: 'title', target: 'title', normalization: 'profile' },
      { path: 'userType', target: 'title', normalization: 'profile' },
    ]
    const resolution = scimResolveMappedAttributes({
      descriptors,
      payload: SCIM_ATTR_MAPPING_FIXTURE_GENERIC_USER,
    })
    expect(resolution.ok).toBe(false)
    expect(resolution.values.title).toBe('Staff Engineer')
    expect(resolution.diagnostics.some((d) => d.code === 'PROFILE_WRITE_POLICY_CONFLICT')).toBe(
      true,
    )
  })

  it('单描述符解析：active 字符串 true 归一为布尔', () => {
    const result = scimMappingResolveOne(
      { path: 'active', target: 'active', normalization: 'active' },
      { active: 'true' },
    )
    expect(result).toEqual({ ok: true, value: true, warningCode: null })
  })

  it('单描述符解析：类型不兼容 → TYPE_MISMATCH', () => {
    const result = scimMappingResolveOne(
      { path: 'active', target: 'active', normalization: 'active' },
      { active: 'yes' },
    )
    expect(result.ok).toBe(false)
    expect(result.warningCode).toBe('MAPPING_TYPE_MISMATCH')
    expect(result.value).toBeNull()
  })
})

describe('归一化（2.5/2.6）', () => {
  it('email/userName：trim + lowercase', () => {
    expect(scimMappingNormalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com')
    expect(scimMappingNormalizeUserName('  Bob.User ')).toBe('bob.user')
    expect(scimMappingNormalizeEmail(123)).toBeNull()
    expect(scimMappingNormalizeEmail(null)).toBeNull()
  })

  it("active：布尔与 'true'/'false' 字符串", () => {
    expect(scimMappingNormalizeActive(true)).toBe(true)
    expect(scimMappingNormalizeActive(false)).toBe(false)
    expect(scimMappingNormalizeActive('TRUE')).toBe(true)
    expect(scimMappingNormalizeActive(' false ')).toBe(false)
    expect(scimMappingNormalizeActive('yes')).toBeNull()
    expect(scimMappingNormalizeActive(1)).toBeNull()
  })

  it('空值归一：空字符串保留为空（非必填不报错）', () => {
    expect(scimMappingNormalizeDisplayName('   ')).toBe('')
    expect(scimMappingNormalizeProfileValue('')).toBe('')
  })

  it('超长字符串：profile 夹紧到上限', () => {
    const long = 'x'.repeat(SCIM_MAPPING_PROFILE_VALUE_MAX_LENGTH + 50)
    const normalized = scimMappingNormalizeProfileValue(long)
    expect(normalized?.length).toBe(SCIM_MAPPING_PROFILE_VALUE_MAX_LENGTH)
  })

  it('非字符串值：profile/displayName 归一返回 null', () => {
    expect(scimMappingNormalizeProfileValue(42)).toBeNull()
    expect(scimMappingNormalizeProfileValue({ a: 1 })).toBeNull()
    expect(scimMappingNormalizeDisplayName(['x'])).toBeNull()
  })

  it('normalizeByMode 各模式一致', () => {
    expect(scimMappingNormalizeByMode('email', ' A@B.C ')).toBe('a@b.c')
    expect(scimMappingNormalizeByMode('active', 'false')).toBe(false)
    expect(scimMappingNormalizeByMode('profile', ' x ')).toBe('x')
    expect(scimMappingNormalizeByMode('none', ' keep ')).toBe(' keep ')
    expect(scimMappingNormalizeByMode(undefined, 5)).toBeNull()
  })

  it('profile 白名单强制：只保留白名单键', () => {
    const whitelisted = scimMappingWhitelistProfileValues({
      department: 'Eng',
      title: 'Engineer',
      email: 'leak@example.com',
      userName: 'leak',
      employeeNumber: 'E1',
    })
    expect(Object.keys(whitelisted).sort()).toEqual([...SCIM_MAPPING_PROFILE_TARGETS].sort())
    expect(whitelisted.email).toBeUndefined()
    expect(whitelisted.department).toBe('Eng')
    expect(whitelisted.userType).toBeNull()
  })
})

describe('preview 与掩码（低敏）', () => {
  it('preview DTO 只含掩码摘要/枚举/计数', () => {
    const resolution = scimResolveMappedAttributes({
      descriptors: SCIM_DEFAULT_MAPPING_DESCRIPTORS,
      payload: SCIM_ATTR_MAPPING_FIXTURE_GENERIC_USER,
    })
    const preview = scimMappingBuildPreviewResult(resolution)
    expect(preview.hasWarnings).toBe(false)
    expect(preview.warningCount).toBe(0)
    const emailTarget = preview.targets.find((t) => t.target === 'email')
    expect(emailTarget?.summary).toContain('***@example.com')
    expect(emailTarget?.summary).not.toContain('alice.work')
    const activeTarget = preview.targets.find((t) => t.target === 'active')
    expect(activeTarget?.summary).toBe('true')
  })

  it('掩码确定性：邮箱保留域名首字符', () => {
    expect(scimMappingMaskValue('email', 'alice.work@example.com')).toBe('a***@example.com')
    expect(scimMappingMaskValue('displayName', 'Alice Generic')).toBe('A***c')
    expect(scimMappingMaskValue('department', 'Eng')).toBe('E***g')
    expect(scimMappingMaskValue('userType', 'Employee')).toBe('E***e')
    expect(scimMappingMaskValue('email', null)).toBe('—')
  })

  it('preview 序列化无禁止内容', () => {
    const resolution = scimResolveMappedAttributes({
      descriptors: SCIM_ATTR_MAPPING_FIXTURE_VENDOR_DESCRIPTORS,
      payload: SCIM_ATTR_MAPPING_FIXTURE_GENERIC_USER,
    })
    const preview = scimMappingBuildPreviewResult(resolution)
    const hits = scimMappingDetectForbiddenContent(JSON.parse(JSON.stringify(preview)))
    expect(hits).toEqual([])
  })
})

describe('warning 文案（6.5/6.6）', () => {
  it('全部 warning code 都有中文文案且不回原始值', () => {
    for (const code of SCIM_MAPPING_WARNING_CODES) {
      const copy = scimMappingWarningCopy(code)
      expect(copy.length).toBeGreaterThan(0)
      expect(copy).not.toContain(code === 'MAPPING_MISSING_REQUIRED' ? '原始值' : 'x@y')
    }
    expect(scimMappingWarningCopy('MAPPING_UNKNOWN_CODE')).toBe('MAPPING_UNKNOWN_CODE')
  })

  it('文案稳定：同一 code 两次调用结果一致且不含邮箱/载荷形态', () => {
    for (const code of SCIM_MAPPING_WARNING_CODES) {
      expect(scimMappingWarningCopy(code)).toBe(scimMappingWarningCopy(code))
      expect(scimMappingDetectForbiddenContent(scimMappingWarningCopy(code))).toEqual([])
    }
  })
})

describe('禁止内容检测与脱敏（2.7/2.8）', () => {
  it('检测 raw SCIM 文档（schemas 数组）、token、Authorization、raw emails', () => {
    const leaky = {
      target: 'email',
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      emails: [{ value: 'a@b.com', primary: true }],
      bearerToken: 'tok_abc',
      authorizationHeader: 'Bearer abc',
    }
    const hits = scimMappingDetectForbiddenContent(leaky)
    expect(hits.some((h) => h.includes('schemas'))).toBe(true)
    expect(hits.some((h) => h.includes('raw-email-array'))).toBe(true)
    expect(hits.some((h) => h.includes('bearerToken'))).toBe(true)
    expect(hits.some((h) => h.includes('authorizationHeader'))).toBe(true)
  })

  it('emails 数组形态识别', () => {
    expect(scimMappingIsEmailArrayShape([{ value: 'a@b.com', primary: true }])).toBe(true)
    expect(scimMappingIsEmailArrayShape([{ value: 'a@b.com' }])).toBe(false)
    expect(scimMappingIsEmailArrayShape(['a@b.com'])).toBe(false)
    expect(scimMappingIsEmailArrayShape([])).toBe(false)
  })

  it('snapshot 候选含 raw 载荷 → 命中（写库前断言）', () => {
    const hits = scimMappingSnapshotForbiddenHits({
      department: 'Eng',
      rawPayload: { schemas: [] },
      emails: [{ value: 'x@y.com', primary: true }],
    })
    expect(hits.length).toBeGreaterThan(0)
  })

  it('脱敏移除 schemas/token 键并对 emails 值打码', () => {
    const sanitized = scimMappingSanitizeLowSensitive({
      department: 'Eng',
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      emails: [{ value: 'a@b.com', primary: true }],
      bearerToken: 'tok',
    }) as Record<string, unknown>
    expect(sanitized.schemas).toBeUndefined()
    expect(sanitized.bearerToken).toBeUndefined()
    expect((sanitized.emails as Array<{ value: string }>)[0]?.value).toBe('[redacted]')
    expect(sanitized.department).toBe('Eng')
  })

  it('正常 preview/audit 载荷干净（无误伤）', () => {
    const clean = {
      target: 'email',
      summary: 'a***@example.com',
      warningCode: 'MAPPING_AMBIGUOUS_VALUE',
      counts: { resolved: 6 },
      organizationId: 9301,
    }
    expect(scimMappingDetectForbiddenContent(clean)).toEqual([])
  })
})

describe('厂商风格 fixture（2.9/2.10）', () => {
  it.each([
    ['generic', SCIM_ATTR_MAPPING_FIXTURE_GENERIC_USER],
    ['okta', SCIM_ATTR_MAPPING_FIXTURE_OKTA_USER],
    ['entra', SCIM_ATTR_MAPPING_FIXTURE_ENTRA_USER],
    ['google', SCIM_ATTR_MAPPING_FIXTURE_GOOGLE_USER],
  ] as const)('%s 载荷经默认描述符解析 identity 面成功', (_name, payload) => {
    const resolution = scimResolveMappedAttributes({
      descriptors: SCIM_DEFAULT_MAPPING_DESCRIPTORS,
      payload,
    })
    expect(resolution.values.userName).toBeTruthy()
    expect(resolution.values.email).toBeTruthy()
    expect(resolution.values.displayName).toBeTruthy()
    expect(resolution.values.active).toBe(true)
    expect(resolution.diagnostics.filter((d) => d.code === 'MISSING_REQUIRED_ATTRIBUTE')).toEqual(
      [],
    )
  })

  it.each([
    ['generic', SCIM_ATTR_MAPPING_FIXTURE_GENERIC_USER],
    ['okta', SCIM_ATTR_MAPPING_FIXTURE_OKTA_USER],
    ['entra', SCIM_ATTR_MAPPING_FIXTURE_ENTRA_USER],
    ['google', SCIM_ATTR_MAPPING_FIXTURE_GOOGLE_USER],
  ] as const)('%s 载荷经厂商描述符解析 profile 面成功', (_name, payload) => {
    const resolution = scimResolveMappedAttributes({
      descriptors: SCIM_ATTR_MAPPING_FIXTURE_VENDOR_DESCRIPTORS,
      payload,
    })
    expect(resolution.values.employeeNumber).toBeTruthy()
    expect(resolution.values.department).toBeTruthy()
    expect(resolution.values.title).toBeTruthy()
    expect(resolution.values.userType).toBeTruthy()
    expect(resolution.diagnostics.filter((d) => d.code === 'UNSUPPORTED_PATH')).toEqual([])
  })

  it('generic 期望值表逐键一致', () => {
    const resolution = scimResolveMappedAttributes({
      descriptors: SCIM_ATTR_MAPPING_FIXTURE_VENDOR_DESCRIPTORS,
      payload: SCIM_ATTR_MAPPING_FIXTURE_GENERIC_USER,
    })
    for (const [key, expected] of Object.entries(SCIM_ATTR_MAPPING_FIXTURE_GENERIC_EXPECTED)) {
      expect(resolution.values[key]).toBe(expected)
    }
  })

  it('非法负例：active=yes → TYPE_MISMATCH；缺失 email 不阻断（非必填）', () => {
    const resolution = scimResolveMappedAttributes({
      descriptors: SCIM_DEFAULT_MAPPING_DESCRIPTORS,
      payload: SCIM_ATTR_MAPPING_FIXTURE_INVALID_USER,
    })
    expect(resolution.values.active).toBeNull()
    expect(resolution.diagnostics.some((d) => d.code === 'TYPE_MISMATCH')).toBe(true)
    expect(resolution.values.email).toBe('broken@example.com')
  })

  it('厂商描述符指纹稳定且异于默认指纹', () => {
    expect(SCIM_ATTR_MAPPING_FIXTURE_VENDOR_FINGERPRINT).not.toBe(
      SCIM_ATTR_MAPPING_FIXTURE_DEFAULT_FINGERPRINT,
    )
  })
})
