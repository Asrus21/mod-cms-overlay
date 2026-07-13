// Slugs (a-z0-9_-) usados como id em canais/estado/URLs. Sem dependencias de
// Node (crypto), para poder ser importado tambem no cliente (painel).

export function slugify(name: string, fallback = "x"): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || fallback;
}

// Slug do mod (dono do item).
export function modSlug(name: string): string {
  return slugify(name, "mod");
}

// Slug do streamer (dono do overlay). Deterministico: o link do overlay
// derivado do nome nunca muda para o mesmo streamer.
export function streamerSlug(name: string): string {
  return slugify(name, "");
}
