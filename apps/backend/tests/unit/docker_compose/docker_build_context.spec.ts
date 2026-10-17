/**
 * v3-docker-compose-runtime-foundation —— tasks 2.2
 * .dockerignore 静态门禁：构建上下文不丢必需文件、不带敏感/大体积本机路径。
 */
import { describe, expect, it } from 'vitest'
import { checkDockerIgnore } from './compose_static_contract.js'

describe('docker build context（task 2.2）', () => {
  it('.dockerignore 全部断言通过', () => {
    const checks = checkDockerIgnore()
    const failed = checks.filter((c) => !c.ok)
    expect(
      failed.map((c) => `${c.id}: ${c.detail}`),
      `${checks.filter((c) => c.ok).length}/${checks.length} 通过`,
    ).toEqual([])
  })
})
