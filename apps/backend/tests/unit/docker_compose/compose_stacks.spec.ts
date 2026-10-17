/**
 * v3-docker-compose-runtime-foundation —— tasks 6.6/7.4/7.5
 * 默认 PG 栈、SQLite 栈与两栈 parity 静态门禁。
 */
import { describe, expect, it } from 'vitest'
import {
  checkComposeParity,
  checkDefaultCompose,
  checkSqliteCompose,
} from './compose_static_contract.js'

describe('默认 PostgreSQL 栈（task 6.6）', () => {
  it('七服务 DAG、healthcheck、secret files、持久化、restart、单端口 全部通过', () => {
    const checks = checkDefaultCompose()
    const failed = checks.filter((c) => !c.ok)
    expect(
      failed.map((c) => `${c.id}: ${c.detail}`),
      `${checks.filter((c) => c.ok).length}/${checks.length} 通过`,
    ).toEqual([])
  })
})

describe('SQLite 栈（task 7.4）', () => {
  it('零 PG、sqlite volume、init/migrate 闸门、backend 环境 全部通过', () => {
    const checks = checkSqliteCompose()
    const failed = checks.filter((c) => !c.ok)
    expect(
      failed.map((c) => `${c.id}: ${c.detail}`),
      `${checks.filter((c) => c.ok).length}/${checks.length} 通过`,
    ).toEqual([])
  })
})

describe('两栈 parity（task 7.5）', () => {
  it('共同不变量（镜像/edge/非 root/secrets ro/healthcheck/DB volume 分离/无 secret 字面值）全部通过', () => {
    const checks = checkComposeParity()
    const failed = checks.filter((c) => !c.ok)
    expect(
      failed.map((c) => `${c.id}: ${c.detail}`),
      `${checks.filter((c) => c.ok).length}/${checks.length} 通过`,
    ).toEqual([])
  })
})
