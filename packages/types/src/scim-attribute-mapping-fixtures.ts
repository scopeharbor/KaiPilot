// @aiproj/types — v3-scim-attribute-mapping 契约夹具（§2.9）。
//
// 纯数据，零副作用，零网络。四个厂商风格的 SCIM User 载荷均为**编造测试值**，
// 不对应任何真实 IdP 用户；用于 preview/resolver 测试与前端示例。
//
// ⚠️ 不接触真实 IdP：本文件无任何网络入口；测试里出现的 token/externalId/邮箱
//    全部是虚构值。

import {
  SCIM_DEFAULT_MAPPING_DESCRIPTORS,
  SCIM_ENTERPRISE_EXTENSION_URN,
  scimComputeAttributeMappingFingerprint,
  type ScimMappingDescriptorList,
} from './scim-attribute-mapping.js'

/** 通用 RFC 7643 风格 User（核心属性 + enterprise extension）。 */
export const SCIM_ATTR_MAPPING_FIXTURE_GENERIC_USER: Record<string, unknown> = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', SCIM_ENTERPRISE_EXTENSION_URN],
  externalId: 'gen-1001',
  userName: 'alice.generic',
  name: { givenName: 'Alice', familyName: 'Generic' },
  displayName: 'Alice Generic',
  active: true,
  userType: 'Employee',
  title: 'Staff Engineer',
  emails: [
    { value: 'alice.work@example.com', type: 'work', primary: true },
    { value: 'alice.personal@example.com', type: 'home' },
  ],
  [SCIM_ENTERPRISE_EXTENSION_URN]: {
    employeeNumber: 'G-1001',
    department: 'Engineering',
    organization: 'Example Corp',
    division: 'Platform',
  },
}

/** Okta 风格 User（emails type=work primary；enterprise extension 齐全）。 */
export const SCIM_ATTR_MAPPING_FIXTURE_OKTA_USER: Record<string, unknown> = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', SCIM_ENTERPRISE_EXTENSION_URN],
  externalId: '00u1abcde2FGHIjklm3n4',
  userName: 'bob.okta',
  name: { givenName: 'Bob', familyName: 'Oktenberg' },
  displayName: 'Bob Oktenberg',
  active: true,
  userType: 'Employee',
  title: 'Product Manager',
  emails: [
    { value: 'bob.primary@example.com', type: 'work', primary: true },
    { value: 'bob.secondary@example.com', type: 'work', primary: false },
  ],
  [SCIM_ENTERPRISE_EXTENSION_URN]: {
    employeeNumber: 'O-4242',
    costCenter: 'CC-100',
    organization: 'Example Corp',
    division: 'Product',
    department: 'Product Management',
    manager: { value: 'alice.generic', displayName: 'Alice Generic' },
  },
}

/** Microsoft Entra ID 风格 User（userType=Member；enterprise extension 属性）。 */
export const SCIM_ATTR_MAPPING_FIXTURE_ENTRA_USER: Record<string, unknown> = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', SCIM_ENTERPRISE_EXTENSION_URN],
  externalId: 'a8f1c2d3-4e5f-6a7b-8c9d-0e1f2a3b4c5d',
  userName: 'carol@example.onmicrosoft.com',
  name: { givenName: 'Carol', familyName: 'Entra' },
  displayName: 'Carol Entra',
  active: true,
  userType: 'Member',
  title: 'Security Analyst',
  emails: [{ value: 'carol@example.com', type: 'work', primary: true }],
  [SCIM_ENTERPRISE_EXTENSION_URN]: {
    employeeNumber: 'E-7777',
    department: 'Security',
    organization: 'Example Corp',
  },
}

/** Google Workspace 风格 User（name 拆分 + department 在 enterprise extension）。 */
export const SCIM_ATTR_MAPPING_FIXTURE_GOOGLE_USER: Record<string, unknown> = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', SCIM_ENTERPRISE_EXTENSION_URN],
  externalId: '11223344556677889900',
  userName: 'dave.google',
  name: { givenName: 'Dave', familyName: 'Gogle' },
  displayName: 'Dave Gogle',
  active: true,
  userType: 'Employee',
  title: 'Site Reliability Engineer',
  emails: [
    { value: 'dave@example.com', type: 'work', primary: true },
    { value: 'dave.alt@example.com', type: 'work' },
  ],
  [SCIM_ENTERPRISE_EXTENSION_URN]: {
    employeeNumber: 'G-2024',
    department: 'Infrastructure',
    organization: 'Example Corp',
  },
}

/** 缺必需字段的负例（无 userName、无 primary email、active 为字符串 'yes'）。 */
export const SCIM_ATTR_MAPPING_FIXTURE_INVALID_USER: Record<string, unknown> = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  externalId: 'bad-1',
  displayName: 'Broken User',
  active: 'yes',
  emails: [{ value: 'broken@example.com', type: 'work' }],
}

/** 多 primary email 的歧义负例。 */
export const SCIM_ATTR_MAPPING_FIXTURE_AMBIGUOUS_EMAILS_USER: Record<string, unknown> = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  externalId: 'amb-1',
  userName: 'amb.user',
  displayName: 'Ambiguous User',
  active: true,
  emails: [
    { value: 'one@example.com', primary: true },
    { value: 'two@example.com', primary: true },
  ],
}

/** 厂商风格载荷的推荐映射描述符（示例；都可经默认描述符解析）。 */
export const SCIM_ATTR_MAPPING_FIXTURE_VENDOR_DESCRIPTORS: ScimMappingDescriptorList = [
  ...SCIM_DEFAULT_MAPPING_DESCRIPTORS,
  {
    path: 'enterprise:employeeNumber',
    target: 'employeeNumber',
    required: false,
    normalization: 'profile',
  },
  {
    path: 'enterprise:department',
    target: 'department',
    required: false,
    normalization: 'profile',
  },
  { path: 'title', target: 'title', required: false, normalization: 'profile' },
  { path: 'userType', target: 'userType', required: false, normalization: 'profile' },
]

/** 期望解析：generic 用户在各目标上的值（用于 fixture 测试断言）。 */
export const SCIM_ATTR_MAPPING_FIXTURE_GENERIC_EXPECTED: Record<string, string | boolean | null> = {
  email: 'alice.work@example.com',
  userName: 'alice.generic',
  displayName: 'Alice Generic',
  givenName: 'Alice',
  familyName: 'Generic',
  active: true,
  employeeNumber: 'G-1001',
  department: 'Engineering',
  title: 'Staff Engineer',
  userType: 'Employee',
}

/** 默认描述符 + 厂商描述符的指纹（稳定性断言用）。 */
export const SCIM_ATTR_MAPPING_FIXTURE_DEFAULT_FINGERPRINT = scimComputeAttributeMappingFingerprint(
  SCIM_DEFAULT_MAPPING_DESCRIPTORS,
)

export const SCIM_ATTR_MAPPING_FIXTURE_VENDOR_FINGERPRINT = scimComputeAttributeMappingFingerprint(
  SCIM_ATTR_MAPPING_FIXTURE_VENDOR_DESCRIPTORS,
)
