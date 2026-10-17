'use client'

import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { Slot } from '@radix-ui/react-slot'
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/Label'
import { Button, type ButtonProps } from '@/components/ui/Button'

/**
 * 表单封装（form-system）：react-hook-form + zod。
 * 提供 Form/FormField/FormItem/FormLabel/FormControl/FormMessage/FormDescription，
 * 字段错误在下方给中文具体文案（非仅红边框），标签在上、控件在下。
 * 前端 zod 校验是体验层，不替代后端 AdonisJS(vine) 权威校验。
 */
export const Form = FormProvider

type FormFieldContextValue = { name: string }
const FormFieldContext = React.createContext<FormFieldContextValue | null>(null)

type FormItemContextValue = { id: string }
const FormItemContext = React.createContext<FormItemContextValue | null>(null)

/** 新手↔专业模式（渐进披露）：novice 仅显示必填字段，pro 显示全部。默认 pro。 */
export type FormMode = 'novice' | 'pro'
const FormModeContext = React.createContext<FormMode>('pro')
export function FormModeProvider({
  mode,
  children,
}: {
  mode: FormMode
  children: React.ReactNode
}) {
  return <FormModeContext.Provider value={mode}>{children}</FormModeContext.Provider>
}
export const useFormMode = () => React.useContext(FormModeContext)

export function useFormField() {
  const fieldContext = React.useContext(FormFieldContext)
  const itemContext = React.useContext(FormItemContext)
  const { getFieldState } = useFormContext()
  const formState = useFormState({ name: fieldContext?.name })
  if (!fieldContext) throw new Error('useFormField 必须在 <FormField> 内使用')
  const fieldState = getFieldState(fieldContext.name, formState)
  const id = itemContext?.id ?? fieldContext.name
  return {
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  }
}

export interface FormFieldProps<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> extends ControllerProps<TFieldValues, TName> {
  /** 标记为专业字段：novice 模式下隐藏（字段仍属同一数据模型，仅可见性变化）。 */
  advanced?: boolean
}

export function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ advanced, ...props }: FormFieldProps<TFieldValues, TName>) {
  const mode = useFormMode()
  if (advanced && mode === 'novice') return null
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  )
}

export const FormItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const id = React.useId()
    return (
      <FormItemContext.Provider value={{ id }}>
        <div ref={ref} className={cn('space-y-1.5', className)} {...props} />
      </FormItemContext.Provider>
    )
  },
)
FormItem.displayName = 'FormItem'

export const FormLabel = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => {
  const { error, formItemId } = useFormField()
  return (
    <Label
      ref={ref}
      htmlFor={formItemId}
      className={cn(error && 'text-danger', className)}
      {...props}
    />
  )
})
FormLabel.displayName = 'FormLabel'

export const FormControl = React.forwardRef<
  React.ElementRef<typeof Slot>,
  React.ComponentPropsWithoutRef<typeof Slot>
>(({ ...props }, ref) => {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField()
  return (
    <Slot
      ref={ref}
      id={formItemId}
      aria-describedby={error ? `${formDescriptionId} ${formMessageId}` : formDescriptionId}
      aria-invalid={!!error}
      {...props}
    />
  )
})
FormControl.displayName = 'FormControl'

export const FormDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => {
  const { formDescriptionId } = useFormField()
  return (
    <p
      ref={ref}
      id={formDescriptionId}
      className={cn('text-sm text-gray-500', className)}
      {...props}
    />
  )
})
FormDescription.displayName = 'FormDescription'

export const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => {
  const { error, formMessageId } = useFormField()
  const body = error ? String(error?.message ?? '') : children
  if (!body) return null
  return (
    <p
      ref={ref}
      id={formMessageId}
      className={cn('text-sm font-medium text-danger', className)}
      {...props}
    >
      {body}
    </p>
  )
})
FormMessage.displayName = 'FormMessage'

/**
 * 提交按钮——仅在表单有改动且校验通过时高亮为主按钮可提交态，
 * 否则弱化并禁用；提交中显示 loading。
 */
export function FormSubmit({ children, disabled, ...props }: ButtonProps) {
  const { isDirty, isValid, isSubmitting } = useFormState()
  const canSubmit = isDirty && isValid
  return (
    <Button
      type="submit"
      variant={canSubmit ? 'primary' : 'secondary'}
      disabled={disabled ?? (!canSubmit || isSubmitting)}
      loading={isSubmitting}
      {...props}
    >
      {children}
    </Button>
  )
}
