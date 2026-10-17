/**
 * v3-docker-compose-runtime-foundation —— tasks 3.5/4.4
 * backend/frontend 镜像静态契约（非 root、loader、init 幂等不泄密、探针命令）。
 */
import { describe, expect, it } from 'vitest'
import { checkBackendDockerfile, checkFrontendDockerfile } from './compose_static_contract.js'

describe('backend 镜像静态契约（task 3.5）', () => {
  it('多阶段/frozen install/非 root/tsx loader/init-config 幂等不泄密/探针 全部通过', () => {
    const checks = checkBackendDockerfile()
    const failed = checks.filter((c) => !c.ok)
    expect(
      failed.map((c) => `${c.id}: ${c.detail}`),
      `${checks.filter((c) => c.ok).length}/${checks.length} 通过`,
    ).toEqual([])
  })
})

describe('frontend 镜像静态契约（task 4.4）', () => {
  it('standalone/相对 API URL/非 root/HOSTNAME/Node 探针 全部通过', () => {
    const checks = checkFrontendDockerfile()
    const failed = checks.filter((c) => !c.ok)
    expect(
      failed.map((c) => `${c.id}: ${c.detail}`),
      `${checks.filter((c) => c.ok).length}/${checks.length} 通过`,
    ).toEqual([])
  })
})
