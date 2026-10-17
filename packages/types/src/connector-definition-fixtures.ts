/**
 * connector-definition-fixtures —— V3 连接器定义契约测试夹具
 *
 * 覆盖：合法定义、非法定义（所有 blocking rule families）、
 * host snapshot fixtures、敏感值。
 */

import { CONNECTOR_DEFINITION_SCHEMA_VERSION } from './connector-definition.js'
import type {
  ConnectorDefinitionV1,
  ConnectorDefinitionHostSnapshot,
  ConnectorHostSeamEntry,
  ConnectorHostPermissionEntry,
  ConnectorHostAuthEntry,
} from './connector-definition.js'

// =============================================================================
// 1. 合法定义 fixtures
// =============================================================================

/** 最小合法定义（clean）。 */
export const VALID_CONNECTOR_MINIMAL: ConnectorDefinitionV1 = {
  definitionSchemaVersion: CONNECTOR_DEFINITION_SCHEMA_VERSION,
  identity: {
    connectorKey: 'demo.connector',
    displayName: 'Demo Connector',
    version: '1.0.0',
    providerKey: 'demo',
    category: 'other',
    provenance: { sourceRef: 'local:fixture', kind: 'local' },
  },
  compatibility: { hostContractVersion: '1.0.0' },
  auth: {
    kind: 'none',
  },
  schemas: [
    {
      schemaKey: 'demo.input',
      fields: [
        { fieldKey: 'title', type: 'string', required: true, description: '标题' },
        { fieldKey: 'count', type: 'integer', required: false, description: '数量' },
      ],
    },
    {
      schemaKey: 'demo.output',
      fields: [{ fieldKey: 'id', type: 'string', required: true }],
    },
  ],
  operations: [
    {
      operationKey: 'demo.query',
      kind: 'query',
      title: '查询示例',
      description: '只读查询',
      inputSchemaRef: 'demo.input',
      outputSchemaRef: 'demo.output',
      hostCapabilityRef: 'server-query',
      permissionRefs: ['demo.read'],
      scopeKind: 'organization',
      sideEffect: 'read-only',
      confirmation: 'not-required',
      idempotency: 'idempotent',
      networkPolicy: 'none',
    },
  ],
  protocolHints: {
    pagination: { mode: 'cursor', cursorField: 'id', maxPageSize: 100 },
    rateLimit: { maxRequestsPerWindow: 100, windowSeconds: 60, scope: 'per-connector' },
    retry: { retryPolicy: 'none', maxAttempts: 0 },
    errorTaxonomy: { categories: ['provider', 'validation'], retryableCategories: ['provider'] },
  },
  extensions: {
    icon: 'demo-icon',
    documentationRef: 'docs/demo.md',
    tags: ['demo', 'fixture'],
  },
}

