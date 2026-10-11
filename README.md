# Valida Vision — v0.7

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

`GEMINI_MODEL` aceita uma lista separada por vírgula (ex.: `gemini-3.7-flash,gemini-3.6-flash`).
Se um modelo não existir, o próximo é tentado.

## Modo demonstração

`DEMO_MODE=true` no `.env` testa a interface sem chamar a API.

## Segurança

Os elogios ficam visíveis para quem abrir a página (é a ideia da dinâmica). Não peça dados sensíveis.

A chave fica só no `.env` e nunca vai para o browser. Não compartilhe o `.env`.
Antes de enviar telas reais da empresa, valide as políticas internas de dados e PII.

## Novidades da v0.7

- **💚 Elogie um Colega** (menu lateral): nome do colega + elogio. Ao chegar a 10 elogios
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
   - `GEMINI_MODEL` = `gemini-3.7-flash,gemini-3.6-flash`
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
`GEMINI_MODEL=gemini-3.7-flash,gemini-3.6-flash`
