import { z } from 'zod'

export const projectFormSchema = z
  .object({
    name: z.string().trim().min(1, '项目名称必填'),
    code: z
      .string()
      .trim()
      .refine((value) => value.length === 0 || /^[A-Za-z0-9_-]+$/.test(value), {
        message: '项目编码只能包含字母、数字、短横线或下划线',
      }),
    description: z.string().trim(),
    priority: z.enum(['low', 'medium', 'high', 'critical']),
    startDate: z.string(),
    endDate: z.string(),
  })
  .refine((values) => !values.startDate || !values.endDate || values.startDate <= values.endDate, {
    message: '结束日期不能早于开始日期',
    path: ['endDate'],
  })

export type ProjectFormValues = z.infer<typeof projectFormSchema>
