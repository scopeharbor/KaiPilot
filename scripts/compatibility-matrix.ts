#!/usr/bin/env tsx
/**
 * compatibility-matrix CI 入口（§5.4 P1）。
 *
 * 从 @aiproj/types 导入兼容矩阵 runner，执行并输出结果。
 * 非零 exit code = 失败。
 *
 * 用法：tsx scripts/compatibility-matrix.ts
 * 通过 pnpm 门禁：pnpm compatibility-matrix
 *
 * 无 Docker、无外部服务、可离线重复。
 */
import { runCompatibilityMatrix } from '@aiproj/types'

function main(): void {
  const result = runCompatibilityMatrix()

  console.log('='.repeat(60))
  console.log(' Contract Compatibility Matrix')
  console.log('='.repeat(60))
  console.log()

  for (const entry of result.entries) {
    const status = entry.passed ? '✅' : '❌'
    console.log(` ${status} [${entry.contractId}] ${entry.fixtureKind}`)
    if (entry.error) {
      console.log(`    ${entry.error}`)
    }
  }

  console.log()
  if (result.driftWarnings.length > 0) {
    console.log('Drift warnings:')
    for (const w of result.driftWarnings) {
      console.log(`  ⚠️  ${w}`)
    }
    console.log()
  }

  console.log('-'.repeat(60))
  console.log(` Summary: ${result.summary}`)
  console.log('-'.repeat(60))

  if (!result.passed) {
    console.error('\n❌ Compatibility matrix FAILED')
    process.exit(1)
  }

  console.log('\n✅ Compatibility matrix PASSED')
}

main()
