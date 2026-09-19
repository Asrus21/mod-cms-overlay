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

// Apelido do convite: texto livre, so para o streamer reconhecer quem entrou
// ("Eu em outra conta", "editor do clipe", o nome da pessoa...). NAO restringe
// quem pode usar o codigo e nao tem relacao com o login da Twitch.
export const MAX_APELIDO = 40;

export function normalizarApelido(bruto: string): string {
  return (bruto || "").trim().replace(/\s+/g, " ").slice(0, MAX_APELIDO);
}

// Como identificar na lista quem usou (ou vai usar) um convite.
// Sem apelido, vale o usuario da Twitch de quem usou.
export function rotuloDoConvite(apelido: string, usedBy: string): string {
  const a = normalizarApelido(apelido);
  if (a) return a;
  if (usedBy) return `@${usedBy}`;
  return "para quem usar primeiro";
}

// Um convite so pode ser usado uma vez. Quem usa nao importa: o codigo e a
// credencial, e quem o recebeu foi escolhido pelo streamer ao entregar.
export type EstadoConvite = { usedBy: string };

export function motivoDeRecusa(convite: EstadoConvite | null): string | null {
  if (!convite) return "Código não encontrado. Confira as letras e tente de novo.";
  if (convite.usedBy) return "Este código já foi usado.";
  return null;
}
