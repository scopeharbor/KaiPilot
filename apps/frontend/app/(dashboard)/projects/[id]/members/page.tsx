'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { z } from 'zod'
import PermissionGuard from '@/components/PermissionGuard'
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
import { Avatar, AvatarFallback } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/Input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table'
import {
  projectKeys,
  projectMembersApi,
  type ProjectMember,
  type ProjectRole,
} from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'

const inviteMemberSchema = z.object({
  email: z.string().trim().min(1, '请输入成员邮箱').email('请输入有效的邮箱地址'),
  roleId: z.string().min(1, '请选择项目角色'),
})

type InviteMemberValues = z.infer<typeof inviteMemberSchema>

export default function ProjectMembersPage() {
  const params = useParams()
  const projectId = Number(params.id)
  const organizationId = useAuthStore((state) => state.currentOrganizationId)
  if (organizationId === null) {
    return <Alert className="my-8">请先选择组织</Alert>
  }
  return (
    <PermissionGuard
      require="project:view"
      fallback={<Alert className="my-8">无权访问项目成员</Alert>}
    >
      <ProjectMembersContent projectId={projectId} />
    </PermissionGuard>
  )
}

function ProjectMembersContent({ projectId }: { projectId: number }) {
  const currentUserId = useAuthStore((state) => state.user?.id)
  const queryClient = useQueryClient()
  const members = useQuery({
    queryKey: projectKeys.members(projectId),
    queryFn: () => projectMembersApi.list(projectId),
  })
  const roles = useQuery({
    queryKey: projectKeys.roles(projectId),
    queryFn: () => projectMembersApi.listRoles(projectId),
  })

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: projectKeys.members(projectId) })
  const changeRole = useMutation({
    mutationFn: ({ userId, projectRoleId }: { userId: number; projectRoleId: number }) =>
      projectMembersApi.changeRole(projectId, userId, projectRoleId),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (userId: number) => projectMembersApi.remove(projectId, userId),
    onSuccess: refresh,
  })
  const transfer = useMutation({
    mutationFn: (userId: number) => projectMembersApi.transferOwner(projectId, userId),
    onSuccess: refresh,
  })
  const roleList = roles.data ?? []

  return (
    <div className="space-y-6 py-8">
      <header className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-gray-800 text-balance">成员管理</h1>
          <p className="text-sm text-gray-500">查看项目成员、调整角色与管理所有权。</p>
        </div>
      </header>

      <AddMemberForm projectId={projectId} roles={roleList} onSuccess={refresh} />

      <Card variant="outlined" className="overflow-x-auto">
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-[var(--card-pad)] py-4">
            <h2 className="text-lg font-semibold text-gray-800">成员</h2>
            <span className="text-sm text-gray-500">{members.data?.length ?? 0} 人</span>
          </div>
          {members.isLoading ? <MembersSkeleton /> : null}
          {members.isError ? (
            <Alert className="m-[var(--card-pad)]" variant="danger" title="成员加载失败" />
          ) : null}
          {members.data ? (
            <Table>
              <TableCaption>项目成员列表</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>成员</TableHead>
                  <TableHead>项目角色</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.data.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    roles={roleList}
                    currentUserId={currentUserId}
                    changeRolePending={changeRole.isPending}
                    removePending={remove.isPending}
                    transferPending={transfer.isPending}
                    onChangeRole={(projectRoleId) =>
                      changeRole.mutate({ userId: member.userId, projectRoleId })
                    }
                    onRemove={() => remove.mutate(member.userId)}
                    onTransfer={() => transfer.mutate(member.userId)}
                  />
                ))}
                {members.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-10 text-center text-gray-500">
                      暂无项目成员
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function AddMemberForm({
  projectId,
  roles,
  onSuccess,
}: {
  projectId: number
  roles: ProjectRole[]
  onSuccess: () => void
}) {
  const invite = useMutation({
    mutationFn: (values: InviteMemberValues) =>
      projectMembersApi.invite(projectId, {
        email: values.email,
        projectRoleId: Number(values.roleId),
      }),
    onSuccess: () => {
      form.reset({ email: '', roleId: '' })
      onSuccess()
    },
  })
  const form = useForm<InviteMemberValues>({
    resolver: zodResolver(inviteMemberSchema),
    mode: 'onChange',
    defaultValues: { email: '', roleId: '' },
  })

  return (
    <PermissionGuard require="project:member:manage">
      <Card variant="outlined">
        <CardContent className="space-y-4 pt-[var(--card-pad)]">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-gray-800">邀请成员</h2>
            <p className="text-sm text-gray-500">填写成员邮箱并选择其项目角色。</p>
          </div>
          <Form {...form}>
            <form
              className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.45fr)_auto] md:items-start"
              onSubmit={form.handleSubmit((values) => invite.mutate(values))}
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>成员邮箱</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="name@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="roleId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>项目角色</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="选择角色" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {roles.map((role) => (
                          <SelectItem key={role.id} value={String(role.id)}>
                            {role.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormSubmit className="md:mt-[1.625rem]" disabled={invite.isPending}>
                发送邀请
              </FormSubmit>
            </form>
          </Form>
          {invite.isError ? (
            <Alert variant="danger" title="邀请失败">
              {(invite.error as { message?: string } | null)?.message ?? '请稍后重试'}
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </PermissionGuard>
  )
}

function MemberRow({
  member,
  roles,
  currentUserId,
  changeRolePending,
  removePending,
  transferPending,
  onChangeRole,
  onRemove,
  onTransfer,
}: {
  member: ProjectMember
  roles: ProjectRole[]
  currentUserId: number | undefined
  changeRolePending: boolean
  removePending: boolean
  transferPending: boolean
  onChangeRole: (projectRoleId: number) => void
  onRemove: () => void
  onTransfer: () => void
}) {
  const isOwner = member.projectRole?.name === 'Project Owner'
  const isSelf = member.userId === currentUserId
  const display = member.user?.fullName || member.user?.email || `用户 ${member.userId}`
  const initials = member.user?.initials || display.slice(0, 1)

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <strong className="block truncate font-medium text-gray-800">{display}</strong>
            <span className="block truncate text-xs text-gray-500">{member.user?.email}</span>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <PermissionGuard
          require="project:member:manage"
          fallback={<Chip>{member.projectRole?.name || '未分配'}</Chip>}
        >
          <Select
            value={member.projectRoleId ? String(member.projectRoleId) : undefined}
            disabled={isOwner || changeRolePending}
            onValueChange={(value) => onChangeRole(Number(value))}
          >
            <SelectTrigger
              className="w-44"
              aria-label={`调整 ${member.user?.email ?? member.userId} 的角色`}
            >
              <SelectValue placeholder="选择角色" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((role) => (
                <SelectItem key={role.id} value={String(role.id)}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PermissionGuard>
      </TableCell>
      <TableCell>
        <PermissionGuard require="project:member:manage">
          <div className="flex justify-end gap-2">
            {!isOwner ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={isSelf || transferPending}
                loading={transferPending}
                onClick={onTransfer}
              >
                转交所有权
              </Button>
            ) : (
              <Chip>项目所有者</Chip>
            )}
            <IconButton
              aria-label={`移除 ${display}`}
              variant="danger"
              size="sm"
              disabled={isOwner || removePending}
              loading={removePending}
              onClick={onRemove}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </IconButton>
          </div>
        </PermissionGuard>
      </TableCell>
    </TableRow>
  )
}

function MembersSkeleton() {
  return (
    <div className="space-y-3 px-[var(--card-pad)] pb-[var(--card-pad)]" aria-label="正在加载成员">
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  )
}
