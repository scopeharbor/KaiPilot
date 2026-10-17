/**
 * contract-versioning —— 共享契约版本化、契约目录与迁移适配器注册表（V2.5 W0 基础治理）。
 *
 * 本模块是前后端共享的纯 TypeScript 模块，零运行时依赖（同 @aiproj/types 其他模块）。
 *
 * # 版本字段职责（D2，禁止互相替代）
 * - `/api/v1`：HTTP 资源集合与路由生命周期。
 * - `contractVersion`：事件或跨包 DTO 的外部形状和语义（语义化版本字符串 "major.minor"）。
 * - `schemaVersion`：可持久化文档/配置的结构版本（数字，允许读取迁移）。
 * - `resourceVersion`/`revision`：单一业务实例的并发或历史版本。
 *
 * # 变更分类（D4）
 * - additive：新增可选字段/可忽略事件，旧 reader 必须安全。
 * - deprecating：保留兼容窗口、替代路径和删除目标版本。
 * - breaking：新 major contractVersion、迁移适配器、consumer inventory、回滚计划和显式批准。
 *   字段收紧、默认值语义改变、枚举删除和事件重命名均视为 breaking。
 *
 * # 兼容策略（D3）
 * Writer 只产生 currentVersion；Reader 接受目录声明的 supportedReadVersions，
 * 并通过相邻版本 adapter 迁移到 currentVersion。迁移链必须确定、幂等、无网络访问，
 * 不得删除安全字段或跨 organization 合并数据。
 */

// =============================================================================
// 1. 版本原语
// =============================================================================

/** 语义化契约版本字符串（"major.minor"），如 "1.0"、"2.3"。 */
export type ContractVersion = `${number}.${number}`

/** 模式版本数字（正整数，用于持久化文档/配置的结构版本标识）。 */
export type SchemaVersion = number

/** 版本解析结果。 */
export interface ParsedContractVersion {
  major: number
  minor: number
}

/** 版本比较结果。 */
export type VersionComparison = 'eq' | 'lt' | 'gt'

// ─── 版本常量 ──────────────────────────────────────────

/** 当前项目整体的契约版本。后续各合约在此基础上声明。 */
export const CURRENT_PROJECT_CONTRACT_VERSION = '1.0' as const

// ─── 工具函数 ──────────────────────────────────────────

/**
 * 解析语义化版本字符串为结构体。
 * 格式：/^(\\d+)\\.(\\d+)$/。
 */
export function parseContractVersion(version: string): ParsedContractVersion {
  if (typeof version !== 'string') {
    throw new TypeError(
      `Invalid contract version format: "${String(version)}". Expected "major.minor" (e.g. "1.0").`,
    )
  }
  const match = /^(\d+)\.(\d+)$/.exec(version)
  if (!match) {
    throw new TypeError(
      `Invalid contract version format: "${version}". Expected "major.minor" (e.g. "1.0").`,
    )
  }
  return { major: parseInt(match[1]!, 10), minor: parseInt(match[2]!, 10) }
}

/**
 * 比较两个语义化版本。
 * 返回 'eq'（相等）、'lt'（version1 < version2）或 'gt'（version1 > version2）。
 */
export function compareContractVersions(version1: string, version2: string): VersionComparison {
  const v1 = parseContractVersion(version1)
  const v2 = parseContractVersion(version2)

  if (v1.major === v2.major && v1.minor === v2.minor) return 'eq'
  if (v1.major < v2.major || (v1.major === v2.major && v1.minor < v2.minor)) return 'lt'
  return 'gt'
}

/**
 * 检查 version 是否在 supportedReadVersions 范围内（兼容读取）。
 * 仅支持相同 major 的版本可安全读取；不同 major 需迁移。
 */
export function isVersionSupported(
  version: string,
  currentVersion: string,
  supportedReadVersions: readonly string[],
): boolean {
  if (version === currentVersion) return true
  return supportedReadVersions.includes(version)
}

/**
 * 版本是否需要迁移才能读取。
 */
