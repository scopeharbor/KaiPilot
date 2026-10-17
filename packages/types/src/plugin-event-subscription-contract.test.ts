import { describe, it, expect } from 'vitest'
import {
  MAX_EVENT_DECLARATION_BYTES,
  MAX_EVENT_FILTER_NODES,
  MAX_EVENT_FILTER_VALUES,
  PLUGIN_EVENT_CATALOG,
  PLUGIN_SEAM_EVENT_SUBSCRIPTION,
  buildPluginEventEnvelope,
  checkPluginEventVersionCompatibility,
  computePluginEventDeliveryIdentity,
  computePluginEventId,
  computePluginEventSubscriptionDigest,
  lookupPluginEventDefinition,
  matchPluginEventFilter,
  pluginEventContainsForbiddenToken,
  validatePluginEventResponse,
  validatePluginEventSubscriptionPayload,
} from './plugin-event-subscription-contract.js'
import {
  makeActionProposalResponse,
  makeAdvisoryDraftResponse,
  makeDirectWriteResponse,
  makeExternalActionResponse,
  makeObservationResponse,
  makeRecursiveResponse,
  makeValidSubscriptionPayload,
} from './plugin-event-subscription-contract-fixtures.js'
import { validatePluginContributionPayload } from './plugin-skill-adapter.js'

/** 构造合法 envelope 输入。 */
function envelopeInput(overrides?: Partial<Parameters<typeof buildPluginEventEnvelope>[0]>) {
  return {
    eventType: 'project.task.updated',
    eventVersion: '1.0.0',
    organizationId: 1,
    projectId: 10,
    occurredAtIso: '2026-08-24T00:00:00.000Z',
    auditLogId: 42,
    producerRef: 'audit-bypass',
    candidateProjection: { entityAction: 'updated', changedFields: 'status' },
    ...overrides,
  }
}

