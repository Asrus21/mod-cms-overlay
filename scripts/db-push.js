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

try {
  pushSchema();
  console.log("[db-push] schema aplicado.");
} catch {
  console.warn("[db-push] 1a tentativa falhou (banco frio?). Aguardando 5s e tentando de novo...");
  try {
    sleep(5000);
    pushSchema();
    console.log("[db-push] schema aplicado na 2a tentativa.");
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn(
      "[db-push] pulado — o build segue normalmente. " +
        "Se voce mudou o schema, rode `npm run db:push` depois. Motivo: " +
        msg
    );
  }
}
