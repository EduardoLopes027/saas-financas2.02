# FinFlow

Aplicação de finanças pessoais com interface estática e API de autenticação e lançamentos.

Use Node.js 24. Para executar a aplicação com a API e o SQLite local:

```powershell
npm start
```

Abra http://127.0.0.1:4174. Sem `DATABASE_URL`, a API local usa SQLite. Com `DATABASE_URL`, instale as dependências com `npm ci` para usar PostgreSQL.

Para visualizar a demonstração, execute `npm run preview` e abra http://localhost:4173.

Para publicar com autenticação e dados persistentes, siga o [guia de implantação no Vercel com Supabase](docs/SUPABASE-VERCEL.md).

## Organização

| Caminho | Conteúdo |
|---|---|
| `public/index.html` | Estrutura das telas e templates |
| `public/assets/css/app.css` | Estilos da interface |
| `public/assets/css/stitch-home.css` | CSS gerado pelo Tailwind |
| `public/assets/js/app.js` | Interações, estado e chamadas à API |
| `public/assets/fonts/` | Fontes locais |
| `public/assets/images/` | Imagens |
| `public/assets/licenses/` | Licenças das fontes |
| `src/styles/stitch-home.input.css` | Fonte do CSS gerado |
| `config/tailwind.cjs` | Configuração do Tailwind |
| `scripts/serve.cjs` | Servidor de prévia estática |
| `backend/` | API, persistência e testes |
| `docs/` | Especificação e instruções de build/publicação |

Execute `npm test` para verificar o backend. Para alterar os estilos gerados, edite `src/styles/stitch-home.input.css` ou os tokens em `config/tailwind.cjs` e execute `npm run build:css`. Esse comando usa Tailwind CSS 3.4.17 via `npx` e pode precisar de acesso ao registro npm; o CSS já compilado está incluído no projeto.

Consulte [a documentação da API](backend/README.md), [as instruções de build](docs/BUILD.md) e [a especificação](docs/Especificacao.md).
