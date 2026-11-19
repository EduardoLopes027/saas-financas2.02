# Build estático do FinFlow

Execute os comandos na raiz do repositório, usando Node.js 24.

O CSS compilado já está incluído em `public/assets/css/stitch-home.css`. Para gerá-lo novamente:

```powershell
npm run build:css
```

O comando usa Tailwind CSS 3.4.17 via `npx` e considera os templates de `public/index.html` e `public/assets/js/app.js`. Edite `src/styles/stitch-home.input.css` e `config/tailwind.cjs` para alterar os estilos gerados. Os estilos próprios da interface ficam em `public/assets/css/app.css`.

Para uma prévia estática, execute `npm run preview` e acesse http://localhost:4173/. Para executar também a API local, use `npm start` e acesse http://127.0.0.1:4174.

Para publicar no projeto Vercel existente, use `public/` como diretório de saída estático. Essa pasta contém `index.html`, CSS, JavaScript, fontes, imagem e licenças, com os caminhos já preparados. Publique pelo fluxo configurado no projeto e confira a raiz do domínio e os arquivos em `assets/`.

O servidor Node local, os testes e o compilador Tailwind ficam fora da pasta pública. A API local precisa das adaptações descritas em [backend/README.md](../backend/README.md) antes de uma publicação em produção.
