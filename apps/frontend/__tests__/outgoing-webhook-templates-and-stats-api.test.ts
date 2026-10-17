/**
 * v2-5-webhook-templates-and-stats -- 模板与统计 API 客户端测试（5.2 P1）。
 *
 * 验证：
 * - API 路径正确性
 * - 请求方法正确性
 * - 参数传递正确性
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  outgoingWebhookTemplatesApi,
  outgoingWebhookStatsApi,
  outgoingWebhookTemplateKeys,
  outgoingWebhookStatsKeys,
} from '@/lib/api/outgoing-webhook-templates-and-stats'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch as any

describe('outgoing-webhook-templates-and-stats API', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  // ===== 5.2 P1: API 路径 =====

  it('list 请求 /outgoing-webhook-templates', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
    await outgoingWebhookTemplatesApi.list()
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/outgoing-webhook-templates'),
      expect.any(Object),
    )
  })

  it('show 请求 /outgoing-webhook-templates/:id', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) })
    await outgoingWebhookTemplatesApi.show('task-status-changed')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/outgoing-webhook-templates/task-status-changed'),
      expect.any(Object),
    )
  })

  it('prefill 请求 /outgoing-webhook-templates/:id/prefill', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) })
    await outgoingWebhookTemplatesApi.prefill('task-status-changed')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/outgoing-webhook-templates/task-status-changed/prefill'),
      expect.any(Object),
    )
  })

  it('apply 使用 POST 方法', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) })
    await outgoingWebhookTemplatesApi.apply({
      templateId: 'task-status-changed',
      name: 'test',
      targetUrl: 'https://example.com/webhook',
    })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/outgoing-webhook-templates/apply'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('stats 请求 /outgoing-webhook-stats', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) })
    await outgoingWebhookStatsApi.index()
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/outgoing-webhook-stats'),
      expect.any(Object),
    )
  })
})

describe('outgoing-webhook-templates-and-stats query keys', () => {
  it('list key 正确', () => {
    expect(outgoingWebhookTemplateKeys.list()).toEqual(['outgoing-webhook-templates', 'list'])
  })

  it('detail key 正确', () => {
    expect(outgoingWebhookTemplateKeys.detail('test')).toEqual([
      'outgoing-webhook-templates',
      'detail',
      'test',
    ])
  })

  it('prefill key 正确', () => {
    expect(outgoingWebhookTemplateKeys.prefill('test')).toEqual([
      'outgoing-webhook-templates',
      'prefill',
      'test',
    ])
  })

  it('stats key 正确', () => {
    expect(outgoingWebhookStatsKeys.index()).toEqual(['outgoing-webhook-stats', 'index', undefined])
  })
})
