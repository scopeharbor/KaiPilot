// v3-scim-provisioning —— 共享 SCIM 契约单测（§2.4 / §2.6）。
// 覆盖：枚举完备性、确定性 hash/ref（跨租隔离、键序无关）、归一化与角色夹紧、
// 冲突策略解析、过滤/分页有界解析、RFC 兼容错误构建与项目错误码映射、
// 低敏脱敏（bearer token / Authorization / raw SCIM 载荷 / 外部属性 / 密码）、
// 审计负载 no-secret 序列化、格式校验。
import { describe, it, expect } from 'vitest'
import {
  SCIM_ALLOWED_ROLES,
  SCIM_AUDIT_EVENTS,
  SCIM_CONFLICT_POLICIES,
  SCIM_ENDPOINT_KEY_MAX_LENGTH,
  SCIM_ENDPOINT_KEY_MIN_LENGTH,
  SCIM_FINGERPRINT_LENGTH,
  SCIM_FORBIDDEN_KEYS,
  SCIM_GROUP_FILTER_ATTRIBUTES,
  SCIM_JIT_ALLOWED_ROLES,
  SCIM_LINK_MODES,
  SCIM_PROJECT_ERROR_CODES,
  SCIM_PROVIDER_STATUSES,
  SCIM_REASON_CODES,
  SCIM_REF_LENGTH,
  SCIM_TOKEN_MAX_LENGTH,
  SCIM_TOKEN_MIN_LENGTH,
  SCIM_TOKEN_STATUSES,
  SCIM_USER_FILTER_ATTRIBUTES,
  SCIM_WARNING_CODES,
  scimBuildAuditPayload,
  scimClampJitDefaultRole,
  scimClampPagination,
  scimClampRole,
  scimComputeEndpointKeyRef,
  scimComputeEventRef,
  scimComputeExternalIdRef,
  scimComputeMappingFingerprint,
  scimComputeProviderRef,
  scimComputeTokenFingerprint,
  scimComputeTokenRef,
  scimDetectForbiddenContent,
  scimErrorResponse,
  scimIsValidEndpointKeyFormat,
  scimIsValidTokenFormat,
  scimListResponse,
  scimLooksLikeRawScimPayload,
  scimNormalizeAttributeMapping,
  scimNormalizeDisplayName,
  scimNormalizeEmail,
  scimNormalizeGroupRoleMapping,
  scimNormalizeJitPolicy,
  scimNormalizeUserName,
  scimParseFilter,
  scimProjectErrorCode,
  scimResolveRole,
  scimRoleRank,
  scimSanitizeLowSensitive,
} from './scim-provisioning.js'
import {
  SCIM_FIXTURE_ENDPOINT_KEY_A,
  SCIM_FIXTURE_ESCALATED_ROLES,
  SCIM_FIXTURE_FILTER_MALFORMED,
  SCIM_FIXTURE_FILTER_UNKNOWN_ATTR,
  SCIM_FIXTURE_FILTER_UNSUPPORTED,
  SCIM_FIXTURE_FILTER_VALID,
  SCIM_FIXTURE_GROUP_MAPPING_A,
  SCIM_FIXTURE_GROUP_RESEARCH,
  SCIM_FIXTURE_JIT_ESCALATED_DEFAULT,
  SCIM_FIXTURE_LEAKY_PAYLOAD,
  SCIM_FIXTURE_ORG_A,
  SCIM_FIXTURE_ORG_B,
  SCIM_FIXTURE_PROVIDER_A,
  SCIM_FIXTURE_PROVIDER_B,
  SCIM_FIXTURE_PROVIDER_ID_A,
  SCIM_FIXTURE_PROVIDER_ID_B,
  SCIM_FIXTURE_RAW_PAYLOAD_VALUES,
  SCIM_FIXTURE_TOKEN_A,
  SCIM_FIXTURE_TOKEN_ACTIVE,
  SCIM_FIXTURE_USER_ALICE,
} from './scim-provisioning-fixtures.js'

