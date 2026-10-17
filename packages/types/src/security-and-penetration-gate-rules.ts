/**
 * security-and-penetration-gate-rules —— V3 安全与渗透门禁的确定性规则引擎。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块，零运行时依赖：不读文件、不访问网络，
 * 输入全部为内存数据（catalog 条目、attack fixture、graph freshness 元数据、文本快照），
 * 输出为确定性 finding 序列。类型契约见 `security-and-penetration-gate.ts`；catalog 与
 * attack fixtures 见 `security-and-penetration-gate-fixtures.ts`（本模块只依赖其类型）。
 *
 * # 检测原则（observation-and-inventory.md §4；design D4/D6）
 * - catalog 完整性：未知 high-risk surface 无条目 → SEC-CAT-001 blocking；catalog 本身
 *   校验失败 → SEC-CAT-002 blocking。
 * - redline（spec Requirement 6）：AI 自动执行 / 客户端权威租户或权限声明 / 跨租泄露 /
 *   secret 持久化 / 未授权真实外部动作 / 无确认正式写入 —— 一律 blocking，waiver 不能降级。
 * - 文本扫描与 compat gate 同纪律：大小写不敏感、句子级否定豁免、描述门禁检测对象的
 *   元描述行（含 gate/门禁/finding/检测/MUST block 等信号）不产 blocking。
 * - graph freshness（spec Requirement 8/9）：空图谱结果不得当作「不存在」的证据；
 *   缺 fallback 证据时 SEC-OBS-001 blocking；讨论图谱但未记录 fallback → SEC-OBS-002 warning。
 * - waiver（spec Requirement 7）：仅 warning finding 可 waiver；redline 一律拒绝；
 *   waiver 必须 owner/reason/expiry/mitigation/evidenceRefs/approvalContext 齐全。
 *
 * # 低敏纪律（红线）
 * 所有 finding 的 summary 经 `sanitizeSecurityEvidence` 处理，evidenceRefs 只含
 * 「路径:行号」或稳定 ID，绝不携带原始 prompt、模型输出、secret、token、
 * Authorization 头、provider 原始载荷、原始 XML/SCIM payload、完整日志或跨租户数据。
 *
 * # 确定性
 * 同一输入两次运行必须产出相同 findingId/ruleId/severity/subjectPath 序列：
 * 每个 detector 对每个（规则, subject）至多产一条 finding，evidenceRefs 去重排序，
 * 输出稳定排序（ruleId → subjectPath → findingId）。
 */

import {
  computeSecuritySourceHash,
  isSecurityDomain,
  sanitizeSecurityEvidence,
  securityFnv1aHash,
  type AttackScenarioFixture,
  type SecurityEvidenceRef,
  type SecurityFinding,
  type SecurityGateCatalogEntry,
  type SecurityGateStatus,
  type SecurityReasonCode,
  type SecuritySeverity,
  type SecurityWaiver,
} from './security-and-penetration-gate.js'
// =============================================================================
// 1. 规则 ID 与输入类型
// =============================================================================

