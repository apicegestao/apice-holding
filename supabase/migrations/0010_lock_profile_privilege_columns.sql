-- ============================================================================
-- Correcao de seguranca: a policy "editar o proprio perfil" liberava a linha
-- inteira, e RLS nao distingue coluna — o usuario conseguia se promover a
-- super admin no proprio UPDATE. O grant por coluna fecha isso no motor;
-- o trigger e a segunda trava para qualquer caminho que apareca depois.
-- ============================================================================

revoke update on public.profiles from anon, authenticated;
grant update (full_name, phone, job_title, avatar_url, must_change_password, last_login_at)
  on public.profiles to authenticated;

create or replace function app.guard_profile_privileges()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- service_role = Edge Functions administrativas; postgres = migrations.
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if new.is_super_admin is distinct from old.is_super_admin
     or new.is_active is distinct from old.is_active
     or new.email is distinct from old.email
     or new.id is distinct from old.id then
    raise exception 'Privilegios de conta so podem ser alterados por um administrador.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges before update on public.profiles
  for each row execute function app.guard_profile_privileges();
