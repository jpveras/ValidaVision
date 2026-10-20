# Toca dos Bug Hunters — v0.36

> Endereço: **https://bughunters-time.vercel.app** (desde 19/10/2026). O antigo `valida-vision.vercel.app` redireciona para ele (307, configurado em Vercel → Domains), então links e QR Codes antigos continuam funcionando.
> Antes chamado **Valida Vision** (o repositório e o projeto da Vercel continuam com o nome antigo).

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

## Novidades da v0.36

- **🎂 Aniversários 7 dias antes:** o quadro "Esta semana na Toca" do Início avisa a partir de 7 dias antes ("Faltam 5 dias para o aniversário de Diego", "Amanhã é aniversário de…"), também para os anos de time; tudo ordenado junto com a agenda pelo que está mais perto. No dia continua o destaque com **Dar parabéns**.
- **📷 Emojis nos comentários do álbum** (os mesmos do Elogie, `vvEmojis`).

## Novidades da v0.35

- **📣 Até 3 recados da chefa:** `recado/_dados.json` = `{ recados: [r1, r2, r3] }` (o formato antigo de um recado vira o Recado 1). Cada um com liga/desliga e frequência. O pop-up mostra os que devem aparecer em sequência ("1 de 3" → Próximo/Anterior, setas do teclado); "já vi" por recado em `localStorage` `vv-recados`. Rotas: `PUT /api/recado/gestora/:n` (0–2); `GET /api/recado` devolve `recados[]` (+ campos do primeiro, para telas antigas). Na Área da Gestora: abas Recado 1/2/3 e "Ver todos como o time vê".
- **🆕 Últimas atualizações com 5 itens** e mais fontes: recados no ar, último comentário do álbum, resposta do desafio anterior, líder do ranking, convite a elogiar quando o mural está vazio.
- **Scan do Elogie e do Sentimento:** o Elogie passou a **recusar links** (como o Sentimento e os comentários). Demais fluxos testados ok (envio, validações, frases prontas, `?para=`, 3 respostas/semana, apagar a própria resposta, nuvem, celular escuro).

## Novidades da v0.34

- **🎂 Aniversários e tempo de time** (`time.js`, `/api/time`): a gestora cadastra nome + dia/mês do aniversário (sem ano) + entrada no time (opcional) na aba **Aniversários**. O Início mostra "Hoje é aniversário de…" / "completa N anos de time" com **Dar parabéns** (abre `/elogiar.html?para=Nome`) e os próximos 7 dias. A data de entrada nunca sai para o público.
- **📅 Agenda do time** (mesmo módulo): aba **Agenda** com tipos (confra, entrega, reunião, feriado, férias, treinamento, outro), data, data final, horário e detalhe. O Início mostra "📅 Esta semana na Toca" com contagem regressiva.
- **🧩 Desafio da semana** (`desafios.js`, `/api/desafios`, página `/desafio.html`, atalhos `/desafio` e `/quiz`): a gestora publica pergunta com 2–4 alternativas + explicação (ideias prontas de QA). Cada pessoa responde uma vez (navegador + nome), vê na hora se acertou e a distribuição; **ranking do mês** (1 ponto por acerto). Publicar um novo encerra o anterior. Novo bloco no Início e item no menu.
- **Elogie um Colega:** frases prontas ("Mandou muito bem! 👏", "Salvou a sprint 🚀"…) para quem só quer tocar (`vvTags` em `vv-emojis.js`).
- **Status da IA** oculto no menu (`data-recurso="status-ia"`); `/api/health` continua funcionando.
- Tudo o que é da gestora fica na Área da Gestora (abas novas + cartões no Início do painel + guia atualizado).

## App Android (APK)

- **Trusted Web Activity** (a Toca em tela cheia pelo Chrome, com notificações): pacote `br.com.jpveras.bughunters`, abre `/inicio.html?app=1`. Android 7.0+.
- Gerado no GitHub Actions (`.github/workflows/apk.yml`, roda ao mudar `android/twa-manifest.json` ou manualmente em Actions → "APK Android (TWA)"): Bubblewrap gera o projeto, Gradle compila, `apksigner` assina. O APK vai para **Releases** (`app-v<versão>`; sem o segredo vira `app-teste`, com chave provisória).
- Chave de assinatura: `android/chave-app.jks.enc` (criptografada, AES-256 + PBKDF2); a senha fica no segredo **`ANDROID_KEYSTORE_PASSWORD`** do repositório. Sem a chave oficial o Android não reconhece o app como da Toca e mostra a barra de endereço.
- `/.well-known/assetlinks.json` (rota no `server.js`) tem a impressão digital SHA-256 da chave oficial.
- Nova versão do app: aumente `appVersionCode` e `appVersionName` em `android/twa-manifest.json`.

## Novidades da v0.33

