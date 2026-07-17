"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

// Botao de alternancia de tema (claro/escuro). O tema fica no atributo
// data-theme do <html> (definido antes do paint por um script no layout, sem
// flash) e e persistido no localStorage. Padrao: dark (o app e dark-first).
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current = (document.documentElement.getAttribute("data-theme") as Theme) || "dark";
    setTheme(current);
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // ignora (modo privado, etc.)
    }
    setTheme(next);
  }

  // Evita divergencia de hidratacao: so mostra o icone certo apos montar.
  const label = theme === "dark" ? "Tema claro" : "Tema escuro";
  return (
    <button
      type="button"
      className={`theme-toggle ${className}`}
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true" suppressHydrationWarning>
        {mounted ? (theme === "dark" ? "☀️" : "🌙") : "☀️"}
      </span>
    </button>
  );
}
