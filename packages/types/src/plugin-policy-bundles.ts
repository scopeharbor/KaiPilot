/**
 * plugin-policy-bundles —— V3 插件权限策略包共享契约
 * （纯类型 + 常量 + 封闭词表 + 确定性归一化/校验/digest + 内置模板 + 低敏 finding，
 *  零运行时依赖，零网络/IO/时间/随机数依赖；reference time 由调用方注入）。
 *
 * 本模块是前后端共享的纯 TypeScript 模块（同 @aiproj/types 其他模块）。
 * 测试见 `plugin-policy-bundles.test.ts`，fixtures 见 `plugin-policy-bundles-fixtures.ts`。
 *
 * # 语义要点（对应 openspec/changes/v3-plugin-policy-bundles spec/design）
 * - D1：策略文档使用封闭 canonical rule set——规则仅含 role、operation、permission、
 *   scope ceiling、side-effect ceiling 与 allow/deny；不接受表达式、函数或自由 metadata。
 * - 策略只能收紧：allow 规则不创造 authority；最终决策仍须上游 RBAC/Policy 放行，
 *   且正式写类请求必须有显式 allow（默认拒绝），显式 deny 一票否决。
 * - 相同输入必须产生相同结果与 digest（稳定排序 + domain-separated FNV-1a）。
 * - 未知 permission/operation/role、表达式注入、敏感 metadata、冲突规则一律 blocking
 *   （fail closed）；组织副本相对模板只能收紧（deny 增加、上限降低、allow 集收缩）。
 * - 命名纪律：PLUGIN_POLICY_ / PluginPolicy / policy- 前缀，不与既有导出冲突。
 */

// =============================================================================
// 1. 枚举与常量
// =============================================================================

/** 策略包 schema 版本（首版固定 "1.0"；未知版本在快照验证时 fail closed）。 */
export const PLUGIN_POLICY_BUNDLE_SCHEMA_VERSION = '1.0' as const
export type PluginPolicyBundleSchemaVersion = typeof PLUGIN_POLICY_BUNDLE_SCHEMA_VERSION

/** 策略角色词表（与后端 start/rbac CanonicalRole 字面值对齐的封闭集）。 */
export const PLUGIN_POLICY_BUNDLE_ROLES = [
  'system_admin',
  'org_admin',
  'project_manager',
  'member',
  'external_collaborator',
  'readonly_observer',
] as const
export type PluginPolicyRole = (typeof PLUGIN_POLICY_BUNDLE_ROLES)[number]

/**
 * 策略操作词表（与 plugin-security-gate 六个运行时操作对齐的封闭集）。
 * 安装/升级/权限变更等生命周期动作不在 operation 词表中——它们由宿主 permission
 * 词表表达（如 `plugin_install:manage`），与运行时操作共同构成本 change 的治理面。
 */
export const PLUGIN_POLICY_BUNDLE_OPERATIONS = [
  'resolve-query',
  'execute',
  'command-proposal',
  'ui-slot',
  'skill-adapter',
  'compiler-contribution',
] as const
export type PluginPolicyOperation = (typeof PLUGIN_POLICY_BUNDLE_OPERATIONS)[number]

/** scope 上限词表（ceiling 语义：允许的最高 scope；organization 宽于 project）。 */
export const PLUGIN_POLICY_BUNDLE_SCOPE_CEILINGS = ['organization', 'project'] as const
export type PluginPolicyScopeCeiling = (typeof PLUGIN_POLICY_BUNDLE_SCOPE_CEILINGS)[number]

/**
 * side-effect 上限词表（与 plugin-manifest 的 MANIFEST_PERMISSION_SIDE_EFFECTS 对齐；
 * 排序即宽严序，index 越大越宽）。内置模板统一封顶 `formal-write`：
 * `external-action` 由宿主网络授权门单独治理，策略包不放宽。
 */
export const PLUGIN_POLICY_BUNDLE_SIDE_EFFECTS = [
  'none',
  'read-only',
  'advisory',
  'render',
  'transform',
  'preview',
  'proposal',
  'formal-write',
  'external-action',
] as const
export type PluginPolicySideEffectCeiling = (typeof PLUGIN_POLICY_BUNDLE_SIDE_EFFECTS)[number]

/** side-effect 宽严秩（用于上限收紧比较；未知值秩为 -1 → 校验层已拦）。 */
export const PLUGIN_POLICY_SIDE_EFFECT_RANK: Record<string, number> = Object.fromEntries(
  PLUGIN_POLICY_BUNDLE_SIDE_EFFECTS.map((v, i) => [v, i]),
)

/** scope 宽严秩（ceiling 语义：organization=1 宽于 project=0）。 */
export const PLUGIN_POLICY_SCOPE_RANK: Record<string, number> = {
  project: 0,
  organization: 1,
}

/** 规则效果封闭集。 */
export const PLUGIN_POLICY_RULE_EFFECTS = ['allow', 'deny'] as const
export type PluginPolicyRuleEffect = (typeof PLUGIN_POLICY_RULE_EFFECTS)[number]

/** 规则数与文本规模上限。 */
export const PLUGIN_POLICY_BUNDLE_LIMITS = {
  MAX_RULES: 96,
  MIN_RULES: 1,
  MAX_DESCRIPTION_LENGTH: 300,
  MAX_PERMISSION_KEY_LENGTH: 128,
  MAX_DETAIL_LENGTH: 200,
  MAX_VERSION: 1000000,
} as const

/**
 * 决策 reason code（封闭、低敏、机器可判；不泄露隐藏权限或组织配置细节）。
 */
export const PLUGIN_POLICY_BUNDLE_REASON_CODES = [
  'policy-redline', // 平台红线命中（一票否决）
  'policy-deny', // 显式 deny 规则命中
  'policy-rbac-denied', // 上游 RBAC/Policy 未放行（交集收紧）
  'policy-ceiling-exceeded', // 请求超出有效 scope/side-effect 上限
  'policy-write-requires-allow', // 正式写类请求无匹配 allow（默认拒绝）
  'policy-unknown-operation', // 请求含未知 operation → fail closed
  'policy-unknown-permission', // 请求含未知 permission → fail closed
  'policy-snapshot-invalid', // 快照缺失/损坏/解析失败 → fail closed
  'policy-snapshot-version-unknown', // schema 版本未知 → fail closed
  'policy-snapshot-org-mismatch', // 组织绑定不匹配 → fail closed
  'policy-snapshot-stale', // revision 落后于当前激活版本 → 缓存失效
] as const
export type PluginPolicyReasonCode = (typeof PLUGIN_POLICY_BUNDLE_REASON_CODES)[number]

