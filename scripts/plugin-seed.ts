/**
 * v3-plugin-fixture-market-seed —— 本机示例插件库 CLI（status / dry-run）。
 *
 * 边界：零数据库、零网络、零写入；只做 catalog 校验与守卫评估。
 * 真正的 seed/reset 落库在 backend service 层经既有私有 registry/install lifecycle 执行。
 * 所有逻辑（解析/守卫/校验/报告/退出码语义）都在 @aiproj/types/plugin-fixture-market-seed，
 * 本文件只是 IO 薄壳：读 fixture 文件、算 sha256、渲染输出。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  fixtureSeedStatusToExitCode,
  parseFixtureSeedCliArgs,
  renderFixtureSeedReportText,
  runFixtureSeedStatusOrDryRun,
  type FixtureSeedFileSource,
} from '@aiproj/types/plugin-fixture-market-seed'
import { FIXTURE_SEED_CATALOG_V1 } from '@aiproj/types/plugin-fixture-market-seed-fixtures'

/** 仓库根（scripts/ 的上一级），fixtureRoot 均为仓库相对路径。 */
const repoRoot = resolve(import.meta.dirname, '..')

function sha256Digest(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`
}

/** 只允许读取 fixtures/plugins 下的声明文件；缺失返回 null 由 checker 报告。 */
function makeRepoFileSource(): FixtureSeedFileSource {
  return {
    readFile(_fixtureRoot, relPath) {
      if (!relPath.startsWith('fixtures/plugins/')) return null
      try {
        return readFileSync(resolve(repoRoot, relPath), 'utf8')
      } catch {
        return null
      }
    },
    hashContent: sha256Digest,
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const parsed = parseFixtureSeedCliArgs(argv)
  if (!parsed.ok) {
    console.error(`本机示例插件库 CLI 参数错误：${parsed.message}`)
    process.exit(parsed.exitCode)
  }

  // 环境：显式参数 > NODE_ENV；启用标记：--enable 或 PLUGIN_FIXTURE_SEED_ENABLED=1
  const environment = parsed.invocation.environment ?? process.env.NODE_ENV
  const enable = parsed.invocation.enable || process.env.PLUGIN_FIXTURE_SEED_ENABLED === '1'

  const report = runFixtureSeedStatusOrDryRun({
    invocation: { ...parsed.invocation, environment, enable },
    catalog: FIXTURE_SEED_CATALOG_V1,
    fileSource: parsed.invocation.command === 'dry-run' ? makeRepoFileSource() : undefined,
  })

  if (parsed.invocation.format === 'json') {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(renderFixtureSeedReportText(report))
  }
  process.exit(fixtureSeedStatusToExitCode(report.status))
}

void main()
