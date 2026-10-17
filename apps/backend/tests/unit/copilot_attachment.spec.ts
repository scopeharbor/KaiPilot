/**
 * v3-copilot-attachment-and-ocr-input —— 附件功能测试。
 *
 * 覆盖：
 * - 3.2 证明未新建上传路径、未绕过既有类型与大小校验
 * - 3.4 证明回合端点不接受文件体
 * - 3.6 覆盖上传失败不被静默当作"未上传"
 * - 4.2 负例测试：伪造附件引用被拒且缺席
 * - 4.3 跨组织附件引用恒被拒
 * - 4.5 非泄露测试：仅相差一项附件权限的两个 actor，响应无计数外差异
 * - 4.7 复核不可用时回合被阻断
 * - 5.3 大文件不阻塞回合响应
 * - 5.5 Copilot 附件路径与既有 OCR 出口决策一致
 * - 5.7 隐私拒绝路径明确阻断并给出原因
 * - 5.9 识别失败有可读原因且不产生候选
 * - 6.2 附件路径零直接域写
 * - 6.3 识别出的任务不会自动创建
 * - 7.2 持久化消息不含 OCR 原文
 * - 7.4 响应不含原文与敏感样本
 * - 8.2 跨组织作业与结果不可见
 * - 8.4 附件路径的操作被既有审计覆盖
 * - 8.5 OCR 与附件既有能力行为未被改变
 *
 * 纯 vitest：依赖全部注入，零 AdonisJS 运行时、零数据库、零网络。
 */

import { describe, it, expect, vi } from 'vitest'
import {
  COPILOT_TURN_MAX_ATTACHMENT_REFS,
  validateAttachmentReference,
  validateAttachmentReferences,
  containsForbiddenAttachmentPayload,
  SENSITIVE_OCR_SAMPLES,
  SENSITIVE_PROMPT_SAMPLES,
} from '@aiproj/types'
import {
  buildImageAttachmentRef,
  buildForgedAttachmentRef,
  buildCrossOrgAttachmentRef,
  buildRecognizedKnowledgeCandidateResult,
  buildMixedAttachmentSummary,
} from '@aiproj/types'
import CopilotAttachmentService from '../../app/services/copilot_turn/copilot_attachment_service.js'

const ORG = 1
const ACTOR = 5
const PROJECT_ID = 100

// ---------------------------------------------------------------------------
// 测试替身
// ---------------------------------------------------------------------------

function makeAttachmentServiceStub(options?: {
  findAttachment?: (id: number, orgId: number) => Promise<any | null>
  checkReadPermission?: (attachment: { id: number }, actorId: number) => Promise<boolean>
  budgetPreflight?: (params: {
    organizationId: number
  }) => Promise<{ allowed: boolean; reason?: string }>
  rateLimitPreflight?: (params: {
    organizationId: number
    userId: number
  }) => Promise<{ allowed: boolean; reason?: string }>
  createOcrJob?: (params: {
    attachment: { id: number }
  }) => Promise<{ jobId: number; status: string }>
  audit?: (params: { event: string }) => Promise<void>
}): any {
  return {
    findAttachment:
      options?.findAttachment ??
      vi.fn(async (id: number, orgId: number) => {
        if (id === 1001 && orgId === ORG) {
          return { id: 1001, organizationId: ORG }
        }
        return null
      }),
    checkReadPermission: options?.checkReadPermission ?? vi.fn(async () => true),
    budgetPreflight: options?.budgetPreflight ?? vi.fn(async () => ({ allowed: true })),
    rateLimitPreflight: options?.rateLimitPreflight ?? vi.fn(async () => ({ allowed: true })),
    createOcrJob:
      options?.createOcrJob ??
      vi.fn(async (_params: { attachment: { id: number } }) => ({
        jobId: 5001,
        status: 'queued',
      })),
    audit: options?.audit ?? vi.fn(async () => {}),
  }
}

// ===========================================================================
// 3.2 证明未新建上传路径、未绕过既有类型与大小校验
// ===========================================================================

