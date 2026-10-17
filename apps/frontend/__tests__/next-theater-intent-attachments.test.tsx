import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/lib/api/ai-intent', () => ({
  aiIntentApi: {
    attachment: vi.fn(),
  },
}))

import { aiIntentApi } from '@/lib/api/ai-intent'
import {
  TheaterIntentAttachments,
  appendAttachmentText,
} from '@/components/next/theater/TheaterIntentAttachments'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

const attachment = vi.mocked(aiIntentApi.attachment)

beforeEach(() => {
  useAiProjectDraftStore.getState().setRawInput('做一个社区志愿者小程序')
  useAiProjectDraftStore.getState().setModelSelection({ connectionId: 4, modelId: 12 })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function upload(file: File) {
  fireEvent.change(screen.getByTestId('intent-attachment-input'), { target: { files: [file] } })
}

describe('需求附件', () => {
  it('读出的文字带文件名追加到输入框；超出上限时截断', () => {
    expect(appendAttachmentText('原文', 'a.docx', '附件内容', 100).next).toBe(
      '原文\n\n【附件：a.docx】\n附件内容',
    )
    expect(appendAttachmentText('', 'a.txt', '内容', 100).next).toBe('【附件：a.txt】\n内容')
    const cut = appendAttachmentText('原文', 'a.txt', '很长的内容', 18)
    expect(cut.truncated).toBe(true)
    expect(cut.next.length).toBe(18)
  })

  it('上传 Word：带上当前模型，文字放进输入框并显示读取方式', async () => {
    attachment.mockResolvedValue({
      fileName: '需求.docx',
      kind: 'docx',
      method: 'docx',
      text: '报名需要填写姓名和手机号',
      chars: 12,
      pages: null,
      ocrModel: null,
      warnings: [],
    })
    render(<TheaterIntentAttachments maxChars={50_000} />)
    upload(new File(['x'], '需求.docx'))
    await screen.findByText(/已放进输入框 · 12 字 · Word/)
    expect(attachment).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: '需求.docx', connectionId: 4, modelId: 12 }),
    )
    expect(useAiProjectDraftStore.getState().rawInput).toBe(
      '做一个社区志愿者小程序\n\n【附件：需求.docx】\n报名需要填写姓名和手机号',
    )
  })

  it('图片识别结果提示核对；失败时显示原因、不改输入框', async () => {
    attachment.mockResolvedValueOnce({
      fileName: '白板.png',
      kind: 'image',
      method: 'ocr',
      text: '签到用二维码',
      chars: 6,
      pages: null,
      ocrModel: 'gpt-5.6-luna',
      warnings: [],
    })
    render(<TheaterIntentAttachments maxChars={50_000} />)
    upload(new File(['x'], '白板.png', { type: 'image/png' }))
    await screen.findByText(/gpt-5.6-luna 识别，请核对/)

    // apiFetch 抛的是普通对象
    attachment.mockRejectedValueOnce({
      status: 422,
      code: 'ATTACHMENT_NO_OCR_MODEL',
      message: '组织里没有能识别图片文字的模型',
    })
    const before = useAiProjectDraftStore.getState().rawInput
    upload(new File(['x'], '扫描.png', { type: 'image/png' }))
    await screen.findByText('组织里没有能识别图片文字的模型')
    await waitFor(() => expect(useAiProjectDraftStore.getState().rawInput).toBe(before))
  })
})
