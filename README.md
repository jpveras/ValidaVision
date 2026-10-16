# Valida Vision — v0.26

## Rodar

```powershell
npm install
npm start
```

Abra http://localhost:3000.

## Trocar a chave do Gemini (sem reiniciar)

1. Gere uma chave em https://aistudio.google.com/apikey
2. Abra o `.env`, troque o valor de `GEMINI_API_KEY` e **salve**.
3. Recarregue a página e clique em **Analisar com IA**.

O servidor relê o `.env` a cada requisição. O valor do `.env` tem prioridade sobre
variáveis de ambiente do Windows.

## Testar se a chave funciona

Abra http://localhost:3000/api/health. A página também avisa sozinha ao abrir se a chave foi recusada.
Se o `ok` vier `true`, a chave e o modelo estão certos.

## Modelos

`GEMINI_MODEL` aceita uma lista separada por vírgula (ex.: `gemini-3.6-flash,gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite`).
Se um modelo não existir, o próximo é tentado.

## Modo demonstração

`DEMO_MODE=true` no `.env` testa a interface sem chamar a API.

## Segurança

Os elogios ficam visíveis para quem abrir a página (é a ideia da dinâmica). Não peça dados sensíveis.

A chave fica só no `.env` e nunca vai para o browser. Não compartilhe o `.env`.
Antes de enviar telas reais da empresa, valide as políticas internas de dados e PII.

## Novidades da v0.26

- **Análise de Tela oculta de novo** (16/10/2026, 20h — ficou visível só para uma demonstração).
  Mesmo esquema da v0.24: fora do menu, `/` leva ao Elogie, tela em `/analise.html`, API intacta.
  Para mostrar: `ANALISE_TELA_VISIVEL=true` + comentar a regra `[data-recurso="analise"]` em `vv-tema.css`.

## Novidades da v0.25

- **Análise de Tela disponível de novo** (16/10/2026, 18h): volta ao menu e volta a ser a página inicial
  (`/` → `/analise.html`). O mecanismo para ocultar ficou pronto: `ANALISE_TELA_VISIVEL=false` +
  descomentar a regra `[data-recurso="analise"]` no fim de `public/vv-tema.css`.

## Novidades da v0.24

- **Análise de Tela oculta** (16/10/2026 — na empresa já existe uma frente sobre isso). Nada foi apagado:
  - a tela foi para `public/analise.html` (antes `index.html`) e continua abrindo por esse endereço;
    a API `/api/analyze` e a IA seguem iguais;
  - o item sumiu do menu (regra `[data-recurso="analise"]` no fim de `public/vv-tema.css`);
  - a página inicial `/` agora leva ao **Elogie um Colega**.
  - **Para voltar a mostrar:** defina `ANALISE_TELA_VISIVEL=true` (página inicial volta a ser a análise)
    e apague a regra do menu em `vv-tema.css`.

## Novidades da v0.23

- **Rótulos dos campos em Comic Sans MS** (v0.23.1, pedido do João): "Print da tela", "Quantidade de
  cenários", "Upload local" e os demais rótulos. Nos celulares sem Comic Sans entra a Comic Neue
  (Google Fonts), quase idêntica. Regra no fim de `public/vv-tema.css`.

- **Modo escuro em todas as telas**: botão ☀/🌙 na barra superior. Por padrão segue o tema do
  celular/computador; a escolha manual fica salva no navegador e vale para todas as telas.
  - `public/vv-tema.js` (carregado no `<head>`, sem piscar branco), `public/vv-tema.css` (cores do
    tema e ajustes finos) e `public/vv-tema-auto.css`, **gerado** por `tools/gerar-tema-escuro.py`
    a partir das cores de cada página — rode de novo se mudar cores no CSS.
  - Nuvens de palavras trocam para cores claras no escuro; QR Code continua branco; PDF/impressão
    sempre no tema claro.
- **Emojis também no Sentimento da Semana** (mesma fileira do Elogie, respeitando os 100 caracteres).

## Novidades da v0.22

- **Emojis no elogio**: fileira com 16 emojis comuns (💚 ❤️ 👏 🙌 🚀 ⭐ 🏆 💪 🎉 😊 🙏 🤝 💡 🔥 ✨ 👍) abaixo
  do campo, na tela do QR Code (`/elogiar.html`) e no formulário do Elogie. Um toque insere onde está o
  cursor, respeitando o limite de 280 caracteres. Os emojis aparecem no elogio, mas não entram na nuvem.

## Novidades da v0.21

