import { describe, expect, it, vi, afterEach } from 'vitest'
import { apiErrorMessage, apiFetch } from '@/lib/api-client'

afterEach(() => vi.unstubAllGlobals())

describe('AI 分析错误显示', () => {
  it('提取普通 ApiError.message，未知对象使用友好回退', () => {
    expect(
      apiErrorMessage({ status: 502, code: 'AI_SERVICE_ERROR', message: '模型暂时不可用' }),
    ).toBe('模型暂时不可用')
    expect(apiErrorMessage({ unexpected: true }, '稍后重试')).toBe('稍后重试')
    expect(apiErrorMessage('[object Object]', '稍后重试')).toBe('稍后重试')
  })

  it('524 HTML 错误保留明确超时原因与恢复指引', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>524 timeout</html>', { status: 524 })),
    )
    await expect(apiFetch('/test')).rejects.toMatchObject({
      status: 524,
      code: 'GATEWAY_TIMEOUT',
      message: expect.stringContaining('网关等待超时'),
    })
    expect(apiErrorMessage({ status: 524 })).toContain('已答内容仍保留')
  })

  it('非 JSON 5xx 不显示 HTML 或空 statusText', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })),
    )
    await expect(apiFetch('/test')).rejects.toMatchObject({
      message: '服务暂时不可用（502），请稍后重试。',
    })
  })
})
