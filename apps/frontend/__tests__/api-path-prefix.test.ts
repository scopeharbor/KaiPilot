import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

/**
 * API 路径前缀审计（fix-v1-runtime-bugs tasks 2.5）。
 *
 * `API_BASE_URL` 已含 `/api/v1`；若客户端路径再自带 `/api/v1/…`，实际请求会打到
 * `/api/v1/api/v1/…` → 404（曾致评论/变更请求/风险/图表「载入失败」）。此测试锁定
 * `lib/api/` 下不再出现 `apiFetch*` 调用位置的 `/api/v1/` 前缀，防止回归。
 */

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'api')

function isCommentLine(line: string): boolean {
  const t = line.trim()
  return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')
}

test('lib/api 下无任何请求路径自带 /api/v1 前缀', () => {
  const offenders: string[] = []
  for (const file of readdirSync(apiDir)) {
    if (!file.endsWith('.ts')) continue
    const lines = readFileSync(join(apiDir, file), 'utf8').split('\n')
    lines.forEach((line, index) => {
      if (isCommentLine(line)) return
      if (line.includes('`/api/v1/')) {
        offenders.push(`${file}:${index + 1} ${line.trim()}`)
      }
    })
  }
  expect(offenders, `发现自带 /api/v1 前缀的请求路径:\n${offenders.join('\n')}`).toEqual([])
})
