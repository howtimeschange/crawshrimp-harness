-- Private identity links; never match legacy owners by display name or email.
create table public.market_identity_links (
 account_id text primary key,
 payload jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.market_identity_links enable row level security;
revoke all on public.market_identity_links from anon, authenticated;
grant select, insert, update on public.market_identity_links to service_role;