/** 完整合法定义（含 trigger + action）。 */
export const VALID_CONNECTOR_FULL: ConnectorDefinitionV1 = {
  definitionSchemaVersion: CONNECTOR_DEFINITION_SCHEMA_VERSION,
  identity: {
    connectorKey: 'acme.full-connector',
    displayName: 'Acme Full Connector',
    description: '完整连接器示例，覆盖触发器与动作',
    version: '2.1.0',
    providerKey: 'acme',
    category: 'automation',
    provenance: { sourceRef: 'repo:github.com/acme/connector@abc123', kind: 'curated' },
  },
  compatibility: { hostContractVersion: '1.0.0' },
  auth: {
    kind: 'oauth2',
    hostCapabilityRef: 'auth.oauth2',
    profileRef: 'auth.profile.acme',
    scopeKeys: ['read:work', 'write:work'],
    credentialHandleFields: [
      { fieldKey: 'accessTokenHandle', displayName: 'Access Token Handle', required: true },
    ],
  },
  schemas: [
    {
      schemaKey: 'acme.issueInput',
      title: 'Issue Input',
      description: '创建任务的输入',
      fields: [
        { fieldKey: 'projectKey', type: 'string', required: true },
        { fieldKey: 'summary', type: 'string', required: true, description: '摘要' },
        {
          fieldKey: 'meta',
          type: 'object',
          required: false,
          fields: [
            { fieldKey: 'priority', type: 'string', enumValues: ['low', 'medium', 'high'] },
            { fieldKey: 'labels', type: 'array', itemType: 'string' },
          ],
        },
      ],
    },
    {
      schemaKey: 'acme.issueOutput',
      fields: [
        { fieldKey: 'issueId', type: 'string', required: true },
        { fieldKey: 'url', type: 'string', required: false },
      ],
    },
    {
      schemaKey: 'acme.triggerOutput',
      fields: [{ fieldKey: 'eventId', type: 'string', required: true }],
    },
  ],
  operations: [
    {
      operationKey: 'acme.onIssueCreated',
      kind: 'trigger',
      title: '任务创建触发器',
      description: '当外部任务创建时触发',
      outputSchemaRef: 'acme.triggerOutput',
      hostCapabilityRef: 'trigger.webhook',
      permissionRefs: ['acme.trigger'],
      scopeKind: 'project',
      sideEffect: 'read-only',
      confirmation: 'not-required',
      idempotency: 'idempotent',
      networkPolicy: 'host-brokered',
    },
    {
      operationKey: 'acme.queryIssues',
      kind: 'query',
      title: '查询任务',
      inputSchemaRef: 'acme.issueInput',
      outputSchemaRef: 'acme.issueOutput',
      hostCapabilityRef: 'server-query',
      permissionRefs: ['acme.read'],
      scopeKind: 'organization',
      sideEffect: 'read-only',
      confirmation: 'not-required',
      idempotency: 'idempotent',
    },
    {
      operationKey: 'acme.createIssue',
      kind: 'action',
      title: '创建任务',
      description: '提案式创建，需人工确认',
      inputSchemaRef: 'acme.issueInput',
      outputSchemaRef: 'acme.issueOutput',
      hostCapabilityRef: 'server-command-proposal',
      permissionRefs: ['acme.write'],
      scopeKind: 'project',
      sideEffect: 'proposal',
      confirmation: 'explicit',
      idempotency: 'non-idempotent',
      networkPolicy: 'host-brokered',
    },
  ],
  protocolHints: {
    pagination: { mode: 'cursor', cursorField: 'issueId', maxPageSize: 50 },
    rateLimit: { maxRequestsPerWindow: 60, windowSeconds: 60 },
    retry: { retryPolicy: 'exponential', maxAttempts: 3, initialDelayMs: 1000 },
    errorTaxonomy: {
      categories: ['provider', 'auth', 'rate-limit', 'validation', 'timeout', 'unavailable'],
    },
  },
  extensions: {
    icon: 'acme-icon',
    documentationRef: 'docs/acme-connector.md',
    tags: ['acme', 'automation'],
  },
}

// =============================================================================
// 2. 非法定义 fixtures（每个 blocking rule family 至少一个）
// =============================================================================

/** 未知 schema 版本。 */
export const INVALID_CONNECTOR_UNKNOWN_VERSION: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  definitionSchemaVersion: '2.0' as any,
}

/** 未知字段（顶层）。 */
export const INVALID_CONNECTOR_UNKNOWN_FIELD: Record<string, unknown> = {
  ...VALID_CONNECTOR_MINIMAL,
  handler: 'function() {}',
  unknownField: 'evil',
}

/** 非法 connectorKey（大写/空格）。 */
export const INVALID_CONNECTOR_BAD_KEY: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  identity: { ...VALID_CONNECTOR_MINIMAL.identity, connectorKey: 'Bad Key With Space' },
}

/** 非法 SemVer（latest）。 */
export const INVALID_CONNECTOR_LATEST: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  identity: { ...VALID_CONNECTOR_MINIMAL.identity, version: 'latest' },
}

/** 不完整 SemVer。 */
export const INVALID_CONNECTOR_INCOMPLETE: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  identity: { ...VALID_CONNECTOR_MINIMAL.identity, version: '1.0' },
}