export function needsMigration(version: string, currentVersion: string): boolean {
  if (version === currentVersion) return false
  const v = parseContractVersion(version)
  const cur = parseContractVersion(currentVersion)
  return v.major < cur.major || (v.major === cur.major && v.minor < cur.minor)
}

/**
 * 格式化版本结构体为字符串。
 */
export function formatContractVersion(parsed: ParsedContractVersion): ContractVersion {
  return `${parsed.major}.${parsed.minor}`
}

/**
 * 递增 major 版本。
 */
export function bumpMajor(version: string): ContractVersion {
  const parsed = parseContractVersion(version)
  return `${parsed.major + 1}.0`
}

/**
 * 递增 minor 版本。
 */
export function bumpMinor(version: string): ContractVersion {
  const parsed = parseContractVersion(version)
  return `${parsed.major}.${parsed.minor + 1}`
}

// =============================================================================
// 2. 变更分类
// =============================================================================

/** 变更类型分类（D4）。 */
export type ChangeKind = 'additive' | 'deprecating' | 'breaking'

/** 变更类型的严重性等级（用于评审优先级）。 */
export const CHANGE_KIND_ORDER: Record<ChangeKind, number> = {
  additive: 0,
  deprecating: 1,
  breaking: 2,
} as const

/** breaking 变更的审批元数据。 */
export interface BreakingChangeApproval {
  /** 批准人（如 lead/architect）。 */
  approvedBy: string
  /** 批准日期 ISO-8601。 */
  approvedAt: string
  /** 回滚计划简述或链接。 */
  rollbackPlan: string
  /** 受影响消费者清单。 */
  consumerInventory: string[]
  /** 变更原因。 */
  rationale: string
}

/** 变更元数据。 */
export interface ChangeMetadata {
  kind: ChangeKind
  /** 简要描述变更内容。 */
  description: string
  /** 引入版本（contractVersion）。 */
  introducedIn: string
  /** breaking 变更必须提供审批信息。 */
  breakingApproval?: BreakingChangeApproval
  /** 标记为 deprecating 时的终止版本（删除目标版本）。 */
  deprecatedIn?: string
  /** 替代路径（deprecating 时必填）。 */
  migrationPath?: string
}

// =============================================================================
// 3. 契约目录
// =============================================================================

/** 契约类型。 */
export type ContractKind = 'wire' | 'persisted' | 'config'

/** 安全分类。 */
export type SecurityClass = 'public' | 'internal' | 'confidential' | 'restricted'

/** 采用状态。 */
export type AdoptionState = 'adopted' | 'pending_adoption' | 'deprecated' | 'retired'

/** 单个契约目录项。 */
export interface ContractCatalogEntry {
  /** 唯一契约标识（反向域名风格或短横线命名）。 */
  contractId: string
  /** 负责人（团队/用户名）。 */
  owner: string
  /** 契约类型。 */
  kind: ContractKind
  /** 当前版本号（语义化字符串 "major.minor"）。 */
  currentVersion: ContractVersion
  /** 读取兼容的旧版本列表。 */
  supportedReadVersions: readonly ContractVersion[]
  /** 安全分类。 */
  securityClass: SecurityClass
  /** 采用状态。 */
  adoptionState: AdoptionState
  /** 简要说明。 */
  description: string
  /** 首次登记日期 ISO-8601。 */
  registeredAt: string
  /** 消费者位置列表（包名/路径，便于 CI 漂移检测）。 */
  consumers: readonly string[]
  /** 变更记录（可选）。 */
  changes?: ChangeMetadata[]
  /** 已知问题或注意事项（可选）。 */
  notes?: string
}

/** 契约目录类型——契约 ID 到目录项的映射。 */
export type ContractCatalog = Record<string, ContractCatalogEntry>

// ─── 安全分类排序（restricted > confidential > internal > public）────
export const SECURITY_CLASS_ORDER: Record<SecurityClass, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
} as const

// ─── 目录验证 ──────────────────────────────────────────

