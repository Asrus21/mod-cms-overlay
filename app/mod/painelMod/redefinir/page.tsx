"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ThemeToggle } from "../../../ThemeToggle";

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("As senhas não conferem");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao redefinir");
      }
      setDone(true);
      setTimeout(() => router.push("/mod/painelMod/login"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao redefinir");
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.form
      className="login-card"
      onSubmit={handleSubmit}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <span className="landing-kicker">⚡ Nova senha</span>
      <h1 className="login-title">Redefinir senha</h1>
      {!token ? (
        <>
          <p className="login-sub">
            Link inválido. Abra o link enviado ao seu email ou peça um novo.
          </p>
          <p className="login-links">
            <a href="/mod/painelMod/esqueci">Esqueci a senha</a>
          </p>
        </>
      ) : done ? (
        <p className="login-sub">
          Senha redefinida com sucesso! Redirecionando para o login…
        </p>
      ) : (
        <>
          <p className="login-sub">Escolha uma nova senha (mínimo 8 caracteres).</p>
          <input
            type="password"
            placeholder="Nova senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
          <input
            type="password"
            placeholder="Confirmar nova senha"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
          {error && <p className="login-error">{error}</p>}
          <button className="primary login-btn" type="submit" disabled={loading}>
            {loading ? "Salvando…" : "Redefinir senha"}
          </button>
        </>
      )}
    </motion.form>
  );
}

export default function ResetPage() {
  return (
    <main className="landing">
      <ThemeToggle className="theme-toggle-fixed" />
      <div className="aurora" aria-hidden="true">
        <span className="aurora-blob b1" />
        <span className="aurora-blob b2" />
        <span className="aurora-blob b3" />
      </div>
      <Suspense fallback={<div className="login-card" />}>
        <ResetForm />
      </Suspense>
    </main>
  );
}
