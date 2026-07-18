// Envio de email transacional via Resend (https://resend.com) por HTTP — sem
// dependencia/SDK. Configuracao (na Vercel):
//   RESEND_API_KEY   -> chave da API do Resend (obrigatorio para enviar)
//   RESET_FROM_EMAIL -> remetente verificado (ex.: "Asrus <no-reply@asrus.app>")
//                       Sem dominio verificado, use "onboarding@resend.dev"
//                       (o Resend so entrega para o email da sua conta em teste).

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY nao configurado no servidor");
  }
  const from = process.env.RESET_FROM_EMAIL || "onboarding@resend.dev";

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:auto;color:#1b1f27">
    <h2 style="margin:0 0 8px">Redefinir sua senha</h2>
    <p style="color:#4b5162;line-height:1.5">
      Recebemos um pedido para redefinir a senha da sua conta no
      <strong>Mod CMS Overlay</strong>. Clique no botao abaixo para escolher uma
      nova senha. O link vale por <strong>1 hora</strong> e so pode ser usado uma vez.
    </p>
    <p style="margin:24px 0">
      <a href="${resetUrl}" style="display:inline-block;background:#6366f1;color:#fff;
         text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700">
        Redefinir senha
      </a>
    </p>
    <p style="color:#8b91a1;font-size:13px;line-height:1.5">
      Se voce nao pediu isso, pode ignorar este email — sua senha continua a mesma.
      <br>Ou copie e cole este endereco no navegador:<br>
      <span style="word-break:break-all">${resetUrl}</span>
    </p>
  </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: "Redefinir sua senha — Mod CMS Overlay",
      html,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend recusou o envio (HTTP ${res.status}): ${detail}`);
  }
}
