'use client';
import { useState } from 'react';
import { Heart, MessageCircle, Send, MoreHorizontal, Music2, Camera, Volume2, VolumeX } from 'lucide-react';
import Modal from '@/components/ui/Modal';

// Aperçu d'un reel tel qu'il apparaîtra sur Instagram : lecteur plein écran avec
// la légende repliée (« … plus »), puis la vignette dans la grille du profil (recadrée en 3:4).

interface Props {
  open:      boolean;
  onClose:   () => void;
  account:   string;
  videoUrl:  string | null;
  coverUrl:  string | null;
  caption:   string | null;
  format:    'reel' | 'story';
}

// Hashtags et mentions en gras, comme dans l'app
function RichCaption({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\s+)/).map((part, i) =>
        /^[#@][A-Za-zÀ-ÿ0-9_.]+/.test(part)
          ? <span key={i} className="font-semibold">{part}</span>
          : <span key={i}>{part}</span>)}
    </>
  );
}

export default function ReelPreview({ open, onClose, account, videoUrl, coverUrl, caption, format }: Props) {
  const [expanded, setExpanded] = useState(false);
  // Lecture automatique = son coupé (règle des navigateurs) ; un clic le remet, comme sur Instagram
  const [muted, setMuted] = useState(true);
  const text      = (caption ?? '').trim();
  const firstLine = text.split('\n')[0];
  const truncated = text.length > firstLine.length || firstLine.length > 60;

  return (
    <Modal open={open} onClose={onClose} title="Aperçu Instagram" size="xl">
      <div className="flex flex-col md:flex-row gap-6 items-center md:items-start justify-center">
        {/* Lecteur reel / story */}
        <div className="relative w-[270px] aspect-[9/16] rounded-[28px] overflow-hidden bg-black border-[6px] border-gray-900 shadow-xl flex-shrink-0">
          {videoUrl
            ? <video src={videoUrl} poster={coverUrl ?? undefined} className="absolute inset-0 w-full h-full object-cover" autoPlay loop muted={muted} playsInline />
            : <div className="absolute inset-0 flex items-center justify-center text-white/60 text-xs">Vidéo indisponible</div>}

          {videoUrl && (
            <button onClick={() => setMuted((m) => !m)} title={muted ? 'Activer le son' : 'Couper le son'}
              className="absolute top-12 right-3 z-20 w-9 h-9 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80">
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          )}

          <div className="absolute top-3 left-3 right-3 flex items-center justify-between text-white text-sm font-semibold drop-shadow">
            <span>{format === 'reel' ? 'Reels' : `${account} · story`}</span>
            <Camera className="w-5 h-5" />
          </div>

          {format === 'reel' && (
            <>
              <div className="absolute right-2 bottom-24 flex flex-col items-center gap-4 text-white drop-shadow">
                <Heart className="w-6 h-6" />
                <MessageCircle className="w-6 h-6" />
                <Send className="w-6 h-6" />
                <MoreHorizontal className="w-6 h-6" />
              </div>

              <div className={`absolute left-0 right-0 bottom-0 p-3 pr-12 text-white text-[12px] leading-snug ${expanded ? 'bg-black/60 max-h-[70%] overflow-y-auto' : 'bg-gradient-to-t from-black/70 to-transparent'}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-violet-600 p-[2px]">
                    <div className="w-full h-full rounded-full bg-gray-800" />
                  </div>
                  <span className="font-semibold">{account}</span>
                  <span className="border border-white/80 rounded-md px-2 py-0.5 text-[11px] font-semibold">Suivre</span>
                </div>
                {text ? (
                  expanded ? (
                    <p className="whitespace-pre-line cursor-pointer" onClick={() => setExpanded(false)}><RichCaption text={text} /></p>
                  ) : (
                    <p className="cursor-pointer" onClick={() => setExpanded(true)}>
                      <span className="line-clamp-1 inline"><RichCaption text={firstLine.slice(0, 60)} /></span>
                      {truncated && <span className="text-white/70"> … plus</span>}
                    </p>
                  )
                ) : (
                  <p className="text-white/60 italic">Pas encore de légende</p>
                )}
                <p className="flex items-center gap-1 mt-1.5 text-white/90"><Music2 className="w-3 h-3" /> {account} · Son original</p>
              </div>
            </>
          )}
        </div>

        {/* Légende complète + vignette de grille */}
        <div className="w-full md:w-64 space-y-4">
          {format === 'reel' && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Légende complète</p>
              <div className="text-sm text-gray-800 whitespace-pre-line bg-gray-50 rounded-lg p-3">
                {text ? <><span className="font-semibold">{account}</span> <RichCaption text={text} /></> : <span className="text-gray-400 italic">Pas encore de légende</span>}
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Cliquez sur la légende dans le téléphone pour la déplier comme sur Instagram.</p>
            </div>
          )}
          {format === 'reel' && coverUrl && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Dans la grille du profil</p>
              <div className="grid grid-cols-3 gap-0.5 w-48">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={coverUrl} alt="" className="aspect-[3/4] object-cover w-full ring-2 ring-primary-500" />
                <div className="aspect-[3/4] bg-gray-200" />
                <div className="aspect-[3/4] bg-gray-200" />
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Vignette recadrée en 3:4 (image du début de la vidéo).</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
