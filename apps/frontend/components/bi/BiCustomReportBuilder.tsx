/**
 * BiCustomReportBuilder —— BI 自定义报表构建器工作台页面。
 *
 * 包含数据源目录、字段选择、筛选、分组、排序、图表类型、布局预览和版本历史。
 * v3-bi-custom-report-builder §8.2
 */
'use client'

import { useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { ScrollArea } from '@/components/ui/ScrollArea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import {
  useBiCustomReportRegistry,
  useBiCustomReportDefinitions,
  useBiCustomReportDefinition,
  useBiCustomReportVersions,
  useBiCustomReportPreview,
  useCreateBiCustomReport,
  useUpdateBiCustomReport,
  useCopyBiCustomReport,
  useSetDefaultBiCustomReport,
  useArchiveBiCustomReport,
  useRestoreBiCustomReport,
} from '@/hooks/use-bi-custom-reports'
import type {
  BiCustomReportFieldDef,
  BiCustomReportPreviewResult,
  BiCustomReportDefinition,
  BiCustomReportScope,
  BiCustomReportVisibility,
} from '@aiproj/types'
import { BI_CUSTOM_REPORT_VISUALIZATION_TYPES, BI_CUSTOM_REPORT_LIMITS } from '@aiproj/types'
import type { PreviewInput } from '@/lib/api/bi-custom-reports'

// ─── 预览状态渲染 ──────────────────────────────────────────────────────────

function PreviewStatus({
  preview,
  isLoading,
  error,
}: {
  preview?: BiCustomReportPreviewResult | null
  isLoading: boolean
  error?: Error | null
}) {
  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 border border-red-200 bg-red-50 rounded-md dark:bg-red-950/20">
        <p className="text-red-700 dark:text-red-400 text-sm font-medium">预览失败</p>
        <p className="text-red-600 dark:text-red-300 text-xs mt-1">{error.message}</p>
      </div>
    )
  }

  if (!preview) {
    return (
      <div className="p-4 text-muted-foreground text-sm text-center">
        选择数据源和字段后点击"预览"查看结果
      </div>
    )
  }

  if (preview.blocked) {
    return (
      <div className="p-4 border border-orange-200 bg-orange-50 rounded-md dark:bg-orange-950/20 space-y-2">
        <p className="text-orange-700 dark:text-orange-400 text-sm font-medium">⛔ 预览被阻止</p>
        {preview.blockedReasons.map((reason, i) => (
          <p key={i} className="text-orange-600 dark:text-orange-300 text-xs">
            {reason}
          </p>
        ))}
      </div>
    )
  }

  const allWarnings = preview.warnings ?? []

  return (
    <div className="space-y-3 p-4">
      {/* Status badge */}
      <div className="flex items-center gap-2">
        <Badge
          variant={
            preview.status === 'ready'
              ? 'primary'
              : preview.status === 'partial'
                ? 'neutral'
                : 'danger'
          }
        >
          {preview.status === 'ready'
            ? '就绪'
            : preview.status === 'partial'
              ? '部分可用'
              : '已阻止'}
        </Badge>
        <span className="text-xs text-muted-foreground">
          hash: {preview.definitionHash?.slice(0, 12)}...
        </span>
      </div>

      {/* Cards */}
      {preview.cards.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {preview.cards.map((card) => (
            <Card key={card.key} className="p-3">
              <p className="text-xs text-muted-foreground">{card.title ?? card.key}</p>
              <p className="text-2xl font-bold">
                {typeof card.value === 'number' ? card.value.toLocaleString() : card.value}
              </p>
            </Card>
          ))}
        </div>
      )}

      {/* Rows count */}
      {preview.rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          预览行数: {preview.rows.length}（最多 {BI_CUSTOM_REPORT_LIMITS.PREVIEW_MAX_ROWS} 行）
        </p>
      )}

      {/* Series */}
      {preview.series.length > 0 && (
        <div className="space-y-1">
          {preview.series.map((s) => (
            <div key={s.key} className="flex items-center gap-2 text-xs">
              <span className="font-medium">{s.label ?? s.key}:</span>
              <span className="text-muted-foreground">{s.values.length} 个数据点</span>
            </div>
          ))}
        </div>
      )}

      {/* Warnings */}
      {allWarnings.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-amber-600">⚠ 警告 ({allWarnings.length})</p>
          {allWarnings.slice(0, 5).map((w, i) => (
            <p key={i} className="text-xs text-amber-600/80">
              {w.message}
            </p>
          ))}
          {allWarnings.length > 5 && (
            <p className="text-xs text-muted-foreground">... 还有 {allWarnings.length - 5} 条</p>
          )}
        </div>
      )}

      {/* Freshness */}
      {preview.freshness && (
        <p className="text-xs text-muted-foreground">
          数据新鲜度:{' '}
          {preview.freshness.status === 'fresh'
            ? '✅ 新鲜'
            : preview.freshness.status === 'stale'
              ? '⚠ 过期'
              : '❓ 未知'}
          {preview.freshness.ttlMinutes && ` (TTL: ${preview.freshness.ttlMinutes}min)`}
        </p>
      )}
    </div>
  )
}