/** 稳定规则 ID 常量（`SEC-<族>-<序号>`；ID 一经发布不得更改含义）。 */
export const SEC_RULE_IDS = {
  /** catalog：high-risk surface 无 gate 条目（blocking）。 */
  catalogGap: 'SEC-CAT-001',
  /** catalog：catalog 条目本身校验失败（重复 id / 缺字段 / 未知枚举）。 */
  catalogInvalid: 'SEC-CAT-002',
  /** catalog：attack scenario 覆盖缺失（blocking，高风险面必须注册或显式延期）。 */
  attackCoverageGap: 'SEC-CAT-003',
  /** redline：AI/生成输出不经预览+显式确认成为正式数据（blocking）。 */
  aiAutoExecution: 'SEC-RL-001',
  /** redline：客户端提供的组织/权限/allow 声明成为权威（blocking）。 */
  clientAuthoritativeClaim: 'SEC-RL-002',
  /** redline：跨租户数据暴露（blocking）。 */
  tenantLeakage: 'SEC-RL-003',
  /** redline：secret/token 持久化到日志/审计/响应（blocking）。 */
  secretPersistence: 'SEC-RL-004',
  /** redline：未授权真实外部动作（blocking）。 */
  unauthorizedExternalAction: 'SEC-RL-005',
  /** redline：正式写入无人工确认（blocking）。 */
  unconfirmedFormalWrite: 'SEC-RL-006',
  /** observation：空图谱结果当「不存在」证据（blocking）。 */
  graphAbsenceConclusion: 'SEC-OBS-001',
  /** observation：讨论图谱但未记录 direct source/OpenSpec fallback（warning）。 */
  graphMissingFallback: 'SEC-OBS-002',
  /** evidence：相关 V3 change 无安全证据且未记 non-applicability（按风险 warning/blocking）。 */
  missingSecurityEvidence: 'SEC-EV-001',
} as const

export type SecRuleId = (typeof SEC_RULE_IDS)[keyof typeof SEC_RULE_IDS]

/** 一个待检 OpenSpec change 的内存快照（仓库相对路径 + 文本内容）。 */
export interface SecurityArtifactSnapshot {
  changeName: string
  artifacts: { path: string; content: string }[]
}

/** 规则引擎输入（结构化 + 文本快照）。 */
export interface SecurityGateEvaluationInput {
  changeName: string
  /** 当前 change 声称触及的 domain（文本/产物中出现的 surface）。 */
  claimedDomains: string[]
  /** 当前 catalog（缺 surface → SEC-CAT-001；含攻击覆盖检查）。 */
  catalogEntries: SecurityGateCatalogEntry[]
  /** 已登记的 attack scenarios（缺类 → SEC-CAT-003）。 */
  attackScenarios: AttackScenarioFixture[]
  /** change 工件快照（文本 redline/evidence 扫描；可空）。 */
  artifactSnapshot?: SecurityArtifactSnapshot
  /** graph freshness 元数据。 */
  graph?: {
    freshness: 'fresh' | 'stale' | 'unknown'
    version?: string
    /** 图谱已知不完整（progress/current-focus 或实测证据）。 */
    knownIncomplete?: boolean
    /** 是否执行了 direct source/OpenSpec fallback 并记录。 */
    fallbackEvidenceRefs?: SecurityEvidenceRef[]
  }
  /** 归档前的安全证据声明（低敏：命令/测试/validate 结果）。 */
  archiveSecurityEvidence?: {
    gateCommand?: string
    strictValidate?: boolean
    focusedTests?: string[]
    nonApplicabilityNote?: string
  }
  /** waiver 列表（应用求值）。 */
  waivers?: SecurityWaiver[]
  /** 注入当前时间（测试用）。 */
  now?: Date
}

/** 规则引擎输出。 */
export interface SecurityGateEvaluationResult {
  changeName: string
  findings: SecurityFinding[]
  blockingCount: number
  warningCount: number
  /** 聚合状态：任一 blocking → blocked；否则任一 warning → warned；否则 passed。 */
  status: Extract<SecurityGateStatus, 'blocked' | 'warned' | 'passed'>
}

// =============================================================================
// 2. finding 创建 helpers（3.3：确定性 ID / 低敏 summary）
// =============================================================================

export interface MakeSecurityFindingInput {
  ruleId: string
  code: SecurityFinding['code']
  severity: SecuritySeverity
  subjectPath: string
  summary: string
  evidenceRefs?: SecurityEvidenceRef[]
  reasonCode?: SecurityReasonCode
}

/** 确定性 finding ID：hash(ruleId|subjectPath|sourceHash)。 */
export function makeSecurityFindingId(
  ruleId: string,
  subjectPath: string,
  sourceHash: string,
): string {
  return `${ruleId.toLowerCase()}-${securityFnv1aHash(`${ruleId}|${subjectPath}|${sourceHash}`)}`
}