- **📷 Álbum separado por momentos.** Na aba Álbum da Área da Gestora, o passo 1 é escolher ou **criar um momento** (nome, data, descrição opcional); só depois dá para escolher as fotos. Card "🗂️ Momentos" para editar ou remover (remover não apaga as fotos: vão para "Outras fotos"). No visualizador do álbum a gestora troca o momento de uma foto.
  - Na página do álbum, as fotos aparecem em seções por momento (mais recente primeiro), com filtros por momento.
  - Dados: `album/_dados.json` ganhou `momentos[]` e `foto.momentoId`. Fotos antigas com o texto "álbum" viram momentos automaticamente (id fixo `m-<sha1>`). Rotas: `POST/PUT/DELETE /api/album/gestora/momentos[/:id]`.
- **🆕 Últimas atualizações no Início:** resumo curto (até 5 itens) com fotos novas, elogios no mural, Sentimento da semana, última sugestão respondida e novidades da Toca. Usa as rotas públicas que já existem (sem gravações novas na Blob).

## Novidades da v0.32.3

- **Menos operações na Vercel Blob** (sem mudar nada para quem usa):
  - `colecao.js` guarda a última versão lida de cada arquivo; se o `head` mostra a mesma versão (ETag), não baixa de novo → cada leitura cai de 2 para 1 operação simples.
  - Memória no servidor por mais tempo: elogios 15 s (config 60 s), álbum 20 s, sugestões 20 s, recado 60 s, senha da gestora 2 min. Quem grava atualiza a memória na hora.
  - Painel da gestora: a lista de semanas (operação avançada) é guardada por 10 min.
- **v0.32.2:** primeira gravação de um arquivo novo (ex.: 1ª foto do álbum) voltou a funcionar — a @vercel/blob passou a dizer "does not exist" em vez de "not found".

## Novidades da v0.32.1

- Boas-vindas fica **10 s** no navegador (PC ou celular). No **app instalado** aparece só na primeira vez que a pessoa abre o app depois de instalar (`localStorage` `vv-bv-app`).

## Novidades da v0.32

- **🏠 Início com menus em blocos coloridos** (`/inicio.html`; `/` e `/inicio` levam para lá). Antes o site abria direto no Elogie um Colega. Blocos: Elogie um Colega, Sentimento da Semana, Álbum do time, Caixa de sugestões e App e lembrete (abre o painel do sino); Análise de Tela e Pergunta continuam ocultas (`data-recurso`).
- **Boas-vindas "Seja Bem-Vindo(a), Caçador(a)!"**: ao abrir a Toca, uma mensagem aparece por cima com o fundo embaçado (`backdrop-filter`); some sozinha em ~3,5 s ou em "Entrar na Toca"/Esc/toque fora, e os blocos entram animados. Não aparece quando a pessoa volta ao Início vindo de outra tela (`?bv=1` força, `?bv=0` desliga). O Recado da Chefa espera a boas-vindas sair (evento `vv-bv-fim`).
- Item **Início** no topo do menu lateral de todas as telas; o logo leva ao Início. O app instalado passa a abrir no Início (`start_url`, com `id` antigo mantido).

## Novidades da v0.31

- **🛡️ Área da Gestora** (`/gestora.html`, atalhos `/gestora`, `/painel`, `/chefa`): o painel saiu de dentro do Sentimento da Semana e virou um lugar só da gestora. Entra-se pelo **escudo ao lado do sino 🔔** em qualquer página (com pontinho verde quando ela está conectada).
  - Abas: **Início** (cartões com o que pede atenção: elogios aguardando, respostas da semana, sugestões novas, recado, fotos, lembrete), **Sentimento**, **Recado**, **Elogios** (moderação completa, atualiza sozinha), **Álbum** (publicar fotos + fotos recentes), **Sugestões**, **Lembrete** e **Senha**. Pergunta da semana continua oculta.
  - **Senha escolhida pela gestora** (aba 🔑 Senha): guardada só como resumo scrypt em `gestora/_senha.json` (`senha-gestora.js`). A senha original `SENTIMENTO_GESTORA_KEY` continua valendo como recuperação. API: `GET /api/gestora`, `PUT /api/gestora/senha` (`gestora.js`).
  - A senha da gestora também libera a moderação dos Elogios (`/elogios-moderacao.html` e modo moderador do Elogie continuam aceitando `ELOGIOS_ADMIN_KEY`).
  - `/sentimento-gestora.html` redireciona para `/gestora.html#sentimento`. O álbum não tem mais a caixa de login no rodapé: a gestora conectada vê um aviso e as ferramentas ao abrir cada foto.

## Novidades da v0.30

