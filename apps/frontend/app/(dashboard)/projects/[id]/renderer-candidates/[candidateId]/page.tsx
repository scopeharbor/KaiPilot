/**
 * RendererCandidatePage —— AI 候选渲染器配置预览/确认页面（§6.2 P0）。
 *
 * 用户可预览 AI 推荐的视图配置，确认保存为个人视图或共享视图，
 * 或拒绝/重置候选配置。
 */
'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/Alert'
import { Label } from '@/components/ui/Label'
import { Input } from '@/components/ui/Input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/RadioGroup'
import { Eye, EyeOff, Loader2, Save, XCircle, AlertTriangle } from 'lucide-react'
import { useConfirmRendererCandidate } from '@/lib/api/use-renderer-configs'
import type { RendererViewType } from '@aiproj/types'

export default function RendererCandidatePage() {
  const params = useParams()
  const router = useRouter()
  const projectId = Number(params.id)
  const confirmMutation = useConfirmRendererCandidate(projectId)

  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<'personal' | 'shared'>('personal')
  const [isPreview, setIsPreview] = useState(true)

  // 模拟候选配置数据，实际从 Compiler artifact 加载
  const candidate = {
    id: params.candidateId as string,
    config: {
      type: 'dashboard' as RendererViewType,
      title: 'AI 推荐仪表盘',
    },
    confidence: 0.85,
  }

  const handleConfirm = async () => {
    confirmMutation.mutate({
      config: {},
      name,
      visibility,
      sourceArtifactRef: candidate.id,
    })
  }

  const handleReject = () => {
    router.push(`/projects/${projectId}`)
  }

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>AI 推荐视图</CardTitle>
              <CardDescription>AI 根据项目情况推荐了以下视图配置</CardDescription>
            </div>
            <Badge variant="neutral">{Math.round(candidate.confidence * 100)}% 置信度</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 预览区 */}
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              {isPreview ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              {candidate.config.title}
              <Badge variant="outline" className="ml-auto">
                {candidate.config.type}
              </Badge>
            </div>
            {isPreview && (
              <div className="mt-4 space-y-3">
                <div className="h-32 rounded bg-muted/50 flex items-center justify-center text-sm text-muted-foreground">
                  预览区域 — AI 推荐仪表盘配置
                </div>
              </div>
            )}
          </div>

          {/* 低置信度警告 */}
          {candidate.confidence < 0.7 && (
            <Alert variant="danger">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>低置信度</AlertTitle>
              <AlertDescription>AI 对此配置的置信度较低，建议审查后再确认</AlertDescription>
            </Alert>
          )}

          {/* 保存选项 */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="view-name">视图名称</Label>
              <Input
                id="view-name"
                placeholder="我的 AI 推荐视图"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>可见性</Label>
              <RadioGroup
                value={visibility}
                onValueChange={(v: 'personal' | 'shared') => setVisibility(v)}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="personal" id="personal" />
                  <Label htmlFor="personal">仅自己可见</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="shared" id="shared" />
                  <Label htmlFor="shared">项目成员共享</Label>
                </div>
              </RadioGroup>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button variant="outline" onClick={handleReject}>
            <XCircle className="mr-2 h-4 w-4" />
            拒绝
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setIsPreview(!isPreview)}>
              {isPreview ? '隐藏预览' : '预览'}
            </Button>
            <Button onClick={handleConfirm} disabled={!name || confirmMutation.isPending}>
              {confirmMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              保存视图
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}
