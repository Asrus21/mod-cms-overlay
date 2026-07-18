"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ThemeToggle } from "../../../ThemeToggle";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username, password, inviteCode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha no cadastro");
      }
      router.push("/mod/painelMod");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no cadastro");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="landing">
      <ThemeToggle className="theme-toggle-fixed" />
      <div className="aurora" aria-hidden="true">
        <span className="aurora-blob b1" />
        <span className="aurora-blob b2" />
        <span className="aurora-blob b3" />
      </div>

      <motion.form
        className="login-card"
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <span className="landing-kicker">⚡ Criar conta</span>
        <h1 className="login-title">Criar sua conta</h1>
        <p className="login-sub">
          Cadastre-se com <strong>email</strong>, <strong>usuário</strong> e{" "}
          <strong>senha</strong>. O email é usado só para recuperar a senha.
        </p>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <input
          placeholder="Usuário (3-20: letras, números ou _)"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
        <input
          type="password"
          placeholder="Senha (mínimo 8 caracteres)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
        <input
          placeholder="Código de convite (se o streamer exigir)"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          autoComplete="off"
        />
        {error && <p className="login-error">{error}</p>}
        <button className="primary login-btn" type="submit" disabled={loading}>
          {loading ? "Criando…" : "Criar conta"}
        </button>
        <p className="login-links">
          Já tem conta? <a href="/mod/painelMod/login">Entrar</a>
        </p>
      </motion.form>
    </main>
  );
}
