# Ailton Hortifruti — Controle de Ponto V1.0

Sistema Next.js + Supabase + Vercel, mobile-first, com matrícula + senha, geofence e evidências de ponto.

## Regras fechadas da V1.0
- Geofence rígido: 80 m em `-8.2929795, -34.9565964`; fora do raio a batida é recusada.
- GPS de baixa precisão não bloqueia: registra e marca para conferência.
- Horário oficial vem do servidor/PostgreSQL.
- Tolerância padrão: 15 min.
- Escalas padrão: 06–15 (1h), 09–19 (2h), 11–19 (sem intervalo), além de escalas personalizadas.
- Sequência conforme a escala: entrada → saída intervalo → retorno → saída, ou entrada → saída.
- Selfie somente na entrada e saída final; bucket privado.
- Política operacional de retenção das selfies: 30 dias. A exclusão deve ser executada por rotina agendada; o registro textual do ponto permanece.
- Cadastro: nome, CPF, telefone, matrícula automática, status; múltiplos administradores.
- Escala pode variar por data; ocorrências: folga, férias, atestado, falta justificada e outros.
- Correção de ponto somente por administrador, preservando horário original, motivo, autor e data da edição.
- Relatórios por período arbitrário, com previsão para PDF/Excel e assinatura de espelho.

## Variáveis Vercel
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
A service role é exclusivamente server-side e nunca deve ser prefixada com `NEXT_PUBLIC`.

## Banco
Execute `supabase/schema.sql` no SQL Editor. Para instalações que já rodaram o schema antigo, revise/migre os dados antes de aplicar em produção.

## Login por matrícula
O Supabase Auth usa internamente um e-mail sintético no formato `MATRICULA@ponto.local`; o funcionário vê apenas matrícula + senha. O cadastro administrativo deve criar o Auth User e a linha em `profiles` usando a mesma matrícula.

## Observação sobre selfies
O schema define o armazenamento privado, mas apagar automaticamente arquivos com mais de 30 dias exige uma rotina agendada. Não apague a linha de `time_entries`; apague apenas o objeto de Storage e limpe `selfie_path` se desejado.