/** 公开市场 authority。 */
export const INVALID_CONNECTOR_PUBLIC_MARKET: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  identity: {
    ...VALID_CONNECTOR_MINIMAL.identity,
    provenance: { sourceRef: 'public-marketplace:evil' },
  },
}

/** 重复 operation key。 */
export const INVALID_CONNECTOR_DUPLICATE_OP: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  operations: [
    { ...VALID_CONNECTOR_MINIMAL.operations[0]!, operationKey: 'dup.key' },
    { ...VALID_CONNECTOR_MINIMAL.operations[0]!, operationKey: 'dup.key' },
  ],
}

/** 重复 schema key。 */
export const INVALID_CONNECTOR_DUPLICATE_SCHEMA: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  schemas: [
    { schemaKey: 'dup.schema', fields: [{ fieldKey: 'a', type: 'string' }] },
    { schemaKey: 'dup.schema', fields: [{ fieldKey: 'b', type: 'string' }] },
  ],
}

/** 不兼容 host refs（未知 seam）。 */
export const INVALID_CONNECTOR_INCOMPATIBLE_REF: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  operations: [
    {
      ...VALID_CONNECTOR_MINIMAL.operations[0]!,
      hostCapabilityRef: 'unknown.seam.not-exist',
    },
  ],
}

/** secret 泄露（auth 中含 token 原值）。 */
export const INVALID_CONNECTOR_SECRET: Record<string, unknown> = {
  ...VALID_CONNECTOR_MINIMAL,
  auth: {
    kind: 'apiKey',
    hostCapabilityRef: 'auth.apikey',
    // 非法：直接包含 secret 原值字段
    token: 'sk_abc123456789012345678',
    apiKey: 'ghp_abc123456789012345678901234567890',
  },
}

/** 危险 schema 路径（绝对路径）。 */
export const INVALID_CONNECTOR_PATH_TRAVERSAL: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  extensions: {
    documentationRef: '../../escape/file.md',
  },
}

/** 原型污染键。 */
export const INVALID_CONNECTOR_PROTOTYPE_POLLUTION: Record<string, unknown> = {
  ...VALID_CONNECTOR_MINIMAL,
  extensions: {
    // @ts-ignore
    __proto__: { polluted: true },
  },
}

/** 隐式 global scope。 */
export const INVALID_CONNECTOR_GLOBAL_SCOPE: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  operations: [
    {
      ...VALID_CONNECTOR_MINIMAL.operations[0]!,
      scopeKind: 'global' as any,
    },
  ],
}

/** 越权 permission（permissionRefs 指向未授权）。 */
export const INVALID_CONNECTOR_PERMISSION_ESCALATION: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  operations: [
    {
      ...VALID_CONNECTOR_MINIMAL.operations[0]!,
      permissionRefs: ['unauthorized.permission'],
    },
  ],
}

/** 未授权网络（direct-allowed）。 */
export const INVALID_CONNECTOR_DIRECT_NETWORK: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  operations: [
    {
      ...VALID_CONNECTOR_MINIMAL.operations[0]!,
      networkPolicy: 'direct-allowed',
      sideEffect: 'external-action',
    },
  ],
}

/** 写操作缺少确认（formal-write + not-required）。 */
export const INVALID_CONNECTOR_MISSING_CONFIRMATION: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  operations: [
    {
      operationKey: 'demo.formalWrite',
      kind: 'action',
      title: '正式写入示例',
      inputSchemaRef: 'demo.input',
      outputSchemaRef: 'demo.output',
      hostCapabilityRef: 'server-command-proposal',
      permissionRefs: ['demo.write'],
      scopeKind: 'project',
      sideEffect: 'formal-write',
      confirmation: 'not-required',
      idempotency: 'non-idempotent',
    },
  ],
}

