/**
 * v3-docker-compose-runtime-foundation —— task 8.1
 *
 * `pnpm check:docker-compose`：Compose/Dockerfile/edge/.dockerignore/文档一致性
 * 静态门禁 CLI。不依赖 Docker CLI/daemon，协作主机与 CI 均可执行。
 *
 * 断言库与 vitest spec 共用 `apps/backend/tests/unit/docker_compose/compose_static_contract.ts`
 * （单一事实来源）。输出低敏 JSON：逐检查 id/状态/说明；任何失败 → exit 1。
 *
 * 目标机 runtime smoke 不在此脚本内：见 `pnpm gate:docker-runtime`
 * （scripts/docker-runtime-gate.ts，缺 Docker 返回 blocked 而非通过）。
 */

import {
  runAllStaticChecks,
  summarizeStatic,
} from '../apps/backend/tests/unit/docker_compose/compose_static_contract.js'

function main(): number {
  const sections = runAllStaticChecks()
  const summary = summarizeStatic(sections)
  const report = {
    gate: 'docker-compose-static',
    generatedAt: new Date().toISOString(),
    sections: sections.map((s) => ({
      section: s.section,
      total: s.checks.length,
      failed: s.checks.filter((c) => !c.ok).length,
      checks: s.checks.map((c) => ({ id: c.id, ok: c.ok, detail: c.detail })),
    })),
    summary,
  }
  console.log(JSON.stringify(report, null, 2))
  if (summary.failed > 0) {
    console.error(`check:docker-compose FAILED：${summary.failed}/${summary.total} 项未通过`)
    return 1
  }
  console.log(`check:docker-compose PASS：${summary.total}/${summary.total} 项通过`)
  return 0
}

process.exit(main())