/** 验证结果。 */
export interface CatalogValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * 验证契约目录项的正确性。
 */
export function validateCatalogEntry(entry: ContractCatalogEntry): CatalogValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!entry.contractId || entry.contractId.length === 0) {
    errors.push('contractId is required')
  }

  if (!entry.owner || entry.owner.length === 0) {
    errors.push('owner is required')
  }

  try {
    parseContractVersion(entry.currentVersion)
  } catch (e) {
    errors.push(`currentVersion "${entry.currentVersion}" is not a valid ContractVersion`)
  }

  for (const v of entry.supportedReadVersions) {
    try {
      parseContractVersion(v)
    } catch (e) {
      errors.push(`supportedReadVersion "${v}" is not a valid ContractVersion`)
    }
  }

  // supportedReadVersions 不应包含 currentVersion（重复声明）
  if (entry.supportedReadVersions.includes(entry.currentVersion)) {
    warnings.push(
      `supportedReadVersions should not include currentVersion "${entry.currentVersion}" (implied)`,
    )
  }

  if (!['wire', 'persisted', 'config'].includes(entry.kind)) {
    errors.push(`kind "${entry.kind}" is not valid; expected wire, persisted, or config`)
  }

  if (!['public', 'internal', 'confidential', 'restricted'].includes(entry.securityClass)) {
    errors.push(
      `securityClass "${entry.securityClass}" is not valid; expected public, internal, confidential, or restricted`,
    )
  }

  if (!['adopted', 'pending_adoption', 'deprecated', 'retired'].includes(entry.adoptionState)) {
    errors.push(
      `adoptionState "${entry.adoptionState}" is not valid; expected adopted, pending_adoption, deprecated, or retired`,
    )
  }

  // 检查 supportedReadVersions 的 major 不大于 currentVersion 的 major
  // 只在 currentVersion 解析成功后才进行此项检查
  if (errors.length === 0 || !errors.some((e) => e.includes('currentVersion'))) {
    try {
      const curParsed = parseContractVersion(entry.currentVersion)
      for (const v of entry.supportedReadVersions) {
        try {
          const vParsed = parseContractVersion(v)
          if (vParsed.major > curParsed.major) {
            errors.push(
              `supportedReadVersion "${v}" has major > currentVersion "${entry.currentVersion}"`,
            )
          }
        } catch {
          // individual version errors already caught above
        }
      }
    } catch {
      // currentVersion error already caught above
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * 验证整个契约目录。
 */
export function validateCatalog(catalog: ContractCatalog): CatalogValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  for (const [contractId, entry] of Object.entries(catalog)) {
    if (entry.contractId !== contractId) {
      errors.push(`Key "${contractId}" does not match entry.contractId "${entry.contractId}"`)
    }
    const result = validateCatalogEntry(entry)
    errors.push(...result.errors.map((e) => `[${contractId}] ${e}`))
    warnings.push(...result.warnings.map((w) => `[${contractId}] ${w}`))
  }

  return { valid: errors.length === 0, errors, warnings }
}

// =============================================================================
// 4. 首批契约目录项（P0 登记）
// =============================================================================

/**
 * Renderer 版本常量（内联；@aiproj/types 保持零依赖，不从 compiler-spec 导入）。
 * 若 compiler-spec 中的常量改变，应手动同步此处的值。
 */
const RENDERER_CURRENT_SCHEMA_VERSION = 1
const RENDERER_OLD_SUPPORTED_VERSIONS = [0] as const

export const CONTRACT_CATALOG: ContractCatalog = {
  // ── 流式进度事件信封 ─────────────────────────────────
  'streaming-progress-envelope-v1': {
    contractId: 'streaming-progress-envelope-v1',
    owner: 'infra-team',
    kind: 'wire',
    currentVersion: '1.0',
    supportedReadVersions: [],
    securityClass: 'internal',
    adoptionState: 'adopted',
    description:
      'StreamingProgressEnvelope——长任务进度事件统一信封，定义 started/progress/heartbeat/checkpoint/completed/failed/cancelled 生命周期，支持 AI Draft 与 Compiler 领域扩展',
    registeredAt: '2026-07-17',
    consumers: ['packages/types/src/progress-streaming.ts'],
    notes: 'V2.5 W1 共享可见性基础；AI Draft 与 Compiler 的 streaming progress 均使用此信封',
  },

  // ── Agent Observation Packet ─────────────────────────
  'agent-observation-manifest-v1': {
    contractId: 'agent-observation-manifest-v1',
    owner: 'agent-infra-team',
    kind: 'wire',
    currentVersion: '1.0',
    supportedReadVersions: [],
    securityClass: 'internal',
    adoptionState: 'adopted',
    description:
      'Agent Observation Manifest/Packet——面向开发 Agent 的 MCP-first 语义化观察输出，默认返回目标相关事实、变化、规则、因果、证据与按需展开 handle',
    registeredAt: '2026-07-19',
    consumers: ['packages/types/src/observation.ts', 'scripts/agent-observation.ts'],
    notes:
      '首期 Code Graph 基图为 codebase-memory-mcp/aiproj；不引入 Neo4j，不把完整 Code Graph 复制进产品库',
  },

  // ── AI Draft 流式事件 ─────────────────────────────────
  'ai-draft-stream-v1': {
    contractId: 'ai-draft-stream-v1',
    owner: 'ai-draft-team',
    kind: 'wire',
    currentVersion: '1.0',
    supportedReadVersions: [],
    securityClass: 'internal',
    adoptionState: 'pending_adoption',
    description:
      'AI 项目草案生成流式事件（SSE 传输），包括 draft.started、module.delta、module.completed、validation.warning、draft.completed、draft.failed 事件类型',
    registeredAt: '2026-07-17',
    consumers: ['packages/types/src/ai-draft.ts', 'apps/backend/app/services/ai_draft/'],
    notes: '待 v2-5-ai-draft-live-sse-transport change 接入后改为 adopted',
  },

  // ── Compiler Stage 事件 ───────────────────────────────
  'compiler-stage-event-v1': {
    contractId: 'compiler-stage-event-v1',
    owner: 'compiler-team',
    kind: 'wire',
    currentVersion: '1.0',
    supportedReadVersions: [],
    securityClass: 'internal',
    adoptionState: 'pending_adoption',
    description:
      'Project Compiler 各阶段事件（stage.started、stage.completed、artifact.produced、stage.failed），供实时桥接消费',
    registeredAt: '2026-07-17',
    consumers: ['packages/compiler-spec/src/'],
    notes: '待 v2-5-compiler-stage-event-realtime-bridge change 接入后改为 adopted',
  },

  // ── Renderer Config ───────────────────────────────────
  'renderer-config-v1': {
    contractId: 'renderer-config-v1',
    owner: 'renderer-team',
    kind: 'config',
    currentVersion: `${RENDERER_CURRENT_SCHEMA_VERSION}.0`,
    supportedReadVersions: RENDERER_OLD_SUPPORTED_VERSIONS.map(
      (v) => `${v}.0` as `${number}.${number}`,
    ),
    securityClass: 'internal',
    adoptionState: 'adopted',
    description:
      '确定性 UI Renderer 视图配置（schemaVersion+views+defaultViewId），前后端共享 ViewConfig/ProjectViewConfig z od schema（compiler-spec/renderer-schema.ts）',
    registeredAt: '2026-07-17',
    consumers: [
      'packages/compiler-spec/src/renderer-schema.ts',
      'packages/compiler-spec/src/renderer-fixtures.ts',
      'apps/backend/app/controllers/renderer_controller.ts',
      'apps/frontend/',
    ],
    notes: '已有 migrateConfigVersion 实现；后续应接入 MigrationAdapterRegistry facade',
  },

  // ── DiagramSpec ────────────────────────────────────────
  'diagram-spec-v1': {
    contractId: 'diagram-spec-v1',
    owner: 'gantt-team',
    kind: 'wire',
    currentVersion: '1.0',
    supportedReadVersions: [],
    securityClass: 'internal',
    adoptionState: 'adopted',
    description:
      'DiagramSpec 最小信封契约——version/type/title/data/metadata，V1 图表类型白名单（wbs_tree/gantt/dependency_graph/critical_path），EntityRef 引用正式实体',
    registeredAt: '2026-07-17',
    consumers: [
      'packages/types/src/diagram-spec.ts',
      'apps/backend/app/services/diagram_spec_validator.ts',
      'apps/frontend/',
    ],
    notes: 'DIAGRAM_SPEC_VERSION = "1.0"；无旧版本需要迁移',
  },
}

// =============================================================================
// 5. 兼容错误原语
// =============================================================================

/** 兼容错误码。 */
export type CompatibilityErrorCode =
  | 'UNSUPPORTED_CONTRACT_VERSION'
  | 'MISSING_REQUIRED_VERSION'
  | 'MIGRATION_CHAIN_BROKEN'
  | 'INVALID_VERSION_FORMAT'
  | 'MIGRATION_IDEMPOTENCY_VIOLATION'
  | 'MIGRATION_INPUT_MUTATION'
  | 'ORGANIZATION_CONTEXT_MISSING'
  | 'ORGANIZATION_CONTEXT_MISMATCH'
  | 'UNKNOWN_CONTRACT_ID'

/** 带安全序列化的兼容错误。 */
export class CompatibilityError extends Error {
  public readonly code: CompatibilityErrorCode
  public readonly contractId?: string
  public readonly version?: string
  public readonly correlationId?: string
  public readonly details?: string

  constructor(opts: {
    code: CompatibilityErrorCode
    message: string
    contractId?: string
    version?: string
    correlationId?: string
    details?: string
  }) {
    super(opts.message)
    this.name = 'CompatibilityError'
    this.code = opts.code
    this.contractId = opts.contractId
    this.version = opts.version
    this.correlationId = opts.correlationId
    this.details = opts.details
  }

  /**
   * 安全序列化为日志/API 可输出的对象。
   * 保证不包含 payload、prompt、token、secret 或组织数据。
   */
  toSafeJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      contractId: this.contractId,
      version: this.version,
      correlationId: this.correlationId,
      details: this.details,
    }
  }
}