/** 创建 finding：summary 先过 sanitization；evidenceRefs 去重排序。 */
export function makeSecurityFinding(input: MakeSecurityFindingInput): SecurityFinding {
  const sourceHash = computeSecuritySourceHash({
    ruleId: input.ruleId,
    subjectPath: input.subjectPath,
    summary: input.summary,
  })
  const sanitized = sanitizeSecurityEvidence(input.summary)
  const refs = (input.evidenceRefs ?? [])
    .map((r) => ({ ...r }))
    .sort((a, b) =>
      `${a.kind}:${a.path ?? a.id ?? ''}`.localeCompare(`${b.kind}:${b.path ?? b.id ?? ''}`),
    )
    .filter(
      (r, i, arr) =>
        arr.findIndex((x) => x.kind === r.kind && x.path === r.path && x.id === r.id) === i,
    )
  return {
    findingId: makeSecurityFindingId(input.ruleId, input.subjectPath, sourceHash),
    ruleId: input.ruleId,
    code: input.code,
    severity: input.severity,
    status:
      input.severity === 'blocking'
        ? 'blocked'
        : input.severity === 'warning'
          ? 'warned'
          : 'passed',
    subjectPath: input.subjectPath,
    evidenceRefs: refs,
    sourceHash,
    summary: typeof sanitized.value === 'string' ? sanitized.value : input.summary,
    reasonCode: input.reasonCode,
  }
}

/** 稳定排序（ruleId → subjectPath → findingId），保证输出确定性。 */
export function sortSecurityFindings(findings: SecurityFinding[]): SecurityFinding[] {
  return [...findings].sort((a, b) => {
    const byRule = a.ruleId.localeCompare(b.ruleId)
    if (byRule !== 0) return byRule
    const bySubject = a.subjectPath.localeCompare(b.subjectPath)
    if (bySubject !== 0) return bySubject
    return a.findingId.localeCompare(b.findingId)
  })
}

// =============================================================================
// 3. catalog 完整性检测（3.1）
// =============================================================================

/** 检查 claimedDomains 是否都有 catalog 条目；未知 domain 本身也报 gap。 */
export function checkSecurityCatalogCompleteness(
  claimedDomains: string[],
  entries: SecurityGateCatalogEntry[],
  evidenceRefs: SecurityEvidenceRef[] = [],
): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  const covered = new Set(entries.map((e) => e.domain))
  const seen = new Set<string>()
  for (const domain of claimedDomains) {
    if (seen.has(domain)) continue
    seen.add(domain)
    if (!isSecurityDomain(domain)) {
      findings.push(
        makeSecurityFinding({
          ruleId: SEC_RULE_IDS.catalogGap,
          code: 'catalog_gap',
          severity: 'blocking',
          subjectPath: `domain:${domain}`,
          summary: `声称的 surface 不是已知安全域: ${domain}`,
          evidenceRefs,
        }),
      )
      continue
    }
    if (!covered.has(domain)) {
      findings.push(
        makeSecurityFinding({
          ruleId: SEC_RULE_IDS.catalogGap,
          code: 'catalog_gap',
          severity: 'blocking',
          subjectPath: `domain:${domain}`,
          summary: `high-risk security surface 无 catalog 条目: ${domain}（未知 surface 不得静默放行）`,
          evidenceRefs,
        }),
      )
    }
  }
  return findings
}

/** 攻击场景覆盖检查：必须覆盖的 attack kind 缺类 → SEC-CAT-003 blocking。 */
export function checkAttackCoverageCompleteness(
  scenarios: AttackScenarioFixture[],
  requiredKinds: readonly string[],
  evidenceRefs: SecurityEvidenceRef[] = [],
): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  const kinds = new Set<string>(scenarios.map((s) => s.kind))
  for (const kind of requiredKinds) {
    if (!kinds.has(kind)) {
      findings.push(
        makeSecurityFinding({
          ruleId: SEC_RULE_IDS.attackCoverageGap,
          code: 'catalog_gap',
          severity: 'blocking',
          subjectPath: `attack-kind:${kind}`,
          summary: `attack scenario kind 无 fixture 覆盖: ${kind}`,
          evidenceRefs,
        }),
      )
    }
  }
  return findings
}