describe('plugin-event-subscription-contract 共享契约测试', () => {
  describe('1. 事件目录（D1 宿主持有）', () => {
    it('pilot 目录只含 project.task.updated@1.0.0 且投影 allowlist 封闭', () => {
      expect(PLUGIN_EVENT_CATALOG).toHaveLength(1)
      const def = lookupPluginEventDefinition('project.task.updated', '1.0.0')
      expect(def).toBeDefined()
      expect(def!.scopeKind).toBe('project')
      expect(def!.requiredPermission).toBe('project:view')
      expect(def!.projectionFields).toEqual(['entityAction', 'changedFields'])
      expect(def!.allowedResponseKinds).toContain('action-proposal')
      expect(lookupPluginEventDefinition('project.task.updated', '2.0.0')).toBeUndefined()
      expect(lookupPluginEventDefinition('unknown.event', '1.0.0')).toBeUndefined()
    })
  })

  describe('2. 订阅声明校验：未知类型/版本/字段 fail closed', () => {
    it('未知事件类型被拒绝', () => {
      const res = validatePluginEventSubscriptionPayload(
        makeValidSubscriptionPayload([{ eventType: 'kafka.topic.message', eventVersion: '1.0.0' }]),
      )
      expect(res.valid).toBe(false)
      expect(res.findings.some((f) => f.code === 'plugin-event-unknown-type')).toBe(true)
    })

    it('未知事件版本被拒绝', () => {
      const res = validatePluginEventSubscriptionPayload(
        makeValidSubscriptionPayload([
          { eventType: 'project.task.updated', eventVersion: '9.9.9' },
        ]),
      )
      expect(res.valid).toBe(false)
      expect(res.findings.some((f) => f.code === 'plugin-event-unknown-version')).toBe(true)
    })

    it('未知顶层/订阅字段被拒绝', () => {
      const res = validatePluginEventSubscriptionPayload({
        subscriptions: [{ eventType: 'project.task.updated', eventVersion: '1.0.0' }],
        sneakyExtra: true,
      })
      expect(res.valid).toBe(false)
      expect(res.findings.some((f) => f.path === 'payload.sneakyExtra')).toBe(true)

      const res2 = validatePluginEventSubscriptionPayload(
        makeValidSubscriptionPayload([
          { eventType: 'project.task.updated', eventVersion: '1.0.0', handler: 'x' } as never,
        ]),
      )
      expect(res2.valid).toBe(false)
      expect(res2.findings.some((f) => f.path?.includes('.handler'))).toBe(true)
    })
  })

  describe('3. 过滤器 AST：脚本/SQL/正则/网络目标与上限', () => {
    it('脚本表达式节点被拒绝且不执行任何代码', () => {
      const res = validatePluginEventSubscriptionPayload(
        makeValidSubscriptionPayload([
          {
            eventType: 'project.task.updated',
            eventVersion: '1.0.0',
            filter: { op: 'regex' as never, field: 'entityAction', pattern: '.*' },
          },
        ]),
      )
      expect(res.valid).toBe(false)
      expect(
        res.findings.some(
          (f) =>
            f.code === 'plugin-event-filter-op-forbidden' ||
            f.code === 'plugin-event-schema-invalid',
        ),
      ).toBe(true)
    })

    it('过滤器值携带 SQL/脚本/正则/网络目标被拒绝', () => {
      for (const value of [
        'SELECT * FROM tasks',
        'function(){return 1}',
        'new RegExp(".*")',
        'https://evil.example',
      ]) {
        const res = validatePluginEventSubscriptionPayload(
          makeValidSubscriptionPayload([
            {
              eventType: 'project.task.updated',
              eventVersion: '1.0.0',
              filter: { op: 'eq', field: 'entityAction', value },
            },
          ]),
        )
        expect(res.valid).toBe(false)
        expect(res.findings.some((f) => f.code === 'plugin-event-filter-op-forbidden')).toBe(true)
      }
    })

    it('filter 字段不在 definition allowlist 被拒绝', () => {
      const res = validatePluginEventSubscriptionPayload(
        makeValidSubscriptionPayload([
          {
            eventType: 'project.task.updated',
            eventVersion: '1.0.0',
            filter: { op: 'eq', field: 'assigneeSalary', value: 1 },
          },
        ]),
      )
      expect(res.valid).toBe(false)
      expect(res.findings.some((f) => f.code === 'plugin-event-unknown-field')).toBe(true)
    })

    it('changed 操作符使用独立允许字段集：status 可监听、任意字段不可', () => {
      const ok = validatePluginEventSubscriptionPayload(
        makeValidSubscriptionPayload([
          {
            eventType: 'project.task.updated',
            eventVersion: '1.0.0',
            filter: { op: 'changed', field: 'status' },
          },
        ]),
      )
      expect(ok.valid).toBe(true)

      const bad = validatePluginEventSubscriptionPayload(
        makeValidSubscriptionPayload([
          {
            eventType: 'project.task.updated',
            eventVersion: '1.0.0',
            filter: { op: 'changed', field: 'internalCost' },
          },
        ]),
      )
      expect(bad.valid).toBe(false)
      expect(bad.findings.some((f) => f.code === 'plugin-event-unknown-field')).toBe(true)

      // changed 匹配语义：字段名出现在 changedFields 列表中才命中
      const envA = buildPluginEventEnvelope(
        envelopeInput({
          candidateProjection: { entityAction: 'updated', changedFields: 'status,priority' },
        }),
      )!
      const envB = buildPluginEventEnvelope(
        envelopeInput({
          candidateProjection: { entityAction: 'updated', changedFields: 'dueDate' },
        }),
      )!
      expect(matchPluginEventFilter([{ op: 'changed', field: 'status' }], envA)).toBe(true)
      expect(matchPluginEventFilter([{ op: 'changed', field: 'status' }], envB)).toBe(false)
    })

    it(`过滤器超过 ${MAX_EVENT_FILTER_NODES} 节点 / in 超过 ${MAX_EVENT_FILTER_VALUES} 值被拒绝`, () => {
      const manyNodes = Array.from({ length: MAX_EVENT_FILTER_NODES + 1 }, (_, i) => ({
        op: 'eq' as const,
        field: 'entityAction',
        value: `v${i}`,
      }))
      const resNodes = validatePluginEventSubscriptionPayload(
        makeValidSubscriptionPayload([
          { eventType: 'project.task.updated', eventVersion: '1.0.0', filter: manyNodes },
        ]),
      )
      expect(resNodes.valid).toBe(false)
      expect(resNodes.findings.some((f) => f.code === 'plugin-event-filter-limit-exceeded')).toBe(
        true,
      )

      const resValues = validatePluginEventSubscriptionPayload(
        makeValidSubscriptionPayload([
          {
            eventType: 'project.task.updated',
            eventVersion: '1.0.0',
            filter: {
              op: 'in',
              field: 'entityAction',
              values: Array.from({ length: MAX_EVENT_FILTER_VALUES + 1 }, (_, i) => `v${i}`),
            },
          },
        ]),
      )
      expect(resValues.valid).toBe(false)
      expect(resValues.findings.some((f) => f.code === 'plugin-event-filter-limit-exceeded')).toBe(
        true,
      )
    })

    it('声明负载超字节上限被拒绝', () => {
      const big = 'x'.repeat(MAX_EVENT_DECLARATION_BYTES)
      const res = validatePluginEventSubscriptionPayload({
        subscriptions: [
          { eventType: 'project.task.updated', eventVersion: '1.0.0', note: big } as never,
        ],
      })
      // 超限或未知字段二者必有一个 blocking
      expect(res.valid).toBe(false)
    })
  })

  describe('4. 稳定 digest 与确定性 identity', () => {
    it('相同订阅乱序键产生一致 digest；内容变化 digest 变化', () => {
      const a = validatePluginEventSubscriptionPayload(makeValidSubscriptionPayload())
      const b = validatePluginEventSubscriptionPayload(makeValidSubscriptionPayload())
      expect(a.valid && b.valid).toBe(true)
      const digestA = computePluginEventSubscriptionDigest(a.normalizedPayload!.subscriptions[0])
      const digestB = computePluginEventSubscriptionDigest(b.normalizedPayload!.subscriptions[0])
      expect(digestA).toBe(digestB)

      const c = validatePluginEventSubscriptionPayload(
        makeValidSubscriptionPayload([
          {
            eventType: 'project.task.updated',
            eventVersion: '1.0.0',
            responseKinds: ['observation'],
            filter: { op: 'eq', field: 'entityAction', value: 'created' },
          },
        ]),
      )
      const digestC = computePluginEventSubscriptionDigest(c.normalizedPayload!.subscriptions[0])
      expect(digestC).not.toBe(digestA)
    })

    it('eventId 与 deliveryIdentity 确定性且区分输入', () => {
      const id1 = computePluginEventId({
        organizationId: 1,
        eventType: 'project.task.updated',
        eventVersion: '1.0.0',
        auditLogId: 42,
      })
      const id2 = computePluginEventId({
        organizationId: 1,
        eventType: 'project.task.updated',
        eventVersion: '1.0.0',
        auditLogId: 43,
      })
      expect(id1).toBe(
        computePluginEventId({
          organizationId: 1,
          eventType: 'project.task.updated',
          eventVersion: '1.0.0',
          auditLogId: 42,
        }),
      )
      expect(id1).not.toBe(id2)

      const base = {
        organizationId: 1,
        pluginId: 'com.aiproj.pilot',
        pluginVersion: '1.0.0',
        eventId: id1,
      }
      const d1 = computePluginEventDeliveryIdentity({ ...base, subscriptionDigest: 'aa' })
      const d2 = computePluginEventDeliveryIdentity({ ...base, subscriptionDigest: 'bb' })
      expect(d1).not.toBe(d2)
      expect(d1).toBe(computePluginEventDeliveryIdentity({ ...base, subscriptionDigest: 'aa' }))
    })

    it('版本兼容判定：same-major 通过，跨 major/未来版本/非法版本拒绝', () => {
      expect(checkPluginEventVersionCompatibility('1.0.0', '1.0.0').compatible).toBe(true)
      expect(checkPluginEventVersionCompatibility('1.2.3', '1.3.0').compatible).toBe(true)
      expect(checkPluginEventVersionCompatibility('2.0.0', '1.0.0').reason).toBe('major-mismatch')
      expect(checkPluginEventVersionCompatibility('1.4.0', '1.3.0').reason).toBe('requested-future')
      expect(checkPluginEventVersionCompatibility('abc', '1.0.0').reason).toBe('invalid-version')
    })
  })

  describe('5. 最小 envelope 低敏纪律', () => {
    it('allowlist 之外的字段一律丢弃；字符串截断；未知事件返回 null', () => {
      const env = buildPluginEventEnvelope(
        envelopeInput({
          candidateProjection: {
            entityAction: 'updated',
            changedFields: 'status'.repeat(50),
            taskTitle: '机密任务名',
            internalCost: 999,
          },
        }),
      )
      expect(env).not.toBeNull()
      expect(Object.keys(env!.projection).sort()).toEqual(['changedFields', 'entityAction'])
      expect(env!.projection.changedFields!.length).toBeLessThanOrEqual(200)
      expect(JSON.stringify(env!.projection)).not.toContain('机密任务名')
      expect(env!.eventId).toHaveLength(8)

      expect(buildPluginEventEnvelope(envelopeInput({ eventVersion: '2.0.0' }))).toBeNull()
    })

    it('envelope 只含稳定 identity、type/version、时间、scope 引用、投影与 provenance', () => {
      const env = buildPluginEventEnvelope(envelopeInput())!
      expect(Object.keys(env).sort()).toEqual(
        [
          'eventType',
          'eventVersion',
          'occurredAt',
          'organizationId',
          'eventId',
          'projectId',
          'projection',
          'provenance',
          'schemaVersion',
        ].sort(),
      )
    })
  })

  describe('6. 响应边界（observation / advisory-draft / action-proposal）', () => {
    const ctx = {
      allowedKinds: ['observation', 'advisory-draft', 'action-proposal'] as const,
      expectedDeliveryIdentity: 'deadbeef',
      eventType: 'project.task.updated',
      eventVersion: '1.0.0',
    }

    it('三类合法响应通过校验并归一化', () => {
      for (const resp of [
        makeObservationResponse('deadbeef'),
        makeAdvisoryDraftResponse('deadbeef'),
        makeActionProposalResponse('deadbeef'),
      ]) {
        const res = validatePluginEventResponse(resp, ctx)
        expect(res.valid).toBe(true)
        expect(res.normalized).toBeDefined()
      }
    })

    it('直接写入指令响应被拒绝（正式表零变化的前提）', () => {
      const res = validatePluginEventResponse(makeDirectWriteResponse('deadbeef'), ctx)
      expect(res.valid).toBe(false)
      expect(res.findings.some((f) => f.code === 'plugin-event-direct-write-forbidden')).toBe(true)
    })

    it('递归工作流/链式事件响应被拒绝', () => {
      const res = validatePluginEventResponse(makeRecursiveResponse('deadbeef'), ctx)
      expect(res.valid).toBe(false)
      expect(res.findings.some((f) => f.code === 'plugin-event-recursion-forbidden')).toBe(true)
    })

    it('外部动作/网络目标响应被拒绝', () => {
      const res = validatePluginEventResponse(makeExternalActionResponse('deadbeef'), ctx)
      expect(res.valid).toBe(false)
      expect(res.findings.some((f) => f.code === 'plugin-event-external-action-forbidden')).toBe(
        true,
      )
    })

    it('deliveryIdentity 不匹配 / 未声明 kind / 非法 schema 被拒绝', () => {
      const mismatch = validatePluginEventResponse(makeObservationResponse('other'), ctx)
      expect(mismatch.valid).toBe(false)

      const undeclaredKind = validatePluginEventResponse(makeActionProposalResponse('deadbeef'), {
        ...ctx,
        allowedKinds: ['observation'],
      })
      expect(undeclaredKind.valid).toBe(false)
      expect(
        undeclaredKind.findings.some((f) => f.code === 'plugin-event-response-kind-forbidden'),
      ).toBe(true)

      const badSchema = validatePluginEventResponse({ kind: 'execute-all' }, ctx)
      expect(badSchema.valid).toBe(false)
      expect(badSchema.findings.some((f) => f.code === 'plugin-event-direct-write-forbidden')).toBe(
        true,
      )
    })

    it('超大响应被拒绝', () => {
      const res = validatePluginEventResponse(
        makeObservationResponse('deadbeef').observation
          ? {
              schemaVersion: 'plugin-event-response-v1',
              kind: 'observation',
              deliveryIdentity: 'deadbeef',
              observation: { note: 'a'.repeat(1001) },
            }
          : {},
        ctx,
      )
      expect(res.valid).toBe(false)
    })
  })

  describe('7. manifest dispatcher 接线与低敏扫描', () => {
    it('dispatcher 分派 event-subscription.internal-events 并透传封闭 finding code', () => {
      const ok = validatePluginContributionPayload(
        PLUGIN_SEAM_EVENT_SUBSCRIPTION,
        makeValidSubscriptionPayload(),
        '1.0.0',
      )
      expect(ok.valid).toBe(true)

      const bad = validatePluginContributionPayload(
        PLUGIN_SEAM_EVENT_SUBSCRIPTION,
        makeValidSubscriptionPayload([{ eventType: 'nope', eventVersion: '1.0.0' }]),
        '1.0.0',
      )
      expect(bad.valid).toBe(false)
      expect(bad.findings.some((f) => f.code === 'plugin-event-unknown-type')).toBe(true)
    })

    it('未登记 seam 变体仍被 unknown-seam 拒绝', () => {
      const res = validatePluginContributionPayload(
        'event-subscription.arbitrary-webhook',
        makeValidSubscriptionPayload(),
        '1.0.0',
      )
      expect(res.valid).toBe(false)
      expect(res.findings[0].code).toBe('plugin-skill-adapter-unknown-seam')
    })

    it('声明负载中的 secret 键与网络描述触发低敏 blocking finding', () => {
      const res = validatePluginEventSubscriptionPayload({
        subscriptions: [
          { eventType: 'project.task.updated', eventVersion: '1.0.0', apiToken: 'x' as never },
        ],
      })
      expect(res.valid).toBe(false)
      expect(res.findings.some((f) => f.code === 'plugin-event-secret-detected')).toBe(true)

      const net = validatePluginEventSubscriptionPayload({
        subscriptions: [
          {
            eventType: 'project.task.updated',
            eventVersion: '1.0.0',
            callbackUrl: 'https://x' as never,
          },
        ],
      })
      expect(net.valid).toBe(false)
      expect(net.findings.some((f) => f.code === 'plugin-event-network-target-forbidden')).toBe(
        true,
      )
    })

    it('禁止 token 扫描器对普通枚举值零误报', () => {
      expect(pluginEventContainsForbiddenToken('in_progress')).toBe(false)
      expect(pluginEventContainsForbiddenToken('updated')).toBe(false)
      expect(pluginEventContainsForbiddenToken('DROP TABLE tasks')).toBe(true)
    })
  })
})
