'use client'

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Switch } from '@/components/ui/Switch'
import { Badge } from '@/components/ui/Badge'
import { useToast } from '@/components/ui/Toast'
import { useCreateCustomView } from '@/hooks/use-custom-views'
import type { CustomViewBaseType, CustomViewConfig, CustomViewVisibility } from '@aiproj/types'

const BASE_VIEW_LABELS: Record<CustomViewBaseType, string> = {
  kanban: '看板',
  list: '列表',
  calendar: '日历',
  gantt: '甘特图',
  wbs: 'WBS',
  resource: '资源',
}

interface SaveViewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  baseViewType: CustomViewBaseType
  currentConfig: CustomViewConfig | null
}

/**
 * 保存视图对话框（v2-custom-views-view-config）。
 *
 * 用户将当前视图配置保存为命名视图：
 * - 视图名称（必填）
 * - 可见范围切换（个人/共享）
 * - 当前基础视图类型（只读提示）
 * - 保存/取消按钮
 */
export function SaveViewDialog({
  open,
  onOpenChange,
  projectId,
  baseViewType,
  currentConfig,
}: SaveViewDialogProps) {
  const [name, setName] = React.useState('')
  const [visibility, setVisibility] = React.useState<CustomViewVisibility>('personal')
  const createView = useCreateCustomView(projectId)
  const { toast } = useToast()

  // 每次打开对话框时重置表单
  React.useEffect(() => {
    if (open) {
      setName('')
      setVisibility('personal')
    }
  }, [open])

  async function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast({ variant: 'error', title: '请输入视图名称' })
      return
    }
    if (!currentConfig) {
      toast({ variant: 'error', title: '无法获取当前视图配置' })
      return
    }

    try {
      await createView.mutateAsync({
        name: trimmedName,
        baseViewType,
        visibility,
        config: currentConfig,
      })
      onOpenChange(false)
    } catch {
      // 错误已由 mutation 的 onError 处理
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !createView.isPending) {
      void handleSave()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-describedby="save-view-description">
        <DialogHeader>
          <DialogTitle>保存当前视图</DialogTitle>
          <DialogDescription id="save-view-description">
            将当前筛选和显示设置保存为命名视图，方便后续快速切换。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 视图名称 */}
          <div className="space-y-1.5">
            <Label htmlFor="view-name">视图名称</Label>
            <Input
              id="view-name"
              placeholder="例：里程碑视图、我的待办"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              aria-required="true"
              maxLength={64}
            />
          </div>

          {/* 基础视图类型（只读提示） */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">基础视图</span>
            <Badge variant="neutral">{BASE_VIEW_LABELS[baseViewType]}</Badge>
          </div>

          {/* 可见范围切换 */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="view-visibility">共享给团队</Label>
              <p className="text-xs text-gray-500">共享视图对项目内所有成员可见</p>
            </div>
            <Switch
              id="view-visibility"
              checked={visibility === 'shared'}
              onCheckedChange={(checked) => setVisibility(checked ? 'shared' : 'personal')}
              aria-label="切换共享状态"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} loading={createView.isPending}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
