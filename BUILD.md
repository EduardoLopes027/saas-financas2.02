# Build estático do FinFlow

Na raiz do repositório, gere o CSS da Home a partir dos templates de `Prototipo.html` e dos tokens do Stitch.

```powershell
npx --yes tailwindcss@3.4.17 -c stitch-tailwind.cjs -i stitch-home.input.css -o stitch-home.css --minify
```

Para uma prévia no computador, com a porta 4173 livre, use `node clara-local.cjs Prototipo.html` e acesse http://localhost:4173/.

Para publicar no projeto Vercel existente, monte a pasta estática usada por esse projeto com `Prototipo.html` como `index.html` na raiz. Inclua os arquivos abaixo ao lado do HTML.

- `stitch-home.css`
- `FinFlow-avatar.jpg`
- `HankenGrotesk.woff2`, `PlusJakartaSans.woff2`, `MaterialSymbols.woff2` e `InterVariable.woff2`
- `Hanken-OFL.txt`, `Jakarta-OFL.txt`, `MaterialSymbols-LICENSE.txt` e `Inter-OFL.txt`

Use a pasta estática como saída do projeto Vercel atual e publique pelo fluxo já configurado nele. O servidor Node local e o Tailwind compilador ficam fora da pasta pública. Depois, confira a raiz do domínio existente e os arquivos CSS, fontes e avatar.