/** 便捷工厂：UNSUPPORTED_CONTRACT_VERSION。 */
export function unsupportedContractVersion(
  contractId: string,
  version: string,
  correlationId?: string,
): CompatibilityError {
  return new CompatibilityError({
    code: 'UNSUPPORTED_CONTRACT_VERSION',
    message: `Contract "${contractId}" version "${version}" is not supported`,
    contractId,
    version,
    correlationId,
  })
}

/** 便捷工厂：MISSING_REQUIRED_VERSION。 */
export function missingRequiredVersion(
  contractId: string,
  correlationId?: string,
): CompatibilityError {
  return new CompatibilityError({
    code: 'MISSING_REQUIRED_VERSION',
    message: `Contract "${contractId}" is missing required version field`,
    contractId,
    correlationId,
  })
}

/** 便捷工厂：MIGRATION_CHAIN_BROKEN。 */
export function migrationChainBroken(
  contractId: string,
  fromVersion: string,
  toVersion: string,
  correlationId?: string,
): CompatibilityError {
  return new CompatibilityError({
    code: 'MIGRATION_CHAIN_BROKEN',
    message: `No migration path from "${contractId}" version ${fromVersion} to ${toVersion}`,
    contractId,
    version: fromVersion,
    correlationId,
  })
}

/** 便捷工厂：ORGANIZATION_CONTEXT_MISSING。 */
export function organizationContextMissing(
  contractId: string,
  correlationId?: string,
): CompatibilityError {
  return new CompatibilityError({
    code: 'ORGANIZATION_CONTEXT_MISSING',
    message: `Organization context is missing for contract "${contractId}"`,
    contractId,
    correlationId,
  })
}

