# Clara · Direção visual e especificação para Front-end

Clara é um nome de trabalho. O cenário usa uma pessoa, saldo consolidado em BRL e lançamentos fictícios. Abra Prototipo.html em um navegador e reduza a janela para ver a versão de celular. O seletor **Cenário do protótipo** simula dados, vazio e falhas. Os lançamentos novos ficam na sessão da página e somem ao recarregar.

## Direção e composição

Fundo verde-cinza #F4F7F6, cartões brancos e saldo em verde-claro #E2F2EB. Use #172B2A para texto, #455B56 para texto secundário, #075B4B para ações e receitas e #A12620 para erros e despesas. Use fonte do sistema, valores com algarismos tabulares e barras horizontais ordenadas por gasto. Categoria e valor aparecem em texto junto a cada barra.

| Tela | Desktop | Celular |
| --- | --- | --- |
| Painel | Navegação no topo, saldo e categorias lado a lado, recentes abaixo | Saldo, categorias e recentes em uma coluna |
| Lançamentos | Mês, tipo e categoria em linha. Resultados com valor alinhado à direita | Filtros empilhados, listas com descrição e metadados que quebram linha conforme a largura |
| Novo lançamento | Página dedicada. Tipo acima, valor e data em duas colunas, categoria e descrição abaixo | Página dedicada em uma coluna, com Salvar e Cancelar depois dos campos |

O protótipo usa 650 px como ponto de quebra inicial. Novembro de 2026 mostra saldo de R$ 2.251,10, receitas de R$ 4.200,00 e despesas de R$ 1.948,90. O saldo considera os lançamentos até 17/11. As categorias e os totais do período consideram novembro até essa mesma data no exemplo.

## Componentes e comportamentos

- **Navegação**. Links semânticos para Painel e Lançamentos, indicador de seção atual, atalho para pular ao conteúdo e foco no título após trocar de tela. O histórico do navegador acompanha a navegação.
- **Saldo e lançamentos**. Formate inteiros em centavos com Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }). Alinhe valores e sinalize receitas e despesas com tipo escrito e sinais + e −. Use data em DD/MM/AAAA nas linhas. Ordene do mais recente ao mais antigo. A barra indica a fração do total de despesas do período.
- **Filtros**. Aplicação imediata, contagem de resultados anunciada e mês inicial corrente em produção. Limpar abre todos os meses e tipos. Trocar o tipo limpa a categoria. Mantenha o foco no controle usado.
- **Formulário**. Tipo com botões de opção, valor positivo obrigatório, data e categoria obrigatórias e descrição opcional. Aceite valor como 123,45 ou 1.234,56, com teclado decimal no celular. Categoria depende do tipo. Validação inline ligada ao campo e foco no primeiro erro. Ao salvar, volte à lista no mês do lançamento e anuncie a confirmação. Em produção, indique envio em andamento e bloqueie submissões repetidas enquanto espera pela API.
- **Estados**. Sem histórico, convide a criar o primeiro lançamento. Sem despesas no período, explique na área de categorias. Sem resultados, ofereça limpar filtros. Em falha de carregamento, ofereça tentar novamente. Em falha de gravação, preserve os dados e permita uma nova tentativa.
- **Acessibilidade**. Mantenha ordem visual e de tabulação coerentes, foco visível de 3 px em #315BC4 e alvos de ação de pelo menos 44 px de altura. Use labels persistentes e mensagens textuais junto aos campos. Meta de contraste de 4,5:1 para texto comum e 3:1 para indicadores de foco e contornos necessários. Verifique a versão integrada com teclado, leitor de tela e zoom de 200%.

## Decisões a validar antes da implementação

| Decisão provisória | Validação |
| --- | --- |
| Saldo acumulado até hoje e despesas do mês corrente no painel | Confirmar saldo inicial, inclusão de agendados e tratamento de lançamentos futuros, estornos e transferências. |
| Categoria obrigatória com opções diferentes por tipo | Confirmar taxonomia inicial e se a pessoa pode criar ou editar categorias. |
| Despesa pré-selecionada, data de hoje e descrição opcional | Observar se os padrões aceleram o preenchimento ou favorecem registros incorretos. |
| Filtros imediatos, período mensal e categoria reiniciada ao mudar tipo | Ver se a pessoa entende o recorte e precisa de intervalo livre ou preservação dos filtros após salvar. |
| Página dedicada e Cancelar sem aviso no protótipo | Validar quando avisar sobre perda de alterações ao cancelar ou voltar. |
| Nome Clara, paleta verde e barras horizontais | Validar identidade e leitura comparativa em telas estreitas com valores longos. |
