#!/usr/bin/env bash
# QA performance data (local only). Adds N SYNTHETIC tickets to the ISOLATED audit database (container supabase_db_ckdesk_audit; never the dev database).
# Requesters and technicians are the synthetic QA accounts made by seed-qa.mjs; tickets are spread over the last 365 days with a realistic mix of status / priority /
# category / assignee, and carry the title prefix "PERF-DATA" so they are removed by:   gen-perf-data.sh clean
# Usage: gen-perf-data.sh <total number of PERF-DATA tickets wanted in the database>   |   gen-perf-data.sh clean
set -euo pipefail
export MSYS_NO_PATHCONV=1
DB=supabase_db_ckdesk_audit
psql_() { docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At "$@"; }
if [ "${1:-}" = "clean" ]; then
  psql_ -c "delete from request_comments where request_id in (select id from requests where title like 'PERF-DATA%'); delete from request_activity where request_id in (select id from requests where title like 'PERF-DATA%'); delete from requests where title like 'PERF-DATA%'; select 'left: '||count(*) from requests where title like 'PERF-DATA%'"
  exit 0
fi
TARGET=${1:?usage: gen-perf-data.sh <count>|clean}
HAVE=$(psql_ -c "select count(*) from requests where title like 'PERF-DATA%'")
NEED=$((TARGET - HAVE))
if [ "$NEED" -le 0 ]; then echo "already $HAVE PERF-DATA tickets"; exit 0; fi
echo "have $HAVE, adding $NEED"
BATCH=25000
DONE=0
while [ "$DONE" -lt "$NEED" ]; do
  N=$((NEED - DONE)); [ "$N" -gt "$BATCH" ] && N=$BATCH
  psql_ -c "
with cfg as (
  select (select array_agg(p.id) from profiles p join auth.users u on u.id=p.id where u.email in ('storea.qa@audit.test','storeb.qa@audit.test','storec.qa@audit.test','storee.qa@audit.test','storea2.qa@audit.test','ho.qa@audit.test')) as reqs,
         (select array_agg(p.id) from profiles p join auth.users u on u.id=p.id where u.email in ('tech1.qa@audit.test','tech2.qa@audit.test','itech.qa@audit.test')) as techs,
         (select id from services where slug='qa-admin-requirements') as svc, (select team_id from services where slug='qa-admin-requirements') as team,
         (select array_agg(id) from service_categories where slug in ('qa-fixtures','qa-hangers','qa-ac','qa-sensor','qa-general')) as cats,
         (select '00000000-0000-0000-0000-000000000001'::uuid) as org
)
insert into requests (request_no, title, requester_id, service_id, team_id, status, priority, category_id, sub_category_id, form_data, form_sections_snapshot, created_at, updated_at, resolved_at, closed_at, assigned_to, org_id)
select '', 'PERF-DATA ' || (g + $HAVE + $DONE), c.reqs[1 + (g % array_length(c.reqs,1))], c.svc, c.team,
       s.status::request_status, (array['low','medium','medium','high','urgent'])[1 + (g % 5)]::request_priority,
       c.cats[1 + (g % array_length(c.cats,1))], (select id from service_sub_categories sc where sc.category_id = c.cats[1 + (g % array_length(c.cats,1))] limit 1),
       jsonb_build_object('f_subject', 'perf ' || g), '[]'::jsonb,
       ts.created, ts.created + interval '1 hour',
       case when s.status in ('resolved','closed') then ts.created + (interval '1 hour' * (2 + (g % 60))) end,
       case when s.status = 'closed' then ts.created + (interval '1 hour' * (80 + (g % 60))) end,
       case when s.status = 'open' and g % 3 = 0 then null else c.techs[1 + (g % array_length(c.techs,1))] end, c.org
from generate_series(1, $N) g, cfg c,
     lateral (select (array['open','assigned','in_progress','in_progress','waiting_user','resolved','resolved','closed','closed','closed','cancelled'])[1 + (g % 11)] as status) s,
     lateral (select now() - (interval '1 minute' * ((g * 7919) % 525600)) as created) ts;
select count(*) from requests where title like 'PERF-DATA%'"
  DONE=$((DONE + N))
done
psql_ -c "analyze requests; select 'total requests: '||count(*) from requests"
