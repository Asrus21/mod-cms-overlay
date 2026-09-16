"use client";

import { useEffect, useState } from "react";
import { buildWidgetDoc, isCountdownDone, widgetText, type WidgetConfig } from "@/lib/widgets";

// Widgets: itens "vivos" da mesa, que se atualizam sozinhos na tela (relogio,
// contagem regressiva e cronometro). Diferente das demais midias, o conteudo
// nao vem do servidor a cada segundo — o proprio overlay calcula a partir da
// configuracao, entao nao gasta tempo real e nunca fica "travado".
// A logica de formatacao fica em lib/widgets.ts (pura, testavel).

export { WIDGET_LABEL, parseWidget, type WidgetConfig, type WidgetKind } from "@/lib/widgets";

// Renderiza o valor do widget, atualizando a cada segundo.
export function WidgetView({ config }: { config: WidgetConfig }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Widget personalizado: o codigo do mod roda num iframe ISOLADO.
  // sandbox="allow-scripts" SEM allow-same-origin poe o codigo numa origem
  // opaca — ele nao alcanca o DOM do painel/overlay, nem cookies, nem o
  // localStorage do nosso dominio. Nunca adicione allow-same-origin aqui: as
  // duas permissoes juntas anulam o isolamento.
  if (config.kind === "custom") {
    return (
      <iframe
        className="widget-custom"
        title="Widget personalizado"
        sandbox="allow-scripts"
        srcDoc={buildWidgetDoc(config)}
      />
    );
  }


  return (
    // O valor depende do relogio: o HTML gerado no servidor e o do cliente
    // caem em segundos diferentes. Isso e esperado aqui (nao e um bug de
    // estado), entao silenciamos o aviso de hidratacao — o React corrige o
    // texto no cliente e o intervalo assume a partir dai.
    <span
      className={`widget-value${isCountdownDone(config, now) ? " done" : ""}`}
      suppressHydrationWarning
    >
      {config.label ? <span className="widget-label">{config.label} </span> : null}
      {widgetText(config, now)}
    </span>
  );
}
