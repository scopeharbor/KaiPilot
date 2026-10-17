'use client'

/**
 * BI 报表模板库页面（v3-bi-report-template-library §6.2-6.4）。
 *
 * 功能：
 *   - 按场景分类的模板卡片目录
 *   - 模板详情（构成说明 + 数据源 freshness + 权限脱敏提示）
 *   - 预览视图（分块渲染 + partial/warning/redaction 安全降级）
 *   - 「从模板创建」入口（复用既有报表工作台确认流 + 降级路径）
 *   - 另存为/编辑副本/归档 UI
 */
import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { Skeleton } from '@/components/ui/Skeleton'
import { BiTemplateCard } from './BiTemplateCard'
import { BiTemplatePreviewView } from './BiTemplatePreviewView'
import {
  useBiTemplates,
  useBiTemplate,
  useBiTemplatePreview,
  useInstantiateBiTemplate,
  useSaveBiTemplateCopy,
} from '@/hooks/use-bi-report-templates'
import type { BiTemplateEntry } from '@aiproj/types'
import { FileText, Copy, Eye } from 'lucide-react'

const SCENARIO_TABS = [
  { value: 'all', label: '全部' },
  { value: 'weekly_review', label: '周会汇报' },
  { value: 'resource_planning', label: '资源规划' },
  { value: 'risk_review', label: '风险评审' },
  { value: 'progress_review', label: '进度评审' },
  { value: 'performance_review', label: '绩效评估' },
]

export function BiReportTemplateLibraryPage() {
  const params = useParams<{ id: string }>()
  const organizationId = Number(params?.id) || 0

  const [activeScenario, setActiveScenario] = useState('all')
  const [selectedTemplate, setSelectedTemplate] = useState<BiTemplateEntry | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [showSaveCopyDialog, setShowSaveCopyDialog] = useState(false)
  const [copyName, setCopyName] = useState('')
  const [copyDescription, setCopyDescription] = useState('')

  // 数据查询
  const { data: listData, isLoading } = useBiTemplates(organizationId, {
    category: activeScenario === 'all' ? undefined : undefined,
  })
  useBiTemplate(organizationId, selectedTemplate?.templateId ?? '')
  const { data: previewData, isLoading: isPreviewLoading } = useBiTemplatePreview(
    organizationId,
    showPreview ? (selectedTemplate?.templateId ?? '') : '',
  )

  // Mutations
  const instantiateMutation = useInstantiateBiTemplate(organizationId)
  const saveCopyMutation = useSaveBiTemplateCopy(organizationId)

  // 按场景筛选
  const templates = (listData?.data ?? []).filter((t) => {
    if (activeScenario === 'all') return true
    return t.scenario === activeScenario
  })

  // 处理模板选择
  const handleSelectTemplate = (template: BiTemplateEntry) => {
    setSelectedTemplate(template)
    setShowPreview(false)
  }

  // 处理从模板创建
  const handleInstantiate = async () => {
    if (!selectedTemplate) return
    await instantiateMutation.mutateAsync({
      templateId: selectedTemplate.templateId,
      body: {},
    })
    // 实际应用中跳转到报表工作台预览页
  }

  // 处理另存为
  const handleSaveCopy = async () => {
    if (!selectedTemplate || !copyName.trim()) return
    await saveCopyMutation.mutateAsync({
      templateId: selectedTemplate.templateId,
      body: { name: copyName.trim(), description: copyDescription.trim() },
    })
    setShowSaveCopyDialog(false)
    setCopyName('')
    setCopyDescription('')
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">BI 报表模板库</h1>
          <p className="text-muted-foreground text-sm mt-1">
            开箱即用的组织级报表模板，一键预览与创建
          </p>
        </div>
      </div>

      {/* 场景筛选 */}
      <Tabs value={activeScenario} onValueChange={setActiveScenario}>
        <TabsList>
          {SCENARIO_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* 模板目录 */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>该场景下暂无可用模板</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => (
            <BiTemplateCard key={t.templateId} template={t} onSelect={handleSelectTemplate} />
          ))}
        </div>
      )}

      {/* 模板详情面板 */}
      {selectedTemplate && (
        <div className="border rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">{selectedTemplate.name}</h2>
              <p className="text-muted-foreground text-sm mt-1">{selectedTemplate.description}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowPreview(!showPreview)}>
                <Eye className="h-4 w-4 mr-1" />
                {showPreview ? '隐藏预览' : '预览'}
              </Button>
              <Button size="sm" onClick={handleInstantiate}>
                <FileText className="h-4 w-4 mr-1" />
                从模板创建
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCopyName(selectedTemplate.name)
                  setCopyDescription(selectedTemplate.description)
                  setShowSaveCopyDialog(true)
                }}
              >
                <Copy className="h-4 w-4 mr-1" />
                另存为自定义模板
              </Button>
            </div>
          </div>

          {/* 脱敏提示 */}
          {selectedTemplate.templateId === 'team_performance' && (
            <p className="text-amber-600 dark:text-amber-400 text-xs flex items-center gap-1">
              ⚠ 此模板包含人员维度数据，默认按团队粒度聚合
            </p>
          )}

          {/* 预览视图 */}
          {showPreview && (
            <BiTemplatePreviewView preview={previewData?.data} isLoading={isPreviewLoading} />
          )}
        </div>
      )}

      {/* 另存为对话框 */}
      <Dialog open={showSaveCopyDialog} onOpenChange={setShowSaveCopyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>另存为自定义模板</DialogTitle>
            <DialogDescription>
              创建该模板的组织自定义副本，模板构成（数据源/指标）保持不变，您可以编辑名称、说明和筛选默认值。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">模板名称</label>
              <Input
                value={copyName}
                onChange={(e) => setCopyName(e.target.value)}
                placeholder="自定义模板名称"
              />
            </div>
            <div>
              <label className="text-sm font-medium">说明</label>
              <Input
                value={copyDescription}
                onChange={(e) => setCopyDescription(e.target.value)}
                placeholder="模板说明"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveCopyDialog(false)}>
              取消
            </Button>
            <Button
              onClick={handleSaveCopy}
              disabled={!copyName.trim() || saveCopyMutation.isPending}
            >
              {saveCopyMutation.isPending ? '保存中...' : '保存副本'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
