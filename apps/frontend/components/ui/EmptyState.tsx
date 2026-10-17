'use client'

import * as React from 'react'
import Image from 'next/image'
import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'

export type EmptyStateIllustration = 'generic' | 'project' | 'task' | 'report' | 'search'

const illustrationSrc: Record<EmptyStateIllustration, string> = {
  generic: '/assets/empty-states/generic.svg',
  project: '/assets/empty-states/project.svg',
  task: '/assets/empty-states/task.svg',
  report: '/assets/empty-states/report.svg',
  search: '/assets/empty-states/search.svg',
}

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: LucideIcon
  illustration?: EmptyStateIllustration
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}

export function EmptyState({
  icon: Icon = Inbox,
  illustration,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
      {...props}
    >
      {illustration ? (
        <Image
          src={illustrationSrc[illustration]}
          alt=""
          aria-hidden="true"
          width={192}
          height={128}
          className="h-32 w-48 max-w-full shrink-0 object-contain"
        />
      ) : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400">
          <Icon className="h-7 w-7" aria-hidden />
        </span>
      )}
      <div className="space-y-1">
        <h3 className="text-balance text-lg font-semibold text-gray-800">{title}</h3>
        {description ? (
          <p className="mx-auto max-w-sm text-pretty text-sm text-gray-500">{description}</p>
        ) : null}
      </div>
      {action ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-3">{action}</div>
      ) : null}
    </div>
  )
}
