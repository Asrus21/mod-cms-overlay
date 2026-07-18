"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ThemeToggle } from "../../../ThemeToggle";

const ERROS: Record<string, string> = {
  twitch: "Login cancelado na Twitch. Tente de novo.",
  state: "Sessão de login expirou. Tente de novo.",
  login: "Não foi possível entrar com a Twitch. Tente de novo.",
};

function LoginInner() {
  const params = useSearchParams();
  const erro = params.get("erro");
  const mensagem = erro ? ERROS[erro] || "Falha no login." : "";

  return (
    <motion.div
      className="login-card"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <span className="landing-kicker">⚡ Painel do mod</span>
      <h1 className="login-title">Entrar</h1>
      <p className="login-sub">
        Faça login com a sua conta da <strong>Twitch</strong>. Você verá os
        streamers que você <strong>modera</strong> e poderá controlar o overlay
        de cada um.
      </p>
      {mensagem && <p className="login-error">{mensagem}</p>}
      <a className="twitch-btn" href="/api/auth/twitch/login">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
          <path d="M4 2 3 6v12h4v3h3l3-3h4l4-4V2H4zm15 10-2.5 2.5H12l-2 2v-2H6V4h13v8z" />
          <path d="M14 6h1.5v4H14V6zm-4 0h1.5v4H10V6z" />
        </svg>
        Entrar com a Twitch
      </a>
    </motion.div>
  );
}

export default function LoginPage() {
  return (
    <main className="landing">
      <ThemeToggle className="theme-toggle-fixed" />
      <div className="aurora" aria-hidden="true">
        <span className="aurora-blob b1" />
        <span className="aurora-blob b2" />
        <span className="aurora-blob b3" />
      </div>
      <Suspense fallback={<div className="login-card" />}>
        <LoginInner />
      </Suspense>
    </main>
  );
}