/** 校验 finding code（封闭集；severity 固定映射见 validate 实现）。 */
export const PLUGIN_POLICY_BUNDLE_FINDING_CODES = [
  'policy-schema-invalid', // 形状错误（非对象/数组错位/字段缺省互斥）
  'policy-unknown-field', // 封闭字段集之外的键
  'policy-authority-claim', // 文档内出现 server-owned authority 字段形态
  'policy-expression-rejected', // 表达式/脚本注入形态
  'policy-sensitive-metadata', // 敏感键（token/secret/apikey…）
  'policy-unknown-role', // 角色不在封闭词表
  'policy-unknown-operation', // 操作不在封闭词表
  'policy-unknown-permission', // permission 不在宿主已知集（context 注入）
  'policy-unknown-ceiling', // scope/side-effect 上限不在封闭词表
  'policy-conflicting-rule', // 同 (role,target) 同时存在 allow 与 deny
  'policy-duplicate-rule', // 完全重复规则（去重，warning）
  'policy-template-expansion', // 组织副本相对模板放宽（blocking）
  'policy-description-invalid', // 中文说明缺省/超界/控制字符
  'policy-version-invalid', // 版本非正整数或超界
  'policy-bundle-id-invalid', // bundleId 格式非法
] as const
export type PluginPolicyFindingCode = (typeof PLUGIN_POLICY_BUNDLE_FINDING_CODES)[number]

/** 敏感/禁止 metadata 键模式（小写匹配；出现在任何键名中即 blocking）。 */
export const PLUGIN_POLICY_FORBIDDEN_KEY_PATTERNS = [
  'token',
  'secret',
  'password',
  'apikey',
  'api_key',
  'authorization',
  'bearer',
  'credential',
  'private_key',
  'private-key',
  'expression',
  'script',
  'handler',
  'eval',
  'webhook',
  'callback_url',
] as const

/**
 * 表达式注入值形态（字符串字段值级扫描；中文说明不含这些 ASCII 形态，
 * 误伤面收敛在代码/URL/shell 片段上）。
 */
