# ValidAI Vision — Protótipo Local v0.4

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

A chave fica só no `.env` e nunca vai para o browser. Não compartilhe o `.env`.
Antes de enviar telas reais da empresa, valide as políticas internas de dados e PII.

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
