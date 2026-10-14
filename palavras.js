// ======================================================
// PALAVRAS PARA A NUVEM
// Usado pelo Elogie um Colega e pelo Sentimento da Semana: separa as palavras de um texto,
// ignora as muito comuns ("de", "que", "muito"…) e conta quantas vezes cada uma aparece.
// ======================================================

export const STOP = new Set(
  `a à às ao aos as o os um uma uns umas de da das do dos d em na nas no nos num numa por pela pelas pelo pelos para pra pro pras pros com sem sob sobre entre até após ante contra desde
  e é eh ou mas mais menos que quem qual quais quando onde como porque porquê pois se já não nao sim só so também tambem muito muita muitos muitas pouco pouca bem mal
  eu tu ele ela nós nos vós eles elas você voce vocês voces me te se lhe lhes meu minha meus minhas teu tua seu sua seus suas nosso nossa nossos nossas dele dela deles delas
  isso isto aquilo esse essa esses essas este esta estes estas aquele aquela aqueles aquelas aqui ali lá la cá ca aí ai
  ser sou és é somos são foi fui foram era eram será serão seja sejam sendo sido estar estou está estamos estão esteve estava estavam
  ter tenho tem temos têm tinha tinham teve tido haver há havia faz fazer fez feito vai vou vamos ir sempre nunca todo toda todos todas tudo nada algo alguém ninguém
  cada outro outra outros outras mesmo mesma tão tao tanto tanta ainda agora hoje dia vez vezes coisa coisas pessoa pessoas obrigado obrigada valeu
  nesta neste nessa nesse nestas nestes nessas nesses disso disto daquilo desse dessa deste desta num numa pelo
  the and you are`.split(/\s+/).filter(Boolean)
);

export function tokens(txt) {
  return String(txt || "").match(/[\p{L}\p{N}]+(?:[-'][\p{L}]+)*/gu) || [];
}

/**
 * Conta as palavras relevantes de uma lista de textos.
 * - `ignorar(texto)` → Set de palavras a pular naquele texto.
 * - `manter` → Set de palavras que contam mesmo estando na lista de comuns (ex.: "bem", "mal").
 * - `inteiraSeVazia` → se um texto curto não sobrar nenhuma palavra, ele entra inteiro
 *   (ex.: "muito bem"), para nenhuma resposta sumir da nuvem.
 */
export function contarTermos(textos, { limite = 80, ignorar, manter, inteiraSeVazia = false } = {}) {
  const cont = new Map();
  const soma = (k) => cont.set(k, (cont.get(k) || 0) + 1);
  for (const t of textos) {
    const pular = ignorar ? ignorar(t) : null;
    const todos = tokens(t.texto ?? t);
    let usados = 0;
    for (const tk of todos) {
      const k = tk.toLocaleLowerCase("pt-BR");
      const comum = (k.length < 3 || STOP.has(k)) && !manter?.has(k);
      if (comum || pular?.has(k) || /^\d+$/.test(k)) continue;
      soma(k);
      usados++;
    }
    if (!usados && inteiraSeVazia && todos.length && todos.length <= 4) {
      soma(todos.join(" ").toLocaleLowerCase("pt-BR"));
    }
  }
  return [...cont.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR")).slice(0, limite);
}
