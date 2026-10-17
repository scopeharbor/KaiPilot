/**
 * v2-project-compiler-foundation —— Preview/Apply stub（tasks 9.1, 9.2）。
 *
 * 返回"功能未实现/后续 Draft Layer change 接管"的结构化响应。
 * 不写任何正式业务表。
 * 不提供绕过人工确认的路径。
 */

export interface StubResponse {
  feature: string
  status: 'unimplemented'
  message: string
  responsibleChange: string
}

/**
 * PreviewStub —— 预览 PDM 的存根。
 * Draft Layer change 将接管此接口。
 */
export function previewPdmStub(): StubResponse {
  return {
    feature: 'preview-pdm',
    status: 'unimplemented',
    message: 'PDM 预览功能尚未实现，将由后续 v2-ai-draft-layer-preview-diff-apply change 接管。',
    responsibleChange: 'v2-ai-draft-layer-preview-diff-apply',
  }
}

/**
 * ApplyStub —— 确认并将 PDM 写入正式业务表的存根。
 * Draft Layer change 将接管此接口。
 *
 * 红线 1：绝不写任何正式业务表。
 * 不提供绕过人工确认的路径。
 */
export function applyStub(): StubResponse {
  return {
    feature: 'apply-pdm',
    status: 'unimplemented',
    message:
      'PDM 确认导入功能尚未实现，将由后续 v2-ai-draft-layer-preview-diff-apply change 接管。',
    responsibleChange: 'v2-ai-draft-layer-preview-diff-apply',
  }
}

/**
 * DiffStub —— PDM 差异对比的存根。
 */
export function diffStub(): StubResponse {
  return {
    feature: 'diff-pdm',
    status: 'unimplemented',
    message: 'PDM 差异对比功能尚未实现，将由后续 change 接管。',
    responsibleChange: 'v2-ai-draft-layer-preview-diff-apply',
  }
}
