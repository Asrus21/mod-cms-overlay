// Logica pura dos widgets (relogio, contagem regressiva, cronometro). Fica
// separada do componente para poder ser testada sem React/DOM — a formatacao
// de tempo e a parte que mais quebra silenciosamente.
//
// A configuracao viaja no campo `text` do item (o mesmo do item de TEXTO),
// serializada em JSON. Timestamps sao absolutos (epoch em ms) para todos os
// espectadores verem exatamente o mesmo numero.

export type WidgetKind = "clock" | "countdown" | "stopwatch";

export type WidgetConfig = {
  kind: WidgetKind;
  label?: string; // texto opcional antes do valor (ex.: "Voltamos em")
  withSeconds?: boolean; // relogio/cronometro com segundos
  targetAt?: number; // countdown: instante alvo (epoch ms)
  startedAt?: number; // stopwatch: instante de inicio (epoch ms)
};

export const WIDGET_LABEL: Record<WidgetKind, string> = {
  clock: "Relógio",
  countdown: "Contagem regressiva",
  stopwatch: "Cronômetro",
};

export function isWidgetKind(v: unknown): v is WidgetKind {
  return v === "clock" || v === "countdown" || v === "stopwatch";
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