// =============================================================================
// 4. 文本扫描 redline 检测（3.5：AI/客户端声明/外部动作/无确认写入；句级否定豁免）
// =============================================================================

interface LineHit {
  path: string
  line: number
  text: string
}

function* iterateSnapshotLines(snapshot: SecurityArtifactSnapshot): Generator<LineHit> {
  for (const artifact of snapshot.artifacts) {
    const lines = artifact.content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index] ?? ''
      if (text.trim().length === 0) continue
      yield { path: artifact.path, line: index + 1, text }
    }
  }
}

/** 句子级否定豁免：命中关键词所在句（以 .。;；!！?？\n 为界）含动作否定词则不产 finding。 */
function isSentenceNegated(text: string, keywords: RegExp): boolean {
  const sentences = text.split(/[.;;!！?？。\n]/)
  for (const sentence of sentences) {
    keywords.lastIndex = 0
    if (!keywords.test(sentence)) continue
    // 只豁免明确否定该动作的句子：「不调用/不执行/禁止/不得/无需(动作)/停在 fixture 边界/必须经确认」。
    return /(?:不(?:调用|执行|验证|联调|授权|发送|推送|写|落库|转正|通过|允许|需要|做|让|要求|触及|涉及|覆盖|用|在|回显|泄露|泄漏|暴露|带出|保存|存储|参与|得|使用|采用|包含|提供)|未(?:经|调用|执行|授权|获得|触及|涉及)|禁止|不得|拒绝|从不|不会|不能|无法|不可|不允许|不要|没有(?:调用|执行|授权)|无需(?:调用|执行|验证|联调|授权|发送|推送|真实)|必须(?:先|经|要)|require(?:s)? (?:confirmation|approval|review)|must (?:first|not)|never|reject|deny|fixture|mock|本地|离线)/i.test(
      sentence,
    )
  }
  return false
}

/** 元描述豁免：描述门禁检测对象/风险的元描述行不产 blocking。 */
function isMetaDescription(text: string): boolean {
  return /(?:gate|门禁|finding|检测|MUST block|redline|红线|attack|渗透|fixture|waiver|scenario|WHEN a|THEN the gate|THEN the command|proposes|attempts)/i.test(
    text,
  )
}

