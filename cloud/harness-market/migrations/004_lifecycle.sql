-- Stable developer-owned scripts; immutable releases. All state writes use RPCs.
begin;
create table public.market_scripts (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users,
 adapter_id text not null check(adapter_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$'),
 created_at timestamptz not null default now(), unique(owner_id,adapter_id)
);
alter table public.market_packages add column script_id uuid references public.market_scripts;
alter table public.market_packages add column adapter_id text;
alter table public.market_packages drop constraint market_packages_status_check;
alter table public.market_packages add constraint market_packages_status_check check(status in ('draft','pending','approved','rejected','withdrawn','canceled','superseded'));
create unique index market_release_version on public.market_packages(script_id,version);
create unique index market_release_live on public.market_packages(script_id) where status='approved';
create index market_script_history on public.market_packages(script_id,created_at desc);
create table public.market_events (
 id bigint generated always as identity primary key, package_id uuid not null references public.market_packages,
 actor_id uuid references auth.users, from_status text, to_status text not null, note text not null default '', created_at timestamptz not null default now()
);
alter table public.market_scripts enable row level security;
alter table public.market_events enable row level security;
grant select on public.market_scripts,public.market_events to authenticated;
create policy market_scripts_read on public.market_scripts for select to authenticated using(owner_id=auth.uid() or public.market_is_admin() or exists(select 1 from public.market_packages p where p.script_id=market_scripts.id and p.status='approved'));
create policy market_events_read on public.market_events for select to authenticated using(exists(select 1 from public.market_packages p where p.id=package_id and (p.owner_id=auth.uid() or public.market_is_admin())));
create function public.market_log_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='INSERT' then
 insert into public.market_events(package_id,actor_id,to_status) values(new.id,auth.uid(),new.status);
 elsif new.status is distinct from old.status then
 insert into public.market_events(package_id,actor_id,from_status,to_status,note) values(new.id,auth.uid(),old.status,new.status,new.review_note);
 end if; return new;
end; $$;
create trigger market_state_event after insert or update on public.market_packages for each row execute function public.market_log_event();
-- New clients cannot bypass stable identity by inserting an unlinked release.
revoke insert on public.market_packages from authenticated;
create function public.market_begin_release(metadata jsonb, adapter text, digest text, bytes bigint)
returns public.market_packages language plpgsql security definer set search_path='' as $$
declare sid uuid; p public.market_packages;
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Verified account required'; end if;
 if adapter is null or adapter !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$' then raise exception 'Invalid adapter id'; end if;
 if (metadata->>'version') is null or (metadata->>'version') !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$' then raise exception 'Invalid version'; end if;
 insert into public.market_scripts(owner_id,adapter_id) values(auth.uid(),adapter) on conflict(owner_id,adapter_id) do nothing;
 select id into sid from public.market_scripts where owner_id=auth.uid() and adapter_id=adapter for update;
 select * into p from public.market_packages where script_id=sid and version=metadata->>'version';
 if found then
 if p.sha256<>digest then raise exception 'Version already exists; increment manifest version'; end if;
 return p; end if;
 -- Adopt legacy releases only when the owner supplies the exact immutable ZIP.
 select * into p from public.market_packages where owner_id=auth.uid() and sha256=digest and version=metadata->>'version' and script_id is null order by created_at limit 1 for update;
 if found then
 update public.market_packages set script_id=sid,adapter_id=adapter where id=p.id returning * into p;
 return p;
 end if;
 select * into p from public.market_packages where script_id=sid and version=metadata->>'version';
 if found then
 if p.sha256<>digest then raise exception 'Version already exists; increment manifest version'; end if;
 return p;
 end if;
 insert into public.market_packages(id,owner_id,script_id,adapter_id,name,author,description,platforms,version,harness_range,icon,sha256,size_bytes)
 values(gen_random_uuid(),auth.uid(),sid,adapter,metadata->>'name',metadata->>'author',metadata->>'description',array(select jsonb_array_elements_text(metadata->'platforms')),metadata->>'version',metadata->>'harness_range',coalesce(metadata->>'icon',''),digest,bytes) returning * into p;
 return p;
end; $$;
create or replace function public.market_submit(package_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.market_packages;
begin
 select * into p from public.market_packages where id=package_id and owner_id=auth.uid();
 perform 1 from public.market_scripts where id=p.script_id for update;
 select * into p from public.market_packages where id=package_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Package is missing or not owned by you'; end if;
 if p.status='pending' then return; end if;
 if p.status not in ('draft','canceled','rejected','withdrawn') then raise exception 'Status changed; refresh before submitting'; end if;
 if p.status='withdrawn' and p.reviewed_by is not null and p.reviewed_by<>p.owner_id then raise exception 'Administrator withdrew this release; publish a corrected new version'; end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='market-packages' and o.name=p.owner_id::text||'/'||p.id::text||'.zip') then raise exception 'Package ZIP missing'; end if;
 update public.market_packages set status='pending',review_note='',reviewed_by=null,reviewed_at=null where id=p.id;
end; $$;
create function public.market_owner_action(package_id uuid, action text, note text default '') returns void language plpgsql security definer set search_path='' as $$
declare p public.market_packages;
begin
 -- Serialize all per-script transitions in the same order as administrative review.
 select * into p from public.market_packages where id=package_id and owner_id=auth.uid();
 if not found then raise exception 'Package not owned by you'; end if;
 perform 1 from public.market_scripts where id=p.script_id for update;
 select * into p from public.market_packages where id=package_id for update;
 if note is null or char_length(note)>2000 then raise exception 'Invalid reason'; end if;
 if action='cancel' and p.status in ('draft','pending') then
 update public.market_packages set status='canceled',review_note=note,reviewed_by=auth.uid(),reviewed_at=now() where id=p.id;
 elsif action='unlist' and p.status='approved' then
 update public.market_packages set status='withdrawn',review_note=note,reviewed_by=auth.uid(),reviewed_at=now() where id=p.id;
 update public.market_packages set status='canceled',review_note='Developer unlisted script: '||note,reviewed_by=auth.uid(),reviewed_at=now() where script_id=p.script_id and status='pending';
 else raise exception 'Status changed; refresh before changing'; end if;
end; $$;
-- Compare semver precedence (build metadata does not affect precedence).
create function public.market_version_gt(a text,b text) returns boolean language plpgsql immutable set search_path='' as $$
declare ac numeric[];bc numeric[];ap text;bp text;aa text[];bb text[];i integer;
begin
 ac=string_to_array(split_part(split_part(a,'-',1),'+',1),'.')::numeric[];
 bc=string_to_array(split_part(split_part(b,'-',1),'+',1),'.')::numeric[];
 if ac<>bc then return ac>bc; end if;
 ap=substring(split_part(a,'+',1) from '-(.*)$');bp=substring(split_part(b,'+',1) from '-(.*)$');
 if ap is null then return bp is not null; elsif bp is null then return false; end if;
 aa=string_to_array(ap,'.');bb=string_to_array(bp,'.');
 for i in 1..greatest(cardinality(aa),cardinality(bb)) loop
 if aa[i] is null then return false; elsif bb[i] is null then return true; end if;
 if aa[i]=bb[i] then continue; end if;
 if aa[i]~'^[0-9]+$' and bb[i]~'^[0-9]+$' then return aa[i]::numeric>bb[i]::numeric;
 elsif aa[i]~'^[0-9]+$' then return false; elsif bb[i]~'^[0-9]+$' then return true;
 else return (aa[i] collate "C")>(bb[i] collate "C"); end if;
 end loop;return false;
end; $$;
create or replace function public.market_review(package_id uuid, decision text, note text default '') returns void language plpgsql security definer set search_path='' as $$
declare p public.market_packages;
begin
 if not public.market_is_admin() then raise exception 'Administrator required'; end if;
 if decision is null or decision not in ('approved','rejected','withdrawn') then raise exception 'Invalid decision'; end if;
 if note is null or char_length(note)>2000 or (decision<>'approved' and char_length(trim(note))=0) then raise exception 'Review reason required'; end if;
 select * into p from public.market_packages where id=package_id;
 perform 1 from public.market_scripts where id=p.script_id for update;
 select * into p from public.market_packages where id=package_id for update;
 if not found or not ((p.status='pending' and decision in ('approved','rejected')) or(p.status='approved' and decision='withdrawn')) then raise exception 'Status changed; refresh before reviewing'; end if;
 if decision='approved' and p.script_id is not null then
 if exists(select 1 from public.market_packages q where q.script_id=p.script_id and q.id<>p.id and q.status in ('approved','superseded','withdrawn') and not public.market_version_gt(p.version,q.version)) then raise exception 'A newer or equal version was already released'; end if;
 update public.market_packages set status='superseded',review_note='Replaced by v'||p.version where script_id=p.script_id and status='approved';
 end if;
 update public.market_packages set status=decision,review_note=note,reviewed_by=auth.uid(),reviewed_at=now() where id=p.id;
end; $$;
revoke all on function public.market_begin_release(jsonb,text,text,bigint), public.market_owner_action(uuid,text,text),public.market_version_gt(text,text),public.market_log_event() from public;
grant execute on function public.market_begin_release(jsonb,text,text,bigint),public.market_owner_action(uuid,text,text) to authenticated;
commit;
