import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'

/** Registers the service worker and offers a reload when a new version is ready. */
export function UpdatePrompt() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // check for updates hourly
      if (reg) setInterval(() => void reg.update(), 60 * 60_000)
    },
  })
  if (!needRefresh) return null
  return (
    <div className="fixed right-4 bottom-24 z-40 flex max-w-sm animate-slide-up items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-pop lg:bottom-6" role="status">
      <RefreshCw className="h-5 w-5 shrink-0 text-primary" />
      <div className="text-sm"><div className="font-semibold">Update available</div><div className="text-muted">Reload to get the latest LAKSHYA.</div></div>
      <Button size="sm" onClick={() => void updateServiceWorker(true)}>Reload</Button>
      <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>Later</Button>
    </div>
  )
}
