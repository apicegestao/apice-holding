-- Bootstrap do primeiro acesso: cria o super admin da holding e a empresa
-- controladora. Rode UMA vez, num projeto Supabase novo, e troque o e-mail.
-- A senha aqui é a padrão: o sistema obriga a troca no primeiro login.
do $$
declare
  v_user_id uuid;
  v_company_id uuid;
  v_email text := 'rafaelportela@outlook.com';
  v_name  text := 'Rafael Portela';
begin
  select id into v_user_id from auth.users where email = v_email;

  if v_user_id is null then
    v_user_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      v_email,
      extensions.crypt('Apice@2026', extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_name, 'must_change_password', true),
      now(), now(), '', '', '', ''
    );

    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      v_user_id::text, v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now()
    );
  end if;

  update public.profiles
     set is_super_admin = true, full_name = v_name, must_change_password = true
   where id = v_user_id;

  insert into public.companies (slug, name, legal_name, sector, description, color, is_holding, display_order)
  values ('apice-holding', 'Ápice Holding', 'Ápice Holding', 'Holding',
          'Empresa controladora do grupo.', '#0EA5E9', true, 0)
  on conflict (slug) do nothing;

  select id into v_company_id from public.companies where slug = 'apice-holding';

  insert into public.company_members (company_id, user_id, role)
  values (v_company_id, v_user_id, 'admin')
  on conflict (company_id, user_id) do update set role = 'admin';
end $$;
