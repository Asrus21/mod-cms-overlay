import crypto from "crypto";

// Re-exporta os helpers de slug (definidos sem crypto em lib/slug.ts, para o
// cliente tambem poder usar).
export { slugify, modSlug, streamerSlug } from "./slug";

// Contas dos moderadores. Cada mod tem nome + senha proprios e uma "mesa"
// isolada (canal/estado por mod). As contas vem SOMENTE da variavel de
// ambiente MOD_ACCOUNTS (JSON) — nunca ficam senha no codigo/repositorio.
//
// Formato do MOD_ACCOUNTS (definir no projeto Vercel):
//   [{"name":"vitu","password":"..."},{"name":"asrus","password":"..."}]

export type ModAccount = { name: string; password: string };

function loadAccounts(): ModAccount[] {
  const raw = process.env.MOD_ACCOUNTS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (a): a is ModAccount =>
          !!a &&
          typeof (a as ModAccount).name === "string" &&
          typeof (a as ModAccount).password === "string"
      )
      .map((a) => ({ name: a.name.trim(), password: a.password }))
      .filter((a) => a.name && a.password);
  } catch {
    // JSON invalido -> nenhuma conta.
    return [];
  }
}

// Ha ao menos uma conta configurada? Usado para dar um erro claro no login
// quando MOD_ACCOUNTS ainda nao foi definido no servidor.
export function hasModAccounts(): boolean {
  return loadAccounts().length > 0;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Valida nome + senha. Retorna o nome canonico (como cadastrado) se bater,
// senao null. Comparacao de senha em tempo constante.
export function verifyMod(name: string, password: string): string | null {
  const n = name.trim().toLowerCase();
  for (const acc of loadAccounts()) {
    if (acc.name.toLowerCase() === n) {
      return safeEqual(password, acc.password) ? acc.name : null;
    }
  }
  return null;
}

