'use client'

/**
 * BI 报表模板卡片组件（v3-bi-report-template-library §6.2）。
 *
 * 展示单个模板的卡片：名称、描述、分类/场景标签、版本与「有新版」徽标。
 */
import { Badge } from '@/components/ui/Badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card'
import type { BiTemplateEntry } from '@aiproj/types'

interface BiTemplateCardProps {
  template: BiTemplateEntry
  onSelect: (template: BiTemplateEntry) => void
}

const categoryLabels: Record<string, string> = {
  execution: '执行',
  resource: '资源',
  risk: '风险',
  milestone: '里程碑',
  people: '人员',
}

const scenarioLabels: Record<string, string> = {
  weekly_review: '周会汇报',
  resource_planning: '资源规划',
  risk_review: '风险评审',
  progress_review: '进度评审',
  performance_review: '绩效评估',
}

export function BiTemplateCard({ template, onSelect }: BiTemplateCardProps) {
  const isPlugin = template.source === 'plugin' || Boolean(template.pluginRef)

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => onSelect(template)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{template.name}</CardTitle>
          {isPlugin ? (
            <Badge
              variant="outline"
              className="text-xs border-primary/40 text-primary"
              title={template.pluginRef?.displayName || template.pluginRef?.pluginId || '插件模板'}
            >
              插件
            </Badge>
          ) : template.isCopy ? (
            <Badge variant="outline" className="text-xs">
              自定义
            </Badge>
          ) : null}
          {template.hasNewerVersion && (
            <Badge variant="neutral" className="text-xs">
              有新版
            </Badge>
          )}
        </div>
        <CardDescription className="text-sm line-clamp-2">{template.description}</CardDescription>
      </CardHeader>
      <CardContent className="pb-2">
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline" className="text-xs">
            {categoryLabels[template.category] ?? template.category}
          </Badge>
          <Badge variant="neutral" className="text-xs">
            {scenarioLabels[template.scenario] ?? template.scenario}
          </Badge>
          <Badge variant="outline" className="text-xs">
            v{template.version}
          </Badge>
        </div>
      </CardContent>
      <CardFooter className="text-xs text-muted-foreground">
        {isPlugin
          ? `插件：${template.pluginRef?.displayName || template.pluginRef?.pluginId || '插件模板'}`
          : template.isCopy
            ? '自定义副本'
            : '内置模板'}
        {template.updatedAt && (
          <span className="ml-auto">
            {new Date(template.updatedAt).toLocaleDateString('zh-CN')}
          </span>
        )}
      </CardFooter>
    </Card>
  )
}
