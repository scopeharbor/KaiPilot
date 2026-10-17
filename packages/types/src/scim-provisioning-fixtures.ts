// @aiproj/types — v3-scim-provisioning 契约夹具（§2.3）。
//
// 纯数据，零副作用。两组织镜像（同名组/同邮箱、不同组织）+ 负例：
// 禁止字段、raw SCIM 载荷、越权角色映射、非法过滤/分页、泄漏型事件。
//
// ⚠️ 本文件里的 endpoint key / token / externalId / 邮箱均为**编造的测试值**，
//    不对应任何真实 IdP；真实 token 的生成与哈希只发生在后端（node:crypto）。

import {
  SCIM_DEFAULT_ATTRIBUTE_MAPPING,
  scimComputeEndpointKeyRef,
  scimComputeProviderRef,
  scimComputeTokenFingerprint,
  scimComputeTokenRef,
  scimNormalizeGroupRoleMapping,
  scimNormalizeJitPolicy,
  type ScimGroupRoleMapping,
  type ScimJitPolicy,
  type ScimProviderSummary,
  type ScimTokenSummary,
  type ScimUserResource,
  type ScimGroupResource,
  type ScimSyncEventSummary,
} from './scim-provisioning.js'

export const SCIM_FIXTURE_ORG_A = 9301
export const SCIM_FIXTURE_ORG_B = 9302

export const SCIM_FIXTURE_PROVIDER_ID_A = 701
export const SCIM_FIXTURE_PROVIDER_ID_B = 702

/** 编造的 endpoint key（仅测试用；真实生成在后端）。 */
export const SCIM_FIXTURE_ENDPOINT_KEY_A = 'epk_AAAAAAAAAAAAAAAAAAAAAAAAAA'
export const SCIM_FIXTURE_ENDPOINT_KEY_B = 'epk_BBBBBBBBBBBBBBBBBBBBBBBBBB'

/** 编造的 bearer token（仅测试用）。 */
export const SCIM_FIXTURE_TOKEN_A = 'tok_fixture_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
export const SCIM_FIXTURE_TOKEN_B = 'tok_fixture_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

export const SCIM_FIXTURE_JIT_DISABLED: ScimJitPolicy = {
  enabled: false,
  defaultRole: 'member',
  linkByEmail: false,
}

export const SCIM_FIXTURE_JIT_ENABLED: ScimJitPolicy = {
  enabled: true,
  defaultRole: 'member',
  linkByEmail: true,
}

/** 组 → 角色映射：A 组织把「研发组」映射为 member（B 组织同名但映射 viewer）。 */
export const SCIM_FIXTURE_GROUP_MAPPING_A: ScimGroupRoleMapping = { 研发组: 'member' }
export const SCIM_FIXTURE_GROUP_MAPPING_B: ScimGroupRoleMapping = { 研发组: 'viewer' }

function fixtureProvider(
  organizationId: number,
  providerId: number,
  overrides: Partial<ScimProviderSummary> = {},
): ScimProviderSummary {
  const endpointKey =
    organizationId === SCIM_FIXTURE_ORG_A
      ? SCIM_FIXTURE_ENDPOINT_KEY_A
      : SCIM_FIXTURE_ENDPOINT_KEY_B
  const groupMapping =
    organizationId === SCIM_FIXTURE_ORG_A
      ? SCIM_FIXTURE_GROUP_MAPPING_A
      : SCIM_FIXTURE_GROUP_MAPPING_B
  return {
    providerRef: scimComputeProviderRef(organizationId, providerId),
    organizationId,
    status: 'enabled',
    // 两组织**同展示名**：跨租测试要靠它证明「同名不穿透」。
    displayName: '企业目录同步',
    endpointPath: `/api/v1/scim/v2/${endpointKey}`,
    endpointKeyRef: scimComputeEndpointKeyRef(endpointKey),
    featureFlags: {
      patchSupported: true,
      filterSupported: true,
      filterMaxResults: 100,
      bulkSupported: false,
      sortSupported: false,
      changePasswordSupported: false,
      etagSupported: false,
    },
    attributeMapping: SCIM_DEFAULT_ATTRIBUTE_MAPPING,
    groupRoleMapping: groupMapping,
    conflictPolicy: 'fail_closed',
    jitPolicy: SCIM_FIXTURE_JIT_DISABLED,
    warningCodes: [],
    updatedAt: '2026-08-16T00:00:00.000Z',
    ...overrides,
  }
}

