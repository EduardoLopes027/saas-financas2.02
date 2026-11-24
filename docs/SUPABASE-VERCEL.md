# Implantação do FinFlow com Supabase e Vercel

## Supabase

1. No SQL Editor, execute o conteúdo completo de [`supabase/schema.sql`](../supabase/schema.sql). O esquema é privado e concede à função de acesso do aplicativo somente as permissões usadas pela API.
2. Crie um usuário PostgreSQL dedicado em uma execução separada. Substitua o valor do exemplo por uma senha aleatória forte e guarde-a no gerenciador de senhas.

   ```sql
   CREATE ROLE finflow_app LOGIN PASSWORD 'SUBSTITUA_POR_UMA_SENHA_FORTE';
   GRANT finflow_runtime TO finflow_app;
   ```

3. Abra **Connect** e selecione **Transaction pooler**. Copie o host, a porta e a referência do projeto. Use `finflow_app.<PROJECT_REF>` como usuário na URL e codifique os caracteres reservados da senha para uso na URL.
4. Em **Database Settings → SSL Configuration**, baixe o certificado CA do projeto. Copie o conteúdo PEM, incluindo as linhas `BEGIN CERTIFICATE` e `END CERTIFICATE`.

O esquema cria a estrutura do banco. Ele não copia contas ou lançamentos existentes no SQLite.

## Vercel

Use Node.js 24.x na raiz do repositório e adicione estas variáveis ao ambiente **Production** do projeto.

```dotenv
DATABASE_URL=postgresql://finflow_app.<PROJECT_REF>:<SENHA_CODIFICADA>@<HOST_DO_TRANSACTION_POOLER>:6543/postgres
DATABASE_CA_CERT=<CONTEÚDO_PEM_COMPLETO_COM_QUEBRAS_DE_LINHA>
APP_ORIGIN=https://<DOMÍNIO_CANÔNICO_DO_FINFLOW>
```

Salve `DATABASE_URL` como variável sensível. Cole o PEM em uma variável multilinha, sem aspas. Preencha `APP_ORIGIN` com a origem HTTPS que os usuários abrirão, sem barra final ou caminho. Para Preview com API, configure as mesmas variáveis nesse ambiente com banco separado e a origem HTTPS correspondente.

A API também aceita o certificado em uma única linha ou com quebras escapadas. Se a URL incluir `sslmode`, use `verify-full`, `verify-ca` ou `require`. A verificação da CA e do hostname fica ativa em todos esses casos.

O deploy serve `public/` e encaminha as rotas `/api/*` para a função Node.js. A autenticação usa senhas com hash scrypt e sessões revogáveis em cookie seguro. A função usa o PostgreSQL configurado em `DATABASE_URL`.

## Conferência

- Abra o domínio canônico e confira se a tela de login carrega. Uma chamada a `GET /api/auth/session` sem sessão deve retornar `401`.
- Se a chamada retornar `503`, procure `[finflow/api] Initialization failed` nos Runtime Logs. `28P01` indica senha recusada, `42P01` indica tabela ausente e `42501` indica que é preciso conferir os privilégios de `finflow_app`, incluindo a concessão de `finflow_runtime`.
- Cadastre duas contas de teste. Em uma delas, crie uma receita no mês anterior e uma despesa no mês corrente. Confira o saldo acumulado na Home e os totais do mês em Lançamentos.
- Edite e exclua a despesa. Recarregue e confira a persistência e os saldos. Entre na outra conta e confirme que os dados da primeira estão isolados.
- Confira o encerramento de sessão e o acesso à conta após novo login.
