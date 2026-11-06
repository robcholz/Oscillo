// A Modal that asks for a few values: text, number or a choice, with inline validation.
// Covers the "Rename…", "Add Measurement…", "Edit Formula…" kind of dialog.
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Button } from './button'
import { Input } from './input'
import { Modal } from './modal'
import { Select } from './select'

export interface FormField {
  key: string
  label: string
  type?: 'text' | 'number' | 'select'
  value?: string
  options?: readonly string[]
  placeholder?: string
  suffix?: string
  required?: boolean
  mono?: boolean
  help?: ReactNode
  /** Return an error message, or null when the value is fine. */
  validate?: (value: string, all: Record<string, string>) => string | null
}

export interface FormModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  fields: FormField[]
  submitLabel: string
  onSubmit: (values: Record<string, string>) => void
  columns?: 1 | 2
  width?: number
}

function Row({ f, value, error, onChange }: { f: FormField; value: string; error?: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-[13px] leading-4 text-gray-900">
        {f.label}
      </label>
      {f.type === 'select' ? (
        <Select id={id} size="small" aria-label={f.label} value={value} onValueChange={onChange} options={f.options ?? []} />
      ) : (
        <Input
          id={id}
          size="small"
          inputMode={f.type === 'number' ? 'decimal' : undefined}
          mono={f.mono}
          value={value}
          placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value)}
          suffix={f.suffix ? <span className="text-[13px] text-gray-700">{f.suffix}</span> : undefined}
          error={error}
        />
      )}
      {f.help && !error && <p className="m-0 text-[13px] leading-[18px] text-gray-900">{f.help}</p>}
    </div>
  )
}

export function FormModal({ open, onClose, title, description, fields, submitLabel, onSubmit, columns = 1, width }: FormModalProps) {
  const init = (): Record<string, string> => Object.fromEntries(fields.map((f) => [f.key, f.value ?? (f.type === 'select' ? (f.options?.[0] ?? '') : '')]))
  const [values, setValues] = useState(init)
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    if (open) {
      setValues(init())
      setErrors({})
    }
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const submit = (): void => {
    const errs: Record<string, string> = {}
    for (const f of fields) {
      const v = (values[f.key] ?? '').trim()
      if (f.required && !v) errs[f.key] = `Enter a ${f.label.toLowerCase()}.`
      else if (f.type === 'number' && v && !Number.isFinite(Number(v))) errs[f.key] = 'Enter a number.'
      else {
        const e = f.validate?.(v, values)
        if (e) errs[f.key] = e
      }
    }
    setErrors(errs)
    if (Object.keys(errs).length) return
    onSubmit(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])))
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      width={width ?? (columns === 2 ? 560 : 480)}
      onSubmit={submit}
      actions={
        <>
          <Button type="secondary" size="small" onClick={onClose}>
            Cancel
          </Button>
          <Button size="small" typeName="submit">
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className={columns === 2 ? 'grid grid-cols-2 gap-4' : 'flex flex-col gap-4'}>
        {fields.map((f) => (
          <Row
            key={f.key}
            f={f}
            value={values[f.key] ?? ''}
            error={errors[f.key]}
            onChange={(v) => {
              setValues((x) => ({ ...x, [f.key]: v }))
              if (errors[f.key]) setErrors((x) => ({ ...x, [f.key]: '' }))
            }}
          />
        ))}
      </div>
    </Modal>
  )
}
