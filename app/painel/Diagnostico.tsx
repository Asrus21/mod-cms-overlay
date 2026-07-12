"use client";

import { useState } from "react";

type Health = {
  db: boolean;
  blob: boolean;
  auth: { accessKey: boolean; sessionSecret: boolean };
  pusher: {
    appId: boolean;
    key: boolean;
    secret: boolean;
    cluster: boolean;
    publicKey: boolean;
    publicCluster: boolean;
    clusterMatch: boolean;
  };
  vdo: boolean;
};

type Row = { ok: boolean; label: string; hint?: string };

function Item({ ok, label, hint }: Row) {
  return (
    <li className={`diag-item ${ok ? "ok" : "bad"}`}>
      <span className="diag-mark">{ok ? "✓" : "✗"}</span>
      <span>
        {label}
        {!ok && hint ? <span className="diag-hint"> — {hint}</span> : null}
      </span>
    </li>
  );
}

// Painel de diagnostico: mostra o que esta configurado no servidor (so
// booleans, nunca valores) para achar rapidamente o que falta na Vercel.
export function Diagnostico() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);

  async function check() {
    setLoading(true);
    try {
      const res = await fetch("/api/health");
      if (res.ok) setHealth(await res.json());
    } finally {
      setLoading(false);
    }
  }

  const rows: Row[] = health
    ? [
        { ok: health.db, label: "Banco de dados (Neon)", hint: "conecte o Neon e redeploy" },
        {
          ok: health.blob,
          label: "Upload de arquivos (Vercel Blob)",
          hint: "falta BLOB_READ_WRITE_TOKEN",
        },
        { ok: health.pusher.appId, label: "Pusher · PUSHER_APP_ID", hint: "adicione na Vercel" },
        { ok: health.pusher.key, label: "Pusher · PUSHER_KEY", hint: "adicione na Vercel" },
        { ok: health.pusher.secret, label: "Pusher · PUSHER_SECRET", hint: "adicione na Vercel" },
        { ok: health.pusher.cluster, label: "Pusher · PUSHER_CLUSTER", hint: "adicione na Vercel" },
        {
          ok: health.pusher.publicKey,
          label: "Pusher · NEXT_PUBLIC_PUSHER_KEY",
          hint: "mesmo valor de PUSHER_KEY",
        },
        {
          ok: health.pusher.publicCluster,
          label: "Pusher · NEXT_PUBLIC_PUSHER_CLUSTER",
          hint: "mesmo valor de PUSHER_CLUSTER",
        },
        {
          ok: health.pusher.clusterMatch,
          label: "Pusher · cluster servidor = navegador",
          hint: "PUSHER_CLUSTER e NEXT_PUBLIC_PUSHER_CLUSTER estão diferentes",
        },
        {
          ok: health.auth.accessKey,
          label: "Login · MOD_ACCESS_KEY",
          hint: "senha do painel",
        },
        {
          ok: health.auth.sessionSecret,
          label: "Login · SESSION_SECRET",
          hint: "segredo do cookie",
        },
        {
          ok: health.vdo,
          label: "Feed ao vivo (VDO_ROOM) — opcional",
          hint: "só se quiser câmera ao vivo",
        },
      ]
    : [];

  return (
    <section className="panel-section">
      <h2>Diagnóstico</h2>
      <p>Confere o que está configurado no servidor (não mostra os valores, só se existem).</p>
      <button onClick={check} disabled={loading}>
        {loading ? "Verificando…" : "Verificar configuração"}
      </button>
      {health && (
        <ul className="diag-list">
          {rows.map((r) => (
            <Item key={r.label} {...r} />
          ))}
        </ul>
      )}
    </section>
  );
}
