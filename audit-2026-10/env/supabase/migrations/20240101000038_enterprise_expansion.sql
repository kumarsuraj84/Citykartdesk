-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 038 — Phase 4: Enterprise Expansion
-- • csat_surveys       — one survey per closed/resolved request, filled by requester
-- • related_requests   — M2M link between requests (symmetric)
-- • kb_articles        — knowledge base articles, org-scoped
-- • kb_article_services — M2M: article ↔ service (surface from service detail)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. CSAT surveys ─────────────────────────────────────────────────────────────

CREATE TABLE csat_surveys (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id   UUID        NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  requester_id UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- rating: 1 (terrible) – 5 (excellent)
  rating       SMALLINT    CHECK (rating BETWEEN 1 AND 5),
  comment      TEXT,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  UNIQUE (request_id)
);

CREATE INDEX idx_csat_org       ON csat_surveys(org_id);
CREATE INDEX idx_csat_request   ON csat_surveys(request_id);
CREATE INDEX idx_csat_rating    ON csat_surveys(rating) WHERE rating IS NOT NULL;

ALTER TABLE csat_surveys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "csat_select" ON csat_surveys FOR SELECT USING (
  requester_id = auth.uid()
  OR current_user_role() IN ('manager', 'admin', 'platform_owner')
);
CREATE POLICY "csat_insert_system" ON csat_surveys FOR INSERT WITH CHECK (
  org_id = current_org_id()
  AND current_user_role() IN ('admin', 'platform_owner')
);
CREATE POLICY "csat_update_requester" ON csat_surveys FOR UPDATE USING (
  requester_id = auth.uid()
  AND submitted_at IS NULL
);

GRANT ALL ON csat_surveys TO service_role;
GRANT SELECT, UPDATE ON csat_surveys TO authenticated;

-- 2. Related requests ─────────────────────────────────────────────────────────

CREATE TABLE related_requests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id    UUID        NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  related_id    UUID        NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  link_type     TEXT        NOT NULL DEFAULT 'related'
                            CHECK (link_type IN ('related', 'duplicates', 'blocks', 'is_blocked_by', 'caused_by')),
  created_by    UUID        NOT NULL REFERENCES profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- symmetric uniqueness: (A,B) and (B,A) are the same link
  UNIQUE (request_id, related_id),
  CHECK (request_id <> related_id)
);

CREATE INDEX idx_related_request  ON related_requests(request_id);
CREATE INDEX idx_related_related  ON related_requests(related_id);
CREATE INDEX idx_related_org      ON related_requests(org_id);

ALTER TABLE related_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "related_select" ON related_requests FOR SELECT USING (
  org_id = current_org_id()
);
CREATE POLICY "related_insert" ON related_requests FOR INSERT WITH CHECK (
  org_id = current_org_id()
  AND current_user_role() IN ('agent', 'manager', 'admin', 'platform_owner')
);
CREATE POLICY "related_delete" ON related_requests FOR DELETE USING (
  org_id = current_org_id()
  AND (created_by = auth.uid() OR current_user_role() IN ('manager', 'admin', 'platform_owner'))
);

GRANT ALL ON related_requests TO service_role;
GRANT SELECT, INSERT, DELETE ON related_requests TO authenticated;

-- 3. Knowledge base ────────────────────────────────────────────────────────────

CREATE TYPE kb_article_status AS ENUM ('draft', 'published', 'archived');

CREATE TABLE kb_articles (
  id           UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID             NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title        TEXT             NOT NULL,
  slug         TEXT             NOT NULL,
  content      TEXT             NOT NULL DEFAULT '',
  status       kb_article_status NOT NULL DEFAULT 'draft',
  author_id    UUID             NOT NULL REFERENCES profiles(id),
  view_count   INTEGER          NOT NULL DEFAULT 0,
  helpful_yes  INTEGER          NOT NULL DEFAULT 0,
  helpful_no   INTEGER          NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE INDEX idx_kb_org_status  ON kb_articles(org_id, status);
CREATE INDEX idx_kb_author      ON kb_articles(author_id);
CREATE INDEX idx_kb_search      ON kb_articles USING GIN(
  to_tsvector('english', title || ' ' || coalesce(content, ''))
);

ALTER TABLE kb_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kb_select" ON kb_articles FOR SELECT USING (
  org_id = current_org_id()
  AND (status = 'published' OR current_user_role() IN ('manager', 'admin', 'platform_owner'))
);
CREATE POLICY "kb_insert" ON kb_articles FOR INSERT WITH CHECK (
  org_id = current_org_id()
  AND current_user_role() IN ('manager', 'admin', 'platform_owner')
);
CREATE POLICY "kb_update" ON kb_articles FOR UPDATE USING (
  org_id = current_org_id()
  AND current_user_role() IN ('manager', 'admin', 'platform_owner')
);
CREATE POLICY "kb_delete" ON kb_articles FOR DELETE USING (
  org_id = current_org_id()
  AND current_user_role() IN ('admin', 'platform_owner')
);

GRANT ALL ON kb_articles TO service_role;
GRANT SELECT ON kb_articles TO authenticated;
GRANT INSERT, UPDATE ON kb_articles TO authenticated;

-- M2M: article ↔ service ──────────────────────────────────────────────────────

CREATE TABLE kb_article_services (
  article_id UUID NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, service_id)
);

ALTER TABLE kb_article_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kb_svc_select" ON kb_article_services FOR SELECT USING (
  EXISTS (SELECT 1 FROM kb_articles WHERE id = article_id AND org_id = current_org_id())
);
CREATE POLICY "kb_svc_write" ON kb_article_services FOR ALL USING (
  EXISTS (SELECT 1 FROM kb_articles WHERE id = article_id AND org_id = current_org_id())
  AND current_user_role() IN ('manager', 'admin', 'platform_owner')
);

GRANT ALL ON kb_article_services TO service_role;
GRANT SELECT ON kb_article_services TO authenticated;

-- 4. updated_at trigger for kb_articles ───────────────────────────────────────

CREATE TRIGGER set_kb_articles_updated_at
  BEFORE UPDATE ON kb_articles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
