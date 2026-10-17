'use client'

import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/Dialog'
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
import { Textarea } from '@/components/ui/Textarea'
import {
  membersApi,
  organizationsApi,
  type Organization,
  type OrganizationMember,
} from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'

const organizationSchema = z.object({
  name: z.string().trim().min(2, '组织名称至少需要 2 个字符'),
  slug: z
    .string()
    .trim()
    .min(2, '组织标识至少需要 2 个字符')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, '组织标识只能使用小写字母、数字和短横线'),
  description: z.string().trim().max(2000, '组织简介不能超过 2000 个字符'),
})

const inviteSchema = z.object({
  email: z.string().trim().min(1, '请输入成员邮箱').email('请输入有效的邮箱地址'),
  role: z.enum(['admin', 'member', 'viewer']),
})

const transferOwnershipSchema = z.object({
  memberId: z.string().min(1, '请选择新的组织所有者'),
})

type OrganizationValues = z.infer<typeof organizationSchema>
type InviteValues = z.infer<typeof inviteSchema>
type TransferOwnershipValues = z.infer<typeof transferOwnershipSchema>

const ROLE_LABEL: Record<OrganizationMember['role'], string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
  viewer: '只读',
}

export default function OrganizationSettingsPage() {
  const organizationId = useAuthStore((state) => state.currentOrganizationId)

  if (organizationId === null) {
    return <Alert className="my-8">请先选择组织</Alert>
  }

  return (
    <PermissionGuard require="org:view" fallback={<Alert className="my-8">无权访问组织设置</Alert>}>
      <OrganizationSettingsContent organizationId={organizationId} />
    </PermissionGuard>
  )
}

function OrganizationSettingsContent({ organizationId }: { organizationId: number }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const organization = useQuery({
    queryKey: ['organizations', organizationId],
    queryFn: () => organizationsApi.get(organizationId),
  })
  const members = useQuery({
    queryKey: ['organizations', organizationId, 'members'],
    queryFn: () => membersApi.list(organizationId),
  })
  const refreshMembers = () =>
    queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'members'] })
  const updateRole = useMutation({
    mutationFn: ({ memberId, role }: { memberId: number; role: OrganizationMember['role'] }) =>
      membersApi.update(organizationId, memberId, role),
    onSuccess: refreshMembers,
  })
  const remove = useMutation({
    mutationFn: (memberId: number) => membersApi.delete(organizationId, memberId),
    onSuccess: refreshMembers,
  })
  const deleteOrganization = useMutation({
    mutationFn: () => organizationsApi.delete(organizationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organizations'] })
      router.push('/dashboard')
    },
  })

  return (
    <div className="space-y-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-gray-800 text-balance">
          {organization.data?.name ?? '组织设置'}
        </h1>
        <p className="text-sm text-gray-500">维护组织资料、成员与高风险操作。</p>
      </header>

      {organization.isLoading ? <Skeleton className="h-64 w-full" /> : null}
      {organization.isError ? <Alert variant="danger" title="组织信息加载失败" /> : null}
      {organization.data ? (
        <OrganizationProfile
          organization={organization.data}
          onUpdated={(updated) => {
            queryClient.setQueryData(['organizations', organizationId], updated)
            void queryClient.invalidateQueries({ queryKey: ['organizations'] })
          }}
        />
      ) : null}

      <OrganizationMembers
        organizationId={organizationId}
        members={members.data ?? []}
        loading={members.isLoading}
        error={members.isError}
        updateRolePending={updateRole.isPending}
        removePending={remove.isPending}
        onRefresh={refreshMembers}
        onUpdateRole={(memberId, role) => updateRole.mutate({ memberId, role })}
        onRemove={(memberId) => remove.mutate(memberId)}
      />

      <Card variant="outlined">
        <CardContent className="space-y-4 pt-[var(--card-pad)]">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-gray-800">危险操作</h2>
            <p className="text-sm text-gray-500">这些操作会影响整个组织，请谨慎处理。</p>
          </div>
          <PermissionGuard require="org:member:manage">
            <Alert variant="warning" title="转交组织所有权">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>转交后，当前所有者将自动变为管理员。</span>
                <TransferOwnershipDialog
                  members={members.data ?? []}
                  loading={updateRole.isPending}
                  onConfirm={(memberId) => updateRole.mutate({ memberId, role: 'owner' })}
                />
              </div>
            </Alert>
          </PermissionGuard>
          <PermissionGuard require="system:admin">
            <Alert variant="danger" title="删除组织">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>删除后组织数据将不可恢复。</span>
                <DeleteOrganizationDialog
                  organizationName={organization.data?.name ?? '当前组织'}
                  loading={deleteOrganization.isPending}
                  onConfirm={() => deleteOrganization.mutate()}
                />
              </div>
            </Alert>
          </PermissionGuard>
        </CardContent>
      </Card>
    </div>
  )
}

