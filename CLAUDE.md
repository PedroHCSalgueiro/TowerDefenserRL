# Tower Defense Roguelite

Tower defense roguelite para navegador (computador, mouse e teclado).
O jogador compra torres numa loja com reroll, posiciona em grade e
monta composições de classes cujos gatilhos disparam em cadeia
contra hordas de centenas de inimigos.

## Links do Notion (use sempre estes, não precisa buscar)
- Plano do Protótipo 1: https://app.notion.com/p/3e5c656560ae817181ecf7cc1c33a570
- Tarefas (banco, filtrar pelo ID, ex.: T03): https://app.notion.com/p/631ea90d2dc44bb7bc3b0ebb02586e96
- Mini-GDD (regras do jogo): https://app.notion.com/p/3e4c656560ae81f4b23dc4c4ece91da4
- Documento Técnico: https://app.notion.com/p/3e5c656560ae81e991d3fc03b62227a4
- Diário de Desenvolvimento: https://app.notion.com/p/3e5c656560ae811f9631fdd9de2301f0

Quando Pedro disser "execute a T0X", abra a tarefa T0X no banco de
Tarefas, leia as seções do Mini-GDD e do Documento Técnico citadas
em "Contexto", apresente um plano e só então implemente.

## Stack
- Phaser 4 (NÃO usar API do Phaser 3; consultar a documentação do Phaser 4)
- TypeScript estrito, Vite, Vitest, ESLint + Prettier

## Arquitetura (regra mais importante)
- src/sim/: lógica pura. PROIBIDO importar Phaser aqui.
- src/render/: Phaser. Só lê estado e eventos da simulação.
- src/ui/: HTML/CSS sobre o canvas.
- src/data/: todos os números do jogo.

## Regras
- Nunca colocar números de jogo no código: sempre em src/data/.
- Toda regra nova da simulação vem com teste em tests/.
- Simulação determinística: usar sempre o RNG com semente, nunca Math.random().
- Não adicionar dependências sem justificar.
- Tarefas pequenas: uma feature por vez, build e testes passando no fim.

## Ao terminar cada tarefa (obrigatório)
1. Marcar o status da tarefa como "Feito" (ou "Bloqueado") no banco
   "Tarefas do Protótipo 1" no Notion.
2. Adicionar uma entrada no topo da página "Diário de Desenvolvimento"
   no Notion, seguindo o modelo da própria página.
3. Nunca decidir regra de jogo sozinho: registrar em "Perguntas de design"
   no Diário e perguntar ao Pedro.

## Comandos
- npm run dev    — servidor de desenvolvimento
- npm test       — testes
- npm run build  — build de produção
- npm run lint   — padrão de código

## Build de playtest (T17)
- O GitHub Pages publica o branch `playtest`, não a `main`. Commits na
  `main` só rodam o CI (lint, testes e build) e não mudam a URL.
- **Promover a build** (só quando o Pedro mandar): apontar o `playtest`
  para um commit da `main` e empurrar. O workflow "Deploy to GitHub Pages"
  publica sozinho em 1 a 2 minutos.
  - Último commit da `main`: `git fetch origin && git push origin origin/main:playtest`
  - Um commit específico: `git push origin <hash>:playtest`
    (voltar para um commit mais antigo pede `--force-with-lease`).
- Conferir: a versão no canto da tela (hash curto) tem que ser a do commit.
- Na build publicada, o painel F2 e as trapaças ficam escondidos; aparecem
  com Ctrl+Shift+D (vale para a sessão) ou com `?debug=1`. No `npm run dev`
  tudo fica visível.
