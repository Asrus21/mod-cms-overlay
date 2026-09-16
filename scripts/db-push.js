// Aplica o schema no banco durante o build — mas NUNCA derruba o deploy.
//
// Por que: o build roda `prisma db push`, e o Neon (plano free) suspende o
// banco quando ocioso. Se o build pega o banco "frio" ou com um soluco de
// rede, o db push falha e, antes, isso quebrava o build inteiro — deixando
// correcoes sem ir pro ar. Aqui a aplicacao do schema e best-effort: se o
// banco estiver disponivel, aplica (cria tabelas novas, etc.); se nao, segue
// o build (as tabelas ja existem de deploys anteriores).
//
// Se voce mudar o schema e o db push automatico nao pegar, rode:
//   npm run db:push

const { execSync } = require("node:child_process");

function sleep(ms) {
  // Espera sincrona sem busy-loop (para dar tempo do Neon acordar).
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pushSchema() {
  execSync("npx --no-install prisma db push --skip-generate", { stdio: "inherit" });
}

// Varias tentativas com espera crescente: uma tabela NOVA que nao e criada
// aqui so aparece como erro em producao depois, com o build ja verde. Dar mais
// chances ao banco frio e barato; desistir na primeira e caro.
const ESPERAS_MS = [5000, 15000, 30000];
let aplicado = false;
let ultimoErro;

for (let tentativa = 0; tentativa <= ESPERAS_MS.length; tentativa++) {
  try {
    pushSchema();
    console.log(`[db-push] schema aplicado (tentativa ${tentativa + 1}).`);
    aplicado = true;
    break;
  } catch (err) {
    ultimoErro = err;
    const espera = ESPERAS_MS[tentativa];
    if (espera === undefined) break;
    console.warn(
      `[db-push] tentativa ${tentativa + 1} falhou (banco frio?). ` +
        `Aguardando ${espera / 1000}s...`
    );
    sleep(espera);
  }
}

if (!aplicado) {
  const msg = ultimoErro && ultimoErro.message ? ultimoErro.message : String(ultimoErro);
  // Continua sem derrubar o deploy (essa e a regra aqui), mas deixa o aviso
  // grande: um recurso novo pode ir ao ar sem a tabela dele.
  console.warn(
    "\n=====================================================================\n" +
      "[db-push] ATENCAO: o schema NAO foi aplicado apos varias tentativas.\n" +
      "O build segue, mas QUALQUER TABELA NOVA deste deploy nao existe no\n" +
      "banco, e o recurso que depende dela vai falhar em producao.\n" +
      "Correcao: rode `npm run db:push` ou refaca o deploy.\n" +
      "Motivo: " + msg + "\n" +
      "=====================================================================\n"
  );
}