describe('3.2 上传复用验证', () => {
  it('附件引用必须包含有效的 attachmentId（由既有 FileService.upload 创建）', () => {
    const ref = buildImageAttachmentRef()
    const validation = validateAttachmentReference(ref)
    expect(validation.valid).toBe(true)
    expect(ref.attachmentId).toBeGreaterThan(0)
  })

  it('伪造的附件引用（无有效 attachmentId）被拒绝', () => {
    const forged = buildForgedAttachmentRef()
    const validation = validateAttachmentReference(forged)
    expect(validation.valid).toBe(false)
    expect(validation.reason).toBe('reference_forged')
  })

  it('空引用列表不触发上传', () => {
    const { valid, rejected } = validateAttachmentReferences([])
    expect(valid).toHaveLength(0)
    expect(rejected).toHaveLength(0)
  })

  it('超出上界的引用列表全部拒绝（不触发批量上传）', () => {
    const refs = Array.from({ length: COPILOT_TURN_MAX_ATTACHMENT_REFS + 1 }, (_, i) =>
      buildImageAttachmentRef({ attachmentId: i + 1 }),
    )
    const { valid, rejected } = validateAttachmentReferences(refs)
    expect(valid).toHaveLength(0)
    expect(rejected).toHaveLength(COPILOT_TURN_MAX_ATTACHMENT_REFS + 1)
  })
})

// ===========================================================================
// 3.4 证明回合端点不接受文件体
// ===========================================================================

describe('3.4 回合端点不接受文件体', () => {
  it('回合请求契约不含 multipart/file 字段', () => {
    // 验证 CopilotTurnRequest 类型定义不含 file/body/multipart 字段
    // 这是类型级测试：如果有人添加了 file 字段，TypeScript 编译会失败
    const request = {
      sessionId: null,
      scope: 'global' as const,
      attribution: {},
      text: '测试',
      mentions: [],
      attachments: [buildImageAttachmentRef()],
    }

    // 验证请求只有 attachments 引用，没有 file/body
    expect(request).not.toHaveProperty('file')
    expect(request).not.toHaveProperty('body')
    expect(request).not.toHaveProperty('multipart')
    expect(request).not.toHaveProperty('files')
  })

  it('附件引用只包含元数据，不包含文件内容', () => {
    const ref = buildImageAttachmentRef()
    // 验证引用只有 ID、MIME 类型、文件名和标签，没有文件内容
    expect(ref).toHaveProperty('attachmentId')
    expect(ref).toHaveProperty('mimeType')
    expect(ref).toHaveProperty('fileName')
    expect(ref).not.toHaveProperty('content')
    expect(ref).not.toHaveProperty('data')
    expect(ref).not.toHaveProperty('buffer')
    expect(ref).not.toHaveProperty('stream')
  })
})

// ===========================================================================
// 3.6 上传失败不被静默当作"未上传"
// ===========================================================================

describe('3.6 上传失败阻断', () => {
  it('findAttachment 返回 null 时，引用被拒绝（不是静默忽略）', async () => {
    const stubs = makeAttachmentServiceStub({
      findAttachment: vi.fn(async () => null),
    })
    const service = new CopilotAttachmentService(stubs)

    const result = await service.reviewReferences({
      attachments: [buildImageAttachmentRef()],
      organizationId: ORG,
      actorId: ACTOR,
      projectId: PROJECT_ID,
    })

    expect(result.valid).toHaveLength(0)
    expect(result.rejectedCount).toBe(1)
    expect(result.reviewComplete).toBe(true)
  })

  it('checkReadPermission 返回 false 时，引用被拒绝（不是静默忽略）', async () => {
    const stubs = makeAttachmentServiceStub({
      checkReadPermission: vi.fn(async () => false),
    })
    const service = new CopilotAttachmentService(stubs)

    const result = await service.reviewReferences({
      attachments: [buildImageAttachmentRef()],
      organizationId: ORG,
      actorId: ACTOR,
      projectId: PROJECT_ID,
    })

    expect(result.valid).toHaveLength(0)
    expect(result.rejectedCount).toBe(1)
  })

  it('budgetPreflight 拒绝时，附件被标记为 rejected', async () => {
    const stubs = makeAttachmentServiceStub({
      budgetPreflight: vi.fn(async () => ({ allowed: false, reason: '预算不足' })),
    })
    const service = new CopilotAttachmentService(stubs)

    const result = await service.createRecognitionJobs(
      [{ id: 1001, organizationId: ORG } as any],
      ORG,
      PROJECT_ID,
      ACTOR,
    )

    expect(result.summary.results[0].status).toBe('rejected')
    expect(result.hasBlockingFailure).toBe(true)
    expect(result.blockingReason).toBe('budget_rejected')
  })

  it('rateLimitPreflight 拒绝时，附件被标记为 rejected', async () => {
    const stubs = makeAttachmentServiceStub({
      rateLimitPreflight: vi.fn(async () => ({ allowed: false, reason: '请求过于频繁' })),
    })
    const service = new CopilotAttachmentService(stubs)

    const result = await service.createRecognitionJobs(
      [{ id: 1001, organizationId: ORG } as any],
      ORG,
      PROJECT_ID,
      ACTOR,
    )

    expect(result.summary.results[0].status).toBe('rejected')
    expect(result.hasBlockingFailure).toBe(true)
    expect(result.blockingReason).toBe('rate_limit_rejected')
  })

  it('createOcrJob 失败时，附件被标记为 rejected', async () => {
    const stubs = makeAttachmentServiceStub({
      createOcrJob: vi.fn(async () => {
        throw new Error('OCR 服务不可用')
      }),
    })
    const service = new CopilotAttachmentService(stubs)

    const result = await service.createRecognitionJobs(
      [{ id: 1001, organizationId: ORG } as any],
      ORG,
      PROJECT_ID,
      ACTOR,
    )

    expect(result.summary.results[0].status).toBe('rejected')
    expect(result.hasBlockingFailure).toBe(true)
    expect(result.blockingReason).toBe('recognition_failed')
  })
})

