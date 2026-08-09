import Image from 'next/image'
import { cn } from '@/lib/utils'

// Source asset is 1552x585 (~2.65:1), trimmed tight to the artwork.
const ASPECT = 585 / 1552

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
