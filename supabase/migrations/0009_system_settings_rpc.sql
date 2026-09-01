-- O schema "app" nao e exposto pelo PostgREST, entao as Edge Functions leem e
-- gravam configuracoes internas por estas RPCs, liberadas apenas ao service_role.
create or replace function public.get_system_setting(p_key text)
returns text language sql stable security definer set search_path = app, pg_temp as $$
  select value from app.system_settings where key = p_key;
$$;
revoke all on function public.get_system_setting(text) from public, anon, authenticated;
grant execute on function public.get_system_setting(text) to service_role;

create or replace function public.set_system_setting(p_key text, p_value text)
returns void language sql volatile security definer set search_path = app, pg_temp as $$
  insert into app.system_settings (key, value, updated_at)
  values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
$$;
revoke all on function public.set_system_setting(text, text) from public, anon, authenticated;
grant execute on function public.set_system_setting(text, text) to service_role;

insert into app.system_settings (key, value)
values ('default_password', 'Apice@2026')
on conflict (key) do nothing;
