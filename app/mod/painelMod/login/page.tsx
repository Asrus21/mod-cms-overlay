"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ThemeToggle } from "../../../ThemeToggle";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, key }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha no login");
      }
      router.push(params.get("callbackUrl") || "/mod/painelMod");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login");
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
        <span className="landing-kicker">⚡ Painel do mod</span>
        <h1 className="login-title">Bem-vindo de volta</h1>
        <p className="login-sub">
          Entre com seu <strong>nome</strong> e a sua <strong>senha</strong>{" "}
          (peça ao streamer).
        </p>
        <input
          placeholder="Seu nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Sua senha"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          required
        />
        {error && <p className="login-error">{error}</p>}
        <button className="primary login-btn" type="submit" disabled={loading}>
          {loading ? "Entrando…" : "Entrar"}
        </button>
      </motion.form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="landing" />}>
      <LoginForm />
    </Suspense>
  );
}
