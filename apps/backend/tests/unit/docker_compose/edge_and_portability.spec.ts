/**
 * v3-docker-compose-runtime-foundation —— tasks 5.3/5.4
 * edge 配置与跨主机可移植性静态门禁。
 */
import { describe, expect, it } from 'vitest'
import { checkEdgeConfig, checkPortability } from './compose_static_contract.js'

describe('edge 配置（task 5.3）', () => {
  it('UI/REST/WS 转发、超时/body size、内部 DNS 不外泄、非特权 全部通过', () => {
    const checks = checkEdgeConfig()
    const failed = checks.filter((c) => !c.ok)
    expect(
      failed.map((c) => `${c.id}: ${c.detail}`),
      `${checks.filter((c) => c.ok).length}/${checks.length} 通过`,
    ).toEqual([])
  })
})

describe('跨主机可移植性（task 5.4）', () => {
  it('部署文件无构建机 IP/localhost backend 绝对 URL/烘焙域名 全部通过', () => {
    const checks = checkPortability()
    const failed = checks.filter((c) => !c.ok)
    expect(
      failed.map((c) => `${c.id}: ${c.detail}`),
      `${checks.filter((c) => c.ok).length}/${checks.length} 通过`,
    ).toEqual([])
  })
})