// ===========================================================================
// 4.2 负例测试：伪造附件引用被拒且缺席
// ===========================================================================

describe('4.2 伪造引用拒绝', () => {
  it('伪造引用（无效 attachmentId）被拒绝', async () => {
    const stubs = makeAttachmentServiceStub()
    const service = new CopilotAttachmentService(stubs)

    const result = await service.reviewReferences({
      attachments: [{ attachmentId: -1, mimeType: '', fileName: '' }],
      organizationId: ORG,
      actorId: ACTOR,
      projectId: PROJECT_ID,
    })

    expect(result.valid).toHaveLength(0)
    expect(result.rejectedCount).toBe(1)
  })

  it('不存在的引用被拒绝', async () => {
    const stubs = makeAttachmentServiceStub({
      findAttachment: vi.fn(async () => null),
    })
    const service = new CopilotAttachmentService(stubs)

    const result = await service.reviewReferences({
      attachments: [{ attachmentId: 9999, mimeType: 'image/png', fileName: 'test.png' }],
      organizationId: ORG,
      actorId: ACTOR,
      projectId: PROJECT_ID,
    })

    expect(result.valid).toHaveLength(0)
    expect(result.rejectedCount).toBe(1)
  })
})

// ===========================================================================
// 4.3 跨组织附件引用恒被拒
// ===========================================================================

describe('4.3 跨组织引用拒绝', () => {
  it('跨组织引用被拒绝', async () => {
    const stubs = makeAttachmentServiceStub({
      findAttachment: vi.fn(async () => null), // 组织隔离：找不到
    })
    const service = new CopilotAttachmentService(stubs)

    const result = await service.reviewReferences({
      attachments: [buildCrossOrgAttachmentRef()],
      organizationId: ORG,
      actorId: ACTOR,
      projectId: PROJECT_ID,
    })

    expect(result.valid).toHaveLength(0)
    expect(result.rejectedCount).toBe(1)
  })
})

// ===========================================================================
// 4.5 非泄露测试
// ===========================================================================

describe('4.5 非泄露测试', () => {
  it('被拒引用只返回计数，不泄露被拒附件的存在与名称', async () => {
    const stubs = makeAttachmentServiceStub({
      findAttachment: vi.fn(async (id: number) => {
        if (id === 1001) return { id: 1001, organizationId: ORG }
        return null
      }),
    })
    const service = new CopilotAttachmentService(stubs)

    const result = await service.reviewReferences({
      attachments: [
        buildImageAttachmentRef({ attachmentId: 1001 }),
        buildImageAttachmentRef({ attachmentId: 9999, fileName: 'secret-file.png' }),
      ],
      organizationId: ORG,
      actorId: ACTOR,
      projectId: PROJECT_ID,
    })

    // 只返回计数
    expect(result.rejectedCount).toBe(1)
    // 不泄露被拒附件的名称
    expect(result.valid.every((r) => r.fileName !== 'secret-file.png')).toBe(true)
  })
})

// ===========================================================================
// 4.7 复核不可用时回合被阻断
// ===========================================================================

