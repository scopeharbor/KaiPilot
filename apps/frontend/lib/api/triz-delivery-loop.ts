'use client'

import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  TrizDlClosedLoopSummary,
  TrizDlClosedLoopItem,
  TrizDlLinkPreviewResponse,
  TrizDlListResponse,
  TrizDlPosture,
} from '@aiproj/types'

/**
 * v3-triz-to-delivery-closed-loop —— 前端 API 客户端（task 10.1）。
 *
 * org+project scoped query keys；写 mutation 由 hooks 层按项目前缀精确失效。
 */

export const trizDeliveryLoopKeys = {
  all: ['triz-delivery-loop'] as const,
  summary: (projectId: number) => [...trizDeliveryLoopKeys.all, 'summary', projectId] as const,
  items: (projectId: number, filters?: { posture?: TrizDlPosture; page?: number }) =>
    [...trizDeliveryLoopKeys.all, 'items', projectId, filters ?? {}] as const,
  detail: (projectId: number, itemId: string | null) =>
    [...trizDeliveryLoopKeys.all, 'detail', projectId, itemId ?? ''] as const,
}

const basePath = (projectId: number) => `/projects/${projectId}/triz/delivery-loop`

export const trizDeliveryLoopApi = {
  /** 摘要（后端返回 {data: summary} 信封）。 */
  summary: async (projectId: number): Promise<TrizDlClosedLoopSummary> => {
    const body = await apiFetchEnvelope<{ data: TrizDlClosedLoopSummary }>(
      `${basePath(projectId)}/summary`,
    )
    return body.data
  },

  /** 分页列表（后端返回 {data, meta}，即信封本身）。 */
  items: async (
    projectId: number,
    filters?: { posture?: TrizDlPosture; page?: number; perPage?: number },
  ): Promise<TrizDlListResponse> => {
    const q = new URLSearchParams()
    if (filters?.posture) q.set('posture', filters.posture)
    if (filters?.page) q.set('page', String(filters.page))
    if (filters?.perPage) q.set('perPage', String(filters.perPage))
    const suffix = q.size ? `?${q.toString()}` : ''
    return apiFetchEnvelope<TrizDlListResponse>(`${basePath(projectId)}/items${suffix}`)
  },

  /** 详情（后端返回 {data: 信封}）。 */
  detail: async (
    projectId: number,
    itemId: string,
  ): Promise<
    TrizDlClosedLoopItem & {
      entitySummaries: Array<{
        kind: string
        entityId: string
        posture: string
        title: string | null
      }>
      contextSummaries: unknown[]
      linkMode: 'apply_receipt' | 'existing_entity'
      legacyUnlinked: boolean
    }
  > => {
    const body = await apiFetchEnvelope<{
      data: Awaited<ReturnType<typeof trizDeliveryLoopApi.detail>>
    }>(`${basePath(projectId)}/items/${encodeURIComponent(itemId)}`)
    return body.data
  },

  /** 验证就绪（task 7.1 的只读面）：供人工验证/重审对话框取当前 fingerprint，零写入。 */
  ready: async (
    projectId: number,
    itemId: string,
  ): Promise<{
    itemId: string
    ready: boolean
    blockingReasons: string[]
    verificationFingerprint: string | null
    effectiveConclusion: 'effective' | 'ineffective' | 'inconclusive' | null
  }> => {
    const body = await apiFetchEnvelope<{
      data: {
        itemId: string
        ready: boolean
        blockingReasons: string[]
        verificationFingerprint: string | null
        effectiveConclusion: 'effective' | 'ineffective' | 'inconclusive' | null
      }
    }>(`${basePath(projectId)}/items/${encodeURIComponent(itemId)}/ready`)
    return body.data
  },

  linkPreview: async (
    projectId: number,
    input: {
      decisionLogId: string
      deliveryRefs: Array<{ kind: 'task' | 'milestone'; entityId: string }>
      contextRefs?: Array<{ kind: 'risk' | 'change_request'; entityId: string }>
    },
  ): Promise<TrizDlLinkPreviewResponse> => {
    const body = await apiFetchEnvelope<{ data: TrizDlLinkPreviewResponse }>(
      `${basePath(projectId)}/links/preview`,
      { method: 'POST', body: JSON.stringify(input) },
    )
    return body.data
  },

  linkConfirm: async (
    projectId: number,
    input: {
      decisionLogId: string
      deliveryRefs: Array<{ kind: 'task' | 'milestone'; entityId: string }>
      previewFingerprint: string
      confirmation: { acknowledgedOnlyLinkWrite: boolean; requestedAt: string }
    },
  ): Promise<{ linkId: number; replayed: boolean }> => {
    const body = await apiFetchEnvelope<{ data: { linkId: number; replayed: boolean } }>(
      `${basePath(projectId)}/links/confirm`,
      { method: 'POST', body: JSON.stringify(input) },
    )
    return body.data
  },

  verify: async (
    projectId: number,
    itemId: string,
    input: {
      conclusion: 'effective' | 'ineffective' | 'inconclusive'
      observationWindow: { from: string; to: string }
      baselineSummary?: string
      targetSummary?: string
      actualResult?: string
      reason?: string
      evidenceRefs: string[]
      verificationFingerprint: string
    },
  ): Promise<{ eventId: number }> => {
    const body = await apiFetchEnvelope<{ data: { eventId: number } }>(
      `${basePath(projectId)}/items/${encodeURIComponent(itemId)}/verifications`,
      { method: 'POST', body: JSON.stringify(input) },
    )
    return body.data
  },

  reopen: async (
    projectId: number,
    itemId: string,
    input: { reason: string; currentFingerprint: string },
  ): Promise<{ eventId: number }> => {
    const body = await apiFetchEnvelope<{ data: { eventId: number } }>(
      `${basePath(projectId)}/items/${encodeURIComponent(itemId)}/reopen`,
      { method: 'POST', body: JSON.stringify(input) },
    )
    return body.data
  },
}