/** 文本扫描 redline 检测器表：ruleId → 前后缀关键词模式（宽松跨距匹配 + 句级否定豁免）。 */
const TEXT_REDLINE_DETECTORS: Array<{
  ruleId: string
  code: SecurityFinding['code']
  severity: SecuritySeverity
  keywords: RegExp
  summary: (line: string) => string
}> = [
  {
    ruleId: SEC_RULE_IDS.aiAutoExecution,
    code: 'redline-ai-auto-execution',
    severity: 'blocking',
    // 拉丁词必须加词边界：否则 `error details` 里的 ai 会被当成 AI 命中（误报）
    keywords:
      /(?:\bAI\b|\bCompiler\b|模型|\bdraft\b|草案|自动)[^。;；!！?？\n]{0,40}(?:直接|自动)?[^。;；!！?？\n]{0,20}(?:落库|写入|执行|转正|\bapply\b|\bcreate\b)/i,
    summary: () => 'AI/生成输出可能绕过预览+显式确认成为正式数据',
  },
  {
    ruleId: SEC_RULE_IDS.clientAuthoritativeClaim,
    code: 'redline-client-authoritative-claim',
    severity: 'blocking',
    keywords:
      /(?:客户端|请求体|body|query|参数|header|claim)[^。;；!！?？\n]{0,40}(?:organizationId|organization_id|tenant|租户|permission|权限|allow|role)[^。;；!！?？\n]{0,30}(?:权威|authority|可信|trusted|作为|视为|当作)/i,
    summary: () => '客户端提供的组织/权限/allow 声明被当作权威',
  },
  {
    ruleId: SEC_RULE_IDS.tenantLeakage,
    code: 'redline-tenant-leakage',
    severity: 'blocking',
    keywords:
      /(?:跨租|跨组织|cross-tenant|cross-org|他租)[^。;；!！?？\n]{0,40}(?:返回|回显|泄露|泄漏|可见|读取|枚举|replay|消费)/i,
    summary: () => '跨租户数据暴露/回显路径',
  },
  {
    ruleId: SEC_RULE_IDS.secretPersistence,
    code: 'redline-secret-persistence',
    severity: 'blocking',
    keywords:
      /(?:secret|token|api[_-]?key|密码|口令|bearer|private[_-]?key)[^。;；!！?？\n]{0,40}(?:写入|落库|记录|持久化|回显|打印|log|日志|响应)/i,
    summary: () => 'secret/token 可能持久化到日志/审计/响应',
  },
  {
    ruleId: SEC_RULE_IDS.unauthorizedExternalAction,
    code: 'redline-unauthorized-external-action',
    severity: 'blocking',
    keywords:
      /(?:真实|real)[^。;；!！?？\n]{0,40}(?:OAuth|token[_-]?exchange|Webhook|Web[ -]?Push|IdP|SCIM|KMS|DLP|OCR|provider|模型|扫描|scan|npm publish|发布|写回|writeback)[^。;；!！?？\n]{0,30}(?:smoke|调用|执行|联调|发送|推送)/i,
    summary: () => '未授权真实外部动作（需 fixture/mock 边界）',
  },
  {
    ruleId: SEC_RULE_IDS.unconfirmedFormalWrite,
    code: 'redline-unconfirmed-formal-write',
    severity: 'blocking',
    keywords:
      /(?:正式|formal)[^。;；!！?？\n]{0,40}(?:数据|项目|写入|write)[^。;；!！?？\n]{0,30}(?:不经|无需|绕过|跳过)?(?:预览|diff|差异|确认|confirm|批准)/i,
    summary: () => '正式写入路径可能缺少预览/差异+显式确认',
  },
]

/** 对文本快照跑 redline 检测（低敏：summary 固定文案，evidenceRefs 只含 path:line）。 */
export function scanArtifactRedlines(snapshot: SecurityArtifactSnapshot): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  for (const { ruleId, code, severity, keywords, summary } of TEXT_REDLINE_DETECTORS) {
    for (const hit of iterateSnapshotLines(snapshot)) {
      if (isMetaDescription(hit.text)) continue
      if (!keywords.test(hit.text)) continue
      if (isSentenceNegated(hit.text, keywords)) continue
      const evidenceRefs: SecurityEvidenceRef[] = [
        { kind: 'source-fallback', path: `${hit.path}:${hit.line}` },
      ]
      const sourceHash = computeSecuritySourceHash({ ruleId, path: hit.path, line: hit.line })
      findings.push({
        findingId: makeSecurityFindingId(ruleId, `${hit.path}:${hit.line}`, sourceHash),
        ruleId,
        code,
        severity,
        status: 'blocked',
        subjectPath: `${hit.path}:${hit.line}`,
        evidenceRefs,
        sourceHash,
        summary: summary(hit.text),
      })
      break // 每条规则每个工件至多一条
    }
  }
  return findings
}

// =============================================================================
// 5. 结构化 redline 检测（3.5：catalog/attacks 层面的红线条目）
// =============================================================================

