// @aiproj/frontend — V3 TRIZ 矛盾矩阵审查 UI API 客户端
// v3-triz-contradiction-matrix-ui / design D6 / tasks §5.1
//
// 只读 API：读取矩阵 DTO。
// Handoff API：提交选中单元/物理矛盾作为候选输入（不写正式业务数据）。

import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  MatrixFilters,
  MatrixHandoffInput,
  MatrixHandoffResponse,
  GetMatrixResponse,
} from '@aiproj/types'

/**
 * v3-triz-contradiction-matrix-ui —— 前端 API 客户端。
 *
 * 读取接口只取矩阵 DTO；handoff 必须由显式 mutation 触发。
 * 所有数据来自后端只读聚合，零模型成本。
 */

export const trizContradictionMatrixKeys = {
  all: ['triz-contradiction-matrix'] as const,
  matrix: (projectId: number, filters: MatrixFilters = {}) =>
    [...trizContradictionMatrixKeys.all, 'matrix', projectId, serializeFilters(filters)] as const,
}

const basePath = (projectId: number) => `/projects/${projectId}/triz/contradiction-matrix`

/**
 * 稳定序列化筛选器，保证 query key 一致性。
 */
function serializeFilters(filters: MatrixFilters): string {
  const keys = Object.keys(filters).sort()
  const parts = keys
    .map((k) => {
      const v = (filters as Record<string, unknown>)[k]
      if (v === undefined || v === null) return null
      return `${k}=${String(v)}`
    })
    .filter(Boolean)
  return parts.join('&')
}

function querySuffix(params: Record<string, string | number | boolean | undefined>) {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) qs.set(key, String(value))
  }
  return qs.size > 0 ? `?${qs.toString()}` : ''
}

export const trizContradictionMatrixApi = {
  /** 读取矛盾矩阵 DTO（只读、零模型成本） */
  getMatrix: (projectId: number, filters: MatrixFilters = {}) =>
    apiFetchEnvelope<GetMatrixResponse>(
      `${basePath(projectId)}${querySuffix(filters as Record<string, string | number | boolean | undefined>)}`,
    ).then((res) => res.data),

  /** 提交 handoff（选中单元/物理矛盾作为候选输入） */
  handoff: (projectId: number, input: MatrixHandoffInput) =>
    apiFetchEnvelope<MatrixHandoffResponse>(`${basePath(projectId)}/handoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then((res) => res.data),
}
