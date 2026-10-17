'use client'

import { Input } from '@/components/ui/Input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { useCallback } from 'react'
import type { AuditLogFilters as Filters } from '@/lib/api/audit-logs'

const ACTIONS = [
  'create',
  'read',
  'update',
  'delete',
  'export',
  'login',
  'logout',
  'approve',
  'reject',
] as const
const SEVERITIES = ['info', 'warning', 'error', 'critical'] as const

interface Props {
  filters: Filters
  onChange: (filters: Filters) => void
}

export function AuditLogFilters({ filters, onChange }: Props) {
  const set = useCallback(
    (key: keyof Filters, value: unknown) => {
      const next = { ...filters, [key]: value || undefined }
      delete next.page
      delete next.cursor
      onChange(next)
    },
    [filters, onChange],
  )

  return (
    <div className="flex flex-wrap gap-3">
      <Input
        className="w-48"
        placeholder="事件类型"
        value={filters.event ?? ''}
        onChange={(e) => set('event', e.target.value)}
        aria-label="事件类型"
      />
      <Select
        value={filters.action?.[0] ?? ''}
        onValueChange={(v) => set('action', v ? [v] : undefined)}
      >
        <SelectTrigger className="w-32" aria-label="操作类型">
          <SelectValue placeholder="操作" />
        </SelectTrigger>
        <SelectContent>
          {ACTIONS.map((a) => (
            <SelectItem key={a} value={a}>
              {a}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filters.severity?.[0] ?? ''}
        onValueChange={(v) => set('severity', v ? [v] : undefined)}
      >
        <SelectTrigger className="w-32" aria-label="严重级别">
          <SelectValue placeholder="级别" />
        </SelectTrigger>
        <SelectContent>
          {SEVERITIES.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        className="w-40"
        type="date"
        value={filters.dateFrom ?? ''}
        onChange={(e) => set('dateFrom', e.target.value)}
        aria-label="开始日期"
      />
      <Input
        className="w-40"
        type="date"
        value={filters.dateTo ?? ''}
        onChange={(e) => set('dateTo', e.target.value)}
        aria-label="结束日期"
      />
      <Input
        className="w-40"
        placeholder="操作人 ID"
        value={filters.actorId ?? ''}
        onChange={(e) => set('actorId', e.target.value ? Number(e.target.value) : undefined)}
        aria-label="操作人 ID"
        type="number"
      />
      <Input
        className="w-40"
        placeholder="实体类型"
        value={filters.entityType ?? ''}
        onChange={(e) => set('entityType', e.target.value)}
        aria-label="实体类型"
      />
      <Input
        className="w-40"
        placeholder="请求 ID"
        value={filters.requestId ?? ''}
        onChange={(e) => set('requestId', e.target.value)}
        aria-label="请求 ID"
      />
    </div>
  )
}
