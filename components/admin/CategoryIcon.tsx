// Shared icon-box renderer for Category/Sub-Category rows — prefers an
// uploaded image (icon_image_url) over the emoji (icon) whenever set.
export function CategoryIcon({
  icon,
  iconImageUrl,
  className,
}: {
  icon: string | null
  iconImageUrl?: string | null
  className: string
}) {
  return (
    <div className={`overflow-hidden ${className}`}>
      {iconImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase storage URL not in next.config's remote patterns
        <img src={iconImageUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        icon ?? '📋'
      )}
    </div>
  )
}
