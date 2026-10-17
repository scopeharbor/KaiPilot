/**
 * renderer-configs —— 渲染器配置 API 客户端（§5.1 P0，§7.1 P0）。
 *
 * 提供验证、预览、保存和加载 renderer-backed 配置的 API 函数。
 */
import { apiFetchEnvelope } from '@/lib/api-client'

const BASE = ''

export interface RendererConfigResponse {
  data: {
    valid: boolean
    configHash?: string
    warnings?: Array<{ code: string; message: string }>
    errors?: Array<{ code: string; message: string }>
  }
}

export interface RendererCandidateConfirmRequest {
  config: Record<string, unknown>
  name: string
  visibility: 'personal' | 'shared'
  sourceArtifactRef?: string
  sourceRunId?: string
}

export interface RendererCandidateConfirmResponse {
  data: {
    id: number
    name: string
    visibility: 'personal' | 'shared'
  }
}

export interface RendererViewOverrideRequest {
  viewId: number
  overrides: Array<{
    path: string
    value: unknown
  }>
}

/**
 * 验证渲染器配置。
 */
export async function validateRendererConfig(config: Record<string, unknown>) {
  return apiFetchEnvelope<RendererConfigResponse['data']>(
    `${BASE}/projects/0/renderer-configs/validate`,
    {
      method: 'POST',
      body: JSON.stringify({ config }),
    },
  )
}

/**
 * 预览 AI 候选渲染器配置。
 */
export async function previewRendererCandidate(config: Record<string, unknown>) {
  return apiFetchEnvelope<RendererConfigResponse['data']>(
    `${BASE}/projects/0/renderer-configs/preview`,
    {
      method: 'POST',
      body: JSON.stringify({ config }),
    },
  )
}

/**
 * 确认 AI 候选并保存为自定义视图。
 */
export async function confirmRendererCandidate(
  projectId: number,
  request: RendererCandidateConfirmRequest,
) {
  return apiFetchEnvelope<RendererCandidateConfirmResponse['data']>(
    `${BASE}/projects/${projectId}/renderer-configs/confirm`,
    {
      method: 'POST',
      body: JSON.stringify(request),
    },
  )
}

/**
 * 保存用户覆盖偏好。
 */
export async function saveViewOverride(projectId: number, request: RendererViewOverrideRequest) {
  return apiFetchEnvelope<{ id: number }>(
    `${BASE}/projects/${projectId}/renderer-configs/overrides`,
    {
      method: 'PUT',
      body: JSON.stringify(request),
    },
  )
}

/**
 * 重置用户覆盖偏好。
 */
export async function resetViewOverride(projectId: number, viewId: number) {
  return apiFetchEnvelope<{ message: string }>(
    `${BASE}/projects/${projectId}/renderer-configs/overrides/${viewId}`,
    { method: 'DELETE' },
  )
}
