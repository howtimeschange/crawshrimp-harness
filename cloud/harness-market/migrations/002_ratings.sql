-- Reviews are per package version; one rating per account, editable by its author.
create table public.market_ratings (
 package_id uuid not null references public.market_packages(id),
 user_id uuid not null references auth.users(id),
 stars smallint not null check(stars between 1 and 5),
 display_name text not null check(char_length(trim(display_name)) between 1 and 40),
 comment text not null default '' check(char_length(comment) <= 2000),
 hidden boolean not null default false,
 deleted boolean not null default false,
 moderation_note text not null default '',
 moderated_by uuid references auth.users(id),
 moderated_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(package_id,user_id)
);
create index market_ratings_recent on public.market_ratings(package_id,created_at desc);
alter table public.market_ratings enable row level security;
revoke all on public.market_ratings from anon, authenticated;
grant select on public.market_ratings to authenticated;
create policy market_ratings_read on public.market_ratings for select to authenticated using (
 public.market_is_admin() or user_id=auth.uid() or (
 not hidden and not deleted and exists(select 1 from public.market_packages p where p.id=package_id and p.status='approved')
 ));
create function public.market_rate(package_id uuid, stars integer, display_name text, comment text default '')
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Verified account required'; end if;
 if not exists(select 1 from public.market_packages p where p.id=package_id and p.status='approved' and p.owner_id<>auth.uid()) then raise exception 'Only published packages from other developers may be rated'; end if;
 if stars is null or stars not between 1 and 5 or display_name is null or char_length(trim(display_name)) not between 1 and 40 or comment is null or char_length(comment)>2000 then raise exception 'Invalid rating'; end if;
 insert into public.market_ratings as r(package_id,user_id,stars,display_name,comment)
 values(package_id,auth.uid(),stars,trim(display_name),trim(comment))
 on conflict on constraint market_ratings_pkey do update
 set stars=excluded.stars,display_name=excluded.display_name,comment=excluded.comment,deleted=false,updated_at=now();
 -- A user edit never clears an administrator's moderation decision.
end; $$;
create function public.market_remove_rating(package_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.market_ratings r set deleted=true,updated_at=now() where r.package_id=market_remove_rating.package_id and r.user_id=auth.uid();
 if not found then raise exception 'Rating not found'; end if;
end; $$;
create function public.market_moderate_rating(package_id uuid, reviewer_id uuid, hide boolean, note text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.market_is_admin() then raise exception 'Administrator required'; end if;
 if hide is null or note is null or char_length(trim(note)) not between 1 and 2000 then raise exception 'Moderation reason required'; end if;
 update public.market_ratings r set hidden=hide,moderation_note=trim(note),moderated_by=auth.uid(),moderated_at=now()
 where r.package_id=market_moderate_rating.package_id and r.user_id=reviewer_id;
 if not found then raise exception 'Rating not found'; end if;
end; $$;
create function public.market_rating_summary(package_ids uuid[])
returns table(package_id uuid, average numeric, total bigint, five bigint, four bigint, three bigint, two bigint, one bigint)
language sql stable security invoker set search_path='' as $$
 select r.package_id,round(avg(r.stars),1),count(*),count(*) filter(where stars=5),count(*) filter(where stars=4),count(*) filter(where stars=3),count(*) filter(where stars=2),count(*) filter(where stars=1)
 from public.market_ratings r where r.package_id=any(package_ids[1:100]) and not r.hidden and not r.deleted
 group by r.package_id;
$$;
revoke all on function public.market_rate(uuid,integer,text,text),public.market_remove_rating(uuid),public.market_moderate_rating(uuid,uuid,boolean,text),public.market_rating_summary(uuid[]) from public;
grant execute on function public.market_rate(uuid,integer,text,text),public.market_remove_rating(uuid),public.market_moderate_rating(uuid,uuid,boolean,text),public.market_rating_summary(uuid[]) to authenticated;
