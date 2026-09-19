// Convites de acesso a mesa de um streamer.
//
// O streamer gera um codigo e entrega a quem quiser; quem digita o codigo no
// painel ganha acesso aquela mesa. Isso substitui "todo mod do canal na Twitch
// tem acesso": moderar nao basta mais, precisa do convite.
//
// Logica pura (sem banco) para poder ser conferida direto.

// Alfabeto sem os pares que se confundem ao ditar ou copiar de um print:
// sem O/0, sem I/1, sem S/5. Quem recebe o codigo costuma digitar a mao.
const ALFABETO = "ABCDEFGHJKLMNPQRTUVWXYZ2346789";
const GRUPOS = 3;
const POR_GRUPO = 4;

export const TAMANHO_CODIGO = GRUPOS * POR_GRUPO;

// Gera um codigo novo, no formato XXXX-XXXX-XXXX.
//
// `aleatorio` e injetavel so para o teste poder fixar a saida; em producao usa
// crypto, e nao Math.random: o codigo e uma credencial de acesso a mesa.
export function gerarCodigo(aleatorio?: (n: number) => number): string {
  const sorteia =
    aleatorio ??
    ((n: number) => {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      // Faixa de rejeicao para nao enviesar os primeiros caracteres.
      const teto = Math.floor(0xffffffff / n) * n;
      let v = buf[0];
      while (v >= teto) {
        crypto.getRandomValues(buf);
        v = buf[0];
      }
      return v % n;
    });

  const letras: string[] = [];
  for (let i = 0; i < TAMANHO_CODIGO; i++) letras.push(ALFABETO[sorteia(ALFABETO.length)]);
  const partes: string[] = [];
  for (let i = 0; i < GRUPOS; i++) partes.push(letras.slice(i * POR_GRUPO, (i + 1) * POR_GRUPO).join(""));
  return partes.join("-");
}

// Normaliza o que a pessoa digitou: caixa alta, sem espaco nem tracinho, e
// trocando os caracteres que o alfabeto evita pelos equivalentes (quem le
// "0" num print quase sempre quis dizer "O"... que aqui vira zero de volta).
// Devolve "" quando nao sobra um codigo do tamanho certo.
export function normalizarCodigo(bruto: string): string {
  const limpo = (bruto || "")
    .toUpperCase()
    .replace(/[\s\-_.]/g, "")
    .replace(/O/g, "0")
    .replace(/I/g, "1")
    .replace(/S/g, "5");
  // Depois da troca acima, 0/1/5 nao existem no alfabeto: sao erros de leitura
  // que nao tem como consertar sozinhos. Mantemos para a comparacao falhar de
  // forma limpa em vez de "quase acertar".
  if (limpo.length !== TAMANHO_CODIGO) return "";
  return limpo;
}

// Formato de exibicao, com os tracinhos.
export function formatarCodigo(codigo: string): string {
  const c = (codigo || "").replace(/[\s\-]/g, "").toUpperCase();
  const partes: string[] = [];
  for (let i = 0; i < c.length; i += POR_GRUPO) partes.push(c.slice(i, i + POR_GRUPO));
  return partes.join("-");
}

// Guardamos e comparamos sempre sem tracinho e em caixa alta.
export function chaveDoCodigo(codigo: string): string {
  return (codigo || "").replace(/[\s\-]/g, "").toUpperCase();
}

// Login da Twitch de quem vai usar o convite (opcional).
const LOGIN_RE = /^[a-zA-Z0-9_]{3,25}$/;

export function normalizarLogin(bruto: string): string | null {
  const v = (bruto || "").trim().replace(/^@/, "").toLowerCase();
  if (!v) return "";        // em branco e valido: vale para quem usar primeiro
  return LOGIN_RE.test(v) ? v : null;
}

// Um convite so pode ser usado por quem ele nomeia — e so uma vez.
export type EstadoConvite = { forLogin: string; usedBy: string };

export function motivoDeRecusa(
  convite: EstadoConvite | null,
  quemUsa: string
): string | null {
  if (!convite) return "Código não encontrado. Confira as letras e tente de novo.";
  if (convite.usedBy) return "Este código já foi usado.";
  if (convite.forLogin && convite.forLogin !== quemUsa.trim().toLowerCase()) {
    return `Este código foi criado para @${convite.forLogin}.`;
  }
  return null;
}