/** 检查攻击夹具是否违反低敏纪律（forbiddenFields 出现于描述或必含敏感键）。 */
export function checkAttackFixtureLowSensitive(
  scenarios: AttackScenarioFixture[],
  sensitiveKeywords: readonly string[],
): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  for (const scenario of scenarios) {
    const text = `${scenario.name} ${scenario.description} ${scenario.notes ?? ''}`
    for (const kw of sensitiveKeywords) {
      if (text.includes(kw)) {
        findings.push(
          makeSecurityFinding({
            ruleId: 'SEC-SAN-001',
            code: 'redaction-violation',
            severity: 'blocking',
            subjectPath: `scenario:${scenario.scenarioId}`,
            summary: `attack fixture 描述含敏感关键词: ${kw}`,
            evidenceRefs: [{ kind: 'fixture-id', id: scenario.scenarioId }],
          }),
        )
        break
      }
    }
  }
  return findings
}

/** 检查两组织意图夹具是否声明了 expectedOutcome（租户负极语义）。 */
export function checkTenantNegativeScenarios(
  scenarios: AttackScenarioFixture[],
): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  for (const scenario of scenarios) {
    if (!scenario.twoOrgIntent) continue
    if (
      scenario.expectedOutcome !== 'non-leaking-failure' &&
      scenario.expectedOutcome !== 'denied-before-side-effect'
    ) {
      findings.push(
        makeSecurityFinding({
          ruleId: 'SEC-TNT-001',
          code: 'catalog-invalid',
          severity: 'blocking',
          subjectPath: `scenario:${scenario.scenarioId}`,
          summary: `两组织夹具期望结局必须是 non-leaking-failure 或 denied-before-side-effect（当前: ${scenario.expectedOutcome}）`,
          evidenceRefs: [{ kind: 'fixture-id', id: scenario.scenarioId }],
        }),
      )
    }
  }
  return findings
}

/** 检查 handle replay 类夹具（preview/export/job/SSE/idempotency）的期望结局。 */
export function checkHandleReplayScenarios(scenarios: AttackScenarioFixture[]): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  for (const scenario of scenarios) {
    if (scenario.kind !== 'handle-replay') continue
    if (scenario.expectedOutcome !== 'denied-before-side-effect') {
      findings.push(
        makeSecurityFinding({
          ruleId: 'SEC-HND-001',
          code: 'catalog-invalid',
          severity: 'blocking',
          subjectPath: `scenario:${scenario.scenarioId}`,
          summary: `handle replay 夹具期望结局必须 denied-before-side-effect（当前: ${scenario.expectedOutcome}）`,
          evidenceRefs: [{ kind: 'fixture-id', id: scenario.scenarioId }],
        }),
      )
    }
  }
  return findings
}

// =============================================================================
// 6. graph freshness / source fallback 校验（3.9）
// =============================================================================

/** 校验 graph freshness 元数据：空图谱 + 无 fallback 证据 → blocking；讨论过图谱但未记录 fallback → warning。 */
export function validateGraphFreshness(input: {
  graph?: {
    freshness: 'fresh' | 'stale' | 'unknown'
    knownIncomplete?: boolean
    fallbackEvidenceRefs?: SecurityEvidenceRef[]
  }
  artifactSnapshot?: SecurityArtifactSnapshot
  evidenceRefs?: SecurityEvidenceRef[]
}): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  const graph = input.graph
  const mentionsGraph = (input.artifactSnapshot?.artifacts ?? []).some((a) =>
    /(?:codebase-memory|图谱|graph|search_graph|get_architecture)/i.test(a.content),
  )

  if (
    graph &&
    (graph.freshness === 'unknown' || graph.freshness === 'stale' || graph.knownIncomplete)
  ) {
    const hasFallback = (graph.fallbackEvidenceRefs?.length ?? 0) > 0
    if (!hasFallback) {
      findings.push(
        makeSecurityFinding({
          ruleId: SEC_RULE_IDS.graphAbsenceConclusion,
          code: 'stale-graph-absence',
          severity: 'blocking',
          subjectPath: 'observation:graph-freshness',
          summary:
            '图谱陈旧/不完整且无 direct source/OpenSpec fallback 证据（空图谱结果不得当作不存在证明）',
          evidenceRefs: input.evidenceRefs,
        }),
      )
    }
  }

  if (mentionsGraph && !graph?.fallbackEvidenceRefs?.length) {
    findings.push(
      makeSecurityFinding({
        ruleId: SEC_RULE_IDS.graphMissingFallback,
        code: 'needs-source-verification',
        severity: 'warning',
        subjectPath: 'observation:source-fallback',
        summary: '工件讨论图谱但未记录 direct source/OpenSpec fallback 证据',
        evidenceRefs: input.evidenceRefs,
      }),
    )
  }
  return findings
}

