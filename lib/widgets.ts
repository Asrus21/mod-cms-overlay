// Logica pura dos widgets (relogio, contagem regressiva, cronometro). Fica
// separada do componente para poder ser testada sem React/DOM — a formatacao
// de tempo e a parte que mais quebra silenciosamente.
//
// A configuracao viaja no campo `text` do item (o mesmo do item de TEXTO),
// serializada em JSON. Timestamps sao absolutos (epoch em ms) para todos os
// espectadores verem exatamente o mesmo numero.

export type WidgetKind = "clock" | "countdown" | "stopwatch" | "custom";

// Limite do codigo de um widget personalizado, somando html + css + js.
// Nao e estetico: a config viaja no campo `text` do evento de tempo real, e o
// Pusher recusa mensagens acima de ~10 KB. 6000 caracteres deixam folga para o
// resto do payload (posicao, escala, ids) sem estourar.
export const MAX_WIDGET_CODE = 6000;

export type WidgetConfig = {
  kind: WidgetKind;
  label?: string; // texto opcional antes do valor (ex.: "Voltamos em")
  withSeconds?: boolean; // relogio/cronometro com segundos
  targetAt?: number; // countdown: instante alvo (epoch ms)
  startedAt?: number; // stopwatch: instante de inicio (epoch ms)
  // kind = "custom": codigo escrito pelo proprio mod.
  html?: string;
  css?: string;
  js?: string;
};

export const WIDGET_LABEL: Record<WidgetKind, string> = {
  clock: "Relógio",
  countdown: "Contagem regressiva",
  stopwatch: "Cronômetro",
  custom: "Personalizado",
};

export function isWidgetKind(v: unknown): v is WidgetKind {
  return v === "clock" || v === "countdown" || v === "stopwatch" || v === "custom";
}

// Le a config do campo `text`. Invalida/ausente -> relogio simples, para o
// item nunca sumir da tela por causa de um JSON quebrado.
export function parseWidget(text?: string | null): WidgetConfig {
  if (!text) return { kind: "clock", withSeconds: true };
  try {
    const parsed = JSON.parse(text) as WidgetConfig;
    if (parsed && isWidgetKind(parsed.kind)) return parsed;
  } catch {
    // ignora
  }
  return { kind: "clock", withSeconds: true };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// Formata uma duracao em ms como MM:SS ou H:MM:SS. Nunca fica negativa (a
// contagem regressiva para em 00:00 em vez de virar tempo negativo).
export function formatDuration(ms: number, withSeconds = true): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (!withSeconds) return h > 0 ? `${h}:${pad(m)}` : `${m} min`;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export function widgetText(cfg: WidgetConfig, now: number): string {
  if (cfg.kind === "clock") {
    const d = new Date(now);
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    return cfg.withSeconds === false ? `${hh}:${mm}` : `${hh}:${mm}:${pad(d.getSeconds())}`;
  }
  if (cfg.kind === "countdown") {
    const alvo = cfg.targetAt ?? now;
    return formatDuration(alvo - now, cfg.withSeconds !== false);
  }
  // stopwatch
  const inicio = cfg.startedAt ?? now;
  return formatDuration(now - inicio, cfg.withSeconds !== false);
}

// A contagem regressiva ja chegou ao fim?
export function isCountdownDone(cfg: WidgetConfig, now: number): boolean {
  return cfg.kind === "countdown" && (cfg.targetAt ?? 0) <= now;
}

// Tamanho total do codigo de um widget personalizado.
export function widgetCodeSize(cfg: WidgetConfig): number {
  return (cfg.html || "").length + (cfg.css || "").length + (cfg.js || "").length;
}

// Monta o documento do widget personalizado, para ir no `srcdoc` de um iframe.
//
// SEGURANCA: este documento roda num iframe com sandbox="allow-scripts" e SEM
// allow-same-origin. Essa combinacao poe o codigo numa origem opaca: ele nao
// alcanca o DOM do painel/overlay, nem os cookies, nem o localStorage do nosso
// dominio. Os dois precisam andar juntos — permitir allow-same-origin junto de
// allow-scripts anularia o isolamento por completo.
//
// Fundo transparente por padrao: o overlay fica por cima da live.
export function buildWidgetDoc(cfg: WidgetConfig): string {
  const css = cfg.css || "";
  const html = cfg.html || "";
  const js = cfg.js || "";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden;color:#fff;font-family:system-ui,sans-serif}
${css}
</style>
</head>
<body>
${html}
<script>
try {
${js}
} catch (e) {
  // Um erro no codigo do mod nao pode derrubar o widget inteiro na live:
  // aparece no console do iframe e o resto continua renderizado.
  console.error("[widget]", e);
}
<\/script>
</body>
</html>`;
}
