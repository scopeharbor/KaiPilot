import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchProjectHealthRiskCommandCenter,
  serializeCommandCenterQuery,
  commandCenterKeys,
  classifyCommandCenterError,
} from '@/lib/api/project-health-risk-command-center'

const apiFetchEnvelope = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({ apiFetchEnvelope }))

beforeEach(() => {
  apiFetchEnvelope.mockReset()
  apiFetchEnvelope.mockResolvedValue({
    data: {
      project: { id: 101, organizationId: 1 },
      headline: { sourceKey: 'project-dashboard', healthStatus: 'yellow', degraded: true },
      sources: [],
      attention: [],
    },
    meta: {
      contractVersion: 'project-health-risk-command-center/v1',
      attentionRuleVersion: 'command-center-attention-rules.v1',
      calculatedAt: '2026-09-01T08:00:00.000Z',
      projectionSignature: 'abcd1234',
      overallAvailability: 'available',
      sourceCounts: {},
      attentionTruncation: { requestedLimit: 20, returned: 0, omitted: 0, truncated: false },
      perSourceTimingMs: {},
    },
  })
})

describe('指挥中心 API client（§5.1/5.2）', () => {
  it('请求路径为项目级只读端点，默认无查询串', async () => {
    await fetchProjectHealthRiskCommandCenter(101)
    expect(apiFetchEnvelope).toHaveBeenCalledWith('/projects/101/health-risk-command-center')
  })

  it('返回统一 envelope：data + meta（contractVersion/projectionSignature）', async () => {
    const result = await fetchProjectHealthRiskCommandCenter(101)
    expect(result.data.project.id).toBe(101)
    expect(result.meta.contractVersion).toBe('project-health-risk-command-center/v1')
    expect(result.meta.projectionSignature).toMatch(/^[0-9a-f]{8}$/)
  })

  it('查询序列化只含白名单键，include 数组逗号分隔', async () => {
    await fetchProjectHealthRiskCommandCenter(101, {
      attentionLimit: 50,
      include: ['risk-workbench', 'prediction'],
      freshnessWindowDays: 14,
    })
    const path = String(apiFetchEnvelope.mock.calls[0]?.[0])
    expect(path.startsWith('/projects/101/health-risk-command-center?')).toBe(true)
    const params = new URLSearchParams(path.split('?')[1])
    expect(params.get('attentionLimit')).toBe('50')
    expect(params.get('include')).toBe('risk-workbench,prediction')
    expect(params.get('freshnessWindowDays')).toBe('14')
  })

  it('serialize 对空 query 输出空串', () => {
    expect(serializeCommandCenterQuery(undefined)).toBe('')
    expect(serializeCommandCenterQuery({})).toBe('')
  })

  it('query key 随有效组织 / 项目 / 规范化 query 变化——scope 切换不复用缓存', () => {
    expect(commandCenterKeys.summary(1, 101)).not.toEqual(commandCenterKeys.summary(2, 101))
    expect(commandCenterKeys.summary(1, 101)).not.toEqual(commandCenterKeys.summary(1, 202))
    expect(commandCenterKeys.summary(1, 101, { attentionLimit: 50 })).not.toEqual(
      commandCenterKeys.summary(1, 101),
    )
    // 相同输入恒同 key（稳定重复）
    expect(commandCenterKeys.summary(1, 101)).toEqual(commandCenterKeys.summary(1, 101))
    // 缺失 scope 显式标记，不会与真实 scope 混淆
    expect(commandCenterKeys.summary(null, null)).toContain('none')
  })

  it('错误分类：401/403/404/422/network/server 各归其类且不泄露细节', () => {
    expect(classifyCommandCenterError({ status: 401 })).toBe('unauthenticated')
    expect(classifyCommandCenterError({ status: 403 })).toBe('not-found-or-forbidden')
    expect(classifyCommandCenterError({ status: 404 })).toBe('not-found-or-forbidden')
    expect(classifyCommandCenterError({ status: 422 })).toBe('validation')
    expect(classifyCommandCenterError(new TypeError('fetch failed'))).toBe('network')
    expect(classifyCommandCenterError({ status: 500 })).toBe('server')
  })

  it('partial 响应数据原样保留（source unavailable 不被吞掉）', async () => {
    apiFetchEnvelope.mockResolvedValue({
      data: {
        project: { id: 101, organizationId: 1 },
        headline: { sourceKey: 'project-dashboard', healthStatus: 'yellow', degraded: true },
        sources: [
          {
            sourceKey: 'resource-load',
            meta: { availability: 'unavailable', reasonCode: 'SOURCE_UNAVAILABLE' },
            warnings: [{ code: 'SOURCE_UNAVAILABLE', sourceKey: 'resource-load', message: 'x' }],
            targets: [],
            facts: null,
          },
        ],
        attention: [],
      },
      meta: { contractVersion: 'project-health-risk-command-center/v1' },
    })
    const result = await fetchProjectHealthRiskCommandCenter(101)
    expect(result.data.sources[0]?.meta.availability).toBe('unavailable')
    expect(result.data.sources[0]?.facts).toBeNull()
  })
})
