import { confirm, message } from '@tauri-apps/plugin-dialog'

type DialogKind = 'info' | 'warning' | 'error'

type DialogOptions = {
  title?: string
  kind?: DialogKind
}

export type FieldValidationMap<FieldKey extends string> = Partial<Record<FieldKey, string>>

export async function showMessageDialog(text: string, options: DialogOptions = {}) {
  const title = options.title ?? '알림'
  const kind = options.kind ?? 'info'

  try {
    await message(text, {
      title,
      kind,
      buttons: 'Ok',
    })
    return
  } catch (error) {
    console.error('dialog fallback', error)
  }

  if (typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert(`${title}\n\n${text}`)
  }
}

export async function showConfirmDialog(text: string, options: DialogOptions = {}) {
  const title = options.title ?? '확인'
  const kind = options.kind ?? 'warning'

  try {
    return await confirm(text, {
      title,
      kind,
      okLabel: '확인',
      cancelLabel: '취소',
    })
  } catch (error) {
    console.error('confirm dialog fallback', error)
  }

  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return window.confirm(`${title}\n\n${text}`)
  }

  return false
}

export async function showValidationDialog(issues: string[], title = '입력 확인') {
  if (issues.length === 0) {
    return
  }

  const body = ['아래 항목을 확인해 주세요.', '', ...issues.map((issue, index) => `${index + 1}. ${issue}`)].join(
    '\n',
  )

  await showMessageDialog(body, {
    title,
    kind: 'warning',
  })
}

export async function showErrorDialog(error: unknown, title = '오류') {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '처리 중 알 수 없는 오류가 발생했습니다.'

  await showMessageDialog(text, {
    title,
    kind: 'error',
  })
}

export function clearFieldError<FieldKey extends string>(
  fieldErrors: FieldValidationMap<FieldKey>,
  field: FieldKey,
) {
  if (!fieldErrors[field]) {
    return fieldErrors
  }

  const nextFieldErrors = { ...fieldErrors }
  delete nextFieldErrors[field]
  return nextFieldErrors
}

export function findFirstInvalidField<FieldKey extends string>(
  fieldOrder: readonly FieldKey[],
  fieldErrors: FieldValidationMap<FieldKey>,
) {
  return fieldOrder.find((field) => Boolean(fieldErrors[field])) ?? null
}

export function focusFieldErrorTarget(field: string) {
  if (typeof document === 'undefined') {
    return
  }

  requestAnimationFrame(() => {
    const element = document.querySelector<HTMLElement>(`[data-field-error-target="${field}"]`)
    if (!element) {
      return
    }

    element.focus()
    element.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    })

    if (
      element instanceof HTMLInputElement &&
      ['email', 'password', 'search', 'tel', 'text', 'url'].includes(element.type)
    ) {
      element.select()
    }

    if (element instanceof HTMLTextAreaElement) {
      element.select()
    }
  })
}