function OrganizationProfile({
  organization,
  onUpdated,
}: {
  organization: Organization
  onUpdated: (organization: Organization) => void
}) {
  const form = useForm<OrganizationValues>({
    resolver: zodResolver(organizationSchema),
    mode: 'onChange',
    defaultValues: {
      name: organization.name,
      slug: organization.slug,
      description: organization.description ?? '',
    },
  })
  const update = useMutation({
    mutationFn: (values: OrganizationValues) =>
      organizationsApi.update(organization.id, {
        ...values,
        description: values.description || null,
      }),
    onSuccess: (updated) => {
      form.reset({
        name: updated.name,
        slug: updated.slug,
        description: updated.description ?? '',
      })
      onUpdated(updated)
    },
  })

  useEffect(() => {
    form.reset({
      name: organization.name,
      slug: organization.slug,
      description: organization.description ?? '',
    })
  }, [form, organization])

  return (
    <Card variant="outlined">
      <CardContent className="space-y-4 pt-[var(--card-pad)]">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-gray-800">组织信息</h2>
          <p className="text-sm text-gray-500">名称与简介会展示给组织内成员。</p>
        </div>
        <PermissionGuard
          require="org:manage"
          fallback={
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-gray-500">组织标识</dt>
                <dd className="font-mono text-gray-800">{organization.slug}</dd>
              </div>
              <div>
                <dt className="text-gray-500">简介</dt>
                <dd className="text-gray-800">{organization.description || '尚未填写组织简介'}</dd>
              </div>
            </dl>
          }
        >
          <Form {...form}>
            <form
              className="space-y-4"
              onSubmit={form.handleSubmit((values) => update.mutate(values))}
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>组织名称</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="slug"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>组织标识</FormLabel>
                    <FormControl>
                      <Input className="font-mono" {...field} />
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
                    <FormLabel>组织简介</FormLabel>
                    <FormControl>
                      <Textarea placeholder="说明组织的工作范围或目标" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {update.isError ? <Alert variant="danger" title="保存组织信息失败" /> : null}
              <div className="flex justify-end">
                <FormSubmit disabled={update.isPending || undefined} loading={update.isPending}>
                  保存组织信息
                </FormSubmit>
              </div>
            </form>
          </Form>
        </PermissionGuard>
      </CardContent>
    </Card>
  )
}

