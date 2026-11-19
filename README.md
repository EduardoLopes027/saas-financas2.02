# FinFlow

Protótipo de um SaaS de finanças pessoais, com interface estática e API local de autenticação e lançamentos.

Use Node.js 24. Para executar a aplicação com a API e o SQLite local:

```powershell
npm start
```

Abra http://127.0.0.1:4174. Não é necessário instalar dependências para executar a aplicação ou os testes.

Para visualizar somente o front-end, execute `npm run preview` e abra http://localhost:4173. Também é possível abrir `public/index.html` diretamente no navegador para usar o protótipo estático.

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
