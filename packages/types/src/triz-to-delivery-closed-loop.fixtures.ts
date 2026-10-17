/**
 * v3-triz-to-delivery-closed-loop —— 确定性测试夹具（前后端共享）。
 *
 * 覆盖：小型基线、跨租诱饵、stale、legacy-unlinked、blocked、completed
 * （awaiting_verification）、effective / ineffective / inconclusive、plugin-degraded。
 * 所有 digest/fingerprint 经共享纯函数重算，fixture 一致性由 `.test.ts` 守住。
 */

import type {
  TrizDlAuthorizedEntitySummary,
  TrizDlClosedLoopItem,
  TrizDlClosedLoopSummary,
  TrizDlEntityPosture,
  TrizDlEntityRef,
  TrizDlLinkMode,
  TrizDlProjectionInput,
  TrizDlVerificationConclusion,
  TrizDlWarningCode,
} from './triz-to-delivery-closed-loop.js'
import { projectTrizDlPosture, trizDlComputeLinkDigest } from './triz-to-delivery-closed-loop.js'

const ORG_A = 1
const ORG_B = 99
const PROJECT_P1 = 10

function ref(kind: TrizDlEntityRef['kind'], entityId: string): TrizDlEntityRef {
  return { kind, entityId }
}

export interface TrizDlItemFixtureSpec {
  name: string
  organizationId?: number
  itemId: string
  decisionLogId: string
  linkMode: TrizDlLinkMode | null
  projection: TrizDlProjectionInput
  latestConclusion: TrizDlVerificationConclusion | null
  updatedAt: string
  deliveryRefsOverride?: TrizDlEntityRef[]
}

/** 从投影输入推导预期姿态（单一事实来源：测试直接复用 projector，避免第二套真值） */
function itemFromSpec(spec: TrizDlItemFixtureSpec): TrizDlClosedLoopItem {
  const out = projectTrizDlPosture(spec.projection)
  return {
    itemId: spec.itemId,
    projectId: PROJECT_P1,
    organizationId: spec.organizationId ?? ORG_A,
    decisionLogId: spec.decisionLogId,
    linkMode: spec.linkMode,
    posture: out.posture,
    warningCodes: out.warningCodes,
    degradedReasons: spec.name === 'plugin-degraded' ? (['plugin_timeout'] as const) : [],
    deliveryRefs:
      spec.deliveryRefsOverride ?? spec.projection.requiredDeliveryFacts.map((f) => f.ref),
    contextRefs: [],
    latestConclusion: spec.latestConclusion,
    updatedAt: spec.updatedAt,
  }
}

const freshOk = (kind: TrizDlEntityRef['kind'], id: string, posture: TrizDlEntityPosture) =>
  ({ ref: ref(kind, id), state: 'ok', posture }) as const

