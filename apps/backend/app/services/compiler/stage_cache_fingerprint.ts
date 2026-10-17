/**
 * v2-5-compiler-stage-cache-wiring —— deterministic Stage 缓存指纹（design D3, task 1.1）。
 *
 * 生产接线需要比 `stageCacheKey(stageId, input)` 更丰富的失效维度：把 stage 身份、
 * contract/manifest schema 版本、cache policy 版本、handler/definition 版本、输入哈希、
 * context scope 摘要与相关 artifact refs 哈希折叠进一个结构化指纹，再由指纹导出缓存键。
 * 任一版本字段变化都会产生新键（构造性失效），无需手工清缓存。
 *
 * 低敏红线（design D4）：缓存键只含 stageId 与哈希，绝不出现 raw prompt、raw context、
 * raw model output、token、secret 或完整 artifact payload。
 */
import type { StageDefinition, StageType } from '@aiproj/compiler-spec'
import { computeContentHash } from './artifact_store.js'

/**
 * 缓存策略版本。指纹结构、键格式或失效语义变化时必须提升，
 * 使旧键自然失效（miss 重算），无需外部清缓存动作。
 */
export const STAGE_CACHE_POLICY_VERSION = '1'

/**
 * 默认 handler/definition 版本。`StageDefinition` 当前无版本字段；
 * deterministic handler 行为分叉时应由注册方显式提供版本（design Open Questions）。
 */
export const DEFAULT_STAGE_HANDLER_VERSION = '1'

/**
 * deterministic Stage 缓存指纹（design D3）。
 * 全部字段都是 id、版本号或哈希——可直接参与键计算而不泄漏敏感内容。
 */
export interface StageCacheFingerprint {
  stageId: string
  stageType: StageType
  /** manifest schemaVersion（orchestrator.validateManifest 同款取法，缺省 '2.0'）。 */
  contractVersion: string
  cachePolicyVersion: string
  handlerVersion: string
  /** 输入内容哈希（Map 感知序列化后的 SHA-256），不含原始输入。 */
  inputHash: string
  /** contextScope 排序拼接摘要（只含 scope 名，不含上下文内容）。 */
  contextScopeSummary: string
  /** 相关输入 artifact refs 的哈希（只 hash ref 字符串，不含 artifact payload）。 */
  artifactRefsHash?: string
}

/**
 * Map 感知的稳定序列化。`CompilerContext.stageOutputs` 是 Map，
 * 直接 JSON.stringify 会丢失为 `{}`，导致上游输出变化不产生新键。
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (v instanceof Map ? Object.fromEntries(v) : v))
}

/** 指纹字段哈希：复用 artifact_store 的 SHA-256 内容哈希。 */
function hashFingerprintPart(value: unknown): string {
  return computeContentHash(stableStringify(value))
}

/**
 * 构造 deterministic Stage 缓存指纹。
 *
 * @param definition Stage 定义（提供 stageId/type/contextScope）。
 * @param contractVersion manifest schemaVersion。
 * @param input 参与哈希的执行输入（由调用方组装；只存哈希，不存原文）。
 * @param handlerVersion handler/definition 版本，缺省 `DEFAULT_STAGE_HANDLER_VERSION`。
 * @param artifactRefs 相关输入 artifact ref 字符串（只哈希，不存 payload）。
 */
export function buildStageCacheFingerprint(params: {
  definition: StageDefinition
  contractVersion: string
  input: unknown
  handlerVersion?: string
  artifactRefs?: string[]
}): StageCacheFingerprint {
  const { definition, contractVersion, input } = params
  const fingerprint: StageCacheFingerprint = {
    stageId: definition.stageId,
    stageType: definition.type,
    contractVersion,
    cachePolicyVersion: STAGE_CACHE_POLICY_VERSION,
    handlerVersion: params.handlerVersion ?? DEFAULT_STAGE_HANDLER_VERSION,
    inputHash: hashFingerprintPart(input),
    contextScopeSummary: [...definition.contextScope].sort().join(','),
  }
  if (params.artifactRefs && params.artifactRefs.length > 0) {
    fingerprint.artifactRefsHash = hashFingerprintPart([...params.artifactRefs].sort())
  }
  return fingerprint
}

/**
 * 由指纹导出缓存键：`stage:<stageId>:<指纹哈希>`。
 * 键只含 stageId 与哈希；版本、输入、artifact refs 全部折叠进哈希。
 */
export function stageCacheKeyFromFingerprint(fingerprint: StageCacheFingerprint): string {
  return `stage:${fingerprint.stageId}:${hashFingerprintPart(fingerprint)}`
}