describe('scim 枚举完备性', () => {
  it('每个枚举都非空且无重复', () => {
    const enums: Array<readonly string[]> = [
      SCIM_PROVIDER_STATUSES,
      SCIM_TOKEN_STATUSES,
      SCIM_ALLOWED_ROLES,
      SCIM_JIT_ALLOWED_ROLES,
      SCIM_CONFLICT_POLICIES,
      SCIM_LINK_MODES,
      SCIM_WARNING_CODES,
      SCIM_REASON_CODES,
      SCIM_PROJECT_ERROR_CODES,
      SCIM_AUDIT_EVENTS,
      SCIM_USER_FILTER_ATTRIBUTES,
      SCIM_GROUP_FILTER_ATTRIBUTES,
    ]
    for (const list of enums) {
      expect(list.length).toBeGreaterThan(0)
      expect(new Set(list).size).toBe(list.length)
    }
  })

  it('角色枚举排除 owner，JIT 默认角色不超过 member', () => {
    expect(SCIM_ALLOWED_ROLES).not.toContain('owner')
    expect(SCIM_JIT_ALLOWED_ROLES).toEqual(['viewer', 'member'])
  })

  it('过滤属性白名单与 design Decision 4 对齐', () => {
    expect(SCIM_USER_FILTER_ATTRIBUTES).toEqual([
      'id',
      'externalId',
      'userName',
      'active',
      'displayName',
    ])
    expect(SCIM_GROUP_FILTER_ATTRIBUTES).toEqual(['id', 'externalId', 'displayName'])
  })
})

describe('scim 确定性 hash / ref', () => {
  it('相同输入产生相同 ref，长度符合约定', () => {
    const a1 = scimComputeProviderRef(SCIM_FIXTURE_ORG_A, SCIM_FIXTURE_PROVIDER_ID_A)
    const a2 = scimComputeProviderRef(SCIM_FIXTURE_ORG_A, SCIM_FIXTURE_PROVIDER_ID_A)
    expect(a1).toBe(a2)
    expect(a1).toHaveLength(SCIM_REF_LENGTH)
    expect(/^[0-9a-f]+$/.test(a1)).toBe(true)
  })

  it('不同组织/不同 provider 的 ref 不碰撞', () => {
    const refs = [
      scimComputeProviderRef(SCIM_FIXTURE_ORG_A, SCIM_FIXTURE_PROVIDER_ID_A),
      scimComputeProviderRef(SCIM_FIXTURE_ORG_A, SCIM_FIXTURE_PROVIDER_ID_B),
      scimComputeProviderRef(SCIM_FIXTURE_ORG_B, SCIM_FIXTURE_PROVIDER_ID_A),
    ]
    expect(new Set(refs).size).toBe(3)
  })

  it('token 指纹与 token ref 分离：指纹 32 位、ref 16 位，且不含 token 本体', () => {
    const fingerprint = scimComputeTokenFingerprint(SCIM_FIXTURE_TOKEN_A)
    expect(fingerprint).toHaveLength(SCIM_FINGERPRINT_LENGTH)
    expect(fingerprint).not.toContain(SCIM_FIXTURE_TOKEN_A)
    const ref = scimComputeTokenRef(SCIM_FIXTURE_PROVIDER_ID_A, 1)
    expect(ref).toHaveLength(SCIM_REF_LENGTH)
    // 同一 token 值 → 同一指纹（旋转/吊销后比对用）
    expect(scimComputeTokenFingerprint(SCIM_FIXTURE_TOKEN_A)).toBe(fingerprint)
  })

  it('endpoint key ref 稳定且不含 key 本体', () => {
    const ref = scimComputeEndpointKeyRef(SCIM_FIXTURE_ENDPOINT_KEY_A)
    expect(ref).toHaveLength(SCIM_REF_LENGTH)
    expect(ref).not.toContain(SCIM_FIXTURE_ENDPOINT_KEY_A)
    expect(scimComputeEndpointKeyRef(SCIM_FIXTURE_ENDPOINT_KEY_A)).toBe(ref)
  })

  it('externalId ref 只存 hash，空值返回 null', () => {
    const ref = scimComputeExternalIdRef('alice-0001')
    expect(ref).toHaveLength(SCIM_REF_LENGTH)
    expect(ref).not.toContain('alice')
    expect(scimComputeExternalIdRef(null)).toBeNull()
    expect(scimComputeExternalIdRef('')).toBeNull()
  })

  it('映射指纹与键序无关（稳定序列化）', () => {
    const base = {
      attributeMapping: SCIM_FIXTURE_PROVIDER_A.attributeMapping,
      groupRoleMapping: SCIM_FIXTURE_GROUP_MAPPING_A,
      conflictPolicy: 'fail_closed' as const,
      jitPolicy: SCIM_FIXTURE_PROVIDER_A.jitPolicy,
    }
    const reordered = {
      jitPolicy: SCIM_FIXTURE_PROVIDER_A.jitPolicy,
      conflictPolicy: 'fail_closed' as const,
      attributeMapping: SCIM_FIXTURE_PROVIDER_A.attributeMapping,
      groupRoleMapping: { 研发组: 'member' },
    }
    expect(scimComputeMappingFingerprint(base)).toBe(scimComputeMappingFingerprint(reordered))
    // 角色变化 → 指纹变化（管理面「配置是否变过」判断依赖它）
    const changed = {
      ...base,
      groupRoleMapping: { 研发组: 'admin' },
    }
    expect(scimComputeMappingFingerprint(changed)).not.toBe(scimComputeMappingFingerprint(base))
  })

  it('事件 ref 在同一时刻内确定、跨时刻不同', () => {
    const input = {
      organizationId: SCIM_FIXTURE_ORG_A,
      providerId: SCIM_FIXTURE_PROVIDER_ID_A,
      event: 'scim.user.provisioned' as const,
      occurredAt: '2026-08-16T00:00:00.000Z',
    }
    expect(scimComputeEventRef(input)).toBe(scimComputeEventRef(input))
    expect(scimComputeEventRef({ ...input, occurredAt: '2026-08-16T00:00:01.000Z' })).not.toBe(
      scimComputeEventRef(input),
    )
  })
})

