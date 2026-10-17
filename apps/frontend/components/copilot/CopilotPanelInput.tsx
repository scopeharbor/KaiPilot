'use client'

import * as React from 'react'
import { ArrowUp, Globe, Loader2, Paperclip, X } from 'lucide-react'
import type { CommandDescriptor, MentionReference, CopilotAttachmentReference } from '@aiproj/types'
import { MENTION_TRIGGER, COMMAND_TRIGGER } from '@aiproj/types'
import { useCopilotStore } from '@/stores/copilot-store'
import { cancelCopilotDemo } from '@/lib/copilot/demo'
import { submitCopilotTurn } from '@/lib/copilot/submit'
import { useCopilotCompletions } from '@/hooks/use-copilot-completions'
import { attachmentsApi } from '@/lib/api/files'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'
import { MentionCompletion } from './MentionCompletion'
import { SlashCommandCompletion } from './SlashCommandCompletion'

// ===========================================================================
// 补全类型
// ===========================================================================

type CompletionKind = 'mention' | 'command' | null

/** Copilot 附件支持的 MIME 类型。 */
const SUPPORTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']

/** 最大附件大小 10MB（与既有 FileService 一致）。 */
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024

/** 单回合最大附件数。 */
const MAX_ATTACHMENTS = 5

// ===========================================================================
// 组件
// ===========================================================================

/**
 * 面板输入区（spec copilot-sidebar-shell / 任务 2.4、2.9）。
 *
 * 集成 @ 提及补全、/ 命令补全与附件上传。
 * - `Cmd/Ctrl + Enter` 提交：**仅面板输入聚焦时触发**；
 * - 流式中禁用提交（先取消再提交）；
 * - 底部输入在移动端贴拇指区（任务 6.8 由容器布局保证）。
 * - 附件上传走既有附件通道，不新建上传路径（v3-copilot-attachment-and-ocr-input D1）。
 */