/** 全部闭环 fixture（含跨租诱饵 org B 的两条，用于 non-leak 断言）。 */
export function buildTrizDlFixtureItems(): TrizDlClosedLoopItem[] {
  const specs: TrizDlItemFixtureSpec[] = [
    {
      name: 'small-baseline-awaiting-apply',
      itemId: 'item-001',
      decisionLogId: 'dec-001',
      linkMode: null,
      projection: {
        linkSuperseded: false,
        decisionSuperseded: false,
        sourceFreshness: 'fresh',
        hasValidLink: false,
        latestVerification: null,
        requiredDeliveryFacts: [],
      },
      latestConclusion: null,
      updatedAt: '2026-08-20T08:00:00.000Z',
    },
    {
      name: 'delivery-linked',
      itemId: 'item-002',
      decisionLogId: 'dec-002',
      linkMode: 'apply_receipt',
      projection: {
        linkSuperseded: false,
        decisionSuperseded: false,
        sourceFreshness: 'fresh',
        hasValidLink: true,
        latestVerification: null,
        requiredDeliveryFacts: [freshOk('task', '2001', 'not_started')],
      },
      latestConclusion: null,
      updatedAt: '2026-08-21T09:00:00.000Z',
    },
    {
      name: 'in-progress',
      itemId: 'item-003',
      decisionLogId: 'dec-003',
      linkMode: 'apply_receipt',
      projection: {
        linkSuperseded: false,
        decisionSuperseded: false,
        sourceFreshness: 'fresh',
        hasValidLink: true,
        latestVerification: null,
        requiredDeliveryFacts: [freshOk('task', '3001', 'in_progress')],
      },
      latestConclusion: null,
      updatedAt: '2026-08-22T10:00:00.000Z',
    },
    {
      name: 'blocked',
      itemId: 'item-004',
      decisionLogId: 'dec-004',
      linkMode: 'existing_entity',
      projection: {
        linkSuperseded: false,
        decisionSuperseded: false,
        sourceFreshness: 'fresh',
        hasValidLink: true,
        latestVerification: null,
        requiredDeliveryFacts: [
          freshOk('task', '4001', 'blocked'),
          freshOk('milestone', '4002', 'not_started'),
        ],
      },
      latestConclusion: null,
      updatedAt: '2026-08-23T11:00:00.000Z',
    },
    {
      name: 'awaiting-verification',
      itemId: 'item-005',
      decisionLogId: 'dec-005',
      linkMode: 'apply_receipt',
      projection: {
        linkSuperseded: false,
        decisionSuperseded: false,
        sourceFreshness: 'fresh',
        hasValidLink: true,
        latestVerification: null,
        requiredDeliveryFacts: [
          freshOk('task', '5001', 'completed'),
          freshOk('milestone', '5002', 'completed'),
        ],
      },
      latestConclusion: null,
      updatedAt: '2026-08-24T12:00:00.000Z',
    },
    {
      name: 'verified-effective',
      itemId: 'item-006',
      decisionLogId: 'dec-006',
      linkMode: 'apply_receipt',
      projection: {
        linkSuperseded: false,
        decisionSuperseded: false,
        sourceFreshness: 'fresh',
        hasValidLink: true,
        latestVerification: { conclusion: 'effective', fresh: true, superseded: false },
        requiredDeliveryFacts: [freshOk('task', '6001', 'completed')],
      },
      latestConclusion: 'effective',
      updatedAt: '2026-08-25T13:00:00.000Z',
    },
    {
      name: 'verified-ineffective',
      itemId: 'item-007',
      decisionLogId: 'dec-007',
      linkMode: 'existing_entity',
      projection: {
        linkSuperseded: false,
        decisionSuperseded: false,
        sourceFreshness: 'fresh',
        hasValidLink: true,
        latestVerification: { conclusion: 'ineffective', fresh: true, superseded: false },
        requiredDeliveryFacts: [freshOk('milestone', '7001', 'completed')],
      },
      latestConclusion: 'ineffective',
      updatedAt: '2026-08-25T14:00:00.000Z',
    },
    {
      name: 'inconclusive',
      itemId: 'item-008',
      decisionLogId: 'dec-008',
      linkMode: 'apply_receipt',
      projection: {
        linkSuperseded: false,
        decisionSuperseded: false,
        sourceFreshness: 'fresh',
        hasValidLink: true,
        latestVerification: { conclusion: 'inconclusive', fresh: true, superseded: false },
        requiredDeliveryFacts: [freshOk('task', '8001', 'completed')],
      },
      latestConclusion: 'inconclusive',
      updatedAt: '2026-08-25T15:00:00.000Z',
    },
    {
      name: 'source-stale',
      itemId: 'item-009',
      decisionLogId: 'dec-009',
      linkMode: 'apply_receipt',
      projection: {
        linkSuperseded: false,
        decisionSuperseded: false,
        sourceFreshness: 'stale',
        hasValidLink: true,
        // stale 之后旧 effective 验证仅作历史
        latestVerification: { conclusion: 'effective', fresh: false, superseded: false },
        requiredDeliveryFacts: [freshOk('task', '9001', 'completed')],
      },
      latestConclusion: 'effective',
      updatedAt: '2026-08-25T16:00:00.000Z',
    },
    {
      name: 'superseded-link',
      itemId: 'item-010',
      decisionLogId: 'dec-010',
      linkMode: 'existing_entity',
      projection: {
        linkSuperseded: true,
        decisionSuperseded: false,
        sourceFreshness: 'fresh',
        hasValidLink: false,
        latestVerification: null,
        requiredDeliveryFacts: [freshOk('task', '10001', 'in_progress')],
      },
      latestConclusion: null,
      updatedAt: '2026-08-25T17:00:00.000Z',
    },
    {
      name: 'unavailable-fail-closed',
      itemId: 'item-011',
      decisionLogId: 'dec-011',
      linkMode: 'apply_receipt',
      projection: {
        linkSuperseded: false,
        decisionSuperseded: false,
        sourceFreshness: 'fresh',
        hasValidLink: true,
        latestVerification: null,
        requiredDeliveryFacts: [{ ref: ref('task', '11001'), state: 'unavailable', posture: null }],
      },
      latestConclusion: null,
      updatedAt: '2026-08-25T18:00:00.000Z',
    },
    {
      name: 'cross-tenant-decoy-A',
      organizationId: ORG_B,
      itemId: 'item-901',
      decisionLogId: 'dec-901',
      linkMode: 'apply_receipt',
      projection: {
        linkSuperseded: false,
        decisionSuperseded: false,
        sourceFreshness: 'fresh',
        hasValidLink: true,
        latestVerification: null,
        requiredDeliveryFacts: [freshOk('task', '99001', 'not_started')],
      },
      latestConclusion: null,
      updatedAt: '2026-08-19T07:00:00.000Z',
    },
    {
      name: 'cross-tenant-decoy-B',
      organizationId: ORG_B,
      itemId: 'item-902',
      decisionLogId: 'dec-902',
      linkMode: 'existing_entity',
      projection: {
        linkSuperseded: false,
        decisionSuperseded: false,
        sourceFreshness: 'stale',
        hasValidLink: true,
        latestVerification: null,
        requiredDeliveryFacts: [freshOk('milestone', '99002', 'blocked')],
      },
      latestConclusion: null,
      updatedAt: '2026-08-18T06:00:00.000Z',
    },
  ]
  return specs.map(itemFromSpec)
}

