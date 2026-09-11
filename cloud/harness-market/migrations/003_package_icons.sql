-- Optional inert PNG thumbnail, reviewed with the package and immutable after submission.
alter table public.market_packages add column icon text not null default ''
 check(icon='' or (char_length(icon)<=100000 and icon ~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$'));
