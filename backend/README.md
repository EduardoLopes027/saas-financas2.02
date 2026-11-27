# Autenticação local do FinFlow

Na raiz do repositório, rode com Node.js 24. Não há dependências de instalação.

```powershell
npm start
npm test
```

Abra http://127.0.0.1:4174 para carregar o protótipo e a API na mesma origem. Use esse endereço ao integrar as telas. O servidor lê o HTML e os arquivos estáticos existentes. Defina `FINFLOW_AUTH_PORT` para usar outra porta. O SQLite fica em `backend/.local/auth.sqlite`, ignorado pelo Git. Use apenas dados fictícios nesse servidor. Os testes criam bancos temporários e os removem ao terminar.

## Interface para o Front-end

Todas as rotas estão sob `/api/auth`. Envie JSON em todas as requisições POST. Quando informados no cadastro, os campos `name` e `salaryDay` acompanham a conta. Para contas sem esses campos, a resposta tem o formato `{"user":{"id":1,"email":"pessoa@example.test"}}`.

| Método e rota | Corpo | Sucesso |
|---|---|---|
| POST /register | `{ email, password, name?, salaryDay? }` | 201 e conta criada. Em seguida, faça login. |
| POST /login | `{ email, password, remember? }` | 200 e conta. O navegador recebe o cookie. |
| GET /session | — | 200 e conta da sessão. |
| POST /logout | `{expectedUserId}` | 204. Revoga a sessão. Retorna 409 se a conta divergir da sessão atual. |

O e-mail é normalizado para minúsculas e sem espaços nas pontas antes da verificação de unicidade. A senha tem pelo menos 15 caracteres no cadastro e aceita até 1.024 bytes. O cookie é HttpOnly e o navegador o envia automaticamente em chamadas de mesma origem. Use `GET /session` na abertura do app para restaurar o estado da sessão. O login substitui a sessão que o navegador apresentar. Com `remember: true`, a sessão e o cookie expiram em 30 dias. Com `false`, o cookie dura a sessão do navegador e o servidor limita a validade a sete dias. Ao omitir o campo, a validade do cookie e da sessão é de sete dias.

```js
const response = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (response.ok) {
  const { user } = await response.json();
  // Atualize a interface com user.
}
```

Erros retornam `{"error":"codigo"}`. Trate 400 para entrada inválida, 401 para login inválido ou sessão ausente, 409 para e-mail indisponível e 429 para excesso de tentativas. O 429 inclui `Retry-After`. Um 403 indica host ou origem recusados e um 415 indica corpo com tipo diferente de JSON. O limite local é compartilhado, com 12 tentativas processadas por janela fixa de 15 minutos e até quatro operações de hash simultâneas.

## Lançamentos por conta

| Método e rota | Sucesso |
|---|---|
| GET /api/transactions | 200 com `{ "items": [...] }`, do mais recente ao mais antigo por data e, em caso de empate, por ID. Uma conta nova recebe uma lista vazia. |
| POST /api/transactions | 201 com `{ "item": { ... } }`. Envie JSON na mesma origem. |
| DELETE /api/transactions/:id | 204. Exclui a linha indicada e seu comprovante. |
| GET /api/transactions/:id/receipt | 200 com o arquivo para download. |

Exemplo fictício do corpo de POST:

```json
{"type":"Despesa","category":"Alimentação","description":"Mercado","amount":3990,"date":"2026-11-10"}
```

O item contém os mesmos campos e um `id` numérico gerado pelo servidor. `amount` é um inteiro positivo em centavos dentro da faixa segura do JavaScript. `date` é uma data civil válida no formato `AAAA-MM-DD`. A descrição é opcional, tem até 80 caracteres e usa a categoria quando fica em branco. As categorias aceitas seguem o protótipo:

- `Receita` admite `Salário` e `Outras receitas`.
- `Despesa` admite `Moradia`, `Alimentação`, `Transporte`, `Lazer` e `Outras despesas`.
- `Transferência` exige categoria `Transferência` e origem e destino distintos em `paymentMethod` e `destinationPaymentMethod`. Ambos usam a lista de formas de pagamento. A linha representa uma transferência interna de efeito líquido zero. Ao somar saldo, projeção, receitas ou despesas, a interface deve somar exclusivamente `Receita` e `Despesa`.

`paymentMethod` admite `Pix`, `Cartão de crédito`, `Cartão de débito`, `Débito automático`, `Boleto bancário`, `Transferência` e `Crédito em conta`. `status` admite `Pago` e `Pendente` e é copiado para parcelas e ocorrências. O status continua sem efeito nas regras de saldo. `notes` aceita até 2.000 caracteres e preserva as hashtags como texto.