/** legacy-unlinked 行（apply result 无 entityRefs 的历史数据投影） */
export function buildTrizDlLegacyUnlinkedItem(): TrizDlClosedLoopItem {
  return {
    itemId: 'item-legacy-100',
    projectId: PROJECT_P1,
    organizationId: ORG_A,
    decisionLogId: 'dec-100',
    linkMode: null,
    posture: 'awaiting_apply',
    warningCodes: ['TRIZ_DL_LEGACY_UNLINKED'],
    degradedReasons: [],
    deliveryRefs: [],
    contextRefs: [],
    latestConclusion: null,
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

/** plugin 降级摘要 fixture（advisory 区局部降级，核心姿态不受影响） */
export function buildTrizDlPluginDegradedSummary(): Pick<
  TrizDlClosedLoopSummary,
  'degradedReasons'
> & { advisoryAvailable: false } {
  return { degradedReasons: ['plugin_timeout'], advisoryAvailable: false }
}

/** 授权实体摘要 fixtures（含 hidden/unavailable 形态） */
export function buildTrizDlEntitySummaryFixtures(): TrizDlAuthorizedEntitySummary[] {
  return [
    {
      kind: 'task',
      entityId: '3001',
      posture: 'in_progress',
      revisionHint: 'rev-a1',
      title: '样例任务 A',
      unavailableReason: null,
    },
    {
      kind: 'milestone',
      entityId: '4002',
      posture: 'not_started',
      revisionHint: 'rev-b2',
      title: '样例里程碑 B',
      unavailableReason: null,
    },
    {
      kind: 'risk',
      entityId: '5009',
      posture: 'unavailable',
      revisionHint: null,
      title: null,
      unavailableReason: 'forbidden',
    },
  ]
}

/** link digest 跨租分域断言辅助：同 refs 不同组织必须得到不同 digest。 */
export function trizDlFixtureDigestPair(): [string, string] {
  const base = {
    projectId: PROJECT_P1,
    decisionLogId: 'dec-002',
    linkMode: 'apply_receipt' as const,
    deliveryRefs: [ref('task', '2001')] as TrizDlEntityRef[],
    contextRefs: [] as TrizDlEntityRef[],
  }
  return [
    trizDlComputeLinkDigest({ organizationId: ORG_A, ...base }),
    trizDlComputeLinkDigest({ organizationId: ORG_B, ...base }),
  ]
}

/** 测试用 warning code 集合（保证词表封闭引用不被遗漏） */
export const TRIZ_DL_FIXTURE_WARNING_CODES: readonly TrizDlWarningCode[] = [
  'TRIZ_DL_LEGACY_UNLINKED',
  'TRIZ_DL_SOURCE_STALE',
  'TRIZ_DL_PARTIAL_UNAVAILABLE',
  'TRIZ_DL_INCONCLUSIVE_EVIDENCE',
]
