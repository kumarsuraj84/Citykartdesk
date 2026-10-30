'use client'

import type { ReactNode } from 'react'
import { useModalA11y } from './useModalA11y'

/**
 * The full-screen wrapper of a pop-up window, with keyboard and screen-reader support built in
 * (see useModalA11y). Use it where a pop-up is written inline inside a bigger component and so
 * cannot call the hook itself. It adds no styling of its own.
 */
export function ModalFrame({ onClose, label, className, children }: {
  onClose: () => void
  label: string
  className?: string
  children: ReactNode
}) {
  const dialog = useModalA11y({ onClose, label })
  return <div {...dialog.props} className={className}>{children}</div>
}
