-- Gemini passa a ser o provedor padrão de IA. O modelo fica vazio de
-- proposito: a Edge Function pergunta a lista ao provedor na primeira vez e
-- grava a escolha, em vez de depender de um identificador fixo no codigo.
insert into app.system_settings (key, value)
values ('ai_provider', 'gemini'), ('insights_model', '')
on conflict (key) do nothing;

update app.system_settings
   set value = '', updated_at = now()
 where key = 'insights_model'
   and value like 'claude-%';