- **Parcelas.** `installments` é um inteiro entre 1 e 48. `amount` é o total e precisa ter ao menos um centavo por parcela. O servidor grava todas as parcelas em uma operação. Por exemplo, 100 centavos em três parcelas geram 34, 33 e 33. O POST devolve a primeira linha. Cada linha de um parcelamento inclui `installments` e `installmentNumber`. Atualize a lista com GET após salvar.
- **Recorrência.** `recurrence` admite `Semanal`, `Mensal` e `Anual`. Pode ser combinada apenas com `installments` igual a 1 ou omitido. O POST cria a primeira linha. O GET grava as ocorrências vencidas até a data civil local do servidor, inclusive, com um cursor persistente que impede duplicação. Parcelas e recorrências mensais ou anuais mantêm o dia original, ajustado para o último dia quando necessário. Por exemplo, 31 de janeiro, 28 de fevereiro e 31 de março em um ano comum.
- **Exclusão.** O DELETE remove apenas a linha indicada. Ocorrências excluídas não reaparecem. A agenda segue ativa e esta API ainda não tem rota para cancelá-la.
- **Comprovante.** Envie `receipt: { name, mimeType, dataBase64 }`, com base64 padrão sem prefixo de data URL e até 5 MiB decodificados. Tipos aceitos são `application/pdf`, `image/png` e `image/jpeg`. A validação confere assinaturas do formato. O arquivo pertence à primeira linha do lançamento e fica no SQLite. POST e GET retornam apenas `receipt: { name, mimeType, size }`, com tamanho em bytes. O download exige sessão da conta titular.

A sessão identifica a conta em cada consulta e gravação. Campos extras enviados pelo cliente são ignorados. O cookie agora cobre `/api`. Se o navegador só tiver um cookie da versão anterior, faça login novamente para usar os lançamentos. Os dados permanecem no SQLite após reiniciar o servidor.

Erros seguem `{"error":"codigo"}`. A API retorna 400 para `invalid_transaction` ou `invalid_json`, 401 para `unauthenticated`, 403 para origem ou host recusados, 404 para lançamento ou comprovante ausente ou fora da conta, 413 para o JSON de lançamento acima do limite (base64 de 5 MiB mais 32 KiB) e 415 para POST sem JSON. O teto das rotas de autenticação continua em 4 KiB.

Para testar com um banco descartável, use uma sessão PowerShell na raiz do repositório. A porta `0` pede uma porta livre, exibida pelo servidor.

```powershell
$env:FINFLOW_DATABASE_PATH = Join-Path ([IO.Path]::GetTempPath()) ("finflow-" + [guid]::NewGuid() + ".sqlite")
$env:FINFLOW_AUTH_PORT = "0"
npm.cmd start
```

## Edição e PostgreSQL

`PATCH /api/transactions/:id` aceita um JSON parcial e devolve `200 { "item": ... }`. A edição afeta somente a linha indicada. Parcelas e ocorrências futuras conservam os parâmetros da criação. O campo `receipt` substitui o arquivo quando recebe um objeto, remove quando recebe `null` e preserva quando omitido.

O servidor local seleciona PostgreSQL quando `DATABASE_URL` está definida. A função da Vercel exige PostgreSQL e `APP_ORIGIN` com a origem HTTPS exata, sem barra final. O pooler de transações usa TLS com verificação do servidor. Informe `DATABASE_CA_CERT` quando o provedor exigir uma CA específica.

No PostgreSQL, o maior valor por lançamento é `999999999999` centavos, correspondente a `NUMERIC(12,2)`. Na Vercel, o comprovante pode ter até 3 MiB decodificados, com espaço para o base64 e os outros campos no limite de requisição da plataforma. O servidor local mantém o limite de 5 MiB. O schema deve ser aplicado antes da inicialização e as credenciais ficam no servidor. Consulte o [guia de implantação](../docs/SUPABASE-VERCEL.md).

`npm test` executa os testes locais. Para incluir o teste PostgreSQL descartável, instale `@electric-sql/pglite` e `@electric-sql/pglite-socket` em um diretório temporário e aponte `FINFLOW_PGLITE_DIR` para esse diretório antes do comando. O teste utiliza um PostgreSQL em memória com conexão TCP local. O banco local SQLite existente permanece onde está.

As senhas usam scrypt com salt aleatório por conta. O banco guarda o hash do identificador de sessão e a validade. O servidor HTTP local se limita ao loopback e só aceita o host configurado. Requisições POST de navegador ficam restritas à mesma origem.

## Entrar com Google