- **📣 Recado da Chefa!** — pop-up com a mensagem que a gestora configura no painel (título, mensagem até 600
  caracteres com emojis e quebras de linha, assinatura, ideias prontas e pré-visualização). Aparece ao abrir a
  Toca, no PC ou no app, conforme a frequência: uma vez por pessoa (volta quando o recado muda), uma vez por dia
  ou sempre. Não aparece no telão, na moderação nem no painel. Dá para rever pelo sino 🔔.
  Módulo `recado.js` (`/api/recado`), Blob `recado/_dados.json`, script `public/vv-recado.js` em todas as telas.
- **Pergunta da semana oculta** (trocada pelo Recado): sai do menu e do painel pela regra
  `[data-recurso="pergunta"]` em `vv-tema.css`; nada foi apagado (`/pergunta.html` e `/api/perguntas` continuam).

## Novidades da v0.29

- **Novo nome: Toca dos Bug Hunters** (o cantinho da equipe Bug Hunters, analistas de testes).
  Títulos, barra superior, app instalado ("Bug Hunters" na tela inicial), notificações e PDFs.
  O endereço do site não mudou, para não quebrar links e QR Codes já divulgados.
- **Ícone caça-bugs**: lupa ampliando um bug simpático (`public/icone-bug-hunters.svg`), também na aba do navegador.
- **📷 Álbum do time** (`/album.html`, atalhos `/album` e `/fotos`): a gestora publica fotos (várias de uma vez,
  com legenda e nome do álbum) pela "Área da gestora" no fim da página, com a mesma senha do painel.
  A equipe vê em grade, abre a foto, curte (1 por navegador, também com toque duplo) e comenta com o próprio nome;
  quem comentou pode apagar o próprio comentário. A gestora edita legendas, apaga fotos e remove comentários.
  - Fotos reduzidas no navegador (até 1600 px + miniatura de 480 px) e servidas por `/api/album/foto/:id`
    com cache longo na CDN. Blob: `album/_dados.json` e `album/fotos/<id>-g.jpg|-p.jpg`. Módulo `album.js`.

## Novidades da v0.28

- **Ícone próprio do app** (v0.28.1): olho com coração ("Vision" + cuidado com a equipe), em degradê verde-petróleo. Arquivo-fonte `public/icone-valida-vision.svg`; PNGs `icon-192`, `icon-512`, `icon-512-maskable` e `apple-touch-icon`.

- **❓ Pergunta da semana** (`/pergunta.html`, atalho `/pergunta`): a gestora lança uma pergunta curta
  no painel (com ideias prontas); a equipe responde anonimamente (até 200 caracteres, até 3 por pessoa,
  pode apagar). A nuvem aparece depois que a pessoa responde. No painel: respostas, palavras, remover,
  encerrar, histórico e **Resumo com IA** (a partir de 3 respostas). Módulo `perguntas.js`,
  Blob `perguntas/_dados.json`.
- **📲 App instalável + 🔔 lembrete de sexta**: manifesto (`manifest.webmanifest`), ícones, service
  worker (`sw.js`) e botão 🔔 na barra superior (`vv-app.js`) para instalar o app e ativar o lembrete.
  - O lembrete chega **toda sexta às 9h** (Vercel Cron em `vercel.json` → `GET /api/lembretes/enviar`;
    só envia na sexta e no máximo 1 vez a cada 20 h). Menciona a Pergunta da semana quando há uma aberta.
  - Chaves de notificação (VAPID) geradas pelo próprio servidor e guardadas na Blob privada
    (`lembretes/vapid.json`); opcional: `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`/`CRON_SECRET`.
  - Painel da gestora: quantas pessoas ativaram e botão "Enviar lembrete agora". iPhone: só com o app
    instalado (Compartilhar → Adicionar à Tela de Início).

## Novidades da v0.27

- **📈 Evolução do Sentimento** (painel da gestora): as últimas 8 semanas lado a lado.
  - Gráfico de respostas por semana, com a parte que tem **sinais de cansaço** (cansado, puxada,
    corrida, estressante, sobrecarga…) destacada; tooltip ao passar o mouse.
  - **Alerta** quando os sinais aparecem em 2 semanas seguidas ou mais (≥ 20% das respostas).
  - Palavras **em alta / em baixa** em relação à semana anterior e tabela com palavra da semana,
    respostas, participação e sinais. Rota `GET /api/sentimentos/gestora/evolucao?ate=&n=`.
- **📮 Caixa de sugestões** (`/sugestoes.html`, atalho `/sugestoes`): sugestões anônimas (até 300
  caracteres, com emojis). Quem enviou acompanha status e resposta no próprio navegador.
  - A gestora gerencia no painel do Sentimento (mesma senha): status (nova, em análise, feito,
    não vamos fazer), resposta e "Mostrar para a equipe" → mural **"Ouvimos você"**.
  - Blob: `sugestoes/_dados.json`. Rotas em `sugestoes.js` (`/api/sugestoes`).

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