/** 组织 A 的 provider（启用，JIT 关）。 */
export const SCIM_FIXTURE_PROVIDER_A: ScimProviderSummary = fixtureProvider(
  SCIM_FIXTURE_ORG_A,
  SCIM_FIXTURE_PROVIDER_ID_A,
)

/** 组织 B 的 provider（启用）——与 A **同展示名、同名组映射不同角色**。 */
export const SCIM_FIXTURE_PROVIDER_B: ScimProviderSummary = fixtureProvider(
  SCIM_FIXTURE_ORG_B,
  SCIM_FIXTURE_PROVIDER_ID_B,
)

/** 组织 A 的 provider（停用）。 */
export const SCIM_FIXTURE_PROVIDER_DISABLED: ScimProviderSummary = fixtureProvider(
  SCIM_FIXTURE_ORG_A,
  SCIM_FIXTURE_PROVIDER_ID_A,
  { status: 'disabled', warningCodes: ['PROVIDER_DISABLED'] },
)

/** 组织 A 的 provider（降级：token 缺失 + KMS 不可用）。 */
export const SCIM_FIXTURE_PROVIDER_DEGRADED: ScimProviderSummary = fixtureProvider(
  SCIM_FIXTURE_ORG_A,
  SCIM_FIXTURE_PROVIDER_ID_A,
  { status: 'degraded', warningCodes: ['TOKEN_MISSING', 'KMS_UNAVAILABLE'] },
)

/** token 摘要（组织 A，active）。 */
export const SCIM_FIXTURE_TOKEN_ACTIVE: ScimTokenSummary = {
  id: 1,
  tokenRef: scimComputeTokenRef(SCIM_FIXTURE_PROVIDER_ID_A, 1),
  fingerprint: scimComputeTokenFingerprint(SCIM_FIXTURE_TOKEN_A),
  status: 'active',
  lastUsedAt: '2026-08-16T01:00:00.000Z',
  failureCount: 0,
  createdAt: '2026-08-16T00:00:00.000Z',
  revokedAt: null,
  expiresAt: null,
}

/** token 摘要（组织 A，已吊销）。 */
export const SCIM_FIXTURE_TOKEN_REVOKED: ScimTokenSummary = {
  ...SCIM_FIXTURE_TOKEN_ACTIVE,
  status: 'revoked',
  revokedAt: '2026-08-16T02:00:00.000Z',
  failureCount: 3,
}

/** 组织 A 的 SCIM User（alice，active）。 */
export const SCIM_FIXTURE_USER_ALICE: ScimUserResource = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  id: 'u-9301-1',
  externalId: 'alice-0001',
  userName: 'alice@fixture-a.example',
  name: { givenName: '爱丽丝', familyName: '测试' },
  displayName: '爱丽丝 测试',
  emails: [{ value: 'alice@fixture-a.example', primary: true }],
  active: true,
  meta: {
    resourceType: 'User',
    created: '2026-08-16T00:00:00.000Z',
    lastModified: '2026-08-16T00:00:00.000Z',
    version: '1',
  },
}

/** 组织 B 的 SCIM User（alice，**同邮箱**不同 externalId——跨租隐藏用例）。 */
export const SCIM_FIXTURE_USER_ALICE_ORG_B: ScimUserResource = {
  ...SCIM_FIXTURE_USER_ALICE,
  id: 'u-9302-1',
  externalId: 'alice-9999',
  userName: 'alice@fixture-b.example',
  emails: [{ value: 'alice@fixture-b.example', primary: true }],
}

/** 组织 A 的 SCIM User（bob，inactive）。 */
export const SCIM_FIXTURE_USER_BOB_INACTIVE: ScimUserResource = {
  ...SCIM_FIXTURE_USER_ALICE,
  id: 'u-9301-2',
  externalId: 'bob-0002',
  userName: 'bob@fixture-a.example',
  displayName: '鲍勃 测试',
  emails: [{ value: 'bob@fixture-a.example', primary: true }],
  active: false,
}