- **Moderação dos elogios em tela separada** (`/elogios-moderacao.html`, senha do moderador):
  feita para abrir no celular enquanto a tela do Elogie está compartilhada no telão.
  - Mostra os elogios com nome e texto, os números (no telão, aguardando, meta) e atualiza sozinha.
  - Botões **Aprovar**, **Aprovar todos** e **Remover**.
  - Chave **"Aprovar antes de mostrar no telão"** (desligada por padrão): ligada, os elogios novos
    ficam aguardando e só entram na contagem e na nuvem depois de aprovados. Ao desligar, os que
    estavam aguardando são aprovados.
- **Modo apresentação mais seguro**: a lista "Últimos elogios" some do telão e o aviso de novo
  elogio não mostra mais o nome (só "💚 Novo elogio recebido!").

- **Correção (14/10)**: apagar respostas do Sentimento (pela pessoa ou pela gestora) falhava em
  produção com "Precondition failed": a leitura da Blob vinha de uma cópia antiga em cache. Agora a
  leitura confere a versão atual (head + get com a versão na URL) antes de alterar o arquivo.

## Novidades da v0.20

- **Sentimento da Semana com frase curta**: em vez de uma palavra, a pessoa escreve como foi a
  semana em até **100 caracteres** (campo de texto com contador, ajustado para PC e celular).
  - A nuvem e o ranking passam a usar as palavras mais citadas nas respostas (palavras muito
    comuns, como "de", "muito" e "semana", ficam de fora).
  - A **Análise da semana** lê as respostas completas (anônimas, em ordem aleatória) para entender
    o contexto, e não repete nomes que apareçam nos textos.
  - O Painel da Gestora mostra cada resposta inteira, com o botão Remover; o resumo copiado inclui as respostas.
  - Respostas antigas de uma palavra continuam funcionando.

## Novidades da v0.19

- **Apagar a análise da semana**: no Painel da Gestora, o card "💡 Análise da semana" ganhou o botão
  **Apagar análise** (pede confirmação). Útil depois de remover as palavras da semana. Com menos de
  3 respostas, o "Gerar novamente" some e o aviso sugere apagar.

## Novidades da v0.18

