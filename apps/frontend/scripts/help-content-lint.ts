/**
 * 帮助中心内容 lint CLI（v3-help-and-operational-issues-center 1.1/1.4）。
 *
 * 用法（仓库根）：
 *   pnpm help:lint
 *
 * 退出码：1 = 存在 error 级问题（broken-link / stale / frontmatter 等），CI 门禁。
 * 内容校验逻辑在 `lib/help/lint.ts`（纯函数，vitest 直接复用）。
 */
import { resolveHelpContentDir } from '../lib/help/load'
import { lintContent, summarizeIssues } from '../lib/help/lint'

interface CliOptions {
  contentDir?: string
  today?: string
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--content-dir' && argv[i + 1]) {
      opts.contentDir = argv[i + 1]
      i++
    } else if (arg === '--today' && argv[i + 1]) {
      opts.today = argv[i + 1]
      i++
    }
  }
  return opts
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const contentDir = opts.contentDir ?? resolveHelpContentDir(process.cwd())
  const issues = lintContent(contentDir, { today: opts.today })

  for (const issue of issues) {
    const tag = issue.severity === 'error' ? 'ERROR' : 'WARN'
    const where = issue.articleId ? ` [${issue.articleId}]` : issue.path ? ` [${issue.path}]` : ''
    console.log(`[${tag}] ${issue.code}${where}: ${issue.message}`)
  }

  const { errors, warnings } = summarizeIssues(issues)
  console.log(
    `\n帮助内容 lint 完成：${errors} error(s)，${warnings} warning(s)（contentDir=${contentDir}）`,
  )
  if (errors > 0) {
    process.exitCode = 1
  }
}

main()