/** 组织 A 的 SCIM Group。 */
export const SCIM_FIXTURE_GROUP_RESEARCH: ScimGroupResource = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
  id: 'g-9301-1',
  externalId: 'group-research-0001',
  displayName: '研发组',
  members: [{ value: 'u-9301-1', display: '爱丽丝 测试' }],
  meta: {
    resourceType: 'Group',
    created: '2026-08-16T00:00:00.000Z',
    lastModified: '2026-08-16T00:00:00.000Z',
    version: '1',
  },
}

/** PATCH 操作夹具。 */
export const SCIM_FIXTURE_PATCH_ACTIVE_FALSE = {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
  Operations: [{ op: 'replace', path: 'active', value: false }],
}

export const SCIM_FIXTURE_PATCH_ADD_GROUP = {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
  Operations: [{ op: 'add', path: 'groups', value: [{ value: 'g-9301-1', display: '研发组' }] }],
}

/** 非法 PATCH：owner 路径（契约层必须拒绝）。 */
export const SCIM_FIXTURE_PATCH_OWNER_PATH = {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
  Operations: [{ op: 'replace', path: 'organization.ownerId', value: 'u-9999' }],
}

/** 过滤夹具（合法 / 非法）。 */
export const SCIM_FIXTURE_FILTER_VALID = 'userName eq "alice@fixture-a.example"'
export const SCIM_FIXTURE_FILTER_UNSUPPORTED = 'userName co "alice"'
export const SCIM_FIXTURE_FILTER_MALFORMED = 'userName eq alice'
export const SCIM_FIXTURE_FILTER_UNKNOWN_ATTR = 'favoriteColor eq "blue"'

/** 低敏同步事件。 */
export const SCIM_FIXTURE_SYNC_EVENT: ScimSyncEventSummary = {
  eventRef: 'evt-fixture-0001',
  occurredAt: '2026-08-16T00:00:00.000Z',
  event: 'scim.user.provisioned',
  providerRef: scimComputeProviderRef(SCIM_FIXTURE_ORG_A, SCIM_FIXTURE_PROVIDER_ID_A),
  reasonCode: 'SCIM_OK',
  counts: { created: 1, updated: 0, deprovisioned: 0 },
  warningCodes: [],
}

/**
 * 泄漏负例：低敏面上**绝不允许**出现的字段/载荷（契约测试断言全被检出）。
 */
export const SCIM_FIXTURE_LEAKY_PAYLOAD = {
  providerRef: 'ref-fixture',
  bearerToken: 'tok_fixture_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  authorizationHeader: 'Bearer tok_fixture_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  rawPayload: '{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"userName":"alice"}',
  rawScimPayload: SCIM_FIXTURE_USER_ALICE,
  externalAttributes: { department: '研发', manager: 'bob@fixture-a.example' },
  rawEmails: ['alice@fixture-a.example', 'alice.private@example.org'],
  endpointKey: SCIM_FIXTURE_ENDPOINT_KEY_A,
  tokenValue: SCIM_FIXTURE_TOKEN_A,
  password: 'hunter2',
  nested: {
    note: '正常字段应保留',
    scimPayload: { schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'] },
  },
  list: [{ rawUserPayload: SCIM_FIXTURE_USER_BOB_INACTIVE }],
}

/** 值形态像 raw SCIM 载荷的样例（检测函数应全部命中）。 */
export const SCIM_FIXTURE_RAW_PAYLOAD_VALUES: string[] = [
  '{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"userName":"alice"}',
  'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  'tok_fixture_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '{"Resources":[{"id":"u-1"}]}',
]

/** 越权角色映射样例（夹紧函数应全部拒绝 owner，JIT 默认角色降到 member）。 */
export const SCIM_FIXTURE_ESCALATED_ROLES: string[] = ['owner', 'super_admin', 'ceo', 'root']
export const SCIM_FIXTURE_JIT_ESCALATED_DEFAULT: string[] = ['owner', 'admin', 'super_admin']

/** 归一化后的组角色映射（供测试断言与后端复用）。 */
export const SCIM_FIXTURE_GROUP_MAPPING_A_NORMALIZED = scimNormalizeGroupRoleMapping(
  SCIM_FIXTURE_GROUP_MAPPING_A,
)
export const SCIM_FIXTURE_JIT_POLICY_A_NORMALIZED = scimNormalizeJitPolicy(SCIM_FIXTURE_JIT_ENABLED)