export function CopilotPanelInput() {
  const draft = useCopilotStore((s) => s.draft)
  const setDraft = useCopilotStore((s) => s.setDraft)
  const streaming = useCopilotStore((s) => s.streaming)
  const mode = useCopilotStore((s) => s.mode)

  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  React.useEffect(() => {
    const focusInput = () => inputRef.current?.focus()
    window.addEventListener('copilot:focus-input', focusInput)
    return () => window.removeEventListener('copilot:focus-input', focusInput)
  }, [])

  // 补全状态
  const [completionActive, setCompletionActive] = React.useState<boolean>(false)
  const [completionKind, setCompletionKind] = React.useState<CompletionKind>(null)
  const [completionPrefix, setCompletionPrefix] = React.useState<string>('')
  const [triggerOffset, setTriggerOffset] = React.useState<number>(0)

  // 结构化引用
  const [selectedMentions, setSelectedMentions] = React.useState<readonly MentionReference[]>([])

  // 附件状态（v3-copilot-attachment-and-ocr-input）
  const [attachments, setAttachments] = React.useState<readonly CopilotAttachmentReference[]>([])
  const [uploading, setUploading] = React.useState<boolean>(false)
  const [uploadError, setUploadError] = React.useState<string | null>(null)

  // 按次网页搜索同意（v3-copilot-optional-web-search-configuration）
  // 默认关闭；提交后自动复位（本次同意只作用于本回合）。
  const [webSearchConsent, setWebSearchConsent] = React.useState<boolean>(false)

  // v3-copilot-inline-triggers：监听内联触发事件，注入引用到面板输入
  const handleInlineTrigger = React.useCallback(
    (detail: { mention: MentionReference; currentRoute: string }) => {
      setSelectedMentions((prev) => [...prev, detail.mention])
      // 预置引用文本到草稿
      const mentionText = `@${detail.mention.label}`
      const currentDraft = useCopilotStore.getState().draft
      setDraft(currentDraft ? `${currentDraft} ${mentionText}` : mentionText)
    },
    [setDraft],
  )

  React.useEffect(() => {
    function handleInlineTriggerEvent(event: Event) {
      const customEvent = event as CustomEvent<{ mention: MentionReference; currentRoute: string }>
      if (customEvent.detail) {
        handleInlineTrigger(customEvent.detail)
      }
    }
    window.addEventListener('copilot:inline-trigger', handleInlineTriggerEvent)
    return () => {
      window.removeEventListener('copilot:inline-trigger', handleInlineTriggerEvent)
    }
  }, [handleInlineTrigger])

  // / 命令候选与 @ 查询：接真实来源
  const { slashCommands, queryMentions, currentRoute } = useCopilotCompletions()

  // 选中的显式斜杠命令——路由规则管线最高优先级的唯一入口
  const [slashCommand, setSlashCommand] = React.useState<string | undefined>(undefined)

  // 检测触发字符
  const detectTrigger = React.useCallback(
    (value: string, cursorPos: number) => {
      if (cursorPos <= 0) {
        setCompletionActive(false)
        setCompletionKind(null)
        return
      }

      const textBeforeCursor = value.slice(0, cursorPos)
      const lastChar = textBeforeCursor[cursorPos - 1]

      // 检测 @ 触发
      if (lastChar === MENTION_TRIGGER) {
        setCompletionActive(true)
        setCompletionKind('mention')
        setCompletionPrefix('')
        setTriggerOffset(cursorPos - 1)
        return
      }

      // 检测 / 触发（仅在文本开头或空格后）
      if (lastChar === COMMAND_TRIGGER) {
        const charBefore = cursorPos >= 2 ? textBeforeCursor[cursorPos - 2] : ' '
        if (charBefore === ' ' || cursorPos === 1) {
          setCompletionActive(true)
          setCompletionKind('command')
          setCompletionPrefix('')
          setTriggerOffset(cursorPos - 1)
          return
        }
      }

      // 如果在补全中，更新前缀
      if (completionActive && completionKind) {
        const textFromTrigger = textBeforeCursor.slice(triggerOffset + 1)
        // 前缀中不应包含空格（空格结束补全）
        if (textFromTrigger.includes(' ') || textFromTrigger.includes('\n')) {
          setCompletionActive(false)
          setCompletionKind(null)
          return
        }
        setCompletionPrefix(textFromTrigger)
      }
    },
    [completionActive, completionKind, triggerOffset],
  )

  // 处理输入变更
  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      setDraft(newValue)

      const cursorPos = e.target.selectionStart ?? newValue.length
      detectTrigger(newValue, cursorPos)
    },
    [setDraft, detectTrigger],
  )

  // 选中提及候选
  const handleMentionSelect = React.useCallback(
    (ref: MentionReference) => {
      const textarea = inputRef.current
      if (!textarea) return

      const value = draft
      const insertPos = triggerOffset
      const before = value.slice(0, insertPos)
      const after = value.slice(insertPos + 1) // 跳过 @
      const displayText = ref.label

      const newValue = `${before}${displayText} ${after}`
      setDraft(newValue)
      setSelectedMentions((prev) => [...prev, ref])

      // 关闭补全
      setCompletionActive(false)
      setCompletionKind(null)

      // 恢复焦点
      requestAnimationFrame(() => {
        textarea.focus()
        const newPos = insertPos + displayText.length + 1
        textarea.setSelectionRange(newPos, newPos)
      })
    },
    [draft, triggerOffset, setDraft],
  )

  // 选中命令候选
  const handleCommandSelect = React.useCallback(
    (cmd: CommandDescriptor) => {
      const textarea = inputRef.current
      if (!textarea) return

      const value = draft
      const insertPos = triggerOffset
      const before = value.slice(0, insertPos)
      const after = value.slice(insertPos + 1) // 跳过 /
      const fillText = cmd.fillText

      const newValue = `${before}${fillText} ${after}`
      setDraft(newValue)

      // 记录显式斜杠命令：提交时随请求带出，使规则管线最高优先级被走到
      setSlashCommand(cmd.routingKey || fillText)

      // 关闭补全
      setCompletionActive(false)
      setCompletionKind(null)

      // 恢复焦点
      requestAnimationFrame(() => {
        textarea.focus()
        const newPos = insertPos + fillText.length + 1
        textarea.setSelectionRange(newPos, newPos)
      })
    },
    [draft, triggerOffset, setDraft],
  )

  // 取消补全
  const handleCancelCompletion = React.useCallback(() => {
    setCompletionActive(false)
    setCompletionKind(null)
  }, [])

  // =========================================================================
  // 附件上传（v3-copilot-attachment-and-ocr-input D1）
  // =========================================================================

  /**
   * 处理文件选择：走既有附件上传通道，不新建上传路径。
   * 上传成功后将 Attachment 转换为 CopilotAttachmentReference。
   */
  const handleFileSelect = React.useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      // 重置 input 值以允许重复选择同一文件
      e.target.value = ''

      // 类型校验（前端预检，与后端一致）
      if (!SUPPORTED_MIME_TYPES.includes(file.type)) {
        setUploadError('仅支持图片（PNG/JPEG/WebP）和 PDF 文件')
        return
      }

      // 大小校验（前端预检，与后端一致）
      if (file.size > MAX_ATTACHMENT_SIZE) {
        setUploadError(`文件大小超过限制（最大 ${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB）`)
        return
      }

      // 附件数上界
      if (attachments.length >= MAX_ATTACHMENTS) {
        setUploadError(`最多上传 ${MAX_ATTACHMENTS} 个附件`)
        return
      }

      setUploading(true)
      setUploadError(null)

      try {
        // 从当前路由推导 projectId
        const projectMatch = /^\/projects\/(\d+)/.exec(currentRoute)
        if (!projectMatch) {
          setUploadError('请在项目页面内上传附件')
          return
        }
        const projectId = Number(projectMatch[1])

        // 走既有附件上传通道（FileService.upload）
        const uploaded = await attachmentsApi.upload(
          projectId,
          {
            entityType: 'copilot_attachment',
            entityId: 0, // Copilot 附件不关联具体实体
          },
          file,
        )

        // 转换为附件引用
        const ref: CopilotAttachmentReference = {
          attachmentId: uploaded.id,
          mimeType: uploaded.mimeType ?? file.type,
          fileName: uploaded.fileName,
          label: file.name,
        }

        setAttachments((prev) => [...prev, ref])
      } catch (err) {
        const message =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message: unknown }).message)
            : '上传失败'
        setUploadError(message)
      } finally {
        setUploading(false)
      }
    },
    [attachments.length, currentRoute],
  )

  /** 移除已选附件。 */
  const handleRemoveAttachment = React.useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  /** 触发文件选择对话框。 */
  const handleAttachmentClick = React.useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  // =========================================================================
  // 提交
  // =========================================================================

  // 提交：走真实回合端点，携带结构化引用、附件引用与显式斜杠命令
  const handleSubmit = React.useCallback(() => {
    if (streaming) return

    void submitCopilotTurn({
      text: draft,
      mentions: selectedMentions,
      attachments: attachments.length > 0 ? attachments : undefined,
      slashCommand,
      currentRoute,
      webSearchConsent,
    })

    // 重置状态
    setSelectedMentions([])
    setAttachments([])
    setSlashCommand(undefined)
    setCompletionActive(false)
    setCompletionKind(null)
    setUploadError(null)
    // 按次同意：提交后复位，下一次提问默认不联网
    setWebSearchConsent(false)
  }, [
    draft,
    selectedMentions,
    attachments,
    slashCommand,
    currentRoute,
    streaming,
    webSearchConsent,
  ])

  // 键盘处理
  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      handleSubmit()
    }
  }

  // 点击外部关闭补全
  React.useEffect(() => {
    if (!completionActive) return

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('[data-copilot-completion]')) {
        setCompletionActive(false)
        setCompletionKind(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside, true)
    return () => document.removeEventListener('mousedown', handleClickOutside, true)
  }, [completionActive])

  return (
    <div className="border-t border-border bg-gray-0 px-3 py-2.5" data-copilot-input-area>
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept={SUPPORTED_MIME_TYPES.join(',')}
        onChange={handleFileSelect}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        data-copilot-attachment-input
      />

      <div className="relative flex items-end gap-2" data-copilot-completion>
        {/* @ 提及补全 */}
        {completionKind === 'mention' && (
          <MentionCompletion
            active={completionActive}
            prefix={completionPrefix}
            triggerOffset={triggerOffset}
            onSelect={handleMentionSelect}
            queryFn={queryMentions}
            onCancel={handleCancelCompletion}
            textareaRef={inputRef}
          />
        )}

        {/* / 命令补全 */}
        {completionKind === 'command' && (
          <SlashCommandCompletion
            active={completionActive}
            prefix={completionPrefix}
            commands={slashCommands}
            onSelect={handleCommandSelect}
            onCancel={handleCancelCompletion}
          />
        )}

        {/* 附件按钮（v3-copilot-attachment-and-ocr-input D1） */}
        <button
          type="button"
          data-copilot-attachment-button
          onClick={handleAttachmentClick}
          disabled={uploading || streaming || attachments.length >= MAX_ATTACHMENTS}
          aria-label="添加附件"
          title="添加附件（图片或 PDF）"
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-40',
            focusRing,
          )}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Paperclip className="h-4 w-4" aria-hidden />
          )}
        </button>

        <textarea
          ref={inputRef}
          data-copilot-input
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="输入你的问题…（Cmd/Ctrl + Enter 提交）"
          aria-label="AI Copilot 输入框"
          aria-expanded={completionActive}
          aria-haspopup="listbox"
          className={cn(
            'max-h-28 min-h-[38px] flex-1 resize-none rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-gray-800 outline-none placeholder:text-placeholder',
            focusRing,
          )}
        />

        {/* 已选提及标签 */}
        {selectedMentions.length > 0 && (
          <div className="flex flex-wrap gap-1" aria-label="已选实体引用">
            {selectedMentions.map((ref, i) => (
              <span
                key={`${ref.entityType}:${ref.entityId}`}
                className="inline-flex items-center gap-0.5 rounded bg-[var(--primary-50)] px-1.5 py-0.5 text-[10px] text-[var(--primary-600)]"
              >
                {ref.label}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMentions((prev) => prev.filter((_, idx) => idx !== i))
                  }}
                  className="ml-0.5 text-[var(--primary-400)] hover:text-[var(--primary-600)]"
                  aria-label={`移除 ${ref.label}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {streaming ? (
          <button
            type="button"
            data-copilot-cancel-input
            onClick={cancelCopilotDemo}
            aria-label="取消生成"
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-gray-500 transition-colors hover:bg-gray-100',
              focusRing,
            )}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            data-copilot-submit
            onClick={handleSubmit}
            disabled={draft.trim().length === 0 || streaming}
            aria-label="提交"
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary-500)] text-white transition-opacity disabled:opacity-40',
              focusRing,
            )}
          >
            <ArrowUp className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      {/* 按次网页搜索同意（v3-copilot-optional-web-search-configuration） */}
      <div
        className="mt-1.5 flex items-center justify-between gap-2"
        data-copilot-web-search-toggle
      >
        <label
          htmlFor="copilot-web-search-consent"
          className="flex min-w-0 items-center gap-1.5 text-[11px] text-gray-500"
        >
          <Globe className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">
            {webSearchConsent
              ? '本次允许联网搜索：可能发送你问题涉及的主题；组织域名策略与额度适用；外部来源会带引用标记'
              : '允许本次使用网页搜索'}
          </span>
        </label>
        <button
          id="copilot-web-search-consent"
          type="button"
          role="switch"
          aria-checked={webSearchConsent}
          disabled={streaming}
          onClick={() => setWebSearchConsent((prev) => !prev)}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40',
            webSearchConsent ? 'bg-primary-600' : 'bg-gray-200',
            focusRing,
          )}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform',
              webSearchConsent ? 'translate-x-4' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      {/* 已选附件标签（v3-copilot-attachment-and-ocr-input D1） */}
      {attachments.length > 0 && (
        <div
          className="mt-1.5 flex flex-wrap gap-1"
          data-copilot-attachment-chips
          aria-label="已选附件"
        >
          {attachments.map((ref, i) => (
            <span
              key={ref.attachmentId}
              className="inline-flex items-center gap-0.5 rounded bg-[var(--primary-50)] px-1.5 py-0.5 text-[10px] text-[var(--primary-600)]"
            >
              <Paperclip className="h-2.5 w-2.5" aria-hidden />
              {ref.label ?? ref.fileName}
              <button
                type="button"
                onClick={() => handleRemoveAttachment(i)}
                className="ml-0.5 text-[var(--primary-400)] hover:text-[var(--primary-600)]"
                aria-label={`移除附件 ${ref.label ?? ref.fileName}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 上传错误提示 */}
      {uploadError && (
        <p className="mt-1 text-[10px] text-red-500" data-copilot-attachment-error role="alert">
          {uploadError}
        </p>
      )}

      {streaming && (
        <p
          className="mt-1.5 flex items-center gap-1 text-[10px] text-gray-400"
          data-copilot-stream-hint
        >
          <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden />
          {mode === 'demonstration' ? '正在生成演示答复…' : '正在生成 AI 答复…'}
        </p>
      )}
    </div>
  )
}
