// WhatsApp click-to-chat. This only OPENS WhatsApp with a prefilled message –
// the user must press send. No unofficial automation, no paid gateway.
import { MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export function whatsappLink(text: string, number?: string | null): string {
  const base = number ? `https://wa.me/${number.replace(/\D/g, '')}` : 'https://wa.me/'
  return `${base}?text=${encodeURIComponent(text.slice(0, 1500))}`
}

export function WhatsAppShare({ text, number, iconOnly, label = 'Share on WhatsApp' }: { text: string; number?: string | null; iconOnly?: boolean; label?: string }) {
  const open = () => window.open(whatsappLink(text, number), '_blank', 'noopener,noreferrer')
  return iconOnly ? (
    <Button variant="ghost" size="icon-sm" onClick={open} aria-label={label} title={`${label} (opens WhatsApp – you press send)`}>
      <MessageCircle className="h-4 w-4 text-[#25D366]" />
    </Button>
  ) : (
    <Button variant="secondary" size="sm" onClick={open} icon={<MessageCircle className="h-4 w-4 text-[#25D366]" />} title="Opens WhatsApp with the message prefilled – you press send">
      {label}
    </Button>
  )
}
