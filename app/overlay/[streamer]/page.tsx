import { streamerSlug } from "@/lib/accounts";
import { OverlayView } from "../OverlayView";

// Overlay permanente de um streamer: /overlay/<streamer>. Link fixo que o
// streamer cola no Browser Source do OBS. Deriva o slug do segmento da URL.
export default function StreamerOverlayPage({
  params,
}: {
  params: { streamer: string };
}) {
  const streamer = streamerSlug(decodeURIComponent(params.streamer));
  return <OverlayView streamer={streamer} />;
}