/** 便捷工厂：ORGANIZATION_CONTEXT_MISMATCH。 */
export function organizationContextMismatch(
  contractId: string,
  expectedOrgId: string,
  actualOrgId: string,
  correlationId?: string,
): CompatibilityError {
  return new CompatibilityError({
    code: 'ORGANIZATION_CONTEXT_MISMATCH',
    message: `Organization context mismatch for contract "${contractId}": expected ${expectedOrgId}, got ${actualOrgId}`,
    contractId,
    version: expectedOrgId,
    correlationId,
    details: `expected=${expectedOrgId}, actual=${actualOrgId}`,
  })
}

// =============================================================================
// 6. 迁移适配器注册表
// =============================================================================

/** 迁移适配器：将契约数据从 fromVersion 迁移到 toVersion。 */
export interface MigrationAdapter<TIn = unknown, TOut = unknown> {
  contractId: string
  fromVersion: ContractVersion
  toVersion: ContractVersion
  /** 迁移函数——必须是纯函数，不得有副作用或网络访问。 */
  migrate: (data: TIn, context?: MigrationContext) => MigrationResult<TOut>
}

/** 迁移上下文（可选，由调用方提供）。 */
export interface MigrationContext {
  organizationId?: string
  /** AI 待确认状态是否保留（true 时 migration 不得丢弃未确认的 AI 字段）。 */
  preservePendingConfirmation?: boolean
}