// ─── 主构建器组件 ──────────────────────────────────────────────────────────

export default function BiCustomReportBuilder() {
  const params = useParams()
  const orgId = Number(params.organizationId)
  const { toast } = useToast()

  // 状态
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set())
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set())
  const [selectedVisualizations, setSelectedVisualizations] = useState<Set<string>>(
    new Set(['table']),
  )
  const [filters, setFilters] = useState<
    Array<{ fieldKey: string; operator: string; value: unknown }>
  >([])
  const [groups, setGroups] = useState<Array<{ fieldKey: string }>>([])
  const [sorts, setSorts] = useState<Array<{ fieldKey: string; direction: string }>>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  // 用字面量联合而非 string：mutation 要求的就是这两个联合，写成 string 只能靠 as any 过
  const [scope, setScope] = useState<BiCustomReportScope>('organization')
  const [visibility, setVisibility] = useState<BiCustomReportVisibility>('personal')
  const [previewResult, setPreviewResult] = useState<BiCustomReportPreviewResult | null>(null)
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('builder')

  // Queries
  const { data: registryData, isLoading: registryLoading } = useBiCustomReportRegistry(orgId)
  const { data: definitionsData, isLoading: definitionsLoading } = useBiCustomReportDefinitions(
    orgId,
    {
      // scope 现在是字面量联合，Select 也没有 'all' 选项，原来的 !== 'all' 判断恒真
      scope,
    },
  )
  const { data: selectedDefinition } = useBiCustomReportDefinition(
    orgId,
    selectedDefinitionId ?? '',
  )
  const { data: versionsData } = useBiCustomReportVersions(orgId, selectedDefinitionId ?? '')

  // Mutations
  const previewMutation = useBiCustomReportPreview(orgId)
  const createMutation = useCreateBiCustomReport(orgId)
  const updateMutation = useUpdateBiCustomReport(orgId, selectedDefinitionId ?? '')
  const copyMutation = useCopyBiCustomReport(orgId)
  useSetDefaultBiCustomReport(orgId, selectedDefinitionId ?? '')
  const archiveMutation = useArchiveBiCustomReport(orgId, selectedDefinitionId ?? '')
  const restoreMutation = useRestoreBiCustomReport(orgId, selectedDefinitionId ?? '')

  const registry = registryData?.data ?? []

  // 切换数据源
  const toggleSource = useCallback((sourceKey: string) => {
    setSelectedSources((prev) => {
      const next = new Set(prev)
      if (next.has(sourceKey)) {
        next.delete(sourceKey)
      } else if (next.size < BI_CUSTOM_REPORT_LIMITS.MAX_DATA_SOURCES) {
        next.add(sourceKey)
      }
      return next
    })
    // 清空字段选择
    setSelectedFields(new Set())
  }, [])

  // 切换字段
  const toggleField = useCallback((fieldKey: string) => {
    setSelectedFields((prev) => {
      const next = new Set(prev)
      if (next.has(fieldKey)) {
        next.delete(fieldKey)
      } else if (next.size < BI_CUSTOM_REPORT_LIMITS.MAX_FIELDS) {
        next.add(fieldKey)
      }
      return next
    })
  }, [])

  // 切换可视化
  const toggleVisualization = useCallback((type: string) => {
    setSelectedVisualizations((prev) => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else if (next.size < BI_CUSTOM_REPORT_LIMITS.MAX_VISUALIZATIONS) {
        next.add(type)
      }
      return next
    })
  }, [])

  // 获取选中数据源的可用字段
  const availableFields = ((): BiCustomReportFieldDef[] => {
    const fieldMap = new Map<string, BiCustomReportFieldDef>()
    for (const sourceKey of selectedSources) {
      const ds = registry.find((d) => d.sourceKey === sourceKey)
      if (ds) {
        for (const f of ds.fields) {
          if (!fieldMap.has(f.fieldKey)) {
            fieldMap.set(f.fieldKey, f)
          }
        }
      }
    }
    return Array.from(fieldMap.values())
  })()

  // 构建预览输入
  const buildPreviewInput = useCallback(
    (): PreviewInput => ({
      title: title || undefined,
      scope,
      dataSources: Array.from(selectedSources).map((sk) => ({ sourceKey: sk })),
      fields: Array.from(selectedFields),
      filters: filters.length > 0 ? filters.map((f) => ({ ...f, label: undefined })) : undefined,
      groups: groups.length > 0 ? groups : undefined,
      sorts: sorts.length > 0 ? sorts : undefined,
      visualizations: Array.from(selectedVisualizations).map((t) => ({ type: t })),
    }),
    [title, scope, selectedSources, selectedFields, filters, groups, sorts, selectedVisualizations],
  )

  // 执行预览
  const handlePreview = useCallback(async () => {
    const input = buildPreviewInput()
    try {
      const result = await previewMutation.mutateAsync(input)
      setPreviewResult(result.data)
    } catch {
      toast({ title: '预览失败', variant: 'error' })
    }
  }, [buildPreviewInput, previewMutation, toast])

  // 保存定义
  const handleSave = useCallback(async () => {
    const input = buildPreviewInput()
    try {
      if (selectedDefinitionId) {
        const def = selectedDefinition?.data
        if (!def) return
        await updateMutation.mutateAsync({
          ...input,
          title: title || '未命名报表',
          description: description || undefined,
          visibility,
          expectedVersion: def.version,
        })
        toast({ title: '报表定义已更新' })
      } else {
        await createMutation.mutateAsync({
          ...input,
          title: title || '未命名报表',
          description: description || undefined,
          scope,
          visibility,
        })
        toast({ title: '报表定义已创建' })
      }
      // 刷新列表
    } catch (err: unknown) {
      toast({
        title: '保存失败',
        description: err instanceof Error ? err.message : undefined,
        variant: 'error',
      })
    }
  }, [
    buildPreviewInput,
    selectedDefinitionId,
    selectedDefinition,
    updateMutation,
    createMutation,
    title,
    description,
    scope,
    visibility,
    toast,
  ])

  // 加载已有定义
  const handleLoadDefinition = useCallback((def: BiCustomReportDefinition) => {
    setSelectedDefinitionId(def.definitionId)
    setTitle(def.title)
    setDescription(def.description ?? '')
    setScope(def.scope)
    setVisibility(def.visibility)
    setSelectedSources(new Set(def.dataSources.map((d) => d.sourceKey)))
    setSelectedFields(new Set(def.fields))
    setSelectedVisualizations(new Set(def.visualizations.map((v) => v.type)))
    setFilters(def.filters ?? [])
    setGroups(def.groups ?? [])
    setSorts(def.sorts ?? [])
    setActiveTab('builder')
  }, [])

  // 可视化的中英文映射
  const vizLabels: Record<string, string> = {
    table: '表格',
    metric_card: '指标卡',
    line: '折线图',
    bar: '柱状图',
    stacked_bar: '堆叠柱状图',
    heatmap: '热力图',
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">BI 自定义报表构建器</h1>
          <p className="text-sm text-muted-foreground mt-1">
            从授权数据源中选择字段、筛选、图表，组合成自定义报表定义
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={
              selectedSources.size === 0 || selectedFields.size === 0 || previewMutation.isPending
            }
          >
            {previewMutation.isPending ? '预览中...' : '🔍 预览'}
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              !previewResult ||
              previewResult.blocked ||
              !title.trim() ||
              createMutation.isPending ||
              updateMutation.isPending
            }
          >
            {createMutation.isPending || updateMutation.isPending
              ? '保存中...'
              : selectedDefinitionId
                ? '💾 更新定义'
                : '💾 保存定义'}
          </Button>
        </div>
      </div>

      {/* Title input */}
      <div className="flex gap-4">
        <div className="flex-1">
          <Label htmlFor="report-title">报表标题 *</Label>
          <Input
            id="report-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入报表标题..."
            maxLength={BI_CUSTOM_REPORT_LIMITS.MAX_TITLE_LENGTH}
          />
        </div>
        <div className="w-40">
          <Label>范围</Label>
          <Select value={scope} onValueChange={(v) => setScope(v as BiCustomReportScope)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="organization">组织</SelectItem>
              <SelectItem value="portfolio">组合</SelectItem>
              <SelectItem value="project">项目</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Label>可见性</Label>
          <Select
            value={visibility}
            onValueChange={(v) => setVisibility(v as BiCustomReportVisibility)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="personal">个人</SelectItem>
              <SelectItem value="shared">共享</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="builder">构建器</TabsTrigger>
          <TabsTrigger value="preview">预览结果</TabsTrigger>
          <TabsTrigger value="definitions">
            已保存 ({definitionsData?.meta?.total ?? 0})
          </TabsTrigger>
          {selectedDefinitionId && <TabsTrigger value="versions">版本历史</TabsTrigger>}
        </TabsList>

        {/* 构建器标签页 */}
        <TabsContent value="builder" className="space-y-4 mt-4">
          <div className="grid grid-cols-3 gap-4">
            {/* 左侧：数据源 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">数据源</CardTitle>
              </CardHeader>
              <CardContent>
                {registryLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : (
                  <ScrollArea className="h-64">
                    <div className="space-y-1">
                      {registry.map((ds) => (
                        <button
                          key={ds.sourceKey}
                          onClick={() => toggleSource(ds.sourceKey)}
                          className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors ${
                            selectedSources.has(ds.sourceKey)
                              ? 'bg-primary/10 border border-primary/20'
                              : 'hover:bg-muted border border-transparent'
                          }`}
                        >
                          <div className="font-medium">{ds.name}</div>
                          <div className="text-muted-foreground truncate">{ds.description}</div>
                          <div className="flex gap-1 mt-1">
                            {ds.permissionTags.map((tag) => (
                              <Badge key={tag} variant="outline" className="text-[10px] px-1 py-0">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            {/* 中间：字段 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  字段 ({selectedFields.size}/{BI_CUSTOM_REPORT_LIMITS.MAX_FIELDS})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {availableFields.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-4 text-center">请先选择数据源</p>
                ) : (
                  <ScrollArea className="h-64">
                    <div className="space-y-1">
                      {availableFields.map((field) => (
                        <button
                          key={field.fieldKey}
                          onClick={() => toggleField(field.fieldKey)}
                          className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors ${
                            selectedFields.has(field.fieldKey)
                              ? 'bg-primary/10 border border-primary/20'
                              : 'hover:bg-muted border border-transparent'
                          }`}
                        >
                          <span className="font-medium">{field.name}</span>
                          <span className="text-muted-foreground ml-2">({field.type})</span>
                          {field.permissionTag && (
                            <Badge variant="outline" className="ml-2 text-[10px] px-1 py-0">
                              {field.permissionTag}
                            </Badge>
                          )}
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            {/* 右侧：可视化 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  图表 ({selectedVisualizations.size}/{BI_CUSTOM_REPORT_LIMITS.MAX_VISUALIZATIONS})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {Object.entries(BI_CUSTOM_REPORT_VISUALIZATION_TYPES).map(([key, value]) => (
                    <button
                      key={value}
                      onClick={() => toggleVisualization(value)}
                      className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors ${
                        selectedVisualizations.has(value)
                          ? 'bg-primary/10 border border-primary/20'
                          : 'hover:bg-muted border border-transparent'
                      }`}
                    >
                      {vizLabels[value] ?? key}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* 预览标签页 */}
        <TabsContent value="preview" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">预览结果</CardTitle>
            </CardHeader>
            <CardContent>
              <PreviewStatus
                preview={previewResult}
                isLoading={previewMutation.isPending}
                error={previewMutation.error}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* 已保存定义列表 */}
        <TabsContent value="definitions" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">已保存的报表定义</CardTitle>
            </CardHeader>
            <CardContent>
              {definitionsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : (definitionsData?.data?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground p-4 text-center">暂无保存的报表定义</p>
              ) : (
                <div className="space-y-2">
                  {(definitionsData?.data ?? []).map((def) => (
                    <div
                      key={def.definitionId}
                      className="flex items-center justify-between p-3 border rounded-md hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">{def.title}</p>
                          {def.isDefault && (
                            <Badge variant="neutral" className="text-[10px]">
                              默认
                            </Badge>
                          )}
                          {def.archivedAt && (
                            <Badge variant="outline" className="text-[10px]">
                              已归档
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[10px]">
                            {def.visibility === 'personal' ? '个人' : '共享'}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          v{def.version} · {def.scope} · {def.dataSources?.length ?? 0} 数据源
                        </p>
                      </div>
                      <div className="flex gap-1 ml-4">
                        <Button size="sm" variant="ghost" onClick={() => handleLoadDefinition(def)}>
                          编辑
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => copyMutation.mutate({ definitionId: def.definitionId })}
                        >
                          复制
                        </Button>
                        {def.archivedAt ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => restoreMutation.mutate(def.version)}
                          >
                            恢复
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => archiveMutation.mutate(def.version)}
                          >
                            归档
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 版本历史 */}
        {selectedDefinitionId && (
          <TabsContent value="versions" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">版本历史</CardTitle>
              </CardHeader>
              <CardContent>
                {(versionsData?.data?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground p-4 text-center">无版本记录</p>
                ) : (
                  <div className="space-y-2">
                    {(versionsData?.data ?? []).map((v) => (
                      <div
                        key={v.version}
                        className="flex items-center justify-between p-2 border-b text-xs"
                      >
                        <span className="font-medium">v{v.version}</span>
                        <span className="text-muted-foreground">{v.changeSummary}</span>
                        <span className="text-muted-foreground">
                          {v.updatedAt ? new Date(v.updatedAt).toLocaleDateString('zh-CN') : '-'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
