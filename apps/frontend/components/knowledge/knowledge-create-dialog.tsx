'use client'

/**
 * v3-four-layer-knowledge-system —— KnowledgeCreateDialog。
 *
 * L1/L2 知识录入弹窗。AI 结构化结果仅产待审草案，需人工确认才转为 active。
 *
 * 权限感知：knowledge:author 控制创建能力。
 */
import { useState } from 'react'
import { useCreateKnowledge, useStructureKnowledge } from '@/hooks/use-knowledge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import type { CreateKnowledgeRequest } from '@aiproj/types'

interface Props {
  open: boolean
  onClose: () => void
}

export function KnowledgeCreateDialog({ open, onClose }: Props) {
  const createMutation = useCreateKnowledge()
  const structureMutation = useStructureKnowledge()

  const [layer, setLayer] = useState<'L1' | 'L2'>('L1')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [domain, setDomain] = useState('')
  const [purpose, setPurpose] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [sourceTitle, setSourceTitle] = useState('')
  const [rawText, setRawText] = useState('')
  const [structuring, setStructuring] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resetForm = () => {
    setTitle('')
    setContent('')
    setDomain('')
    setPurpose('')
    setSourceId('')
    setSourceTitle('')
    setRawText('')
    setError(null)
  }

  const handleCreate = async () => {
    setError(null)
    try {
      const body: CreateKnowledgeRequest = {
        layer,
        title,
        content: content || { raw: rawText || '' },
        domain: domain || '通用',
        purpose: purpose || '参考',
        provenance: {
          sources: [
            {
              layer,
              sourceId: sourceId || `manual-${Date.now()}`,
              title: sourceTitle || title || '手动录入',
            },
          ],
        },
      }
      await createMutation.mutateAsync(body)
      resetForm()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleStructure = async () => {
    if (!rawText.trim()) return
    setStructuring(true)
    setError(null)
    try {
      const result = await structureMutation.mutateAsync({
        rawText: rawText.trim(),
        domain: domain || undefined,
      })
      // AI 结构化结果仅为候选草案，用户仍需人工确认
      if (
        result &&
        'candidates' in result &&
        Array.isArray(result.candidates) &&
        result.candidates.length > 0
      ) {
        const c = result.candidates[0] as {
          title: string
          content: string | Record<string, unknown>
          domain: string
          purpose: string
        }
        setTitle(c.title)
        setContent(typeof c.content === 'string' ? c.content : JSON.stringify(c.content, null, 2))
        setDomain(c.domain)
        setPurpose(c.purpose)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStructuring(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          resetForm()
          onClose()
        }
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新建知识</DialogTitle>
          <DialogDescription>
            录入 L1 规范知识或 L2 观察知识。AI 结构化结果仅产待审草案。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* 层级选择 */}
          <div>
            <label className="text-sm font-medium">层级</label>
            <Select value={layer} onValueChange={(v) => setLayer(v as 'L1' | 'L2')}>
              <SelectTrigger aria-label="层级">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="L1">L1 规范</SelectItem>
                <SelectItem value="L2">L2 观察</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              L3 由合成治理生成，L4 由产品自动采集，不可手动创建。
            </p>
          </div>

          {/* AI 结构化输入 */}
          <div>
            <label className="text-sm font-medium">AI 结构化（可选）</label>
            <Textarea
              placeholder="在此粘贴原文，AI 将自动提取结构化知识草案…"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={4}
            />
            <div className="flex justify-end mt-2">
              <Button
                variant="outline"
                onClick={handleStructure}
                disabled={!rawText.trim() || structuring}
                size="sm"
              >
                {structuring ? (
                  <>
                    <LoadingSpinner className="mr-1 h-4 w-4" />
                    结构化中…
                  </>
                ) : (
                  'AI 结构化'
                )}
              </Button>
            </div>
          </div>

          {/* 基本信息 */}
          <div>
            <label className="text-sm font-medium">标题</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="知识标题"
            />
          </div>

          <div>
            <label className="text-sm font-medium">内容</label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={layer === 'L1' ? '规范内容…' : '观察内容…'}
              rows={6}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">领域</label>
              <Input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="如：进度管理"
              />
            </div>
            <div>
              <label className="text-sm font-medium">用途</label>
              <Input
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="如：规划 / 监控"
              />
            </div>
          </div>

          {/* 来源信息 */}
          <div>
            <label className="text-sm font-medium">来源（必填）</label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                placeholder="来源 ID"
              />
              <Input
                value={sourceTitle}
                onChange={(e) => setSourceTitle(e.target.value)}
                placeholder="来源标题"
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-500 bg-red-50 dark:bg-red-950 rounded p-3">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                resetForm()
                onClose()
              }}
            >
              取消
            </Button>
            <Button onClick={handleCreate} disabled={!title.trim() || createMutation.isPending}>
              {createMutation.isPending ? (
                <>
                  <LoadingSpinner className="mr-1 h-4 w-4" />
                  创建中…
                </>
              ) : (
                '创建（草稿）'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
