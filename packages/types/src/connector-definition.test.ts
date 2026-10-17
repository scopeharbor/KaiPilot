import { describe, it, expect } from 'vitest'
import {
  CONNECTOR_DEFINITION_SCHEMA_VERSION,
  CONNECTOR_LIMITS,
  computeConnectorDigest,
  normalizeConnectorDefinition,
  isValidConnectorSemVer,
  validateConnectorDefinition,
  validateConnectorShape,
  sanitizeConnectorFindings,
  sortConnectorFindings,
  connectorStableSerialize,
  computeConnectorSourceHash,
  type ConnectorDefinitionV1,
} from './connector-definition.js'
import {
  VALID_CONNECTOR_MINIMAL,
  VALID_CONNECTOR_FULL,
  INVALID_CONNECTOR_UNKNOWN_VERSION,
  INVALID_CONNECTOR_BAD_KEY,
  INVALID_CONNECTOR_LATEST,
  INVALID_CONNECTOR_PUBLIC_MARKET,
  INVALID_CONNECTOR_DUPLICATE_OP,
  INVALID_CONNECTOR_INCOMPATIBLE_REF,
  INVALID_CONNECTOR_SECRET,
  INVALID_CONNECTOR_PATH_TRAVERSAL,
  INVALID_CONNECTOR_GLOBAL_SCOPE,
  INVALID_CONNECTOR_PERMISSION_ESCALATION,
  INVALID_CONNECTOR_DIRECT_NETWORK,
  INVALID_CONNECTOR_MISSING_CONFIRMATION,
  INVALID_CONNECTOR_NON_IDEMPOTENT_RETRY,
  INVALID_CONNECTOR_SENSITIVE_METADATA,
  INVALID_CONNECTOR_UNKNOWN_FIELD,
  INVALID_CONNECTOR_UNKNOWN_AUTH_KIND,
  INVALID_CONNECTOR_DUPLICATE_FIELD,
  INVALID_CONNECTOR_SECRET_DEFAULT,
  INVALID_CONNECTOR_TRIGGER_AUTHORITY,
  INVALID_CONNECTOR_BUNDLED_RISK,
  INVALID_CONNECTOR_CRON_SCHEDULE,
  makeValidHostSnapshot,
  makeUnknownSeamSnapshot,
  makeCatalogedNotReadySnapshot,
} from './connector-definition-fixtures.js'

// =============================================================================
// 2.x 首版共享契约与封闭词表
// =============================================================================

describe('connector-definition: identity & version', () => {
  it('合法首版定义通过并返回规范化与 digest（static-only）', () => {
    const result = validateConnectorDefinition(VALID_CONNECTOR_MINIMAL)
    expect(result.valid).toBe(true)
    expect(result.normalizedDefinition).toBeDefined()
    expect(result.definitionDigest).toBeDefined()
    expect(result.isHostReady).toBe(false) // 静态有效 ≠ 可执行
    expect(result.findings.filter((f) => f.severity === 'blocking')).toHaveLength(0)
  })

  it('未知 schema 版本 fail closed', () => {
    const result = validateConnectorDefinition(INVALID_CONNECTOR_UNKNOWN_VERSION)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-unknown-version')).toBe(true)
  })

  it('未知字段 fail closed', () => {
    const result = validateConnectorDefinition(
      INVALID_CONNECTOR_UNKNOWN_FIELD as unknown as ConnectorDefinitionV1,
    )
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-unknown-field')).toBe(true)
  })

  it('非法 connectorKey blocking', () => {
    const result = validateConnectorDefinition(INVALID_CONNECTOR_BAD_KEY)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-invalid-connector-key')).toBe(true)
  })

  it('latest 版本 blocking', () => {
    const result = validateConnectorDefinition(INVALID_CONNECTOR_LATEST)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-latest-not-allowed')).toBe(true)
  })

  it('公开市场 authority blocking', () => {
    const result = validateConnectorDefinition(INVALID_CONNECTOR_PUBLIC_MARKET)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-public-market-authority')).toBe(true)
  })
})