// =============================================================================
// 7. 归档证据检查（6.2：相关 change 无安全证据 → 按风险 warning/blocking）
// =============================================================================

/** 检查归档前安全证据声明：相关 change 必须记录 gate 命令或 non-applicability。 */
export function checkArchiveSecurityEvidence(input: {
  changeName: string
  claimedDomains: string[]
  archiveSecurityEvidence?: {
    gateCommand?: string
    strictValidate?: boolean
    focusedTests?: string[]
    nonApplicabilityNote?: string
  }
  evidenceRefs?: SecurityEvidenceRef[]
}): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  const ev = input.archiveSecurityEvidence
  if (!ev) {
    findings.push(
      makeSecurityFinding({
        ruleId: SEC_RULE_IDS.missingSecurityEvidence,
        code: 'missing-evidence',
        severity: 'blocking',
        subjectPath: `change:${input.changeName}`,
        summary:
          'change 触及安全 surface 但无归档安全证据声明（需 gate 命令或 non-applicability 说明）',
        evidenceRefs: input.evidenceRefs,
      }),
    )
    return findings
  }
  if (ev.nonApplicabilityNote && ev.nonApplicabilityNote.trim().length > 0) {
    return findings // non-applicability 记录即可，无需全量 gate
  }
  if (!ev.gateCommand || ev.gateCommand.trim().length === 0) {
    findings.push(
      makeSecurityFinding({
        ruleId: SEC_RULE_IDS.missingSecurityEvidence,
        code: 'missing-evidence',
        severity: 'warning',
        subjectPath: `change:${input.changeName}`,
        summary: 'change 未记录 security gate 命令（建议补齐；高风险面按风险升级为 blocking）',
        evidenceRefs: input.evidenceRefs,
      }),
    )
  }
  if (ev.strictValidate !== true) {
    findings.push(
      makeSecurityFinding({
        ruleId: SEC_RULE_IDS.missingSecurityEvidence,
        code: 'missing-evidence',
        severity: 'warning',
        subjectPath: `change:${input.changeName}`,
        summary: 'change 未记录 OpenSpec strict validate 通过',
        evidenceRefs: input.evidenceRefs,
      }),
    )
  }
  return findings
}

// =============================================================================
// 8. waiver 应用（3.7：仅 warning 可 waiver；redline 拒绝）
// =============================================================================

/** 应用 waiver：匹配的 warning finding → waived；redline/blocking 拒绝并产生 finding。 */
export function applySecurityWaivers(
  findings: SecurityFinding[],
  waivers: SecurityWaiver[],
  now: Date = new Date(),
): { findings: SecurityFinding[]; rejectedWaiverFindings: SecurityFinding[] } {
  const out: SecurityFinding[] = []
  const rejected: SecurityFinding[] = []
  for (const finding of sortSecurityFindings(findings)) {
    const waiver = waivers.find(
      (w) => w.ruleId === finding.ruleId && w.subjectPath === finding.subjectPath,
    )
    if (!waiver) {
      out.push(finding)
      continue
    }
    if (finding.code.startsWith('redline-') || finding.severity === 'blocking') {
      rejected.push(
        makeSecurityFinding({
          ruleId: 'SEC-WVR-001',
          code: 'waiver-rejected-redline',
          severity: 'blocking',
          subjectPath: finding.subjectPath,
          summary: `waiver 试图抑制 redline/blocking finding: ${finding.ruleId}（拒绝，保持 blocking）`,
          evidenceRefs: finding.evidenceRefs,
        }),
      )
      out.push(finding)
      continue
    }
    // warning finding：校验 waiver 完整性
    if (
      !waiver.owner ||
      !waiver.reason ||
      !waiver.mitigation ||
      !waiver.expiresAt ||
      waiver.evidenceRefs.length === 0 ||
      !waiver.approvalContext
    ) {
      out.push(finding)
      continue
    }
    if (new Date(waiver.expiresAt).getTime() < now.getTime()) {
      out.push(finding)
      continue
    }
    out.push({ ...finding, status: 'waived', waiverRef: waiver.waiverId })
  }
  return {
    findings: sortSecurityFindings(out),
    rejectedWaiverFindings: sortSecurityFindings(rejected),
  }
}