describe('scim 归一化', () => {
  it('userName / email / displayName 归一化', () => {
    expect(scimNormalizeUserName('  Alice@Example.COM ')).toBe('alice@example.com')
    expect(scimNormalizeEmail('  BOB@EXAMPLE.org ')).toBe('bob@example.org')
    expect(scimNormalizeDisplayName('  研发组  ')).toBe('研发组')
    expect(scimNormalizeUserName(null)).toBe('')
  })

  it('属性映射：非法/空路径回落默认，合法路径保留', () => {
    const normalized = scimNormalizeAttributeMapping({
      emailAttribute: 'emails',
      userNameAttribute: '',
      displayNameAttribute: '../evil',
      givenNameAttribute: 'name.givenName',
      familyNameAttribute: 'name.familyName',
      activeAttribute: 'active',
    })
    expect(normalized.emailAttribute).toBe('emails')
    expect(normalized.userNameAttribute).toBe('userName') // 空 → 默认
    expect(normalized.displayNameAttribute).toBe('displayName') // 非法字符 → 默认
    expect(normalized.givenNameAttribute).toBe('name.givenName')
  })

  it('组角色映射：owner 被丢弃并上报，重复组名后者覆盖', () => {
    // 重复场景 = 归一化后撞名（对象键本身不能重复）：'研发组' 与 ' 研发组 '。
    const input: Record<string, unknown> = {
      研发组: 'member',
      管理组: 'owner',
      运维组: 'admin',
      ' 研发组 ': 'viewer',
    }
    const { mapping, droppedOwner, duplicates } = scimNormalizeGroupRoleMapping(input)
    expect(mapping).toEqual({ 研发组: 'viewer', 运维组: 'admin' })
    expect(droppedOwner).toEqual(['管理组'])
    expect(duplicates).toEqual(['研发组'])
    expect(scimNormalizeGroupRoleMapping(null).mapping).toEqual({})
  })

  it('JIT 策略：默认角色夹紧，owner/admin 降到 member', () => {
    for (const role of SCIM_FIXTURE_JIT_ESCALATED_DEFAULT) {
      expect(scimClampJitDefaultRole(role)).toBe('member')
    }
    expect(scimClampJitDefaultRole('viewer')).toBe('viewer')
    const policy = scimNormalizeJitPolicy({
      enabled: true,
      defaultRole: 'admin',
      linkByEmail: true,
    })
    expect(policy).toEqual({ enabled: true, defaultRole: 'member', linkByEmail: true })
    expect(scimNormalizeJitPolicy(undefined)).toEqual({
      enabled: false,
      defaultRole: 'member',
      linkByEmail: false,
    })
  })
})