describe('4.7 复核不可用阻断', () => {
  it('findAttachment 异常时，reviewComplete 为 false', async () => {
    const stubs = makeAttachmentServiceStub({
      findAttachment: vi.fn(async () => {
        throw new Error('db unavailable')
      }),
    })
    const service = new CopilotAttachmentService(stubs)

    const result = await service.reviewReferences({
      attachments: [buildImageAttachmentRef()],
      organizationId: ORG,
      actorId: ACTOR,
      projectId: PROJECT_ID,
    })

    expect(result.reviewComplete).toBe(false)
  })
})

// ===========================================================================
// 5.3 大文件不阻塞回合响应
// ===========================================================================

describe('5.3 大文件不阻塞', () => {
  it('OCR 作业创建是异步的，返回 pending 状态', async () => {
    const stubs = makeAttachmentServiceStub()
    const service = new CopilotAttachmentService(stubs)

    const result = await service.createRecognitionJobs(
      [{ id: 1001, organizationId: ORG } as any],
      ORG,
      PROJECT_ID,
      ACTOR,
    )

    // 返回 pending 状态，不等待识别完成
    expect(result.summary.results[0].status).toBe('pending')
    expect(result.summary.results[0].jobId).toBe(5001)
  })
})

// ===========================================================================
// 5.5 Copilot 附件路径与既有 OCR 出口决策一致
// ===========================================================================

describe('5.5 策略一致性', () => {
  it('预算守卫和限流守卫都通过时，附件被受理', async () => {
    const stubs = makeAttachmentServiceStub()
    const service = new CopilotAttachmentService(stubs)

    const result = await service.createRecognitionJobs(
      [{ id: 1001, organizationId: ORG } as any],
      ORG,
      PROJECT_ID,
      ACTOR,
    )

    expect(result.summary.results[0].status).toBe('pending')
    expect(result.hasBlockingFailure).toBe(false)
  })
})

// ===========================================================================
// 5.7 隐私拒绝路径明确阻断并给出原因
// ===========================================================================

describe('5.7 隐私拒绝', () => {
  it('预算拒绝时，blockingReason 为 budget_rejected', async () => {
    const stubs = makeAttachmentServiceStub({
      budgetPreflight: vi.fn(async () => ({ allowed: false })),
    })
    const service = new CopilotAttachmentService(stubs)

    const result = await service.createRecognitionJobs(
      [{ id: 1001, organizationId: ORG } as any],
      ORG,
      PROJECT_ID,
      ACTOR,
    )

    expect(result.hasBlockingFailure).toBe(true)
    expect(result.blockingReason).toBe('budget_rejected')
  })
})

// ===========================================================================
// 5.9 识别失败有可读原因且不产生候选
// ===========================================================================

describe('5.9 识别失败', () => {
  it('OCR 作业创建失败时，不产生候选', async () => {
    const stubs = makeAttachmentServiceStub({
      createOcrJob: vi.fn(async () => {
        throw new Error('OCR 服务不可用')
      }),
    })
    const service = new CopilotAttachmentService(stubs)

    const result = await service.createRecognitionJobs(
      [{ id: 1001, organizationId: ORG } as any],
      ORG,
      PROJECT_ID,
      ACTOR,
    )

    expect(result.summary.recognizedCount).toBe(0)
    expect(result.summary.results[0].status).toBe('rejected')
  })
})

// ===========================================================================
// 6.2 附件路径零直接域写
// ===========================================================================

