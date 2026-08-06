import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-4 py-8 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#EEF2FF]">
        <Icon className="h-5 w-5 text-[#4F46E5]" />
      </div>
      <div className="space-y-1">
        <p className="text-[13px] font-semibold text-[#0F0F1A]">{title}</p>
        {description && (
          <p className="text-[12px] text-[#8A8AA8] leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