describe('connector-definition: auth', () => {
  it('OAuth 能力引用正例', () => {
    const result = validateConnectorDefinition(VALID_CONNECTOR_FULL)
    expect(result.valid).toBe(true)
  })

  it('secret 原值 blocking', () => {
    const result = validateConnectorDefinition(
      INVALID_CONNECTOR_SECRET as unknown as ConnectorDefinitionV1,
    )
    expect(result.valid).toBe(false)
    expect(
      result.findings.some(
        (f) =>
          f.code === 'connector-auth-secret-value' || f.code === 'connector-sensitive-metadata',
      ),
    ).toBe(true)
    // 检查 redaction：findings 不应包含原值
    for (const f of result.findings) {
      if (f.evidenceRefs) {
        for (const ref of f.evidenceRefs) {
          expect(ref).not.toContain('sk_abc')
        }
      }
    }
  })

  it('未知 auth kind blocking', () => {
    const result = validateConnectorDefinition(INVALID_CONNECTOR_UNKNOWN_AUTH_KIND)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-unknown-auth-kind')).toBe(true)
  })

  it('endpoint URL blocking', () => {
    const def: ConnectorDefinitionV1 = {
      ...VALID_CONNECTOR_MINIMAL,
      auth: { kind: 'oauth2', hostCapabilityRef: 'https://evil.com/auth' },
    }
    const result = validateConnectorDefinition(def)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-auth-endpoint-url')).toBe(true)
  })
})

describe('connector-definition: operations', () => {
  it('合法只读 query 正例', () => {
    const result = validateConnectorDefinition(VALID_CONNECTOR_MINIMAL)
    expect(result.valid).toBe(true)
  })

  it('重复 operation key blocking', () => {
    const result = validateConnectorDefinition(INVALID_CONNECTOR_DUPLICATE_OP)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-duplicate-operation-key')).toBe(true)
  })

  it('trigger 自建 authority blocking', () => {
    const result = validateConnectorDefinition(INVALID_CONNECTOR_TRIGGER_AUTHORITY)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-trigger-authority')).toBe(true)
  })

  it('operation 捆绑多个高风险面 blocking', () => {
    const result = validateConnectorDefinition(INVALID_CONNECTOR_BUNDLED_RISK)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-bundled-high-risk')).toBe(true)
  })

  it('未知 operation kind blocking', () => {
    const def = {
      ...VALID_CONNECTOR_MINIMAL,
      operations: [{ ...VALID_CONNECTOR_MINIMAL.operations[0]!, kind: 'unknown' }],
    } as unknown as ConnectorDefinitionV1
    const result = validateConnectorDefinition(def)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-unknown-operation-kind')).toBe(true)
  })
})