- **IA reserva gratuita: Cloudflare Workers AI.** O plano gratuito da Mistral não libera a API, então a
  reserva passa a usar a Cloudflare (10.000 "Neurons"/dia grátis, sem cartão), com o modelo
  `@cf/mistralai/mistral-small-3.1-24b-instruct`, que lê imagens (reserva: `@cf/meta/llama-4-scout-17b-16e-instruct`).
  - Ative com `CLOUDFLARE_API_TOKEN` (token com permissão Workers AI). Opcionais: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_MODEL`.
  - A Mistral continua aceita (`MISTRAL_API_KEY`), mas só com plano pago; se as duas existirem, vale a Cloudflare.
  - Teste da reserva sem esperar o Gemini falhar: `POST /api/analyze?reserva=1` (até 10 por hora).

## Novidades da v0.17

- **IA reserva (Mistral, plano gratuito)**: se o Gemini falhar (sobrecarga, cota do dia, modelo
  indisponível) ou não responder em `RESERVA_APOS_S` segundos (padrão 75), a Análise de Tela e a
  Análise da semana são feitas pela Mistral. A tela mostra qual IA respondeu.
  - Ative com `MISTRAL_API_KEY` (crie em console.mistral.ai, plano "Experiment": só telefone verificado,
    sem cartão). Opcional: `MISTRAL_MODEL` (padrão `mistral-medium-2508,mistral-small-2506`).
  - Sem a chave, nada muda: só o Gemini é usado.
  - Atenção: no plano gratuito da Mistral, os pedidos podem ser usados para treinar os modelos dela.
  - O Status da IA (`/api/health`) mostra também a situação da reserva.

## Novidades da v0.16

- **Economia da cota gratuita do Gemini**: o plano gratuito do Google tem limite diário de pedidos
  por modelo (ex.: 20/dia). Agora cada modelo tem no máximo 2 tentativas em sobrecarga, e um modelo
  com a cota esgotada é pulado sem nova chamada por até 1 h.
- Reservas "lite" no fim da lista (`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`), com mais cota gratuita.
- Mensagens mais claras: sobrecarga do Google e cota diária esgotada são explicadas separadamente.

## Novidades da v0.15

- **Modelos Gemini atualizados**: o `gemini-2.5-flash` deixou de estar disponível para chaves novas;
  a lista recomendada passa a ser `gemini-3.6-flash,gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite`.
- Quando um modelo está descontinuado ou não liberado para a chave, o sistema pula para o próximo
  da lista (antes parava com erro). Na Análise da semana, cada modelo tem uma nova tentativa
  quando o Google está sobrecarregado, e a mensagem final explica a sobrecarga.

## Novidades da v0.14

- **Campo liberado de novo quando a gestora remove palavras**: ao abrir (ou voltar para) a tela do
  Sentimento, o navegador confere se as palavras que enviou ainda existem. As que a gestora removeu
  saem da lista e os envios voltam a ficar disponíveis. Se a semana for zerada, o campo volta por completo.

## Novidades da v0.13

- **Apagar a própria palavra** no Sentimento da Semana: abaixo do campo aparecem as palavras que a
  pessoa enviou na semana, cada uma com o botão **Apagar** (pede confirmação). Ao apagar, o envio
  volta a ficar disponível. Só o navegador que enviou consegue apagar: no envio ele recebe uma chave
  aleatória e o servidor guarda apenas o hash dela (nada que identifique a pessoa).
  Palavras enviadas antes da v0.13 continuam podendo ser removidas pela gestora no painel.

## Novidades da v0.12

- **Sentimento da Semana com até 3 palavras**: cada pessoa pode enviar até 3 palavras por semana
  (`SENTIMENTO_MAX_ENVIOS`). Depois de enviar, o campo continua liberado e a tela mostra quantas
  ainda pode mandar. O painel da gestora e a análise da IA passam a contar **palavras enviadas**
  (não pessoas), já que as respostas continuam anônimas.

## Novidades da v0.11 (manutenção)

- **Armazenamento econômico na Vercel Blob**: elogios ficam num único arquivo
  (`elogios/_dados.json`) e os sentimentos, um arquivo por semana (`sentimentos/<semana>.json`).
  As telas passam a usar só leituras simples (o plano gratuito permite 10 mil/mês), em vez de listar
  arquivos a cada atualização (que consumia o limite de 2 mil operações avançadas/mês).
  Gravação segura contra envios simultâneos (ETag/`ifMatch`). Elogios no formato antigo são
  importados automaticamente.
- **Várias pessoas na mesma rede**: o limite anti-repetição agora é de 40 envios por minuto por IP
  (antes 1 a cada 3 s, o que barrava colegas saindo pelo mesmo IP da empresa).
- Removidas dependências não usadas (`@google/genai`, `openai`) e o `node_modules.zip`.

## Novidades da v0.10

- **💡 Análise da semana** no Painel da Gestora: com um clique, a IA (Gemini) lê as palavras
  anônimas da semana (só a contagem agregada — nenhum identificador é enviado), compara com a
  semana anterior e sugere: clima geral, leitura, temas, 3 a 5 ações coletivas (por quê, como,
  quando), uma pergunta para abrir a conversa com a equipe, o que evitar e, se houver sinais de
  esgotamento, recomendação de apoio do RH.
  - Disponível a partir de 3 respostas na semana; fica salva por semana (Vercel Blob) e entra no
    PDF e no "Copiar resumo". "Gerar novamente" atualiza quando chegam novas respostas.
  - Chamada à IA em módulo próprio (`ia.js`), com tempo máximo e modelo reserva; a Análise de
    Tela não foi alterada.

## Novidades da v0.9

- **Tela de demonstração do Elogie um Colega** (modo apresentação, só para o moderador):
  - **Link curto de reserva**: `/elogie` (ou `/e`) leva à tela de envio, para quem não consegue ler o QR Code.
    Aparece em destaque no telão e tem botão **Copiar link** (para colar no chat do Teams).
  - **Nuvem ao vivo** (padrão): a nuvem aparece no primeiro elogio e cresce a cada envio.
    Ou **Revelar na meta**: suspense até atingir a meta, com "Revelar a nuvem agora".
  - Aviso no telão a cada elogio novo ("💚 Novo elogio para Ana!"), faixa com os 3 últimos e botão **Tela cheia**.

## Novidades da v0.8

- **🙂 Sentimento da Semana** (menu lateral): toda sexta, cada pessoa da equipe escreve **uma frase curta** (até 100 caracteres)
  sobre como foi a semana. As respostas são **anônimas** (não guardamos nome, IP nem identificador).
  - Depois da primeira resposta, a pessoa vê a nuvem da equipe naquela semana e quantas respostas já chegaram.
  - Cada navegador pode enviar até 3 palavras por semana (`SENTIMENTO_MAX_ENVIOS`; semana de segunda a
    domingo, horário de Brasília). O campo continua liberado até a pessoa usar todos os envios.
  - A pessoa pode **apagar** as próprias palavras da semana (botão Apagar, com confirmação).
- **Painel da gestora** (`/sentimento-gestora.html`, link no rodapé da página): senha própria
  `SENTIMENTO_GESTORA_KEY`. Mostra palavra da semana, total de respostas, ranking, comparação com a semana
  anterior, histórico de todas as semanas, **Baixar PDF**, **Copiar resumo** e remoção de palavras impróprias.
- Variáveis: `SENTIMENTO_GESTORA_KEY` (obrigatória para o painel) e `SENTIMENTO_EQUIPE` (padrão 15).

## Novidades da v0.7

- **💚 Elogie um Colega** (menu lateral): nome do colega + elogio. Ao chegar a 15 elogios
  (`ELOGIOS_META`), as palavras mais usadas formam uma **nuvem de palavras** que se atualiza sozinha.
  - **QR Code → `/elogiar.html`**: o público abre só a tela de envio (sem menu, nuvem ou moderação).
  - **Área do moderador** (link no fim da página `Elogie um Colega`): entre com `ELOGIOS_ADMIN_KEY`.
    Só o moderador vê o **Modo apresentação**, os botões **Remover** e **Apagar todos**.
    A senha fica salva só no seu navegador; use "Sair do modo moderador" em computadores compartilhados.
  - **Modo apresentação**: nuvem em tela cheia, QR Code e contador ao vivo. Atalho:
    `/elogios.html?apresentar=1` (pede a senha se você ainda não entrou como moderador).
  - Local (`npm start`): os elogios ficam em `data/elogios.json`. Na Vercel: Vercel Blob.
- Pronto para publicar na **Vercel** (passo a passo abaixo). O `npm start` continua igual.
- Prints acima de 4 MB são reduzidos no navegador antes do envio (limite da Vercel: 4,5 MB).
  Prints menores seguem exatamente como antes.

## Publicar na Vercel

1. Em https://vercel.com/new, importe o repositório `jpveras/ValidaVision` e clique em **Deploy**
   (a Vercel detecta o Express sozinha; não precisa mudar nada).
2. No projeto criado: **Storage → Create → Blob** → dê um nome (ex.: `valida-vision-elogios`)
   → **Connect** ao projeto. Isso cria a variável `BLOB_READ_WRITE_TOKEN` automaticamente.
3. **Settings → Environment Variables**, adicione:
   - `GEMINI_API_KEY` = sua chave **nova** do Gemini
   - `GEMINI_MODEL` = `gemini-3.6-flash,gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite`
   - `ELOGIOS_ADMIN_KEY` = uma senha sua para moderar os elogios
   - (opcional) `DEMO_MODE` = `true` se quiser apresentar sem chamar a IA
4. **Deployments → ⋯ → Redeploy** para aplicar as variáveis.
5. Use o endereço de produção (`https://<projeto>.vercel.app`). Para a apresentação, abra
   `https://<projeto>.vercel.app/elogios.html?apresentar=1` e projete a tela: o QR Code leva o público
   direto para o formulário.