/** 非幂等重试（non-idempotent + exponential）。 */
export const INVALID_CONNECTOR_NON_IDEMPOTENT_RETRY: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  operations: [
    {
      operationKey: 'demo.write',
      kind: 'action',
      title: '非幂等写入',
      inputSchemaRef: 'demo.input',
      hostCapabilityRef: 'server-command-proposal',
      permissionRefs: ['demo.write'],
      scopeKind: 'project',
      sideEffect: 'formal-write',
      confirmation: 'explicit',
      idempotency: 'non-idempotent',
    },
  ],
  protocolHints: {
    ...VALID_CONNECTOR_MINIMAL.protocolHints!,
    retry: { retryPolicy: 'exponential', maxAttempts: 3 },
  },
}

/** 敏感嵌套 metadata（description 含 token）。 */
export const INVALID_CONNECTOR_SENSITIVE_METADATA: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  identity: {
    ...VALID_CONNECTOR_MINIMAL.identity,
    description: '包含 token sk_abc123456789012345678 的敏感描述',
  },
}

/** 危险 schema/path（URL ref）。 */
export const INVALID_CONNECTOR_URL_REF: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  schemas: [
    {
      schemaKey: 'demo.bad',
      fields: [{ fieldKey: 'bad', type: 'string', schemaRef: 'https://evil.com/schema' }],
    },
  ],
}

/** 任意类型 any。 */
export const INVALID_CONNECTOR_ANY_TYPE: Record<string, unknown> = {
  ...VALID_CONNECTOR_MINIMAL,
  schemas: [
    {
      schemaKey: 'demo.bad',
      fields: [{ fieldKey: 'bad', type: 'any' as any }],
    },
  ],
}

/** 触发器自建 authority（trigger + formal-write）。 */
export const INVALID_CONNECTOR_TRIGGER_AUTHORITY: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  operations: [
    {
      operationKey: 'demo.triggerBad',
      kind: 'trigger',
      title: '非法触发器',
      outputSchemaRef: 'demo.output',
      hostCapabilityRef: 'server-query',
      permissionRefs: ['demo.read'],
      scopeKind: 'organization',
      sideEffect: 'formal-write',
      confirmation: 'not-required',
    },
  ],
}

/** 操作捆绑多个高风险面。 */
export const INVALID_CONNECTOR_BUNDLED_RISK: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  operations: [
    {
      operationKey: 'demo.bundled',
      kind: 'trigger',
      title: '捆绑风险操作',
      description: '同时包含 webhook trigger 与 external-action',
      inputSchemaRef: 'demo.input',
      outputSchemaRef: 'demo.output',
      hostCapabilityRef: 'trigger.webhook',
      hostSeamRef: 'external-action',
      permissionRefs: ['demo.write'],
      scopeKind: 'project',
      sideEffect: 'external-action',
      confirmation: 'explicit',
      idempotency: 'non-idempotent',
      networkPolicy: 'host-brokered',
    },
  ],
}

/** Cron 调度（协议提示中含 cron）。 */
export const INVALID_CONNECTOR_CRON_SCHEDULE: Record<string, unknown> = {
  ...VALID_CONNECTOR_MINIMAL,
  protocolHints: {
    ...VALID_CONNECTOR_MINIMAL.protocolHints,
    cron: '*/5 * * * *',
  },
}

/** 远程 $ref。 */
export const INVALID_CONNECTOR_REMOTE_REF: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  schemas: [
    {
      schemaKey: 'demo.remote',
      fields: [
        { fieldKey: 'ref', type: 'object', schemaRef: 'https://remote.example.com/schema.json' },
      ],
    },
  ],
}

/** 非法枚举（未知 auth kind）。 */
export const INVALID_CONNECTOR_UNKNOWN_AUTH_KIND: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  auth: { kind: 'unknownKind' as any },
}

/** 未知 operation kind。 */
export const INVALID_CONNECTOR_UNKNOWN_OP_KIND: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  operations: [
    {
      ...VALID_CONNECTOR_MINIMAL.operations[0]!,
      kind: 'unknown' as any,
    },
  ],
}

/** 重复 field key。 */
export const INVALID_CONNECTOR_DUPLICATE_FIELD: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  schemas: [
    {
      schemaKey: 'dup.fields',
      fields: [
        { fieldKey: 'dup', type: 'string' },
        { fieldKey: 'dup', type: 'string' },
      ],
    },
  ],
}