/** 迁移结果。 */
export interface MigrationResult<T = unknown> {
  success: boolean
  data: T
  warnings?: string[]
  error?: string
}

/**
 * 迁移适配器注册表——纯函数、无状态。
 * 按 contractId + (fromVersion→toVersion) 注册和解析迁移路径。
 */
export class MigrationAdapterRegistry {
  /** 内部存储：contractId → fromVersion→toVersion → adapter。 */
  private readonly adapters = new Map<string, Map<string, MigrationAdapter>>()

  /**
   * 注册迁移适配器。
   * @throws 如果重复注册相同的 (contractId, fromVersion → toVersion)
   *         或非相邻版本注册（from+1 !== to major，暂不强制相邻以保持灵活）。
   */
  register(adapter: MigrationAdapter): void {
    const key = this.key(adapter.fromVersion, adapter.toVersion)

    if (this.isDuplicate(adapter.contractId, key)) {
      throw new CompatibilityError({
        code: 'MIGRATION_IDEMPOTENCY_VIOLATION',
        message:
          `Duplicate migration adapter for "${adapter.contractId}" ` +
          `from ${adapter.fromVersion} to ${adapter.toVersion}`,
        contractId: adapter.contractId,
        version: adapter.fromVersion,
      })
    }

    if (!this.adapters.has(adapter.contractId)) {
      this.adapters.set(adapter.contractId, new Map())
    }
    this.adapters.get(adapter.contractId)!.set(key, adapter)
  }

  /**
   * 解析从 fromVersion 到 toVersion 的迁移链。
   * 链中每一步必须是相邻 major 版本（major 差 1）。
   * 返回有序的 adapter 列表。
   */
  resolveChain(contractId: string, fromVersion: string, toVersion: string): MigrationAdapter[] {
    const from = parseContractVersion(fromVersion)
    const to = parseContractVersion(toVersion)

    if (from.major === to.major && from.minor <= to.minor) {
      // 同 major 且目标不低于来源——无需迁移
      return []
    }

    if (from.major >= to.major) {
      // from >= to，回退方向不支持（只能向前迁移）
      throw migrationChainBroken(contractId, fromVersion, toVersion)
    }

    const chain: MigrationAdapter[] = []
    let currentMajor = from.major
    let currentMinor = from.minor

    // 逐 major 步进
    while (currentMajor < to.major) {
      const fromStr = formatContractVersion({ major: currentMajor, minor: currentMinor })
      const toStr = formatContractVersion({ major: currentMajor + 1, minor: 0 })

      const adapter = this.findAdapter(contractId, fromStr, toStr)
      if (!adapter) {
        throw migrationChainBroken(contractId, fromVersion, toVersion)
      }

      chain.push(adapter)
      currentMajor++
      currentMinor = 0
    }

    return chain
  }