export const PLUGIN_POLICY_EXPRESSION_VALUE_PATTERNS: readonly RegExp[] = [
  /\$\{/,
  /=>\s*[^;\s]/,
  /\bfunction\s*\(/,
  /\beval\s*\(/,
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  /\bprocess\.env\b/,
  /\bchild_process\b/,
  /javascript:/i,
  /<script/i,
  /`[^`]*`/,
]

/** authority-claim 键形态（文档不得声明组织/租户/授权事实）。 */
export const PLUGIN_POLICY_AUTHORITY_CLAIM_KEYS = [
  'organizationid',
  'organization_id',
  'tenantid',
  'tenant_id',
  'userid',
  'user_id',
  'granted',
  'authorized',
  'isauthorized',
] as const

/**
 * 键名扫描安全子串：包含这些子串的键（如 descriptionZh 含 "script"）是合法说明
 * 字段，不做敏感键判定；其值仍走独立的长度/控制字符/表达式扫描。
 */
export const PLUGIN_POLICY_SAFE_KEY_SUBSTRINGS = ['description'] as const

// =============================================================================
// 2. 核心类型
// =============================================================================

/** 单条策略规则（扁平封闭字段；operation 与 permissionKey 恰填其一）。 */
export interface PluginPolicyBundleRule {
  /** 适用角色（封闭六角色）。 */
  role: PluginPolicyRole
  /** 效果：allow 仅携带收紧上限，deny 一票否决。 */
  effect: PluginPolicyRuleEffect
  /** 目标运行时操作（与 permissionKey 二选一）。 */
  operation?: PluginPolicyOperation
  /** 目标宿主 permission key（如 `plugin_install:manage`；与 operation 二选一）。 */
  permissionKey?: string
  /** scope 上限（可选收紧；缺省表示本条不额外限缩）。 */
  scopeCeiling?: PluginPolicyScopeCeiling
  /** side-effect 上限（可选收紧；缺省表示本条不额外限缩）。 */
  sideEffectCeiling?: PluginPolicySideEffectCeiling
}

/** 策略包文档（canonical 形态；normalize 后 rules 有序且无完全重复）。 */
export interface PluginPolicyBundleDocument {
  /** schema 版本。 */
  schemaVersion: PluginPolicyBundleSchemaVersion
  /** 包标识（小写 `[a-z0-9][a-z0-9._:-]{1,63}`；不含组织 id——组织归属由存储行表达）。 */
  bundleId: string
  /** 单调递增正整数版本。 */
  version: number
  /** 来源模板 id（组织副本必填；内置文档缺省）。 */
  sourceTemplateId?: (typeof PLUGIN_POLICY_TEMPLATE_IDS)[number]
  /** 来源模板版本（组织副本必填）。 */
  sourceTemplateVersion?: number
  /** 简体中文说明（有界、低敏；UI 直接展示）。 */
  descriptionZh: string
  /** 规则集（canonical 排序、去重）。 */
  rules: PluginPolicyBundleRule[]
}

/** 校验 finding（detail 有界低敏；不回显原始输入全文）。 */
export interface PluginPolicyValidationFinding {
  code: PluginPolicyFindingCode
  severity: 'info' | 'warning' | 'blocking'
  /** 字段路径（如 `rules[3].permissionKey`）。 */
  path?: string
  detail?: string
}

/** 校验上下文：宿主注入已知 permission 集（封闭词表的宿主侧事实来源）。 */
export interface PluginPolicyValidationContext {
  /** 宿主已知 permission key 全集（提供时未知 key → blocking）。 */
  knownPermissionKeys?: readonly string[]
  /** 模板基线文档（组织副本收紧性检查用；normalize 后文档或其 digest 前置形态均可）。 */
  baselineDocument?: unknown
}

/** 校验结果。 */
export interface PluginPolicyValidationResult {
  valid: boolean
  findings: PluginPolicyValidationFinding[]
  /** 归一化文档（仅 valid 时返回）。 */
  normalized?: PluginPolicyBundleDocument
  /** canonical digest（仅 valid 时返回）。 */
  digest?: string
}

/** 已验证的策略快照（security gate 消费的唯一形态；digest 进入授权 receipt）。 */
export interface VerifiedPluginPolicySnapshot {
  /** 归一化后的策略文档。 */
  document: PluginPolicyBundleDocument
  /** canonical digest（对 normalized document 计算，域分隔）。 */
  digest: string
  /** 激活修订号（每次 activate/disable 递增；缓存失效判据）。 */
  revision: number
  /** 激活时间（调用方注入的 ISO 参考时间）。 */
  activatedAt: string
  /** 组织绑定（`org:<id>`；mismatch 即 fail closed）。 */
  organizationScope: string
}

// =============================================================================
// 3. 工具：稳定序列化 / FNV-1a / Domain-separated digest
// =============================================================================

/** 确定性稳定序列化（键排序；数组顺序由调用方 normalize 保证）。 */
export function pbStableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => pbStableSerialize(v)).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    return `{${entries.map(([k, v]) => JSON.stringify(k) + ':' + pbStableSerialize(v)).join(',')}}`
  }
  return JSON.stringify(value)
}

/** FNV-1a 32-bit（与 plugin-manifest / plugin-security-gate 同算法便于交叉核对）。 */
export function pbFnv1aHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** Domain-separated digest：`aiproj:plugin-policy-bundle:<domain>:<stableSerialized>`。 */
export function pbDomainSeparatedDigest(domain: string, payload: unknown): string {
  const ns = `aiproj:plugin-policy-bundle:${domain}`
  return pbFnv1aHash(`${ns}:${pbStableSerialize(payload)}`)
}

// =============================================================================
// 4. Normalization / 排序 / digest
// =============================================================================

/** 规则排序键（undefined → ''；保证任意输入顺序下 canonical 序一致）。 */
function ruleSortKey(r: PluginPolicyBundleRule): string {
  return [
    r.role,
    r.effect,
    r.operation ?? '',
    r.permissionKey ?? '',
    r.scopeCeiling ?? '',
    r.sideEffectCeiling ?? '',
  ].join('\u241f')
}

/** 规则 canonical 排序（确定性；相同键保持首现序——重复项随后被去重）。 */
export function sortPluginPolicyRules(
  rules: readonly PluginPolicyBundleRule[],
): PluginPolicyBundleRule[] {
  return rules
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ka = ruleSortKey(a.r)
      const kb = ruleSortKey(b.r)
      if (ka !== kb) return ka < kb ? -1 : 1
      return a.i - b.i
    })
    .map((x) => x.r)
}

/** 完全重复规则去重（按 canonical 键）。 */
export function dedupePluginPolicyRules(rules: readonly PluginPolicyBundleRule[]): {
  rules: PluginPolicyBundleRule[]
  duplicates: number
} {
  const seen = new Set<string>()
  const out: PluginPolicyBundleRule[] = []
  let duplicates = 0
  for (const r of rules) {
    const k = ruleSortKey(r)
    if (seen.has(k)) {
      duplicates++
      continue
    }
    seen.add(k)
    out.push(r)
  }
  return { rules: out, duplicates }
}

/** 归一化单条规则：trim 字符串、permissionKey 小写。 */
export function normalizePluginPolicyBundleRule(
  rule: PluginPolicyBundleRule,
): PluginPolicyBundleRule {
  return {
    role: rule.role,
    effect: rule.effect,
    ...(rule.operation != null
      ? { operation: rule.operation.trim() as PluginPolicyOperation }
      : {}),
    ...(rule.permissionKey != null
      ? { permissionKey: rule.permissionKey.trim().toLowerCase() }
      : {}),
    ...(rule.scopeCeiling != null ? { scopeCeiling: rule.scopeCeiling } : {}),
    ...(rule.sideEffectCeiling != null ? { sideEffectCeiling: rule.sideEffectCeiling } : {}),
  }
}

/**
 * 归一化整份文档：trim/lowercase、rules 排序去重。
 * 输入假定已通过形状级校验（enum 合法性由 validate 负责，此处不做枚举改写）。
 */
export function normalizePluginPolicyBundleDocument(
  doc: PluginPolicyBundleDocument,
): PluginPolicyBundleDocument {
  const { rules, duplicates } = dedupePluginPolicyRules(
    doc.rules.map(normalizePluginPolicyBundleRule),
  )
  void duplicates
  return {
    schemaVersion: doc.schemaVersion,
    bundleId: doc.bundleId.trim().toLowerCase(),
    version: doc.version,
    ...(doc.sourceTemplateId != null ? { sourceTemplateId: doc.sourceTemplateId } : {}),
    ...(doc.sourceTemplateVersion != null
      ? { sourceTemplateVersion: doc.sourceTemplateVersion }
      : {}),
    descriptionZh: doc.descriptionZh.trim(),
    rules: sortPluginPolicyRules(rules),
  }
}

/** canonical digest：对 normalized 文档做域分隔摘要（不含任何易变字段）。 */
export function computePluginPolicyBundleDigest(doc: PluginPolicyBundleDocument): string {
  return pbDomainSeparatedDigest('document-v1', {
    schemaVersion: doc.schemaVersion,
    bundleId: doc.bundleId,
    version: doc.version,
    ...(doc.sourceTemplateId != null ? { sourceTemplateId: doc.sourceTemplateId } : {}),
    ...(doc.sourceTemplateVersion != null
      ? { sourceTemplateVersion: doc.sourceTemplateVersion }
      : {}),
    descriptionZh: doc.descriptionZh,
    rules: sortPluginPolicyRules(doc.rules),
  })
}

// =============================================================================
// 5. 校验（fail closed：blocking finding 聚合返回，不抛异常）
// =============================================================================

function findForbiddenKeys(
  raw: Record<string, unknown>,
  path: string,
): PluginPolicyValidationFinding[] {
  const findings: PluginPolicyValidationFinding[] = []
  const stack: Array<{ obj: unknown; path: string }> = [{ obj: raw, path }]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur || !cur.obj || typeof cur.obj !== 'object') continue
    if (Array.isArray(cur.obj)) {
      cur.obj.forEach((item, i) => stack.push({ obj: item, path: `${cur.path}[${i}]` }))
      continue
    }
    for (const [k, v] of Object.entries(cur.obj as Record<string, unknown>)) {
      const lowerKey = k.toLowerCase()
      const isSafeKey = PLUGIN_POLICY_SAFE_KEY_SUBSTRINGS.some((s) => lowerKey.includes(s))
      if (!isSafeKey && PLUGIN_POLICY_AUTHORITY_CLAIM_KEYS.includes(lowerKey as never)) {
        findings.push({
          code: 'policy-authority-claim',
          severity: 'blocking',
          path: `${cur.path}.${k}`,
          detail: 'authority claim key',
        })
      } else if (
        !isSafeKey &&
        PLUGIN_POLICY_FORBIDDEN_KEY_PATTERNS.some((p) => lowerKey.includes(p))
      ) {
        findings.push({
          code: 'policy-sensitive-metadata',
          severity: 'blocking',
          path: `${cur.path}.${k}`,
          detail: 'forbidden metadata key',
        })
      }
      stack.push({ obj: v, path: `${cur.path}.${k}` })
    }
  }
  return findings
}

function scanExpressionValue(value: string, path: string): PluginPolicyValidationFinding | null {
  if (PLUGIN_POLICY_EXPRESSION_VALUE_PATTERNS.some((re) => re.test(value))) {
    return {
      code: 'policy-expression-rejected',
      severity: 'blocking',
      path,
      detail: 'expression-like value',
    }
  }
  return null
}

/**
 * 校验并归一化一份策略包文档。
 *
 * blocking 类：schema/unknown-field/authority-claim/expression/sensitive-metadata/
 * unknown-{role,operation,permission,ceiling}/conflict/template-expansion/
 * description/version/bundle-id。
 * warning 类：duplicate-rule（自动去重，不影响 valid）。
 */
export function validatePluginPolicyBundleDocument(
  input: unknown,
  context?: PluginPolicyValidationContext,
): PluginPolicyValidationResult {
  const findings: PluginPolicyValidationFinding[] = []
  const block = (): PluginPolicyValidationResult => ({ valid: false, findings })

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    findings.push({
      code: 'policy-schema-invalid',
      severity: 'blocking',
      detail: 'document must be object',
    })
    return block()
  }
  const obj = input as Record<string, unknown>

  // 1. 封闭字段集
  const allowedKeys = new Set([
    'schemaVersion',
    'bundleId',
    'version',
    'sourceTemplateId',
    'sourceTemplateVersion',
    'descriptionZh',
    'rules',
  ])
  for (const k of Object.keys(obj)) {
    if (!allowedKeys.has(k)) {
      findings.push({
        code: 'policy-unknown-field',
        severity: 'blocking',
        path: k,
        detail: `unknown field: ${k}`,
      })
    }
  }
  // 不在此处提前返回：全树 authority/敏感/表达式扫描对畸形输入同样执行（fail closed 聚合）。

  // 2. 全树 authority-claim / 敏感 metadata 扫描
  findings.push(...findForbiddenKeys(obj, '$'))

  // 3. 标量字段
  if (obj.schemaVersion !== PLUGIN_POLICY_BUNDLE_SCHEMA_VERSION) {
    findings.push({
      code: 'policy-schema-invalid',
      severity: 'blocking',
      path: 'schemaVersion',
      detail: String(obj.schemaVersion),
    })
  }
  if (
    typeof obj.bundleId !== 'string' ||
    !/^[a-z0-9][a-z0-9._:-]{1,63}$/.test(obj.bundleId.trim().toLowerCase())
  ) {
    findings.push({
      code: 'policy-bundle-id-invalid',
      severity: 'blocking',
      path: 'bundleId',
      detail: undefined,
    })
  }
  if (
    typeof obj.version !== 'number' ||
    !Number.isInteger(obj.version) ||
    obj.version < 1 ||
    obj.version > PLUGIN_POLICY_BUNDLE_LIMITS.MAX_VERSION
  ) {
    findings.push({
      code: 'policy-version-invalid',
      severity: 'blocking',
      path: 'version',
      detail: undefined,
    })
  }
  if (
    obj.sourceTemplateId != null &&
    !(PLUGIN_POLICY_TEMPLATE_IDS as readonly string[]).includes(String(obj.sourceTemplateId))
  ) {
    findings.push({
      code: 'policy-schema-invalid',
      severity: 'blocking',
      path: 'sourceTemplateId',
      detail: String(obj.sourceTemplateId),
    })
  }
  if (
    obj.sourceTemplateVersion != null &&
    (typeof obj.sourceTemplateVersion !== 'number' ||
      !Number.isInteger(obj.sourceTemplateVersion) ||
      obj.sourceTemplateVersion < 1)
  ) {
    findings.push({
      code: 'policy-version-invalid',
      severity: 'blocking',
      path: 'sourceTemplateVersion',
      detail: undefined,
    })
  }
  if ((obj.sourceTemplateId == null) !== (obj.sourceTemplateVersion == null)) {
    findings.push({
      code: 'policy-schema-invalid',
      severity: 'blocking',
      path: 'sourceTemplateId',
      detail: 'sourceTemplate pair required together',
    })
  }

  // 4. 中文说明：必有、有界、无控制字符、无表达式形态
  if (typeof obj.descriptionZh !== 'string') {
    findings.push({
      code: 'policy-description-invalid',
      severity: 'blocking',
      path: 'descriptionZh',
      detail: 'required',
    })
  } else {
    const d = obj.descriptionZh
    if (
      d.trim().length === 0 ||
      d.length > PLUGIN_POLICY_BUNDLE_LIMITS.MAX_DESCRIPTION_LENGTH ||
      /[\u0000-\u0008\u000e-\u001f\u007f]/.test(d)
    ) {
      findings.push({
        code: 'policy-description-invalid',
        severity: 'blocking',
        path: 'descriptionZh',
        detail: undefined,
      })
    } else {
      const exprHit = scanExpressionValue(d, 'descriptionZh')
      if (exprHit) findings.push(exprHit)
    }
  }

  // 5. rules 数组
  if (!Array.isArray(obj.rules)) {
    findings.push({
      code: 'policy-schema-invalid',
      severity: 'blocking',
      path: 'rules',
      detail: 'must be array',
    })
    return block()
  }
  if (
    obj.rules.length < PLUGIN_POLICY_BUNDLE_LIMITS.MIN_RULES ||
    obj.rules.length > PLUGIN_POLICY_BUNDLE_LIMITS.MAX_RULES
  ) {
    findings.push({
      code: 'policy-schema-invalid',
      severity: 'blocking',
      path: 'rules',
      detail: `length ${obj.rules.length}`,
    })
    return block()
  }
  const knownPerms = context?.knownPermissionKeys
    ? new Set(context.knownPermissionKeys.map((k) => k.toLowerCase()))
    : null
  const parsedRules: PluginPolicyBundleRule[] = []
  const targetOwners = new Map<string, Set<PluginPolicyRuleEffect>>()

  for (let i = 0; i < obj.rules.length; i++) {
    const rPath = `rules[${i}]`
    const r = obj.rules[i]
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      findings.push({
        code: 'policy-schema-invalid',
        severity: 'blocking',
        path: rPath,
        detail: 'rule must be object',
      })
      continue
    }
    const ro = r as Record<string, unknown>
    const rAllowed = new Set([
      'role',
      'effect',
      'operation',
      'permissionKey',
      'scopeCeiling',
      'sideEffectCeiling',
    ])
    for (const k of Object.keys(ro)) {
      if (!rAllowed.has(k))
        findings.push({
          code: 'policy-unknown-field',
          severity: 'blocking',
          path: `${rPath}.${k}`,
          detail: `unknown field: ${k}`,
        })
    }
    if (!(PLUGIN_POLICY_BUNDLE_ROLES as readonly string[]).includes(String(ro.role))) {
      findings.push({
        code: 'policy-unknown-role',
        severity: 'blocking',
        path: `${rPath}.role`,
        detail: String(ro.role),
      })
    }
    if (!(PLUGIN_POLICY_RULE_EFFECTS as readonly string[]).includes(String(ro.effect))) {
      findings.push({
        code: 'policy-schema-invalid',
        severity: 'blocking',
        path: `${rPath}.effect`,
        detail: String(ro.effect),
      })
    }
    const hasOp = ro.operation != null
    const hasPerm = ro.permissionKey != null
    if (hasOp === hasPerm) {
      findings.push({
        code: 'policy-schema-invalid',
        severity: 'blocking',
        path: rPath,
        detail: 'exactly one of operation/permissionKey required',
      })
      continue
    }
    let opVal: PluginPolicyOperation | undefined
    let permVal: string | undefined
    if (hasOp) {
      if (!(PLUGIN_POLICY_BUNDLE_OPERATIONS as readonly string[]).includes(String(ro.operation))) {
        findings.push({
          code: 'policy-unknown-operation',
          severity: 'blocking',
          path: `${rPath}.operation`,
          detail: String(ro.operation),
        })
      } else {
        opVal = String(ro.operation) as PluginPolicyOperation
      }
    } else {
      if (
        typeof ro.permissionKey !== 'string' ||
        ro.permissionKey.trim().length === 0 ||
        ro.permissionKey.length > PLUGIN_POLICY_BUNDLE_LIMITS.MAX_PERMISSION_KEY_LENGTH
      ) {
        findings.push({
          code: 'policy-schema-invalid',
          severity: 'blocking',
          path: `${rPath}.permissionKey`,
          detail: undefined,
        })
      } else {
        permVal = ro.permissionKey.trim().toLowerCase()
        const exprHit = scanExpressionValue(permVal, `${rPath}.permissionKey`)
        if (exprHit) findings.push(exprHit)
        if (knownPerms && !knownPerms.has(permVal)) {
          findings.push({
            code: 'policy-unknown-permission',
            severity: 'blocking',
            path: `${rPath}.permissionKey`,
            detail: undefined,
          })
        }
      }
    }
    let scopeVal: PluginPolicyScopeCeiling | undefined
    if (ro.scopeCeiling != null) {
      if (
        !(PLUGIN_POLICY_BUNDLE_SCOPE_CEILINGS as readonly string[]).includes(
          String(ro.scopeCeiling),
        )
      ) {
        findings.push({
          code: 'policy-unknown-ceiling',
          severity: 'blocking',
          path: `${rPath}.scopeCeiling`,
          detail: String(ro.scopeCeiling),
        })
      } else {
        scopeVal = String(ro.scopeCeiling) as PluginPolicyScopeCeiling
      }
    }
    let seVal: PluginPolicySideEffectCeiling | undefined
    if (ro.sideEffectCeiling != null) {
      if (
        !(PLUGIN_POLICY_BUNDLE_SIDE_EFFECTS as readonly string[]).includes(
          String(ro.sideEffectCeiling),
        )
      ) {
        findings.push({
          code: 'policy-unknown-ceiling',
          severity: 'blocking',
          path: `${rPath}.sideEffectCeiling`,
          detail: String(ro.sideEffectCeiling),
        })
      } else {
        seVal = String(ro.sideEffectCeiling) as PluginPolicySideEffectCeiling
      }
    }
    if (
      typeof ro.role === 'string' &&
      (PLUGIN_POLICY_BUNDLE_ROLES as readonly string[]).includes(ro.role) &&
      typeof ro.effect === 'string' &&
      (PLUGIN_POLICY_RULE_EFFECTS as readonly string[]).includes(ro.effect) &&
      (opVal != null || permVal != null)
    ) {
      const target = opVal != null ? `op:${opVal}` : `perm:${permVal}`
      const key = `${String(ro.role)}\u241f${target}`
      const owners = targetOwners.get(key) ?? new Set<PluginPolicyRuleEffect>()
      owners.add(ro.effect as PluginPolicyRuleEffect)
      targetOwners.set(key, owners)
      parsedRules.push({
        role: ro.role as PluginPolicyRole,
        effect: ro.effect as PluginPolicyRuleEffect,
        ...(opVal != null ? { operation: opVal } : {}),
        ...(permVal != null ? { permissionKey: permVal } : {}),
        ...(scopeVal != null ? { scopeCeiling: scopeVal } : {}),
        ...(seVal != null ? { sideEffectCeiling: seVal } : {}),
      })
    }
  }

  // 6. 冲突检测：同 (role,target) 同时 allow+deny → blocking（fail closed）
  for (const [key, owners] of targetOwners) {
    if (owners.size > 1) {
      findings.push({
        code: 'policy-conflicting-rule',
        severity: 'blocking',
        path: key.replace(/\u241f/g, '/'),
        detail: 'allow and deny coexist',
      })
    }
  }

  // 7. 收敛 blocking 判定
  if (findings.some((f) => f.severity === 'blocking')) return block()

  const normalized = normalizePluginPolicyBundleDocument({
    schemaVersion: obj.schemaVersion as PluginPolicyBundleSchemaVersion,
    bundleId: String(obj.bundleId),
    version: obj.version as number,
    ...(obj.sourceTemplateId != null
      ? { sourceTemplateId: obj.sourceTemplateId as PluginPolicyBundleDocument['sourceTemplateId'] }
      : {}),
    ...(obj.sourceTemplateVersion != null
      ? { sourceTemplateVersion: obj.sourceTemplateVersion as number }
      : {}),
    descriptionZh: String(obj.descriptionZh),
    rules: parsedRules,
  })

  // 8. 重复规则提示（去重已在 normalize 完成；warning 不影响 valid）
  if (normalized.rules.length < parsedRules.length) {
    findings.push({
      code: 'policy-duplicate-rule',
      severity: 'warning',
      detail: `${parsedRules.length - normalized.rules.length} duplicate(s)`,
    })
  }

  // 9. 组织副本收紧性检查（提供 baseline 时）
  if (context?.baselineDocument != null) {
    const baseRes = validatePluginPolicyBundleDocument(context.baselineDocument, {
      knownPermissionKeys: context.knownPermissionKeys,
    })
    if (baseRes.valid && baseRes.normalized) {
      findings.push(...comparePluginPolicyCopyToBaseline(normalized, baseRes.normalized))
    }
  }

  if (findings.some((f) => f.severity === 'blocking')) return block()
  return { valid: true, findings, normalized, digest: computePluginPolicyBundleDigest(normalized) }
}

/**
 * 组织副本 vs 模板收紧性比较（design D3：副本只能 deny 更多、上限更低、allow 集更小）。
 * 返回 blocking findings（空数组 = 未发现放宽）。
 */
export function comparePluginPolicyCopyToBaseline(
  copy: PluginPolicyBundleDocument,
  baseline: PluginPolicyBundleDocument,
): PluginPolicyValidationFinding[] {
  const findings: PluginPolicyValidationFinding[] = []
  type RuleMeta = {
    effect: PluginPolicyRuleEffect
    scope?: PluginPolicyScopeCeiling
    se?: PluginPolicySideEffectCeiling
  }
  const index = (doc: PluginPolicyBundleDocument) => {
    const m = new Map<string, RuleMeta>()
    for (const r of doc.rules) {
      const target = r.operation != null ? `op:${r.operation}` : `perm:${r.permissionKey}`
      m.set(`${r.role}\u241f${target}`, {
        effect: r.effect,
        scope: r.scopeCeiling,
        se: r.sideEffectCeiling,
      })
    }
    return m
  }
  const base = index(baseline)
  const cp = index(copy)
  for (const [key, cRule] of cp) {
    const bRule = base.get(key)
    if (!bRule) {
      if (cRule.effect === 'allow') {
        findings.push({
          code: 'policy-template-expansion',
          severity: 'blocking',
          path: key.replace(/\u241f/g, '/'),
          detail: 'allow target absent in baseline',
        })
      }
      continue
    }
    if (bRule.effect === 'deny' && cRule.effect === 'allow') {
      findings.push({
        code: 'policy-template-expansion',
        severity: 'blocking',
        path: key.replace(/\u241f/g, '/'),
        detail: 'baseline denied',
      })
      continue
    }
    if (cRule.effect === 'allow') {
      // allow 规则的上限只许降不许升
      if (
        cRule.scope &&
        bRule.scope &&
        (PLUGIN_POLICY_SCOPE_RANK[cRule.scope] ?? -1) >
          (PLUGIN_POLICY_SCOPE_RANK[bRule.scope] ?? -1)
      ) {
        findings.push({
          code: 'policy-template-expansion',
          severity: 'blocking',
          path: `${key.replace(/\u241f/g, '/')}/scopeCeiling`,
          detail: 'scope ceiling loosened',
        })
      }
      if (
        cRule.se &&
        bRule.se &&
        (PLUGIN_POLICY_SIDE_EFFECT_RANK[cRule.se] ?? -1) >
          (PLUGIN_POLICY_SIDE_EFFECT_RANK[bRule.se] ?? -1)
      ) {
        findings.push({
          code: 'policy-template-expansion',
          severity: 'blocking',
          path: `${key.replace(/\u241f/g, '/')}/sideEffectCeiling`,
          detail: 'side-effect ceiling loosened',
        })
      }
    }
  }
  return findings
}

// =============================================================================
// 6. 快照构造与验证（security gate 只消费 verified snapshot）
// =============================================================================

/** 构造 verified snapshot：假定文档已通过 validate（内部仍复核 digest 一致性）。 */
export function createVerifiedPluginPolicySnapshot(input: {
  document: PluginPolicyBundleDocument
  revision: number
  activatedAt: string
  organizationScope: string
}): VerifiedPluginPolicySnapshot {
  const normalized = normalizePluginPolicyBundleDocument(input.document)
  return {
    document: normalized,
    digest: computePluginPolicyBundleDigest(normalized),
    revision: input.revision,
    activatedAt: new Date(input.activatedAt).toISOString(),
    organizationScope: input.organizationScope,
  }
}

/**
 * 验证快照可用性：parse 形态 / schema 版本 / digest 完整性 / 组织绑定逐项检查；
 * 任一失败给出稳定 reason code（spec Requirement 5/6：mismatch 即 deny，不回退放行）。
 */
export function verifyPluginPolicySnapshot(
  snapshot: unknown,
  expected?: { organizationScope?: string },
): { valid: boolean; reasonCode?: PluginPolicyReasonCode } {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { valid: false, reasonCode: 'policy-snapshot-invalid' }
  }
  const s = snapshot as Partial<VerifiedPluginPolicySnapshot>
  if (!s.document || typeof s.document !== 'object')
    return { valid: false, reasonCode: 'policy-snapshot-invalid' }
  if (s.document.schemaVersion !== PLUGIN_POLICY_BUNDLE_SCHEMA_VERSION) {
    return { valid: false, reasonCode: 'policy-snapshot-version-unknown' }
  }
  const check = validatePluginPolicyBundleDocument(s.document)
  if (!check.valid || !check.normalized || check.digest !== s.digest) {
    return { valid: false, reasonCode: 'policy-snapshot-invalid' }
  }
  if (expected?.organizationScope != null && s.organizationScope !== expected.organizationScope) {
    return { valid: false, reasonCode: 'policy-snapshot-org-mismatch' }
  }
  if (typeof s.revision !== 'number' || !Number.isInteger(s.revision) || s.revision < 1) {
    return { valid: false, reasonCode: 'policy-snapshot-invalid' }
  }
  return { valid: true }
}

// =============================================================================
// 7. 内置模板（任务 1.4：admin-managed / pm-enabled / member-readonly）
// =============================================================================

/** 内置模板 id 封闭集。 */
export const PLUGIN_POLICY_TEMPLATE_IDS = [
  'admin-managed',
  'pm-enabled',
  'member-readonly',
] as const
export type PluginPolicyTemplateId = (typeof PLUGIN_POLICY_TEMPLATE_IDS)[number]

const ADMIN_RUNTIME_ALLOW_RULES: PluginPolicyBundleRule[] = ['system_admin', 'org_admin'].flatMap(
  (role) =>
    PLUGIN_POLICY_BUNDLE_OPERATIONS.map((operation) => ({
      role: role as PluginPolicyRole,
      effect: 'allow' as const,
      operation,
      scopeCeiling: 'organization' as const,
      sideEffectCeiling: 'formal-write' as const,
    })),
)

const ADMIN_MANAGE_ALLOW_RULES: PluginPolicyBundleRule[] = ['system_admin', 'org_admin'].flatMap(
  (role) =>
    (['plugin_install:manage', 'plugin_registry:manage'] as const).map((permissionKey) => ({
      role: role as PluginPolicyRole,
      effect: 'allow' as const,
      permissionKey,
      scopeCeiling: 'organization' as const,
    })),
)

const LOW_ROLE_READ_ONLY_ALLOW_RULES: PluginPolicyBundleRule[] = (
  ['project_manager', 'member'] as const
).flatMap((role) =>
  (['resolve-query', 'ui-slot'] as const).map((operation) => ({
    role,
    effect: 'allow' as const,
    operation,
    scopeCeiling: 'organization' as const,
    sideEffectCeiling: 'read-only' as const,
  })),
)

const LOW_ROLE_MANAGE_DENY_RULES: PluginPolicyBundleRule[] = (
  ['project_manager', 'member'] as const
).flatMap((role) =>
  (['plugin_install:manage', 'plugin_registry:manage'] as const).map((permissionKey) => ({
    role,
    effect: 'deny' as const,
    permissionKey,
  })),
)

const PM_FULL_USE_ALLOW_RULES: PluginPolicyBundleRule[] = PLUGIN_POLICY_BUNDLE_OPERATIONS.map(
  (operation) => ({
    role: 'project_manager' as const,
    effect: 'allow' as const,
    operation,
    scopeCeiling: 'project' as const,
    sideEffectCeiling: 'formal-write' as const,
  }),
)

export interface PluginPolicyTemplate {
  templateId: PluginPolicyTemplateId
  templateVersion: number
  titleZh: string
  descriptionZh: string
  document: PluginPolicyBundleDocument
}

/** 三个内置模板（随宿主版本发布、只读；组织仅可复制后收紧）。 */
export const BUILTIN_PLUGIN_POLICY_TEMPLATES: readonly PluginPolicyTemplate[] = [
  {
    templateId: 'admin-managed',
    templateVersion: 1,
    titleZh: '管理员集中管控',
    descriptionZh:
      '插件安装与使用均由系统管理员和组织管理员集中管控；项目经理与普通成员仅可使用查询类只读能力，安装、升级、权限变更与正式写入全部拒绝。策略只会收紧既有 RBAC 权限，不会授予角色原本没有的权限。',
    document: {
      schemaVersion: '1.0',
      bundleId: 'builtin.admin-managed',
      version: 1,
      descriptionZh:
        '管理员集中管控：仅管理员可管理与使用插件，其余角色只读查询；策略只能收紧 RBAC，不能放大权限。',
      rules: [
        ...ADMIN_RUNTIME_ALLOW_RULES,
        ...ADMIN_MANAGE_ALLOW_RULES,
        ...LOW_ROLE_READ_ONLY_ALLOW_RULES,
        ...LOW_ROLE_MANAGE_DENY_RULES,
      ],
    },
  },
  {
    templateId: 'pm-enabled',
    templateVersion: 1,
    titleZh: '项目经理可用',
    descriptionZh:
      '管理员保留安装与管理权；项目经理可在项目范围内使用插件运行时能力（含正式写，需走宿主确认流）；普通成员仅查询类只读能力。所有上限均为封顶值，实际权限仍由 RBAC 决定。',
    document: {
      schemaVersion: '1.0',
      bundleId: 'builtin.pm-enabled',
      version: 1,
      descriptionZh:
        '项目经理可用：管理员管理，项目经理在项目范围内使用插件能力，成员只读；策略只能收紧 RBAC，不能放大权限。',
      rules: [
        ...ADMIN_RUNTIME_ALLOW_RULES,
        ...ADMIN_MANAGE_ALLOW_RULES,
        ...PM_FULL_USE_ALLOW_RULES,
        ...LOW_ROLE_READ_ONLY_ALLOW_RULES.filter((r) => r.role === 'member'),
        ...LOW_ROLE_MANAGE_DENY_RULES,
      ],
    },
  },
  {
    templateId: 'member-readonly',
    templateVersion: 1,
    titleZh: '成员只读',
    descriptionZh:
      '最常见的默认姿态：管理员管理，项目经理可在项目范围内使用插件能力；普通成员严格只读——查询类能力可以通过，但安装、升级、权限变更与一切正式写入都被显式拒绝。策略只能收紧 RBAC，不能放大权限。',
    document: {
      schemaVersion: '1.0',
      bundleId: 'builtin.member-readonly',
      version: 1,
      descriptionZh:
        '成员只读：管理员管理，项目经理项目内使用，成员仅查询且显式拒绝安装/升级/权限变更/正式写入；策略只能收紧 RBAC，不能放大权限。',
      rules: [
        ...ADMIN_RUNTIME_ALLOW_RULES,
        ...ADMIN_MANAGE_ALLOW_RULES,
        ...PM_FULL_USE_ALLOW_RULES,
        ...LOW_ROLE_READ_ONLY_ALLOW_RULES.filter((r) => r.role === 'member'),
        ...LOW_ROLE_MANAGE_DENY_RULES,
      ],
    },
  },
]

/** 按 id 取内置模板（未知 id 返回 undefined，调用方 fail closed）。 */
export function getBuiltinPluginPolicyTemplate(
  templateId: string,
): PluginPolicyTemplate | undefined {
  return BUILTIN_PLUGIN_POLICY_TEMPLATES.find((t) => t.templateId === templateId)
}

// =============================================================================
// 8. Deny-first 交集求值器（任务 2.1；纯函数、零 I/O、确定性）
// =============================================================================

/** 读类操作（缺省策略时 abstain：仅受 RBAC/红线约束）。 */
export const PLUGIN_POLICY_READ_OPERATIONS: readonly PluginPolicyOperation[] = [
  'resolve-query',
  'ui-slot',
]

/** 正式写类操作（必须有显式 allow 才放行：默认拒绝）。 */
export const PLUGIN_POLICY_FORMAL_WRITE_OPERATIONS: readonly PluginPolicyOperation[] = [
  'execute',
  'command-proposal',
  'skill-adapter',
  'compiler-contribution',
]

/** 正式写的 side-effect 秩阈值（≥ proposal 视为写类）。 */
export const PLUGIN_POLICY_WRITE_SIDE_EFFECT_MIN_RANK = PLUGIN_POLICY_SIDE_EFFECT_RANK['proposal']

/** 求值目标：运行时操作或宿主 permission（恰好其一）。 */
export interface PluginPolicyDecisionTarget {
  operation?: PluginPolicyOperation
  permissionKey?: string
}

/** 求值输入（全部来自服务端可信解析；客户端输入禁止直接进入）。 */
export interface PluginPolicyEvaluateInput {
  /** 已验证快照（必须先过 verifyPluginPolicySnapshot）。 */
  snapshot: VerifiedPluginPolicySnapshot
  /** actor 角色（服务端从组织/项目成员关系解析的封闭角色集）。 */
  actorRoles: readonly PluginPolicyRole[]
  /** 目标。 */
  target: PluginPolicyDecisionTarget
  /** 请求 scope kind（封闭二值）。 */
  scopeKind: 'organization' | 'project'
  /** 请求涉及 permission 的最高 side-effect 类（宿主按 vocabulary 折算；读类传 'read-only'）。 */
  sideEffect?: PluginPolicySideEffectCeiling
  /** 平台红线命中（宿主红线检查结论；true → 一票否决）。 */
  redlineHit?: boolean
  /** 上游 RBAC/Policy 放行结论（交集项）。 */
  rbacAllowed: boolean
}

/** 求值结果（reasonCodes 稳定排序；policyDigest 供 receipt 绑定）。 */
export interface PluginPolicyEvaluateResult {
  allowed: boolean
  reasonCode?: PluginPolicyReasonCode
  reasonCodes: PluginPolicyReasonCode[]
  /** 快照 canonical digest（enforcement 模式进入授权 receipt）。 */
  policyDigest: string
  /** 命中的快照 revision（缓存失效判定/审计）。 */
  revision: number
}

function sortPolicyReasonCodes(codes: PluginPolicyReasonCode[]): PluginPolicyReasonCode[] {
  return [...new Set(codes)].sort((a, b) => {
    const ia = PLUGIN_POLICY_BUNDLE_REASON_CODES.indexOf(a)
    const ib = PLUGIN_POLICY_BUNDLE_REASON_CODES.indexOf(b)
    if (ia !== ib) return ia - ib
    return a < b ? -1 : a > b ? 1 : 0
  })
}

/**
 * Deny-first 交集求值：
 * 1. 平台红线命中 → 一票否决；
 * 2. 未知 operation/permission → fail closed；
 * 3. 上游 RBAC/Policy 未放行 → 交集拒绝（策略绝不放大）；
 * 4. 显式 deny（任一 actor 命中角色规则）→ 一票否决；
 * 5. allow 规则的 scope/side-effect 上限收紧交集，超出 → 拒绝；
 * 6. 正式写类请求无显式 allow → 默认拒绝（读类 abstain 放行交由上游）。
 * 相同输入必然产生相同结果与 policyDigest。
 */
export function evaluatePluginPolicy(input: PluginPolicyEvaluateInput): PluginPolicyEvaluateResult {
  const deny = (...codes: PluginPolicyReasonCode[]): PluginPolicyEvaluateResult => ({
    allowed: false,
    reasonCode: sortPolicyReasonCodes(codes)[0],
    reasonCodes: sortPolicyReasonCodes(codes),
    policyDigest: input.snapshot.digest,
    revision: input.snapshot.revision,
  })

  // 2. 目标合法性（防御性 fail closed；正常路径由调用方类型保证）
  const hasOp = input.target.operation != null
  const hasPerm = input.target.permissionKey != null
  if (hasOp === hasPerm) return deny('policy-unknown-operation')
  if (
    hasOp &&
    !(PLUGIN_POLICY_BUNDLE_OPERATIONS as readonly string[]).includes(String(input.target.operation))
  ) {
    return deny('policy-unknown-operation')
  }
  if (
    hasPerm &&
    (typeof input.target.permissionKey !== 'string' ||
      input.target.permissionKey.trim().length === 0)
  ) {
    return deny('policy-unknown-permission')
  }

  // 1. 平台红线
  if (input.redlineHit === true) return deny('policy-redline')

  // 3. 上游 RBAC/Policy（交集：策略不放大）
  if (input.rbacAllowed !== true) return deny('policy-rbac-denied')

  // 4./5./6. 规则匹配
  const roleSet = new Set(input.actorRoles)
  let hasAllowMatch = false
  for (const rule of input.snapshot.document.rules) {
    if (!roleSet.has(rule.role)) continue
    const targetMatched =
      rule.operation != null
        ? rule.operation === input.target.operation
        : rule.permissionKey != null &&
          rule.permissionKey === input.target.permissionKey?.trim().toLowerCase()
    if (!targetMatched) continue
    if (rule.effect === 'deny') return deny('policy-deny')
    // effect === 'allow'：上限收紧检查
    hasAllowMatch = true
    if (
      rule.scopeCeiling != null &&
      (PLUGIN_POLICY_SCOPE_RANK[input.scopeKind] ?? -1) >
        (PLUGIN_POLICY_SCOPE_RANK[rule.scopeCeiling] ?? -1)
    ) {
      return deny('policy-ceiling-exceeded')
    }
    if (
      rule.sideEffectCeiling != null &&
      input.sideEffect != null &&
      (PLUGIN_POLICY_SIDE_EFFECT_RANK[input.sideEffect] ?? -1) >
        (PLUGIN_POLICY_SIDE_EFFECT_RANK[rule.sideEffectCeiling] ?? -1)
    ) {
      return deny('policy-ceiling-exceeded')
    }
  }

  // 6. 正式写类默认拒绝（spec Scenario 1：安装/升级/权限变更/正式写入 MUST 拒绝）
  const sideEffectRank =
    input.sideEffect != null ? (PLUGIN_POLICY_SIDE_EFFECT_RANK[input.sideEffect] ?? -1) : -1
  const isFormalWrite =
    (hasOp &&
      (PLUGIN_POLICY_FORMAL_WRITE_OPERATIONS as readonly string[]).includes(
        String(input.target.operation),
      )) ||
    (hasPerm && input.target.permissionKey!.includes(':manage')) ||
    sideEffectRank >= (PLUGIN_POLICY_WRITE_SIDE_EFFECT_MIN_RANK ?? Number.MAX_SAFE_INTEGER)
  if (isFormalWrite && !hasAllowMatch) return deny('policy-write-requires-allow')

  return {
    allowed: true,
    reasonCodes: [],
    policyDigest: input.snapshot.digest,
    revision: input.snapshot.revision,
  }
}
