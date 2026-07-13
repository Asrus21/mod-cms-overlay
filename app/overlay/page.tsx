// /overlay sem streamer: apenas uma ajuda. O overlay "de verdade" e por
// streamer, em /overlay/<streamer> (link gerado no painel).
export default function OverlayIndexPage() {
  return (
    <div className="overlay-root overlay-help">
      <div>
        <p>Este é o overlay por streamer.</p>
        <p>
          Use o link <code>/overlay/NOME_DO_STREAMER</code> — gere o link do seu
          streamer no painel (campo &quot;Streamer&quot;) e cole no OBS.
        </p>
      </div>
    </div>
  );
}
