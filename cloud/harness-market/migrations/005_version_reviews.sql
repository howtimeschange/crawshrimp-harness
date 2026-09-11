-- Keep published version discussions visible while this script has a live release.
begin;
create function public.market_script_live(sid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select sid is not null and exists(select 1 from public.market_packages where script_id=sid and status='approved');
$$;
revoke all on function public.market_script_live(uuid) from public;
grant execute on function public.market_script_live(uuid) to authenticated;
drop policy market_read on public.market_packages;
create policy market_read on public.market_packages for select to authenticated using(status='approved' or owner_id=auth.uid() or public.market_is_admin() or (status='superseded' and public.market_script_live(script_id)));
drop policy market_ratings_read on public.market_ratings;
create policy market_ratings_read on public.market_ratings for select to authenticated using(public.market_is_admin() or user_id=auth.uid() or(not hidden and not deleted and exists(select 1 from public.market_packages p where p.id=package_id and (p.status='approved' or(p.status='superseded' and public.market_script_live(p.script_id))))));
create or replace function public.market_rating_summary(package_ids uuid[])
returns table(package_id uuid,average numeric,total bigint,five bigint,four bigint,three bigint,two bigint,one bigint)
language sql stable security invoker set search_path='' as $$
 with latest as (
 select distinct on (target.id,r.user_id) target.id as target_id,r.stars
 from public.market_packages target
 join public.market_packages release on release.id=target.id or (target.script_id is not null and release.script_id=target.script_id and release.status in ('approved','superseded'))
 join public.market_ratings r on r.package_id=release.id
 where target.id=any(package_ids[1:100]) and not r.hidden and not r.deleted
 order by target.id,r.user_id,r.updated_at desc,r.package_id
 ) select target_id,round(avg(stars),1),count(*),count(*) filter(where stars=5),count(*) filter(where stars=4),count(*) filter(where stars=3),count(*) filter(where stars=2),count(*) filter(where stars=1) from latest group by target_id;
$$;
create or replace function public.market_remove_rating(package_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.market_ratings r set deleted=true,updated_at=now()
 where r.user_id=auth.uid() and (r.package_id=market_remove_rating.package_id or r.package_id in (
 select sibling.id from public.market_packages target join public.market_packages sibling on sibling.script_id=target.script_id
 where target.id=market_remove_rating.package_id and target.script_id is not null));
 if not found then raise exception 'Rating not found'; end if;
end; $$;
commit;