O OAuth fica disponível na API HTTPS com PostgreSQL. Configure `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` (ou `SUPABASE_ANON_KEY`) na função. Use uma chave pública do projeto. Cadastre `APP_ORIGIN` seguido de `/api/auth/google/callback` na lista de redirecionamentos autorizados do Supabase Auth e configure o provedor Google no Supabase. Reaplique `supabase/schema.sql` no banco para criar as tabelas de vínculo e de tentativas, ajustar a restrição de dia de salário e conceder os privilégios ao papel de execução. [Fluxo PKCE do Supabase](https://supabase.com/docs/guides/auth/sessions/pkce-flow)

- `GET /api/auth/google` inicia o login.
- `POST /api/auth/google/link` recebe `{}` com sessão ativa e origem HTTPS configurada. Retorna `200 {"url":"..."}` para navegação. Sem configuração, retorna `503 {"error":"google_unavailable"}`.
- `GET /api/auth/google/callback` consome a tentativa e redireciona para `/#painel` ou `/?auth_error=google_failed#login`. Se o e-mail já pertence a uma conta sem vínculo, o login retorna `/?auth_error=google_link_required#login`. O titular entra com a senha e inicia o vínculo autenticado.

O vínculo usa o identificador permanente do Google. Uma conta criada via OAuth recebe o nome do Google e `salaryDay: "5-business"`, com login por senha desativado. O cookie da tentativa expira em cinco minutos. O teste PostgreSQL usa uma resposta simulada do Supabase e executa as operações com `SET ROLE finflow_runtime`.

## Configurações da conta

- `GET /api/auth/session` e `POST /api/auth/login` retornam `{user}` com o perfil, as preferências e o estado do vínculo Google. `name` e `salaryDay` continuam disponíveis para consumidores legados. `createdAt` pode ser nulo para cadastros SQLite anteriores a esta versão.
- `PATCH /api/auth/profile` aceita qualquer subconjunto não vazio dos campos `displayName`, `phone`, `paydayRule`, `paydayDay`, `theme`, `carryOver`, `amountMask` e `currency`, mais `expectedUserId` da conta exibida. Retorna `{user}`. O dia fixo aceita inteiros de 1 a 31 e a moeda disponível é `BRL`.
- `DELETE /api/user/account` requer JSON com `confirm: true` e `expectedUserId`. Retorna `204` após a remoção em cascata dos dados FinFlow e das sessões. A operação não apaga a conta Google ou o cadastro no Supabase Auth.
- Se a conta exibida divergir da sessão nas gravações, a API retorna `409 account_changed`. Em produção, as duas rotas exigem o cabeçalho `Origin` igual a `APP_ORIGIN`.
- A verificação de e-mail só é exibida quando o endereço verificado pelo Google coincide com o endereço FinFlow. Vínculos anteriores à migração podem registrar essa evidência no próximo login via Google.

Em uma instalação Supabase existente, aplique `supabase/migrations/20261126000000_account_settings.sql` antes de publicar a API. Se a migração Google OAuth ainda estiver pendente, aplique-a primeiro. Instalações novas podem usar `supabase/schema.sql`. Confirme a concessão de `finflow_runtime` ao login `finflow_app` e o encaminhamento de `/api/auth/profile` e `/api/user/account` para a função Vercel.

### Avatar da conta

- `PATCH /api/user/profile` e `PATCH /api/auth/profile` aceitam `{expectedUserId, avatar_url}` junto aos campos de perfil existentes. Ambos retornam `{user}`. A sessão retorna `user.avatar_url`, que pode ser nulo.
- O upload aceita data URLs com JPEG, PNG ou WebP estáticos, até 512 KiB de arquivo, 4096 pixels por lado e 8.388.608 pixels no total. O servidor decodifica e converte o upload para WebP de até 256 pixels por lado, sem os metadados originais. O limite do corpo JSON é 703.148 bytes. Se as duas vagas de processamento estiverem ocupadas, o cliente pode tentar novamente após receber `503 avatar_processing_busy`.
- URLs HTTPS sem credenciais são aceitas sem fetch no servidor. O conteúdo remoto e seu MIME não são verificados. A interface deve usar o endereço somente como origem de uma imagem e omitir o referenciador.
- O login Google importa a foto verificada somente para uma conta ainda sem avatar, com e-mail Google correspondente ao da conta. Fotos personalizadas são preservadas. Enviar `null` remove o avatar do perfil e desativa a importação automática. Os metadados do vínculo Google permanecem associados à identidade até a exclusão da conta.
- Em Supabase existente, aplique `supabase/migrations/20261127000000_account_avatar.sql` depois da migração de Configurações e antes de publicar a API. A migração acrescenta duas colunas à tabela privada de usuários e concede somente seu UPDATE ao papel `finflow_runtime`. SQLite amplia a tabela local na primeira inicialização. Para Vercel, encaminhe também `/api/user/profile` e instale as dependências opcionais de plataforma do `sharp`.