// =============================================================================
// 9. 总入口
// =============================================================================

/** 规则引擎总入口：组合 catalog 完整性 + 文本 redline + graph freshness + 归档证据 + waiver。 */
export function evaluateSecurityGate(
  input: SecurityGateEvaluationInput,
): SecurityGateEvaluationResult {
  const all: SecurityFinding[] = []

  all.push(...checkSecurityCatalogCompleteness(input.claimedDomains, input.catalogEntries))
  all.push(...checkAttackCoverageCompleteness(input.attackScenarios, ATTACK_KINDS_REQUIRED))
  all.push(...checkAttackFixtureLowSensitive(input.attackScenarios, LOW_SENSITIVE_SCAN_KEYWORDS))
  all.push(...checkTenantNegativeScenarios(input.attackScenarios))
  all.push(...checkHandleReplayScenarios(input.attackScenarios))

  if (input.artifactSnapshot) {
    all.push(...scanArtifactRedlines(input.artifactSnapshot))
    all.push(
      ...validateGraphFreshness({ graph: input.graph, artifactSnapshot: input.artifactSnapshot }),
    )
  }

  all.push(
    ...checkArchiveSecurityEvidence({
      changeName: input.changeName,
      claimedDomains: input.claimedDomains,
      archiveSecurityEvidence: input.archiveSecurityEvidence,
    }),
  )

  const { findings, rejectedWaiverFindings } = applySecurityWaivers(
    all,
    input.waivers ?? [],
    input.now ?? new Date(),
  )

  const blockingCount = findings.filter((f) => f.severity === 'blocking').length
  const warningCount = findings.filter((f) => f.severity === 'warning').length
  const status: Extract<SecurityGateStatus, 'blocked' | 'warned' | 'passed'> =
    blockingCount > 0 ? 'blocked' : warningCount > 0 ? 'warned' : 'passed'

  return {
    changeName: input.changeName,
    findings: [...findings, ...rejectedWaiverFindings],
    blockingCount: blockingCount + rejectedWaiverFindings.length,
    warningCount,
    status,
  }
}

/** P0 attack kinds 必须全覆盖（spec Requirement 3）。 */
export const ATTACK_KINDS_REQUIRED: readonly string[] = [
  'cross-tenant-enumeration',
  'horizontal-privilege-escalation',
  'vertical-privilege-escalation',
  'route-body-query-org-mismatch',
  'client-forged-decision',
  'handle-replay',
  'sso-replay-scope-mismatch',
  'scim-replay-scope-mismatch',
  'secret-token-leakage',
  'dlp-bypass',
  'audit-mutation',
  'path-traversal',
  'injection',
  'open-redirect',
  'oversized-input',
  'unconfirmed-formal-write',
  'unauthorized-external-action',
]

/** 低敏扫描关键词（fixture 描述自检）。 */
export const LOW_SENSITIVE_SCAN_KEYWORDS: readonly string[] = [
  'Bearer ',
  'eyJ',
  'sk-',
  'PRIVATE KEY',
  'SAMLResponse',
  'userName',
  'authorization:',
]
