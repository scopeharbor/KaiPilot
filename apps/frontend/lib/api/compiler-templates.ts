/**
 * v3-template-compiler-plugin-integration —— Compiler Templates API client（tasks 4.1）。
 *
 * 对应后端端点：
 *   GET /api/v1/ai/compiler/templates
 *   GET /api/v1/ai/compiler/templates/:templateId
 */

import { api, unwrap } from './_base'

export interface CompilerTemplateSummary {
  templateId: string
  name: string
  description: string
  pluginId: string
  pluginVersion: string
  source: 'plugin'
  version: number
  payloadDigest: string
  compatDigest: string
  seedDigest: string
  selectionDigest: string
  projectType: string
  objectives: string[]
  overridableParams: string[]
  wbsConstraints?: { maxDepth?: number; maxTasks?: number; requireMilestones?: boolean }
}

export interface CompilerTemplateDetail extends CompilerTemplateSummary {
  seed: {
    projectType: string
    objectives: string[]
    description?: string
    wbsConstraints?: { maxDepth?: number; maxTasks?: number; requireMilestones?: boolean }
    overridableParams?: string[]
  }
  compat: { pluginVersion: string; compatibilityDigest: string }
  snapshot: {
    pluginId: string
    pluginVersion: string
    templateId: string
    templateVersion: number
    payloadDigest: string
    compatDigest: string
    seedDigest: string
    selectionDigest: string
    seed: CompilerTemplateSummary['wbsConstraints'] & { projectType: string; objectives: string[] }
  }
}

export interface ListCompilerTemplatesResponse {
  data: CompilerTemplateSummary[]
  meta: { total: number }
}

export interface GetCompilerTemplateResponse {
  data: CompilerTemplateDetail
  meta?: { stale?: boolean; message?: string }
}

/** 列出可用模板候选 */
export async function listCompilerTemplates(): Promise<ListCompilerTemplatesResponse> {
  return api.get('/ai/compiler/templates').json<ListCompilerTemplatesResponse>().then(unwrap)
}

/** 获取模板详情 */
export async function getCompilerTemplateDetail(
  templateId: string,
): Promise<GetCompilerTemplateResponse> {
  return api
    .get(`/ai/compiler/templates/${templateId}`)
    .json<GetCompilerTemplateResponse>()
    .then(unwrap)
}