A cada `git push` no `main`, a Vercel publica a nova versão sozinha.

## Novidades da v0.6

- **Sua logo no topo**: salve a imagem como `public/logo.png` e recarregue a página. Sem o arquivo, aparece a logo padrão.
- **Quantidade de cenários** (opcional): informe de 1 a 50, ou use os atalhos 5/10/20. A IA recebe o limite e o servidor
  garante o corte, mantendo os cenários de maior prioridade. Em branco, a IA decide.
- **Exportar resultado**, que aparece depois da análise:
  - **Planilha (CSV)**: abre no Excel; uma linha por cenário, com passos e resultado esperado (útil para importar no Zephyr/Jira).
  - **PDF**: abre a impressão com o print e os cenários; escolha "Salvar como PDF".
  - **Copiar texto**: copia em Markdown para colar no Jira, Teams ou e-mail.

## Novidades da v0.5

- Novo layout no padrão Valid.AI: barra superior, menu lateral e card **Executar**.
- **Colar print**: copie a tela (Win+Shift+S, PrtSc ou "Copiar imagem") e cole com **Ctrl+V** em qualquer lugar da página.
- Aviso no topo quando a chave do Gemini é recusada ou o modo demonstração está ativo.

## Novidades da v0.4

- **🔎 O que a IA viu**: observações visíveis por componente, separadas dos cenários.
- **🧪 De onde veio a sugestão**: cada cenário explica a observação que o motivou.
- **Prioridade 🟥 Alta / 🟨 Média / 🟩 Baixa**, com a tabela "Por onde começar".
- **💡 O que estou esquecendo?**: pontos que um QA costuma esquecer e que não estão nos cenários.
- Modo demonstração agora retorna dados de exemplo completos (`DEMO_MODE=true`).

## Erro 503 (alta demanda)

O servidor tenta até 3 vezes cada modelo e, se continuar sobrecarregado, passa ao próximo
da lista `GEMINI_MODEL`. Deixe pelo menos dois modelos no `.env`, por exemplo:
`GEMINI_MODEL=gemini-3.6-flash,gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite`
