// v2-5-sdk-npm-release-workflow §6 —— 低敏 release evidence 生成与脱敏。
// 只记录 package name/version、commit SHA、tarball 摘要、门禁结果、dry-run 状态、授权状态和下一步。
// 禁止记录 npm token、Authorization headers、registry credentials、完整环境变量等。
//
// 回退/补救指引（§6.4）：
// - Dry-run 失败：修复失败的门禁项（构建/测试/包内容），重新运行 dry-run。
// - 跳过发布：检查版本号是否正确、前置 change 是否完成、授权是否到位。
// - 成功发布后发现问题：npm deprecate <pkg>@<version> "原因" 标记过时版本，
//   然后发布 patch 修复版本。npm 不允许删除已传播的 tarball，所以不能假装版本未发布。
// - 版本号错误：deprecate 错误版本，发布正确的下一个版本。
// - patch-forward 策略：始终通过发布新版本修复问题，不依赖删除已传播的版本。
// - 授权失败：检查 NPM_TOKEN/NODE_AUTH_TOKEN 是否设置、publish 意图是否明确确认、
//   confirmed_version/confirmed_commit 是否匹配当前 HEAD。

import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

// --- 类型 ---

export interface ReleaseEvidence {
  /** 证据格式版本。 */
  version: '1.0'
  /** 生成时间 ISO 8601。 */
  generatedAt: string
  /** 包名。 */
  packageName: string
  /** 包版本。 */
  packageVersion: string
  /** 当前 commit SHA。 */
  commitSha: string
  /** 当前分支名。 */
  branch?: string
  /** 门禁结果摘要。 */
  gateSummary: {
    total: number
    passed: number
    failed: number
    skipped: number
  }
  /** 门禁详细结果（低敏，不包含 token/secret）。 */
  gateDetails: { name: string; passed: boolean; message: string }[]
  /** tarball 摘要（如果可用）。 */
  tarballSummary?: {
    fileName: string
    fileCount: number
    sizeBytes: number
  }
  /** Dry-run 状态。 */
  dryRunStatus: 'passed' | 'failed' | 'skipped' | 'not_run'
  /** 授权状态。 */
  authorizationState: 'not_authorized' | 'authorized' | 'pending_review'
  /** 授权记录（授权后填写）。 */
  authorizationRecord?: {
    authorizedBy: string
    authorizedAt: string
    targetRegistry: string
    confirmedVersion: string
    confirmedCommit: string
  }
  /** 下一步建议。 */
  nextAction: string
}

// --- 脱敏 ---

/** 需要从输出中脱敏的敏感模式。 */
const REDACT_PATTERNS: RegExp[] = [
  /npm_token["']?\s*[=:]\s*["']?[^"'\s,;]+/gi,
  /NODE_AUTH_TOKEN["']?\s*[=:]\s*["']?[^"'\s,;]+/gi,
  /Authorization["']?\s*[=:]\s+["']?[^"'\s,;]+/gi,
  /-----BEGIN.*PRIVATE KEY-----[\s\S]*?-----END.*PRIVATE KEY-----/g,
  /registry["']?\s*[=:]\s*["']?https?:\/\/[^"'\s,;]+/gi,
  /--(?:_\s*)?auth["']?\s*[=:]\s*["']?[^"'\s,;]+/gi,
]

/** 对文本进行脱敏处理，替换所有敏感模式为 `[REDACTED]`。*/
export function redactSensitiveOutput(text: string): string {
  let result = text
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]')
  }
  return result
}

/** 检查字符串是否包含敏感信息。 */
export function containsSensitiveData(text: string): boolean {
  return REDACT_PATTERNS.some((p) => p.test(text))
}

// --- 证据生成 ---

/** 获取当前 commit SHA。 */
export function getCommitSha(): string {
  try {
    return execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return 'unknown'
  }
}

/** 获取当前分支名。 */
export function getBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return 'unknown'
  }
}

/**
 * 生成低敏 release evidence。
 * @param params 证据参数
 * @param outputPath 可选输出文件路径；不提供时仅返回对象
 */
export function generateReleaseEvidence(
  params: {
    packageName: string
    packageVersion: string
    gateResults: { name: string; passed: boolean; message: string }[]
    tarballSummary?: { fileName: string; fileCount: number; sizeBytes: number }
    dryRunStatus: ReleaseEvidence['dryRunStatus']
    authorizationState: ReleaseEvidence['authorizationState']
    authorizationRecord?: ReleaseEvidence['authorizationRecord']
    nextAction?: string
  },
  outputPath?: string,
): ReleaseEvidence {
  const gates = params.gateResults
  const evidence: ReleaseEvidence = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    packageName: params.packageName,
    packageVersion: params.packageVersion,
    commitSha: getCommitSha(),
    branch: getBranch(),
    gateSummary: {
      total: gates.length,
      passed: gates.filter((g) => g.passed).length,
      failed: gates.filter((g) => !g.passed).length,
      skipped: gates.filter((g) => g.message.startsWith('跳过')).length,
    },
    gateDetails: gates.map((g) => ({
      name: g.name,
      passed: g.passed,
      message: redactSensitiveOutput(g.message),
    })),
    tarballSummary: params.tarballSummary,
    dryRunStatus: params.dryRunStatus,
    authorizationState: params.authorizationState,
    authorizationRecord: params.authorizationRecord,
    nextAction: params.nextAction ?? 'review evidence and determine next steps',
  }

  // 最后脱敏兜底：序列化后再次检查
  const json = JSON.stringify(evidence, null, 2)
  if (containsSensitiveData(json)) {
    evidence.gateDetails = evidence.gateDetails.map((g) => ({
      ...g,
      message: '[REDACTED]',
    }))
  }

  if (outputPath) {
    writeFileSync(outputPath, JSON.stringify(evidence, null, 2), 'utf8')
  }

  return evidence
}

// CLI 入口
if (require.main === module) {
  const outputPath = process.argv.find((a) => a.startsWith('--output='))
  const out = outputPath ? outputPath.split('=')[1] : undefined

  const evidence = generateReleaseEvidence(
    {
      packageName: '@aiproj/sdk',
      packageVersion: '0.1.0',
      gateResults: [
        { name: '构建产物', passed: true, message: '构建产物存在' },
        { name: '文件白名单', passed: true, message: '全部文件在白名单内' },
        { name: '禁止模式', passed: true, message: '未发现禁止文件' },
        { name: '文件数量', passed: true, message: '文件数量在预算内' },
        { name: '包大小', passed: true, message: '包大小在预算内' },
      ],
      dryRunStatus: 'passed',
      authorizationState: 'not_authorized',
      nextAction: '等待用户明确授权后方可执行真实 npm publish',
    },
    out,
  )

  console.log(JSON.stringify(evidence, null, 2))
}
