import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/form'

interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  danger?: boolean
  /** require the user to type this phrase (for irreversible operations) */
  typeToConfirm?: string
}

type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>
const Ctx = createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const [typed, setTyped] = useState('')
  const resolver = useRef<(v: boolean) => void>(undefined)

  const confirm = useCallback<ConfirmFn>((o) => {
    setTyped('')
    setOpts(o)
    return new Promise<boolean>((res) => (resolver.current = res))
  }, [])

  const close = (v: boolean) => {
    resolver.current?.(v)
    setOpts(null)
  }

  const blocked = !!opts?.typeToConfirm && typed !== opts.typeToConfirm

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal
        open={!!opts}
        onClose={() => close(false)}
        title={opts?.title}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
            <Button variant={opts?.danger ? 'danger' : 'primary'} disabled={blocked} onClick={() => close(true)}>
              {opts?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-muted">
          {opts?.message}
          {opts?.typeToConfirm && (
            <div>
              <p className="mb-2">Type <strong className="text-fg">{opts.typeToConfirm}</strong> to confirm.</p>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-label="Confirmation phrase" />
            </div>
          )}
        </div>
      </Modal>
    </Ctx.Provider>
  )
}

export function useConfirm() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useConfirm outside ConfirmProvider')
  return c
}
