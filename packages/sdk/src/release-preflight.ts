// v2-5-sdk-npm-release-workflow §3 —— Release preflight 模块。
// 检查构建产物存在性、npm pack 输出白名单、禁止模式匹配、包大小预算。
// 用于 `scripts/release-preflight.ts` CLI 和单元测试。

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// --- 常量 ---

const SDK_PKG_DIR = resolve(__dirname, '..')
const BUILD_DIR = resolve(SDK_PKG_DIR, 'dist')

/** 允许包含在 npm pack 中的文件/目录前缀（相对于包根目录）。 */
const ALLOWLIST: string[] = ['dist/', 'README.md', 'LICENSE', 'package.json']

/** 禁止包含在 npm pack 中的文件路径模式。 */
const FORBIDDEN_PATTERNS: RegExp[] = [
  /\.env/, // 环境变量
  /\.env\./, // 环境变量变体
  /\.log$/i, // 日志文件
  /node_modules/, // 依赖
  /tsconfig\.json$/, // 构建配置
  /vitest\.config\./, // 测试配置
  /\.test\.(ts|js|tsx|jsx)$/, // 测试文件
  /\.spec\.(ts|js|tsx|jsx)$/, // 测试文件
  /\.fixture\.(ts|js)$/, // 夹具文件
  /src\//, // TypeScript 源码
  /obs-observe-/, // Observation 产物
  /docs\//, // 项目文档/规划
  /openspec\//, // OpenSpec 规划
  /progress\//, // 进度文档
  /\.claude\//, // Claude 配置
  /\.git\//, // Git 元数据
  /\.gitignore$/, // Git ignore
  /\.npmrc$/, // npm 配置
  /\.tmp-/, // 临时文件
  /pnpm-lock\.yaml$/, // lock 文件
  /NPM_TOKEN/i, // token 内容
  /NODE_AUTH_TOKEN/i, // 认证 token
  /-----BEGIN.*PRIVATE KEY-----/, // 私钥
]

/** 最大 tarball 大小（字节）。100KB 对 SDK 初始包来说足够宽松。 */
export const MAX_TARBALL_SIZE = 100 * 1024

/** 最大包内文件数量。 */
export const MAX_FILE_COUNT = 50

// --- 类型 ---

export interface PackEntry {
  path: string
  size: number
}

export interface PackResult {
  name: string
  version: string
  filename: string
  files: PackEntry[]
  entryCount: number
  size: number
  unpackedSize?: number
}

export interface GateResult {
  name: string
  passed: boolean
  message: string
}

export interface PreflightResult {
  passed: boolean
  gates: GateResult[]
}

// --- 门禁函数 ---

export function checkBuildArtifacts(buildDir = BUILD_DIR, pkgDir = SDK_PKG_DIR): GateResult {
  if (!existsSync(buildDir)) {
    return { name: '构建产物', passed: false, message: `构建产物目录不存在: ${buildDir}` }
  }
  const indexJs = resolve(buildDir, 'index.js')
  const indexDts = resolve(buildDir, 'index.d.ts')
  if (!existsSync(indexJs)) {
    return {
      name: '构建产物',
      passed: false,
      message: `构建产物缺失: ${indexJs}。请先运行 pnpm --filter @aiproj/sdk build`,
    }
  }
  if (!existsSync(indexDts)) {
    return { name: '构建产物', passed: false, message: `类型声明缺失: ${indexDts}` }
  }
  if (!existsSync(resolve(pkgDir, 'LICENSE'))) {
    return { name: '构建产物', passed: false, message: `LICENSE 文件缺失` }
  }
  return {
    name: '构建产物',
    passed: true,
    message: `构建产物存在: dist/index.js, dist/index.d.ts, LICENSE`,
  }
}

export function checkAllowlist(files: PackEntry[]): GateResult {
  const violations = files.filter(
    (f) => !ALLOWLIST.some((allowed) => f.path === allowed || f.path.startsWith(allowed)),
  )
  if (violations.length === 0) {
    return { name: '文件白名单', passed: true, message: `所有 ${files.length} 个文件均在白名单内` }
  }
  return {
    name: '文件白名单',
    passed: false,
    message: `${violations.length} 个文件不在白名单内: ${violations.map((v) => v.path).join(', ')}`,
  }
}

export function checkForbiddenPatterns(files: PackEntry[]): GateResult {
  const violations = files.filter((f) => FORBIDDEN_PATTERNS.some((p) => p.test(f.path)))
  if (violations.length === 0) {
    return { name: '禁止模式', passed: true, message: '未发现禁止文件' }
  }
  return {
    name: '禁止模式',
    passed: false,
    message: `发现 ${violations.length} 个禁止文件: ${violations.map((v) => v.path).join(', ')}`,
  }
}

export function checkFileCount(files: PackEntry[]): GateResult {
  if (files.length <= MAX_FILE_COUNT) {
    return {
      name: '文件数量',
      passed: true,
      message: `${files.length} 个文件 ≤ ${MAX_FILE_COUNT} 上限`,
    }
  }
  return {
    name: '文件数量',
    passed: false,
    message: `${files.length} 个文件 > ${MAX_FILE_COUNT} 上限`,
  }
}

export function checkPackageSize(result: PackResult): GateResult {
  const size = result.unpackedSize ?? result.size
  if (size <= MAX_TARBALL_SIZE) {
    return {
      name: '包大小',
      passed: true,
      message: `${formatSize(size)} ≤ ${formatSize(MAX_TARBALL_SIZE)} 上限`,
    }
  }
  return {
    name: '包大小',
    passed: false,
    message: `${formatSize(size)} > ${formatSize(MAX_TARBALL_SIZE)} 上限`,
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// --- 组合 ---

export async function runPreflight(
  files?: PackEntry[],
  buildDir?: string,
  pkgDir?: string,
): Promise<PreflightResult> {
  const gates: GateResult[] = []

  // 门禁 1: 构建产物
  gates.push(checkBuildArtifacts(buildDir, pkgDir))

  if (files && files.length > 0) {
    // 门禁 2: 文件白名单
    gates.push(checkAllowlist(files))
    // 门禁 3: 禁止模式
    gates.push(checkForbiddenPatterns(files))
    // 门禁 4: 文件数量
    gates.push(checkFileCount(files))
    // 门禁 5: 包大小（用文件列表估算）
    const totalSize = files.reduce((sum, f) => sum + f.size, 0)
    const packResult: PackResult = {
      name: '@aiproj/sdk',
      version: '0.1.0',
      filename: 'aiproj-sdk-0.1.0.tgz',
      files,
      entryCount: files.length,
      size: totalSize,
      unpackedSize: totalSize,
    }
    gates.push(checkPackageSize(packResult))
  } else {
    gates.push(
      { name: '文件白名单', passed: false, message: '跳过：无 pack 文件数据' },
      { name: '禁止模式', passed: false, message: '跳过：无 pack 文件数据' },
      { name: '文件数量', passed: false, message: '跳过：无 pack 文件数据' },
      { name: '包大小', passed: false, message: '跳过：无 pack 文件数据' },
    )
  }

  const allPassed = gates.every((g) => g.passed)
  return { passed: allPassed, gates }
}