  /**
   * 执行从 fromVersion 到 toVersion 的迁移。
   * 沿 resolveChain 逐步应用 adapter.migrate。
   */
  migrate<T = unknown>(
    contractId: string,
    data: unknown,
    fromVersion: string,
    toVersion: string,
    context?: MigrationContext,
  ): MigrationResult<T> {
    const chain = this.resolveChain(contractId, fromVersion, toVersion)
    let current: unknown = data
    const warnings: string[] = []

    for (const adapter of chain) {
      const result = adapter.migrate(current, context)
      if (!result.success) {
        return {
          success: false,
          data: current as unknown as T,
          error:
            result.error || `Migration from ${adapter.fromVersion} to ${adapter.toVersion} failed`,
          warnings: [...warnings, ...(result.warnings || [])],
        }
      }
      if (result.warnings?.length) {
        warnings.push(...result.warnings)
      }
      current = result.data
    }

    return {
      success: true,
      data: current as unknown as T,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  }

  /**
   * 检查是否有从 fromVersion 到 toVersion 的迁移路径。
   */
  hasPath(contractId: string, fromVersion: string, toVersion: string): boolean {
    try {
      this.resolveChain(contractId, fromVersion, toVersion)
      return true
    } catch {
      return false
    }
  }

  /**
   * 列出 contractId 的所有已注册适配器。
   */
  listAdapters(contractId: string): MigrationAdapter[] {
    const adapters = this.adapters.get(contractId)
    if (!adapters) return []
    return Array.from(adapters.values())
  }

  /**
   * 检测迁移链中是否存在环路。
   */
  detectCycle(contractId: string): boolean {
    const contractAdapters = this.adapters.get(contractId)
    if (!contractAdapters || contractAdapters.size === 0) return false

    const visited = new Set<string>()

    for (const [, adapter] of contractAdapters) {
      const key = `${adapter.fromVersion}->${adapter.toVersion}`
      if (visited.has(key)) continue
      visited.add(key)

      // 检查是否有 adapter 的 toVersion 指向另一个 adapter 的 fromVersion 形成环
      const to = adapter.toVersion
      const backAdapters = contractAdapters.get(this.key(to, adapter.fromVersion))
      if (backAdapters) return true
    }

    return false
  }

  /**
   * 清除所有注册项（主要用于测试）。
   */
  clear(): void {
    this.adapters.clear()
  }

  private key(from: string, to: string): string {
    return `${from}>${to}`
  }

  private isDuplicate(contractId: string, key: string): boolean {
    return this.adapters.get(contractId)?.has(key) ?? false
  }

  private findAdapter(
    contractId: string,
    fromVersion: string,
    toVersion: string,
  ): MigrationAdapter | undefined {
    const contractAdapters = this.adapters.get(contractId)
    if (!contractAdapters) return undefined
    return contractAdapters.get(this.key(fromVersion, toVersion))
  }
}

/** 全局单例 MigrationAdapterRegistry。 */
export const globalMigrationRegistry = new MigrationAdapterRegistry()

// =============================================================================
// 7. SchemaVersion 工具（数字版本兼容层）
// =============================================================================

/**
 * 将 SchemaVersion（数字）转为 ContractVersion 字符串。
 * 如 schemaVersion=1 → "1.0"。
 */
export function schemaVersionToContractVersion(schemaVersion: SchemaVersion): ContractVersion {
  return `${schemaVersion}.0`
}

/**
 * 将 ContractVersion 字符串转为 SchemaVersion（取 major）。
 * 如 "1.0" → 1。
 */
export function contractVersionToSchemaVersion(version: ContractVersion): SchemaVersion {
  return parseContractVersion(version).major
}
