-- Apply once to the existing Auth project using the Supabase SQL editor.
-- Depends on harness-analytics/migrations/001_analytics.sql (shared administrator list).
create function public.market_is_admin() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.harness_analytics_admins where user_id = auth.uid());
$$;
revoke all on function public.market_is_admin() from public;
grant execute on function public.market_is_admin() to authenticated;
create table public.market_packages (
 id uuid primary key, owner_id uuid not null default auth.uid() references auth.users(id),
 name text not null check(char_length(name) between 1 and 80),
 author text not null check(char_length(author) between 1 and 80),
 description text not null check(char_length(description) between 10 and 10000),
 platforms text[] not null check(cardinality(platforms) between 1 and 20),
 version text not null check(char_length(version) between 1 and 60),
 harness_range text not null check(char_length(harness_range) between 1 and 100),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 size_bytes bigint not null check(size_bytes between 1 and 52428800),
 status text not null default 'draft' check(status in ('draft','pending','approved','rejected','withdrawn')),
 review_note text not null default '', reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
 created_at timestamptz not null default now()
);
create index market_status_created on public.market_packages(status, created_at desc);
create index market_owner_created on public.market_packages(owner_id, created_at desc);
alter table public.market_packages enable row level security;
grant select, insert on public.market_packages to authenticated;
revoke update, delete on public.market_packages from anon, authenticated;
create policy market_read on public.market_packages for select to authenticated using (
 status = 'approved' or owner_id = auth.uid() or public.market_is_admin()
);
create policy market_create on public.market_packages for insert to authenticated with check (
 owner_id = auth.uid() and coalesce((auth.jwt()->>'is_anonymous')::boolean,false) = false
 and status = 'draft' and review_note = '' and reviewed_by is null and reviewed_at is null
);
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('market-packages','market-packages',false,52428800,array['application/zip']);
-- Immutable objects: nobody may replace/delete an uploaded ZIP through the client.
create policy market_zip_upload on storage.objects for insert to authenticated with check (
 bucket_id = 'market-packages' and exists (
 select 1 from public.market_packages p where storage.objects.name = p.owner_id::text || '/' || p.id::text || '.zip'
 and p.owner_id = auth.uid() and p.status = 'draft')
);
create policy market_zip_read on storage.objects for select to authenticated using (
 bucket_id = 'market-packages' and exists (
 select 1 from public.market_packages p where storage.objects.name = p.owner_id::text || '/' || p.id::text || '.zip'
 and (p.status = 'approved' or p.owner_id = auth.uid() or public.market_is_admin()))
);
create function public.market_submit(package_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
 update public.market_packages p set status = 'pending'
 where p.id = package_id and p.owner_id = auth.uid() and p.status = 'draft'
 and exists(select 1 from storage.objects o where o.bucket_id = 'market-packages'
 and o.name = p.owner_id::text || '/' || p.id::text || '.zip');
 if not found then raise exception 'Package is missing, already submitted, or not owned by you'; end if;
end; $$;
create function public.market_review(package_id uuid, decision text, note text default '') returns void
language plpgsql security definer set search_path = '' as $$
begin
 if not public.market_is_admin() then raise exception 'Administrator required'; end if;
 if decision not in ('approved','rejected','withdrawn') then raise exception 'Invalid decision'; end if;
 if char_length(note) > 2000 or (decision <> 'approved' and char_length(trim(note)) = 0) then raise exception 'Review reason required (max 2000 characters)'; end if;
 update public.market_packages set status = decision, review_note = note, reviewed_by = auth.uid(), reviewed_at = now()
 where id = package_id and ((status = 'pending' and decision in ('approved','rejected')) or (status = 'approved' and decision = 'withdrawn'));
 if not found then raise exception 'Status changed; refresh before reviewing'; end if;
end; $$;
revoke all on function public.market_submit(uuid), public.market_review(uuid,text,text) from public;
grant execute on function public.market_submit(uuid), public.market_review(uuid,text,text) to authenticated;
