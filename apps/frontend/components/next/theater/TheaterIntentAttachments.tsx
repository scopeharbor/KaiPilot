'use client'

import * as React from 'react'
import { AlertCircle, FileText, Loader2, Paperclip, X } from 'lucide-react'
import { aiIntentApi, type RequirementAttachmentResult } from '@/lib/api/ai-intent'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

/** 可上传的格式（与后端 requirement_attachment_service 一致）。 */
export const ATTACHMENT_ACCEPT = '.docx,.pdf,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp'
export const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024
/** 图片交给识别的上限；更大的先在浏览器里压缩。 */
const IMAGE_MAX_BYTES = 2 * 1024 * 1024
const IMAGE_MAX_EDGE = 2000

type Item =
  | { id: number; fileName: string; state: 'reading' }
  | { id: number; fileName: string; state: 'done'; result: RequirementAttachmentResult }
  | { id: number; fileName: string; state: 'failed'; message: string }

const METHOD_LABEL: Record<RequirementAttachmentResult['method'], string> = {
  text: '文本',
  docx: 'Word',
  pdf_text: 'PDF 文字',
  ocr: '图片识别',
}

/** 附件读出来的文字追加到需求原文末尾，带上文件名方便用户对照、删改。 */
export function appendAttachmentText(
  rawInput: string,
  fileName: string,
  text: string,
  max: number,
): { next: string; truncated: boolean } {
  const head = `${rawInput.trimEnd()}${rawInput.trim() ? '\n\n' : ''}【附件：${fileName}】\n`
  const room = max - head.length
  if (room <= 0) return { next: rawInput, truncated: true }
  return { next: head + text.slice(0, room), truncated: text.length > room }
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

function readFileBuffer(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsArrayBuffer(file)
  })
}

/** 大图压到长边 2000px 的 JPEG，识别够用、也不超过上传上限。 */
async function shrinkImage(file: File): Promise<{ buffer: ArrayBuffer; fileName: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85),
  )
  if (!blob) throw new Error('图片压缩失败')
  return { buffer: await readFileBuffer(blob), fileName: file.name.replace(/\.[^.]+$/, '.jpg') }
}

export function TheaterIntentAttachments({
  disabled,
  maxChars,
}: {
  disabled?: boolean
  maxChars: number
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [items, setItems] = React.useState<Item[]>([])
  const seq = React.useRef(0)
  const reading = items.some((item) => item.state === 'reading')

  const update = (id: number, next: Item) =>
    setItems((current) => current.map((item) => (item.id === id ? next : item)))

  const readOne = async (file: File) => {
    const id = ++seq.current
    setItems((current) => [...current, { id, fileName: file.name, state: 'reading' }])
    try {
      if (file.size > ATTACHMENT_MAX_BYTES)
        throw new Error('文件超过 15 MB，请拆小或只上传需要的部分')
      let buffer = await readFileBuffer(file)
      let fileName = file.name
      if (file.type.startsWith('image/') && file.size > IMAGE_MAX_BYTES) {
        ;({ buffer, fileName } = await shrinkImage(file))
      }
      const selection = useAiProjectDraftStore.getState().modelSelection
      const result = await aiIntentApi.attachment({
        fileName,
        dataBase64: toBase64(buffer),
        ...(selection ? { connectionId: selection.connectionId, modelId: selection.modelId } : {}),
      })
      const store = useAiProjectDraftStore.getState()
      const { next, truncated } = appendAttachmentText(
        store.rawInput,
        file.name,
        result.text,
        maxChars,
      )
      store.setRawInput(next)
      update(id, {
        id,
        fileName: file.name,
        state: 'done',
        result: truncated
          ? {
              ...result,
              warnings: [
                ...result.warnings,
                `输入框已接近 ${maxChars.toLocaleString()} 字上限，只放进了一部分`,
              ],
            }
          : result,
      })
    } catch (error) {
      update(id, {
        id,
        fileName: file.name,
        state: 'failed',
        // apiFetch 抛的是 { status, code, message } 普通对象，不是 Error
        message:
          (error as { message?: unknown } | null)?.message &&
          typeof (error as { message?: unknown }).message === 'string'
            ? (error as { message: string }).message
            : '读取失败，请稍后重试',
      })
    }
  }

  return (
    <div data-intent-attachments className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        data-testid="intent-attachment-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          // 逐个读，保证追加进输入框的顺序与选择顺序一致
          void files.reduce((chain, file) => chain.then(() => readOne(file)), Promise.resolve())
        }}
      />
      <button
        type="button"
        disabled={disabled || reading}
        onClick={() => inputRef.current?.click()}
        title="上传需求文件：Word（.docx）、PDF、文本或图片；读出的文字会放进输入框，你可以先看、再改"
        className="inline-flex w-fit items-center gap-1.5 font-sans text-xs text-[var(--nx-text-secondary)] underline-offset-2 transition-colors hover:text-[var(--nx-text-primary)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
      >
        {reading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
        )}
        {reading ? '正在读取附件…' : '添加附件（Word / PDF / 文本 / 图片）'}
      </button>
      {items.length > 0 ? (
        <ul className="flex flex-col gap-1.5" aria-label="已添加的附件">
          {items.map((item) => (
            <li
              key={item.id}
              data-attachment-state={item.state}
              className="flex items-start gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1.5 text-xs text-[var(--nx-text-secondary)]"
            >
              {item.state === 'failed' ? (
                <AlertCircle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--nx-status-danger)]"
                  aria-hidden
                />
              ) : item.state === 'reading' ? (
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
              ) : (
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[var(--nx-text-primary)]" title={item.fileName}>
                  {item.fileName}
                </p>
                {item.state === 'reading' ? (
                  <p>正在读取文字…（图片和扫描件要识别，会慢一些）</p>
                ) : null}
                {item.state === 'failed' ? (
                  <p className="text-[var(--nx-status-danger)]">{item.message}</p>
                ) : null}
                {item.state === 'done' ? (
                  <>
                    <p>
                      已放进输入框 · {item.result.chars.toLocaleString()} 字 ·{' '}
                      {METHOD_LABEL[item.result.method]}
                      {item.result.pages ? ` · ${item.result.pages} 页` : ''}
                      {item.result.ocrModel ? `（${item.result.ocrModel} 识别，请核对）` : ''}
                    </p>
                    {item.result.warnings.map((warning) => (
                      <p
                        key={warning}
                        className="text-[var(--nx-status-warning,var(--nx-text-secondary))]"
                      >
                        {warning}
                      </p>
                    ))}
                  </>
                ) : null}
              </div>
              {item.state !== 'reading' ? (
                <button
                  type="button"
                  aria-label={`移除 ${item.fileName} 的提示`}
                  onClick={() =>
                    setItems((current) => current.filter((other) => other.id !== item.id))
                  }
                  className="shrink-0 text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