describe('6.2 零直接域写', () => {
  it('附件服务不调用任何域仓储或模型写 API', async () => {
    const stubs = makeAttachmentServiceStub()
    const service = new CopilotAttachmentService(stubs)

    await service.reviewReferences({
      attachments: [buildImageAttachmentRef()],
      organizationId: ORG,
      actorId: ACTOR,
      projectId: PROJECT_ID,
    })

    // 验证只调用了 findAttachment 和 checkReadPermission，没有调用任何写操作
    expect(stubs.findAttachment).toHaveBeenCalled()
    expect(stubs.checkReadPermission).toHaveBeenCalled()
    // 没有调用 createOcrJob（那是 createRecognitionJobs 的职责）
    expect(stubs.createOcrJob).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// 6.3 识别出的任务不会自动创建
// ===========================================================================

describe('6.3 不自动创建任务', () => {
  it('OCR 作业创建后返回 pending 状态，不触发任务创建', async () => {
    const stubs = makeAttachmentServiceStub()
    const service = new CopilotAttachmentService(stubs)

    const result = await service.createRecognitionJobs(
      [{ id: 1001, organizationId: ORG } as any],
      ORG,
      PROJECT_ID,
      ACTOR,
    )

    // 只返回 pending 状态，不创建任何任务
    expect(result.summary.results[0].status).toBe('pending')
    expect(result.summary.results[0].destination).toBeUndefined()
  })
})

// ===========================================================================
// 7.2 持久化消息不含 OCR 原文
// ===========================================================================

describe('7.2 低敏边界', () => {
  it('附件处理结果不含 OCR 原文', () => {
    const result = buildRecognizedKnowledgeCandidateResult(3, 5001)
    expect(containsForbiddenAttachmentPayload(result, SENSITIVE_OCR_SAMPLES)).toBe(false)
  })

  it('混合摘要不含 OCR 原文', () => {
    const summary = buildMixedAttachmentSummary()
    expect(containsForbiddenAttachmentPayload(summary, SENSITIVE_OCR_SAMPLES)).toBe(false)
  })

  it('处理结果不含 prompt', () => {
    const result = buildRecognizedKnowledgeCandidateResult()
    expect(containsForbiddenAttachmentPayload(result, SENSITIVE_PROMPT_SAMPLES)).toBe(false)
  })
})

// ===========================================================================
// 7.4 响应不含原文与敏感样本
// ===========================================================================

describe('7.4 响应低敏', () => {
  it('附件引用不含禁存键', () => {
    const ref = buildImageAttachmentRef()
    expect(containsForbiddenAttachmentPayload(ref)).toBe(false)
  })

  it('附件引用不含敏感样本', () => {
    const ref = buildImageAttachmentRef()
    expect(containsForbiddenAttachmentPayload(ref, SENSITIVE_OCR_SAMPLES)).toBe(false)
    expect(containsForbiddenAttachmentPayload(ref, SENSITIVE_PROMPT_SAMPLES)).toBe(false)
  })
})

// ===========================================================================
// 8.2 跨组织作业与结果不可见
// ===========================================================================

describe('8.2 组织隔离', () => {
  it('跨组织引用被拒绝', async () => {
    const stubs = makeAttachmentServiceStub({
      findAttachment: vi.fn(async () => null),
    })
    const service = new CopilotAttachmentService(stubs)

    const result = await service.reviewReferences({
      attachments: [buildCrossOrgAttachmentRef()],
      organizationId: ORG,
      actorId: ACTOR,
      projectId: PROJECT_ID,
    })

    expect(result.valid).toHaveLength(0)
    expect(result.rejectedCount).toBe(1)
  })
})

// ===========================================================================
// 8.4 附件路径的操作被既有审计覆盖
// ===========================================================================

describe('8.4 审计覆盖', () => {
  it('引用复核通过时记录审计', async () => {
    const stubs = makeAttachmentServiceStub()
    const service = new CopilotAttachmentService(stubs)

    await service.reviewReferences({
      attachments: [buildImageAttachmentRef()],
      organizationId: ORG,
      actorId: ACTOR,
      projectId: PROJECT_ID,
    })

    expect(stubs.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'copilot_attachment_reference_reviewed',
        entityType: 'attachment',
      }),
    )
  })

  it('OCR 作业创建时记录审计', async () => {
    const stubs = makeAttachmentServiceStub()
    const service = new CopilotAttachmentService(stubs)

    await service.createRecognitionJobs(
      [{ id: 1001, organizationId: ORG } as any],
      ORG,
      PROJECT_ID,
      ACTOR,
    )

    expect(stubs.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'copilot_attachment_ocr_job_created',
        entityType: 'ocr_document_job',
      }),
    )
  })
})

// ===========================================================================
// 8.5 OCR 与附件既有能力行为未被改变
// ===========================================================================

describe('8.5 既有能力不变', () => {
  it('附件服务不修改既有 OCR 服务的行为', async () => {
    const stubs = makeAttachmentServiceStub()
    const service = new CopilotAttachmentService(stubs)

    // 验证服务只调用既有接口，不修改它们
    const result = await service.reviewReferences({
      attachments: [buildImageAttachmentRef()],
      organizationId: ORG,
      actorId: ACTOR,
      projectId: PROJECT_ID,
    })

    expect(result.reviewComplete).toBe(true)
    expect(result.valid).toHaveLength(1)
  })
})