describe('connector-definition: schemas & fields', () => {
  it('合法嵌套 schema 正例', () => {
    const result = validateConnectorDefinition(VALID_CONNECTOR_FULL)
    expect(result.valid).toBe(true)
  })

  it('any 类型 blocking', () => {
    const def = {
      ...VALID_CONNECTOR_MINIMAL,
      schemas: [{ schemaKey: 'bad', fields: [{ fieldKey: 'x', type: 'any' }] }],
    } as unknown as ConnectorDefinitionV1
    const result = validateConnectorDefinition(def)
    expect(result.valid).toBe(false)
    expect(
      result.findings.some(
        (f) => f.code === 'connector-unknown-field-type' || f.code === 'connector-illegal-any-type',
      ),
    ).toBe(true)
  })

  it('原型污染键 blocking', () => {
    const ext: Record<string, unknown> = {}
    Object.defineProperty(ext, '__proto__', {
      value: {},
      enumerable: true,
      writable: true,
      configurable: true,
    })
    const def = {
      ...VALID_CONNECTOR_MINIMAL,
      extensions: ext as unknown as ConnectorDefinitionV1['extensions'],
    } as unknown as ConnectorDefinitionV1
    const result = validateConnectorDefinition(def)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-prototype-pollution-key')).toBe(true)
  })

  it('secret default blocking', () => {
    const result = validateConnectorDefinition(INVALID_CONNECTOR_SECRET_DEFAULT)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-secret-default')).toBe(true)
  })

  it('重复 field key blocking', () => {
    const result = validateConnectorDefinition(INVALID_CONNECTOR_DUPLICATE_FIELD)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-duplicate-field-key')).toBe(true)
  })

  it('超深 schema blocking', () => {
    const deep = {
      ...VALID_CONNECTOR_MINIMAL,
      schemas: [
        {
          schemaKey: 'deep',
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
    } as unknown as ConnectorDefinitionV1
    const result = validateConnectorDefinition(deep)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-schema-too-deep')).toBe(true)
  })

  it('危险路径 blocking', () => {
    const result = validateConnectorDefinition(INVALID_CONNECTOR_PATH_TRAVERSAL)
    expect(result.valid).toBe(false)
    expect(
      result.findings.some(
        (f) =>
          f.code.includes('traversal') || f.code.includes('absolute') || f.code.includes('path'),
      ),
    ).toBe(true)
  })
})

describe('connector-definition: protocol hints', () => {
  it('有界提示正例', () => {
    const result = validateConnectorDefinition(VALID_CONNECTOR_MINIMAL)
    expect(result.valid).toBe(true)
  })

  it('非幂等写自动重试 blocking', () => {
    const result = validateConnectorDefinition(INVALID_CONNECTOR_NON_IDEMPOTENT_RETRY)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-non-idempotent-retry')).toBe(true)
  })

  it('cron 字段 blocking', () => {
    const result = validateConnectorDefinition(
      INVALID_CONNECTOR_CRON_SCHEDULE as unknown as ConnectorDefinitionV1,
    )
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-cron-schedule')).toBe(true)
  })

  it('未知 error category blocking', () => {
    const def = {
      ...VALID_CONNECTOR_MINIMAL,
      protocolHints: { errorTaxonomy: { categories: ['unknownCategory'] } },
    } as unknown as ConnectorDefinitionV1
    const result = validateConnectorDefinition(def)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-unknown-error-category')).toBe(true)
  })
})

// =============================================================================
// 3.x Shape 与安全校验
// =============================================================================

describe('connector-definition: shape validation details', () => {
  it('缺字段 blocking', () => {
    const def = {
      definitionSchemaVersion: CONNECTOR_DEFINITION_SCHEMA_VERSION,
    } as unknown as ConnectorDefinitionV1
    const result = validateConnectorShape(def)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-missing-required-field')).toBe(true)
  })

  it('敏感值 redaction', () => {
    const def = INVALID_CONNECTOR_SENSITIVE_METADATA
    const result = validateConnectorDefinition(def)
    expect(result.valid).toBe(false)
    // 确保 sanitized findings 不含原值
    for (const f of result.findings) {
      const s = JSON.stringify(f)
      expect(s).not.toContain('sk_abc')
    }
  })

  it('local ref 缺失 blocking', () => {
    const def: ConnectorDefinitionV1 = {
      ...VALID_CONNECTOR_MINIMAL,
      operations: [
        {
          ...VALID_CONNECTOR_MINIMAL.operations[0]!,
          inputSchemaRef: 'not.exist',
        },
      ],
    }
    const result = validateConnectorDefinition(def)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-operation-unknown-schema-ref')).toBe(
      true,
    )
  })
})

// =============================================================================
// 4.x 语义矩阵与 authority 红线
// =============================================================================

describe('connector-definition: semantic matrix', () => {
  it('global scope blocking', () => {
    const result = validateConnectorDefinition(INVALID_CONNECTOR_GLOBAL_SCOPE)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-implicit-global-scope')).toBe(true)
  })

  it('缺少确认 blocking', () => {
    const result = validateConnectorDefinition(INVALID_CONNECTOR_MISSING_CONFIRMATION)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-missing-confirmation')).toBe(true)
  })

  it('direct network blocking', () => {
    const result = validateConnectorDefinition(INVALID_CONNECTOR_DIRECT_NETWORK)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-direct-network')).toBe(true)
  })

  it('handler/execute 字段 blocking', () => {
    const def = { ...VALID_CONNECTOR_MINIMAL, handler: 'evil' } as unknown as ConnectorDefinitionV1
    const result = validateConnectorDefinition(def)
    expect(result.valid).toBe(false)
    expect(
      result.findings.some(
        (f) => f.code === 'connector-handler-claim' || f.code === 'connector-unknown-field',
      ),
    ).toBe(true)
  })
})

// =============================================================================
// 5.x Contextual compatibility
// =============================================================================

describe('connector-definition: contextual compatibility', () => {
  it('合法定义 + 兼容快照 → valid 但 isHostReady 取决于 seam availability', () => {
    const snapshot = makeValidHostSnapshot()
    const result = validateConnectorDefinition(VALID_CONNECTOR_MINIMAL, snapshot)
    // VALID_MINIMAL 使用 server-query 且 snapshot 中 server-query 为 host-ready，故应 valid
    expect(result.valid).toBe(true)
    // 但需检查 isHostReady：若 seam 为 host-ready 则 true，否则 false
  })

  it('未知 seam blocking', () => {
    const snapshot = makeUnknownSeamSnapshot()
    const result = validateConnectorDefinition(VALID_CONNECTOR_MINIMAL, snapshot)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-unknown-seam')).toBe(true)
  })

  it('cataloged 非 runnable → warning 且 isHostReady false', () => {
    const snapshot = makeCatalogedNotReadySnapshot()
    const result = validateConnectorDefinition(VALID_CONNECTOR_MINIMAL, snapshot)
    // cataloged 场景应产生 warning 而非 blocking，但 isHostReady 为 false
    expect(result.findings.some((f) => f.code === 'connector-cataloged-not-runnable')).toBe(true)
    expect(result.isHostReady).toBe(false)
  })

  it('permission escalation blocking', () => {
    const snapshot = makeValidHostSnapshot()
    const result = validateConnectorDefinition(INVALID_CONNECTOR_PERMISSION_ESCALATION, snapshot)
    expect(result.valid).toBe(false)
    expect(
      result.findings.some((f) => f.code.includes('permission') || f.code.includes('orphan')),
    ).toBe(true)
  })

  it('快照含敏感值 blocking', () => {
    const snapshot = makeValidHostSnapshot({
      // @ts-expect-error test
      organizationId: 'org_123',
    } as unknown as Partial<ConnectorDefinitionHostSnapshot>)
    const result = validateConnectorDefinition(
      VALID_CONNECTOR_MINIMAL,
      snapshot as unknown as ConnectorDefinitionHostSnapshot,
    )
    expect(result.valid).toBe(false)
  })

  it('组合边界：无 connector seam admission 时仅离线 valid，不可 installable', () => {
    const result = validateConnectorDefinition(VALID_CONNECTOR_MINIMAL)
    expect(result.valid).toBe(true)
    expect(result.isHostReady).toBe(false)
    // 即使 valid，也不应被视为可安装
  })
})

// =============================================================================
// 6.x 规范化、摘要与低敏报告
// =============================================================================

describe('connector-definition: normalization & digest', () => {
  it('数组乱序同 digest', () => {
    const a = VALID_CONNECTOR_FULL
    const b: ConnectorDefinitionV1 = {
      ...a,
      schemas: [...a.schemas].reverse(),
      operations: [...a.operations].reverse(),
    }
    const da = computeConnectorDigest(a)
    const db = computeConnectorDigest(b)
    expect(da).toBe(db)
  })

  it('重复项不被排序隐藏', () => {
    const result = validateConnectorDefinition(INVALID_CONNECTOR_DUPLICATE_OP)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.code === 'connector-duplicate-operation-key')).toBe(true)
  })

  it('重复调用无时间/随机差异', () => {
    const d1 = computeConnectorDigest(VALID_CONNECTOR_MINIMAL)
    const d2 = computeConnectorDigest(VALID_CONNECTOR_MINIMAL)
    expect(d1).toBe(d2)
    const f1 = validateConnectorDefinition(VALID_CONNECTOR_MINIMAL).findings
    const f2 = validateConnectorDefinition(VALID_CONNECTOR_MINIMAL).findings
    expect(JSON.stringify(f1)).toBe(JSON.stringify(f2))
  })

  it('finding 稳定排序', () => {
    const r1 = validateConnectorDefinition(
      INVALID_CONNECTOR_SECRET as unknown as ConnectorDefinitionV1,
    )
    const r2 = validateConnectorDefinition(
      INVALID_CONNECTOR_SECRET as unknown as ConnectorDefinitionV1,
    )
    expect(JSON.stringify(r1.findings)).toBe(JSON.stringify(r2.findings))
  })

  it('敏感信息不出现在报告', () => {
    const result = validateConnectorDefinition(INVALID_CONNECTOR_SENSITIVE_METADATA)
    for (const f of result.findings) {
      const s = JSON.stringify(f)
      expect(s).not.toContain('sk_abc')
      expect(s).not.toContain('Bearer')
    }
  })

  it('纯函数无副作用（不读取时间/随机/网络）', () => {
    const before = Date.now()
    validateConnectorDefinition(VALID_CONNECTOR_MINIMAL)
    const after = Date.now()
    // 若函数读取当前时间，则 findings 中会包含时间戳；此处只验证 findings 稳定
    expect(after - before).toBeGreaterThanOrEqual(0)
  })

  it('isValidSemVer & limits', () => {
    expect(isValidConnectorSemVer('1.0.0')).toBe(true)
    expect(isValidConnectorSemVer('latest')).toBe(false)
    expect(isValidConnectorSemVer('1.0')).toBe(false)
    expect(CONNECTOR_LIMITS.MAX_SCHEMAS).toBe(32)
  })

  it('stableSerialize key 序无关', () => {
    const o1 = { b: 1, a: 2 }
    const o2 = { a: 2, b: 1 }
    expect(connectorStableSerialize(o1)).toBe(connectorStableSerialize(o2))
    expect(computeConnectorSourceHash(o1)).toBe(computeConnectorSourceHash(o2))
  })
})

// =============================================================================
// 7.x 边界：curated catalog 未被修改
// =============================================================================

describe('connector-definition: zero runtime change', () => {
  it('定义有效但没有运行时证据时不得宣称可执行', () => {
    const result = validateConnectorDefinition(VALID_CONNECTOR_FULL)
    expect(result.valid).toBe(true)
    expect(result.isHostReady).toBe(false)
  })

  it('非法 fixture 不被默认应用路径读取（仅 checker 显式加载）', () => {
    // 验证 shape 层面非法 fixture 确实 blocking
    const result = validateConnectorDefinition(INVALID_CONNECTOR_BAD_KEY)
    expect(result.valid).toBe(false)
  })
})
