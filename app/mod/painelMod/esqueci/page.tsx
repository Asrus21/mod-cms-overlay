"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ThemeToggle } from "../../../ThemeToggle";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao enviar");
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar");
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
        <span className="landing-kicker">⚡ Recuperar senha</span>
        <h1 className="login-title">Esqueci a senha</h1>
        {done ? (
          <>
            <p className="login-sub">
              Se houver uma conta com esse email, enviamos um{" "}
              <strong>link para redefinir a senha</strong>. Confira sua caixa de
              entrada (e o spam). O link vale por 1 hora.
            </p>
            <p className="login-links">
              <a href="/mod/painelMod/login">Voltar para o login</a>
            </p>
          </>
        ) : (
          <>
            <p className="login-sub">
              Informe o <strong>email cadastrado</strong>. Enviaremos um link
              para você criar uma nova senha.
            </p>
            <input
              type="email"
              placeholder="Seu email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            {error && <p className="login-error">{error}</p>}
            <button className="primary login-btn" type="submit" disabled={loading}>
              {loading ? "Enviando…" : "Enviar link"}
            </button>
            <p className="login-links">
              <a href="/mod/painelMod/login">Voltar para o login</a>
            </p>
          </>
        )}
      </motion.form>
    </main>
  );
}
