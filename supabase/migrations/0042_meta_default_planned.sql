-- Alvo novo nasce "Planejada", não "Em andamento" — pedido do usuário: o
-- status por padrão dava a entender que o trabalho já tinha começado, o
-- que raramente é verdade na hora do cadastro (a pessoa costuma cadastrar
-- o alvo antes de começar a medir/agir sobre ele). Só muda o valor padrão
-- da coluna — alvos já existentes continuam com o status que já tinham.
alter table public.metas alter column status set default 'planned';
