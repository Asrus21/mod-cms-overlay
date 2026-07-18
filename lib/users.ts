// Validacao/normalizacao dos campos de cadastro. Regras simples e claras.

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function validateEmail(email: string): string | null {
  if (!EMAIL_RE.test(email)) return "Email invalido";
  if (email.length > 254) return "Email muito longo";
  return null;
}

// Usuario ja normalizado (minusculo). 3-20 caracteres: letras, numeros e _.
export function validateUsername(username: string): string | null {
  if (!USERNAME_RE.test(username)) {
    return "Usuario deve ter 3-20 caracteres: letras, numeros ou _";
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (typeof password !== "string" || password.length < 8) {
    return "A senha precisa ter ao menos 8 caracteres";
  }
  if (password.length > 200) return "Senha muito longa";
  return null;
}