/** secret default。 */
export const INVALID_CONNECTOR_SECRET_DEFAULT: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  schemas: [
    {
      schemaKey: 'demo.secret',
      fields: [{ fieldKey: 'pwd', type: 'string', defaultValue: 'secret=abc123456789' }],
    },
  ],
}

/** 超深 schema（depth > 5）。 */
export const INVALID_CONNECTOR_TOO_DEEP: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  schemas: [
    {
      schemaKey: 'deep.schema',
      fields: [
        {
          fieldKey: 'l1',
          type: 'object',
          fields: [
            {
              fieldKey: 'l2',
              type: 'object',
              fields: [
                {
                  fieldKey: 'l3',
                  type: 'object',
                  fields: [
                    {
                      fieldKey: 'l4',
                      type: 'object',
                      fields: [
                        {
                          fieldKey: 'l5',
                          type: 'object',
                          fields: [{ fieldKey: 'l6', type: 'string' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

/** 超量 schema。 */
export const INVALID_CONNECTOR_TOO_MANY_SCHEMAS: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  schemas: Array.from({ length: 33 }, (_, i) => ({
    schemaKey: `schema.${i}`,
    fields: [{ fieldKey: `f${i}`, type: 'string' as const }],
  })),
}

/** 非法 endpoint URL（auth 中含 URL）。 */
export const INVALID_CONNECTOR_AUTH_ENDPOINT: ConnectorDefinitionV1 = {
  ...VALID_CONNECTOR_MINIMAL,
  auth: {
    kind: 'oauth2',
    hostCapabilityRef: 'https://evil.com/authorize',
  },
}

// =============================================================================
// 3. Host snapshot fixtures
// =============================================================================

export function makeHostSeamEntry(
  overrides?: Partial<ConnectorHostSeamEntry>,
): ConnectorHostSeamEntry {
  return {
    seamVersion: '1.0.0',
    availability: 'host-ready',
    requiredPermissions: ['demo.read'],
    scopeModes: ['organization', 'project'],
    sideEffectCeiling: 'external-action',
    confirmationCeiling: 'explicit',
    networkCeiling: 'host-brokered',
    ...overrides,
  }
}

export function makeHostPermissionEntry(
  overrides?: Partial<ConnectorHostPermissionEntry>,
): ConnectorHostPermissionEntry {
  return {
    seamKey: 'server-query',
    maxScopeKind: 'organization',
    maxSideEffect: 'read-only',
    maxConfirmation: 'not-required',
    maxNetwork: 'none',
    ...overrides,
  }
}

export function makeHostAuthEntry(
  overrides?: Partial<ConnectorHostAuthEntry>,
): ConnectorHostAuthEntry {
  return {
    kind: 'none',
    scopeKeys: [],
    ...overrides,
  }
}

export function makeValidHostSnapshot(
  overrides?: Partial<ConnectorDefinitionHostSnapshot>,
): ConnectorDefinitionHostSnapshot {
  return {
    hostContractVersion: '1.0.0',
    pluginIdentity: { pluginId: 'demo.plugin', version: '1.0.0' },
    manifestDigest: 'sha256:abc123',
    seamCatalog: {
      'server-query': makeHostSeamEntry({ availability: 'host-ready' }),
      'server-command-proposal': makeHostSeamEntry({
        seamVersion: '1.0.0',
        availability: 'host-ready',
        requiredPermissions: ['demo.write'],
        sideEffectCeiling: 'proposal',
        confirmationCeiling: 'explicit',
        networkCeiling: 'host-brokered',
      }),
      'trigger.webhook': makeHostSeamEntry({
        availability: 'host-ready',
        requiredPermissions: ['acme.trigger'],
        scopeModes: ['project'],
        sideEffectCeiling: 'read-only',
        confirmationCeiling: 'not-required',
        networkCeiling: 'host-brokered',
      }),
      'auth.oauth2': makeHostSeamEntry({ availability: 'host-ready' }),
    },
    permissionVocabulary: {
      'demo.read': makeHostPermissionEntry({
        seamKey: 'server-query',
        maxScopeKind: 'organization',
        maxSideEffect: 'read-only',
        maxNetwork: 'host-brokered',
      }),
      'demo.write': makeHostPermissionEntry({
        seamKey: 'server-command-proposal',
        maxScopeKind: 'project',
        maxSideEffect: 'proposal',
        maxConfirmation: 'explicit',
        maxNetwork: 'host-brokered',
      }),
      'acme.read': makeHostPermissionEntry({
        seamKey: 'server-query',
        maxScopeKind: 'organization',
        maxSideEffect: 'read-only',
        maxNetwork: 'host-brokered',
      }),
      'acme.write': makeHostPermissionEntry({
        seamKey: 'server-command-proposal',
        maxScopeKind: 'project',
        maxSideEffect: 'proposal',
        maxConfirmation: 'explicit',
        maxNetwork: 'host-brokered',
      }),
      'acme.trigger': makeHostPermissionEntry({
        seamKey: 'trigger.webhook',
        maxScopeKind: 'project',
        maxSideEffect: 'read-only',
        maxNetwork: 'host-brokered',
      }),
    },
    authCapabilities: {
      'auth.oauth2': makeHostAuthEntry({ kind: 'oauth2', scopeKeys: ['read:work', 'write:work'] }),
      'auth.none': makeHostAuthEntry({ kind: 'none' }),
      'auth.apikey': makeHostAuthEntry({ kind: 'apiKey' }),
    },
    evidenceFreshness: 'fresh',
    ...overrides,
  }
}

/** 未知 seam 的 snapshot。 */
export function makeUnknownSeamSnapshot(): ConnectorDefinitionHostSnapshot {
  return makeValidHostSnapshot({ seamCatalog: {} })
}

/** 未来版本的 snapshot（host 1.0，requested 2.0）。 */
export function makeFutureVersionSnapshot(): ConnectorDefinitionHostSnapshot {
  return makeValidHostSnapshot({ hostContractVersion: '1.0.0' })
}

/** 已废弃无迁移的 snapshot。 */
export function makeDeprecatedNoMigrationSnapshot(): ConnectorDefinitionHostSnapshot {
  return makeValidHostSnapshot({
    seamCatalog: {
      'server-query': makeHostSeamEntry({
        availability: 'deprecated',
        replacementSeamKey: undefined,
      }),
    },
  })
}

/** 仅 cataloged 无 host-ready 的 snapshot。 */
export function makeCatalogedNotReadySnapshot(): ConnectorDefinitionHostSnapshot {
  return makeValidHostSnapshot({
    seamCatalog: {
      'server-query': makeHostSeamEntry({ availability: 'cataloged' }),
    },
  })
}

// =============================================================================
// 4. 敏感值 fixtures
// =============================================================================

export const SENSITIVE_CONNECTOR_VALUES = [
  'sk_abc123456789012345678',
  'Bearer eyJhbGciOiJIUzI1NiJ9',
  'ghp_abc123456789012345678901234567890',
  'secret=supersecret123',
  'password: hunter2',
  '-----BEGIN PRIVATE KEY-----',
]

export const NON_SENSITIVE_CONNECTOR_VALUES = [
  'normal text',
  'fixture:valid-connector',
  'sha256:abcdef',
  'demo-icon',
]

export const SENSITIVE_CONNECTOR_KEYS = [
  'token',
  'secret',
  'password',
  'apiKey',
  'authorization',
  'private_key',
  'credential',
  'cookie',
]

export const NON_SENSITIVE_CONNECTOR_KEYS = [
  'connectorKey',
  'displayName',
  'version',
  'providerKey',
  'category',
  'operationKey',
]

// =============================================================================
// 5. JSON packs（仓库内 JSON fixtures，供 checker 使用）
// =============================================================================

/** 默认 JSON packs 路径（相对仓库根）。 */
export const CONNECTOR_JSON_FIXTURE_PACKS = {
  clean: 'fixtures/connector-definitions/clean.json',
  invalid: 'fixtures/connector-definitions/invalid-pack.json',
}