function OrganizationMembers({
  organizationId,
  members,
  loading,
  error,
  updateRolePending,
  removePending,
  onRefresh,
  onUpdateRole,
  onRemove,
}: {
  organizationId: number
  members: OrganizationMember[]
  loading: boolean
  error: boolean
  updateRolePending: boolean
  removePending: boolean
  onRefresh: () => void
  onUpdateRole: (memberId: number, role: OrganizationMember['role']) => void
  onRemove: (memberId: number) => void
}) {
  return (
    <Card variant="outlined" className="overflow-x-auto">
      <CardContent className="p-0">
        <div className="space-y-1 px-[var(--card-pad)] pt-[var(--card-pad)]">
          <h2 className="text-lg font-semibold text-gray-800">组织成员</h2>
          <p className="text-sm text-gray-500">邀请成员并管理其组织角色。</p>
        </div>
        <InviteOrganizationMember organizationId={organizationId} onAdded={onRefresh} />
        {loading ? <Skeleton className="mx-[var(--card-pad)] mb-5 h-28" /> : null}
        {error ? (
          <Alert className="m-[var(--card-pad)]" variant="danger" title="组织成员加载失败" />
        ) : null}
        {!loading && !error ? (
          <Table>
            <TableCaption>组织成员列表</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>成员</TableHead>
                <TableHead>角色</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => {
                const display = member.user?.fullName || member.user?.email || '未知成员'
                const memberEmail = member.user?.email ?? '—'
                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarFallback>{display.slice(0, 1)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <strong className="block truncate font-medium text-gray-800">
                            {display}
                          </strong>
                          <span className="block truncate text-xs text-gray-500">
                            {memberEmail}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <PermissionGuard
                        require="org:member:manage"
                        fallback={<Chip>{ROLE_LABEL[member.role]}</Chip>}
                      >
                        <Select
                          value={member.role}
                          disabled={member.role === 'owner' || updateRolePending}
                          onValueChange={(role) =>
                            onUpdateRole(member.id, role as OrganizationMember['role'])
                          }
                        >
                          <SelectTrigger className="w-36" aria-label={`调整 ${display} 的角色`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="owner" disabled>
                              所有者
                            </SelectItem>
                            <SelectItem value="admin">管理员</SelectItem>
                            <SelectItem value="member">成员</SelectItem>
                            <SelectItem value="viewer">只读</SelectItem>
                          </SelectContent>
                        </Select>
                      </PermissionGuard>
                    </TableCell>
                    <TableCell className="text-right">
                      <PermissionGuard require="org:member:manage">
                        <IconButton
                          aria-label={`移除 ${display}`}
                          variant="danger"
                          size="sm"
                          disabled={member.role === 'owner' || removePending}
                          loading={removePending}
                          onClick={() => onRemove(member.id)}
                        >
                          <Trash2 aria-hidden />
                        </IconButton>
                      </PermissionGuard>
                    </TableCell>
                  </TableRow>
                )
              })}
              {members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-10 text-center text-gray-500">
                    暂无组织成员
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  )
}

function InviteOrganizationMember({
  organizationId,
  onAdded,
}: {
  organizationId: number
  onAdded: () => void
}) {
  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    mode: 'onChange',
    defaultValues: { email: '', role: 'member' },
  })
  const invite = useMutation({
    mutationFn: (values: InviteValues) => membersApi.invite(organizationId, values),
    onSuccess: () => {
      form.reset()
      onAdded()
    },
  })

  return (
    <PermissionGuard require="org:member:manage">
      <Form {...form}>
        <form
          className="grid gap-4 px-[var(--card-pad)] py-5 md:grid-cols-[minmax(0,1fr)_12rem_auto] md:items-start"
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
            name="role"
            render={({ field }) => (
              <FormItem>
                <FormLabel>组织角色</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="admin">管理员</SelectItem>
                    <SelectItem value="member">成员</SelectItem>
                    <SelectItem value="viewer">只读</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormSubmit
            className="md:mt-[1.625rem]"
            disabled={invite.isPending || undefined}
            loading={invite.isPending}
          >
            邀请成员
          </FormSubmit>
          {invite.isError ? (
            <Alert className="md:col-span-3" variant="danger" title="邀请成员失败" />
          ) : null}
        </form>
      </Form>
    </PermissionGuard>
  )
}

function DeleteOrganizationDialog({
  organizationName,
  loading,
  onConfirm,
}: {
  organizationName: string
  loading: boolean
  onConfirm: () => void
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="danger">删除组织</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认删除组织</DialogTitle>
          <DialogDescription>
            将永久删除“{organizationName}”及其数据，此操作无法撤销。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">取消</Button>
          </DialogClose>
          <Button variant="danger" loading={loading} onClick={onConfirm}>
            确认删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TransferOwnershipDialog({
  members,
  loading,
  onConfirm,
}: {
  members: OrganizationMember[]
  loading: boolean
  onConfirm: (memberId: number) => void
}) {
  const candidates = members.filter((member) => member.role !== 'owner')
  const form = useForm<TransferOwnershipValues>({
    resolver: zodResolver(transferOwnershipSchema),
    mode: 'onChange',
    defaultValues: { memberId: '' },
  })

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" disabled={candidates.length === 0}>
          转交所有权
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>转交组织所有权</DialogTitle>
          <DialogDescription>
            新所有者将获得组织最高权限，当前所有者会自动变为管理员。
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit(({ memberId }) => onConfirm(Number(memberId)))}
          >
            <FormField
              control={form.control}
              name="memberId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>新所有者</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="选择组织成员" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {candidates.map((member) => (
                        <SelectItem key={member.id} value={String(member.id)}>
                          {member.user?.fullName || member.user?.email || `成员 #${member.userId}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  取消
                </Button>
              </DialogClose>
              <FormSubmit loading={loading} disabled={loading || undefined}>
                确认转交
              </FormSubmit>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
