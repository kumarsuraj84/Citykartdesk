import Image from 'next/image'
import { cn } from '@/lib/utils'

// Source asset is 1774x887 (~2:1) on a light canvas.
const ASPECT = 887 / 1774

interface BrandLogoProps {
  /** Rendered height in px — width follows the logo's native aspect ratio. */
  height?: number
  className?: string
  priority?: boolean
}

/** The complete Citykart Desk logo — used everywhere the brand identity
 * appears: the app header and auth screens. */
export function BrandLogo({ height = 32, className, priority }: BrandLogoProps) {
  const width = Math.round(height / ASPECT)
  return (
    <div className={cn('inline-flex items-center', className)}>
      <Image
        src="/citykart-desk-logo-full.png"
        alt="Citykart Desk"
        width={width}
        height={height}
        priority={priority}
        style={{ width, height }}
        className="rounded-xl object-contain"
      />
    </div>
  )
}
