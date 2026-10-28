-- Public bucket for admin-uploaded icons (services/categories/sub-categories).
-- No storage.objects RLS needed: all writes go through the admin/service-role
-- client (bypasses RLS entirely), all reads are via the public URL (bucket is
-- public, so Storage serves it directly without a policy check).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('icons', 'icons', true, 5242880, ARRAY['image/png','image/jpeg','image/gif','image/webp'])
ON CONFLICT (id) DO NOTHING;

ALTER TABLE services ADD COLUMN icon_image_url TEXT;
ALTER TABLE service_categories ADD COLUMN icon_image_url TEXT;
ALTER TABLE service_sub_categories ADD COLUMN icon_image_url TEXT;

NOTIFY pgrst, 'reload schema';
