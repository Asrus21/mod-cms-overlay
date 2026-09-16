// Traducao de erros do Prisma para mensagens que dizem o que fazer.
//
// Motivo: `scripts/db-push.js` aplica o schema no build de forma best-effort
// (para um banco frio nao derrubar o deploy). O efeito colateral e que uma
// tabela nova pode nunca ser criada, o build passa verde, e o recurso vai ao
// ar quebrado — devolvendo um erro cru do Prisma para o usuario. Aqui esse
// caso vira uma mensagem que explica a causa e a correcao.

// P2021 = "The table does not exist in the current database".
const TABELA_NAO_EXISTE = "P2021";

function codigo(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "string") return c;
  }
  return undefined;
}

// A tabela deste recurso ainda nao foi criada no banco?
export function tabelaAusente(err: unknown): boolean {
  return codigo(err) === TABELA_NAO_EXISTE;
}

// Mensagem para devolver ao cliente. `recurso` e o nome em portugues do que
// falhou (ex.: "As cenas salvas").
export function mensagemDeBanco(err: unknown, recurso: string): string {
  if (tabelaAusente(err)) {
    // Frase montada sem verbo concordando com `recurso`, para servir tanto a
    // nomes no singular quanto no plural.
    return (
      `Indisponível: ${recurso}. A tabela correspondente não foi criada no ` +
      `banco (o db push do último deploy não aplicou o schema). Refaça o ` +
      `deploy ou rode "npm run db:push".`
    );
  }
  return err instanceof Error ? err.message : "Falha no banco de dados";
}
