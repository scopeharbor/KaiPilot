'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { projectsApi, type ProjectPriority } from '@/lib/api/projects'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormSubmit,
  useForm,
  zodResolver,
} from '@/components/forms'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { projectFormSchema, type ProjectFormValues } from './schema'

const PRIORITIES: Array<{ value: ProjectPriority; label: string }> = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'critical', label: '紧急' },
]

export default function NewProjectPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  if (organizationId === null) {
    return <Alert className="my-8">请先选择组织</Alert>
  }
  return <NewProjectForm />
}

function NewProjectForm() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    mode: 'onChange',
    defaultValues: {
      name: '',
      code: '',
      description: '',
      priority: 'medium',
      startDate: '',
      endDate: '',
    },
  })

  const create = useMutation({
    mutationFn: (values: ProjectFormValues) =>
      projectsApi.create({
        ...values,
        code: values.code || undefined,
        description: values.description || null,
        startDate: values.startDate || undefined,
        endDate: values.endDate || undefined,
      }),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      router.push(`/projects/${project.id}`)
    },
  })

  const onSubmit = (values: ProjectFormValues) => create.mutate(values)

  return (
    <div className="space-y-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-gray-800 text-balance">新建项目</h1>
        <p className="text-sm text-gray-500">填写基础信息后即可开始规划任务与里程碑。</p>
      </header>

      <Card variant="outlined">
        <CardContent className="pt-[var(--card-pad)]">
          <Form {...form}>
            <form
              aria-label="新建项目表单"
              className="space-y-4"
              onSubmit={form.handleSubmit(onSubmit)}
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>项目名称</FormLabel>
                    <FormControl>
                      <Input placeholder="例如：开项平台 V1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>项目编码</FormLabel>
                    <FormControl>
                      <Input placeholder="字母、数字、- 或 _" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>描述</FormLabel>
                    <FormControl>
                      <Textarea placeholder="简要说明项目目标与范围" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>优先级</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="选择优先级" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PRIORITIES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>开始日期</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>结束日期</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {create.isError ? (
                <Alert variant="danger" title="创建项目失败">
                  {(create.error as { message?: string })?.message ?? '请稍后重试。'}
                </Alert>
              ) : null}

              <div className="flex flex-wrap justify-end gap-3 pt-2">
                <Button type="button" variant="secondary" onClick={() => router.back()}>
                  取消
                </Button>
                <FormSubmit disabled={create.isPending || undefined} loading={create.isPending}>
                  创建项目
                </FormSubmit>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
