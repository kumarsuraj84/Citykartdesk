set session_replication_role = replica;
with su as (select p.id, row_number() over (order by p.id) rn from profiles p where p.store_id is not null),
     tk as (select id, row_number() over (order by id) rn from requests where status not in ('resolved','closed','cancelled') limit 120)
update requests r set requester_id = su.id, created_at = now() - (random()*25 || ' days')::interval
from tk join su on su.rn = tk.rn where r.id = tk.id;