describe('scim 角色夹紧与冲突解析', () => {
  it('owner 及任意未知角色 → null（拒绝）', () => {
    for (const role of SCIM_FIXTURE_ESCALATED_ROLES) {
      expect(scimClampRole(role)).toBeNull()
    }
    expect(scimClampRole('member')).toBe('member')
    expect(scimClampRole('admin')).toBe('admin')
    expect(scimClampRole(null)).toBeNull()
  })

  it('角色秩 admin > member > viewer', () => {
    expect(scimRoleRank('viewer')).toBeLessThan(scimRoleRank('member'))
    expect(scimRoleRank('member')).toBeLessThan(scimRoleRank('admin'))
  })

  it('fail_closed：多角色冲突 → 无角色 + conflict', () => {
    const result = scimResolveRole(['member', 'admin'], 'fail_closed')
    expect(result).toEqual({ role: null, conflict: true })
    expect(scimResolveRole(['member'], 'fail_closed')).toEqual({ role: 'member', conflict: false })
    expect(scimResolveRole([], 'fail_closed')).toEqual({ role: null, conflict: false })
    // 重复角色不算冲突
    expect(scimResolveRole(['admin', 'admin'], 'fail_closed')).toEqual({
      role: 'admin',
      conflict: false,
    })
  })

  it('highest：多角色冲突取最高秩', () => {
    const result = scimResolveRole(['member', 'admin', 'viewer'], 'highest')
    expect(result).toEqual({ role: 'admin', conflict: false })
    expect(scimResolveRole(['viewer', 'member'], 'highest')).toEqual({
      role: 'member',
      conflict: false,
    })
  })
})

describe('scim 格式校验', () => {
  it('endpoint key 格式：长度与字符集', () => {
    expect(scimIsValidEndpointKeyFormat(SCIM_FIXTURE_ENDPOINT_KEY_A)).toBe(true)
    expect(scimIsValidEndpointKeyFormat('short')).toBe(false)
    expect(scimIsValidEndpointKeyFormat('x'.repeat(SCIM_ENDPOINT_KEY_MIN_LENGTH))).toBe(true)
    expect(scimIsValidEndpointKeyFormat('x'.repeat(SCIM_ENDPOINT_KEY_MAX_LENGTH + 1))).toBe(false)
    expect(scimIsValidEndpointKeyFormat('a'.repeat(40) + '!')).toBe(false)
    expect(scimIsValidEndpointKeyFormat(null)).toBe(false)
  })

  it('bearer token 格式：长度与字符集', () => {
    expect(scimIsValidTokenFormat(SCIM_FIXTURE_TOKEN_A)).toBe(true)
    expect(scimIsValidTokenFormat('abc')).toBe(false)
    expect(scimIsValidTokenFormat('x'.repeat(SCIM_TOKEN_MIN_LENGTH))).toBe(true)
    expect(scimIsValidTokenFormat('x'.repeat(SCIM_TOKEN_MAX_LENGTH + 1))).toBe(false)
    expect(scimIsValidTokenFormat('a'.repeat(40) + ' ')).toBe(false)
  })
})

describe('scim 过滤解析（有界）', () => {
  it('合法精确 eq 过滤被解析（含转义引号）', () => {
    const result = scimParseFilter(SCIM_FIXTURE_FILTER_VALID, SCIM_USER_FILTER_ATTRIBUTES)
    expect(result).toEqual({
      ok: true,
      attribute: 'userName',
      value: 'alice@fixture-a.example',
    })
    const escaped = scimParseFilter('displayName eq "a\\"b"', SCIM_USER_FILTER_ATTRIBUTES)
    expect(escaped).toEqual({ ok: true, attribute: 'displayName', value: 'a"b' })
    const active = scimParseFilter('active eq "true"', SCIM_USER_FILTER_ATTRIBUTES)
    expect(active).toEqual({ ok: true, attribute: 'active', value: 'true' })
  })

  it('不受支持的运算符/结构被拒绝为 FILTER_UNSUPPORTED', () => {
    for (const filter of [SCIM_FIXTURE_FILTER_UNSUPPORTED, 'userName pr', '(userName eq "a")']) {
      const result = scimParseFilter(filter, SCIM_USER_FILTER_ATTRIBUTES)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe('FILTER_UNSUPPORTED')
    }
    // 未知属性同样属于不支持（不是格式错误——避免把「属性名」当语法探测面）
    const unknown = scimParseFilter(SCIM_FIXTURE_FILTER_UNKNOWN_ATTR, SCIM_USER_FILTER_ATTRIBUTES)
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.reason).toBe('FILTER_UNSUPPORTED')
  })

  it('格式错误（引号不闭合等）被拒绝为 FILTER_MALFORMED', () => {
    const result = scimParseFilter(SCIM_FIXTURE_FILTER_MALFORMED, SCIM_USER_FILTER_ATTRIBUTES)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('FILTER_MALFORMED')
    const empty = scimParseFilter('', SCIM_USER_FILTER_ATTRIBUTES)
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.reason).toBe('FILTER_MALFORMED')
  })

  it('拒绝时不回显请求内容（非泄露 detail）', () => {
    const result = scimParseFilter(SCIM_FIXTURE_FILTER_MALFORMED, SCIM_USER_FILTER_ATTRIBUTES)
    if (!result.ok) {
      expect(result.detail).not.toContain('alice')
      expect(result.detail).not.toContain('eq')
    }
  })
})

describe('scim 分页夹紧', () => {
  it('count=0（RFC 语义=返回全部）被拒绝', () => {
    const result = scimClampPagination(1, 0)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('PAGINATION_UNBOUNDED')
    expect(scimClampPagination(1, -5).ok).toBe(false)
  })

  it('count 缺省 → maxResults；超限 → 夹紧', () => {
    const def = scimClampPagination(1, null, 100)
    expect(def.ok && def.pagination).toEqual({ startIndex: 1, count: 100 })
    const clamped = scimClampPagination(1, 5000, 100)
    expect(clamped.ok && clamped.pagination.count).toBe(100)
    const small = scimClampPagination(1, 25, 100)
    expect(small.ok && small.pagination.count).toBe(25)
  })

  it('startIndex < 1 夹紧到 1，非整数向下取整', () => {
    const low = scimClampPagination(0, 10, 100)
    expect(low.ok && low.pagination.startIndex).toBe(1)
    const float = scimClampPagination(2.9, 10.9, 100)
    expect(float.ok && float.pagination).toEqual({ startIndex: 2, count: 10 })
  })
})

describe('scim RFC 错误构建与错误码映射', () => {
  it('Error 响应形状符合 RFC 7644 §3.12', () => {
    const error = scimErrorResponse({
      status: 400,
      scimType: 'invalidFilter',
      detail: '过滤表达式无效',
    })
    expect(error.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error'])
    expect(error.status).toBe('400')
    expect(error.scimType).toBe('invalidFilter')
    expect(error.detail).toBe('过滤表达式无效')
    const bare = scimErrorResponse({ status: 401 })
    expect(bare.detail).toBeUndefined()
    expect(bare.scimType).toBeUndefined()
  })

  it('status/scimType → 项目错误码映射', () => {
    expect(scimProjectErrorCode(401)).toBe('SCIM_UNAUTHORIZED')
    expect(scimProjectErrorCode(403)).toBe('SCIM_UNAUTHORIZED')
    expect(scimProjectErrorCode(404)).toBe('SCIM_NOT_FOUND')
    expect(scimProjectErrorCode(409)).toBe('SCIM_CONFLICT')
    expect(scimProjectErrorCode(400)).toBe('SCIM_VALIDATION_ERROR')
    expect(scimProjectErrorCode(400, 'invalidFilter')).toBe('SCIM_VALIDATION_ERROR')
    expect(scimProjectErrorCode(501)).toBe('SCIM_UNSUPPORTED')
    expect(scimProjectErrorCode(500)).toBe('SCIM_SERVER_ERROR')
    for (const code of SCIM_PROJECT_ERROR_CODES) {
      expect(code.startsWith('SCIM_')).toBe(true)
    }
  })

  it('ListResponse 构建器形状正确', () => {
    const list = scimListResponse({
      totalResults: 1,
      itemsPerPage: 100,
      startIndex: 1,
      resources: [SCIM_FIXTURE_USER_ALICE],
    })
    expect(list.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:ListResponse'])
    expect(list.totalResults).toBe(1)
    expect(list.Resources).toHaveLength(1)
  })
})

describe('scim 低敏检测与脱敏', () => {
  it('泄漏负例的所有禁止字段都被检出', () => {
    const hits = scimDetectForbiddenContent(SCIM_FIXTURE_LEAKY_PAYLOAD)
    expect(hits.length).toBeGreaterThanOrEqual(9)
    for (const hit of hits) {
      expect(hit).toMatch(
        /\.(bearerToken|authorizationHeader|rawPayload|rawScimPayload|externalAttributes|rawEmails|endpointKey|tokenValue|password|scimPayload|rawUserPayload)/,
      )
    }
  })

  it('raw SCIM 载荷形态的值被检出', () => {
    for (const value of SCIM_FIXTURE_RAW_PAYLOAD_VALUES) {
      expect(scimLooksLikeRawScimPayload(value)).toBe(true)
    }
    expect(scimLooksLikeRawScimPayload('普通文案')).toBe(false)
    expect(scimLooksLikeRawScimPayload(42)).toBe(false)
    expect(scimLooksLikeRawScimPayload(null)).toBe(false)
  })

  it('脱敏删除禁止键并把 raw 载荷替换为占位符', () => {
    const sanitized = scimSanitizeLowSensitive(SCIM_FIXTURE_LEAKY_PAYLOAD)
    expect(sanitized).not.toHaveProperty('bearerToken')
    expect(sanitized).not.toHaveProperty('password')
    expect(sanitized).not.toHaveProperty('endpointKey')
    expect(sanitized).not.toHaveProperty('tokenValue')
    // 嵌套与数组同样被剥
    expect(sanitized.nested).not.toHaveProperty('scimPayload')
    expect(sanitized.list[0]).not.toHaveProperty('rawUserPayload')
    // 正常字段保留
    expect(sanitized.nested.note).toBe('正常字段应保留')
    expect(scimDetectForbiddenContent(sanitized)).toEqual([])
  })

  it('禁止键比较大小写不敏感', () => {
    const hits = scimDetectForbiddenContent({ BearerToken: 'x', RAW_PAYLOAD: 'y' })
    expect(hits).toHaveLength(2)
    const sanitized = scimSanitizeLowSensitive({ BearerToken: 'x', fine: 1 })
    expect(sanitized).toEqual({ fine: 1 })
  })

  it('审计载荷 no-secret 序列化：绝不含 token/密码/外部属性原文', () => {
    const payload = scimBuildAuditPayload({
      event: 'scim.user.provisioned',
      organizationId: SCIM_FIXTURE_ORG_A,
      providerRef: scimComputeProviderRef(SCIM_FIXTURE_ORG_A, SCIM_FIXTURE_PROVIDER_ID_A),
      tokenRef: scimComputeTokenRef(SCIM_FIXTURE_PROVIDER_ID_A, 1),
      externalIdRef: scimComputeExternalIdRef('alice-0001'),
      requestId: 'req-1',
      reasonCode: 'SCIM_OK',
      counts: { created: 1 },
      occurredAt: '2026-08-16T00:00:00.000Z',
    })
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('alice')
    expect(serialized).not.toContain('token_value')
    expect(serialized).not.toContain(SCIM_FIXTURE_TOKEN_A)
    expect(serialized).not.toContain('password')
    expect(scimDetectForbiddenContent(payload)).toEqual([])
  })

  it('误传禁止字段进审计载荷也会在构建时被剥掉', () => {
    const payload = scimBuildAuditPayload({
      event: 'scim.request.denied',
      organizationId: SCIM_FIXTURE_ORG_A,
      providerRef: null,
      occurredAt: '2026-08-16T00:00:00.000Z',
    }) as Record<string, unknown>
    payload.bearerToken = SCIM_FIXTURE_TOKEN_A
    payload.rawPayload = '{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"]}'
    const sanitized = scimSanitizeLowSensitive(payload)
    expect(sanitized).not.toHaveProperty('bearerToken')
    expect(sanitized).not.toHaveProperty('rawPayload')
  })
})

describe('scim fixture 一致性', () => {
  it('两组织 provider 同展示名、同组名但不同角色（跨租不穿透素材）', () => {
    expect(SCIM_FIXTURE_PROVIDER_A.displayName).toBe(SCIM_FIXTURE_PROVIDER_B.displayName)
    expect(SCIM_FIXTURE_PROVIDER_A.groupRoleMapping['研发组']).toBe('member')
    expect(SCIM_FIXTURE_PROVIDER_B.groupRoleMapping['研发组']).toBe('viewer')
    expect(SCIM_FIXTURE_PROVIDER_A.providerRef).not.toBe(SCIM_FIXTURE_PROVIDER_B.providerRef)
  })

  it('provider 摘要不含禁止字段', () => {
    expect(scimDetectForbiddenContent(SCIM_FIXTURE_PROVIDER_A)).toEqual([])
    expect(scimDetectForbiddenContent(SCIM_FIXTURE_TOKEN_ACTIVE)).toEqual([])
    expect(scimDetectForbiddenContent(SCIM_FIXTURE_GROUP_RESEARCH)).toEqual([])
  })

  it('token 摘要指纹与 fixture token 一致（后端比对用）', () => {
    expect(SCIM_FIXTURE_TOKEN_ACTIVE.fingerprint).toBe(
      scimComputeTokenFingerprint(SCIM_FIXTURE_TOKEN_A),
    )
  })
})
