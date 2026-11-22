import React, { useEffect, useRef, useState } from 'react';
import {
  Captions,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Music,
  Pause,
  PictureInPicture2,
  Play,
  Share2,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { ActiveMediaTrack } from '../types/media';
import { formatBytes, formatDate, formatTimeSeconds } from '../utils/media';

const AUDIO_FALLBACK_ART = '/src/assets/images/audio_vinyl_artwork_1795357589564.jpg';

export interface RemotePlaybackCommand {
  action: 'play' | 'pause' | 'seek';
  currentTime: number;
  isPlaying: boolean;
  seq: number;
}

interface MediaPlayerStageProps {
  activeTrack: ActiveMediaTrack | null;
  queueIndex: number;
  queueLength: number;
  nextTrackName?: string | null;
  onPrev: () => void;
  onNext: () => void;
  onShare?: () => void;
  onSendToTvNow?: () => void;
  remoteCommand?: RemotePlaybackCommand | null;
  onPlaybackControl?: (action: 'play' | 'pause' | 'seek', currentTime: number, isPlaying: boolean) => void;
  onClose: () => void;
}

export const MediaPlayerStage: React.FC<MediaPlayerStageProps> = ({
  activeTrack,
  queueIndex,
  queueLength,
  nextTrackName,
  onPrev,
  onNext,
  onShare,
  onSendToTvNow,
  remoteCommand,
  onPlaybackControl,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const suppressSyncEmitUntilRef = useRef<number>(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [isTheater, setIsTheater] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [artFailed, setArtFailed] = useState(false);

  const kind = activeTrack?.entry.kind;
  const activeMediaEl = kind === 'video' ? videoRef.current : kind === 'audio' ? audioRef.current : null;
  const hasPrev = queueIndex > 0;
  const hasNext = queueIndex < queueLength - 1;
  const showUpNextOverlay =
    kind === 'video' &&
    hasNext &&
    duration > 15 &&
    duration - currentTime <= 10;

  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setMediaError(null);
    setIsPlaying(false);
    suppressSyncEmitUntilRef.current = Date.now() + 900;
  }, [activeTrack?.streamUrl]);

  // Apply remote play/pause/seek commands without echoing back to server
  useEffect(() => {
    if (!remoteCommand || !activeTrack) return;
    const el = kind === 'video' ? videoRef.current : kind === 'audio' ? audioRef.current : null;
    if (!el) return;

    suppressSyncEmitUntilRef.current = Date.now() + 900;
    if (
      typeof remoteCommand.currentTime === 'number' &&
      Math.abs((el.currentTime || 0) - remoteCommand.currentTime) > 1.5
    ) {
      try {
        el.currentTime = remoteCommand.currentTime;
        setCurrentTime(remoteCommand.currentTime);
      } catch {
        // Ignore seek before metadata loaded
      }
    }
    if (remoteCommand.action === 'pause') {
      el.pause();
    } else if (remoteCommand.action === 'play') {
      void el.play().catch(() => undefined);
    }
  }, [remoteCommand, activeTrack, kind]);

  useEffect(() => {
    if (activeMediaEl) {
      activeMediaEl.volume = isMuted ? 0 : volume;
      activeMediaEl.playbackRate = playbackRate;
    }
  }, [volume, isMuted, playbackRate, activeMediaEl, activeTrack?.streamUrl]);

  // Keyboard shortcuts for desktop streaming player
  useEffect(() => {
    if (!activeTrack || (kind !== 'video' && kind !== 'audio')) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      const el = kind === 'video' ? videoRef.current : audioRef.current;
      if (!el) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (el.paused) {
          void el.play();
        } else {
          el.pause();
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        el.currentTime = Math.min(el.duration || el.currentTime + 10, el.currentTime + 10);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        el.currentTime = Math.max(0, el.currentTime - 10);
      } else if (e.key === 'm' || e.key === 'M') {
        setIsMuted((prev) => !prev);
      } else if ((e.key === 'f' || e.key === 'F') && kind === 'video') {
        if (document.fullscreenElement) {
          void document.exitFullscreen();
        } else if (stageRef.current) {
          void stageRef.current.requestFullscreen();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTrack, kind]);

  // Toggle HTML5 subtitle track mode cleanly
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !vid.textTracks || vid.textTracks.length === 0) return;
    for (let i = 0; i < vid.textTracks.length; i++) {
      vid.textTracks[i].mode = subtitlesEnabled ? 'showing' : 'hidden';
    }
  }, [subtitlesEnabled, activeTrack?.subtitleUrl]);

  if (!activeTrack) return null;

  const togglePlay = () => {
    const el = kind === 'video' ? videoRef.current : audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => {
        setMediaError('O navegador não conseguiu iniciar a reprodução automática. Clique em Play.');
      });
    } else {
      el.pause();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = kind === 'video' ? videoRef.current : audioRef.current;
    const next = Number(e.target.value);
    if (el && Number.isFinite(next)) {
      el.currentTime = next;
      setCurrentTime(next);
      if (Date.now() > suppressSyncEmitUntilRef.current) {
        onPlaybackControl?.('seek', next, !el.paused);
      }
    }
  };

  const handlePip = async () => {
    const vid = videoRef.current;
    if (!vid || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await vid.requestPictureInPicture();
      }
    } catch {
      // Ignore PiP denial
    }
  };

  const handleFullscreen = async () => {
    if (!stageRef.current) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await stageRef.current.requestFullscreen();
      }
    } catch {
      // Ignore fullscreen denial
    }
  };

  // Image Lightbox Viewer
  if (kind === 'image') {
    return (
      <div className="mb-6 rounded-xl border border-slate-800 bg-[#090E1A] p-4">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-100">{activeTrack.entry.name}</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              <span>{activeTrack.entry.extension.toUpperCase() || 'Imagem'}</span>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{formatBytes(activeTrack.entry.size)}</span>
              {activeTrack.entry.lastModified && (
                <>
                  <span className="mx-1.5" aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{formatDate(activeTrack.entry.lastModified)}</span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {onShare && (
              <button
                type="button"
                onClick={onShare}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 text-xs font-medium text-slate-200 hover:bg-slate-800 hover:text-white whitespace-nowrap"
              >
                <Share2 className="h-3.5 w-3.5 text-sky-400" />
                <span>Compartilhar</span>
              </button>
            )}
            {queueLength > 1 && (
              <>
                <button
                  type="button"
                  onClick={onPrev}
                  disabled={!hasPrev}
                  aria-label="Imagem anterior"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-35"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onNext}
                  disabled={!hasNext}
                  aria-label="Próxima imagem"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-35"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar visualizador"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex max-h-[62vh] items-center justify-center overflow-hidden rounded-lg bg-black/60 p-2">
          <img
            src={activeTrack.streamUrl}
            alt={activeTrack.entry.name}
            referrerPolicy="no-referrer"
            className="max-h-[58vh] w-auto rounded object-contain"
          />
        </div>
      </div>
    );
  }

  // Audio Studio Player
  if (kind === 'audio') {
    return (
      <div className="mb-6 rounded-xl border border-slate-800 bg-[#111827] p-4">
        <audio
          ref={audioRef}
          src={activeTrack.streamUrl}
          autoPlay
          onPlay={(e) => {
            setIsPlaying(true);
            if (Date.now() > suppressSyncEmitUntilRef.current) {
              onPlaybackControl?.('play', e.currentTarget.currentTime, true);
            }
          }}
          onPause={(e) => {
            setIsPlaying(false);
            if (Date.now() > suppressSyncEmitUntilRef.current) {
              onPlaybackControl?.('pause', e.currentTarget.currentTime, false);
            }
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onEnded={() => {
            if (queueIndex < queueLength - 1) onNext();
          }}
          onError={() => setMediaError('Não foi possível reproduzir este formato de áudio no navegador.')}
        />

        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
              {!artFailed ? (
                <img
                  src={AUDIO_FALLBACK_ART}
                  alt={`Capa de áudio para ${activeTrack.entry.name}`}
                  referrerPolicy="no-referrer"
                  onError={() => setArtFailed(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-slate-900 text-sky-400">
                  <Music className="h-7 w-7" />
                </div>
              )}
            </div>

            <div className="min-w-0">
              <p className="text-[11px] font-medium text-sky-400">
                {activeTrack.remoteSourceLabel || 'Reproduzindo áudio'}
              </p>
              <h3 className="truncate text-sm font-semibold text-slate-100">{activeTrack.entry.name}</h3>
              <p className="mt-0.5 truncate text-xs text-slate-400">
                <span>{activeTrack.entry.extension.toUpperCase() || 'Áudio'}</span>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{formatBytes(activeTrack.entry.size)}</span>
                {queueLength > 1 && (
                  <>
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      Faixa {queueIndex + 1} de {queueLength}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-2 lg:max-w-xl">
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={onPrev}
                disabled={!hasPrev}
                aria-label="Faixa anterior"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-35"
              >
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-600 text-white transition-colors hover:bg-sky-500"
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-0.5" />}
              </button>
              <button
                type="button"
                onClick={onNext}
                disabled={!hasNext}
                aria-label="Próxima faixa"
                title={hasNext && nextTrackName ? `Próxima: ${nextTrackName}` : 'Sem próxima faixa'}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-35"
              >
                <SkipForward className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <span className="w-12 text-right font-mono text-[11px] text-slate-400 tabular-nums">
                {formatTimeSeconds(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.5}
                value={Math.min(currentTime, duration || 100)}
                onChange={handleSeek}
                aria-label="Progresso da reprodução"
                className="h-1.5 flex-1 cursor-pointer accent-sky-500"
              />
              <span className="w-12 font-mono text-[11px] text-slate-400 tabular-nums">
                {formatTimeSeconds(duration)}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsMuted((prev) => !prev)}
                aria-label={isMuted ? 'Ativar som' : 'Silenciar'}
                className="text-slate-400 hover:text-slate-100"
              >
                {isMuted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  setIsMuted(false);
                  setVolume(Number(e.target.value));
                }}
                aria-label="Volume"
                className="h-1.5 w-20 cursor-pointer accent-sky-500"
              />
            </div>
            {onShare && (
              <button
                type="button"
                onClick={onShare}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 text-xs font-medium text-slate-200 hover:bg-slate-800 hover:text-white whitespace-nowrap"
              >
                <Share2 className="h-3.5 w-3.5 text-sky-400" />
                <span>Compartilhar</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar player"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {mediaError && (
          <p role="alert" className="mt-3 text-xs text-amber-300">
            {mediaError}
          </p>
        )}
      </div>
    );
  }

  // Video Cinema Player
  return (
    <div
      ref={stageRef}
      className={`mb-6 overflow-hidden rounded-xl border border-slate-800 bg-black ${
        isTheater ? 'mx-auto w-full' : ''
      }`}
    >
      <div className="flex items-center justify-between border-b border-slate-800/80 bg-[#0F1626] px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-100">{activeTrack.entry.name}</h3>
          <p className="text-[11px] text-slate-400">
            <span>{activeTrack.entry.extension.toUpperCase() || 'Vídeo'}</span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{formatBytes(activeTrack.entry.size)}</span>
            {activeTrack.remoteSourceLabel && (
              <>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span className="text-sky-400">{activeTrack.remoteSourceLabel}</span>
              </>
            )}
            {activeTrack.subtitleLabel && (
              <>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span>Legenda: {activeTrack.subtitleLabel}</span>
              </>
            )}
            {queueLength > 1 && (
              <>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {queueIndex + 1} / {queueLength}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onSendToTvNow && (
            <button
              type="button"
              onClick={onSendToTvNow}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-sky-500 whitespace-nowrap"
            >
              <Play className="h-3 w-3" />
              <span>Enviar para TV</span>
            </button>
          )}
          {onShare && (
            <button
              type="button"
              onClick={onShare}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 hover:text-white whitespace-nowrap"
            >
              <Share2 className="h-3.5 w-3.5 text-sky-400" />
              <span>Compartilhar</span>
            </button>
          )}
          {activeTrack.subtitleUrl && (
            <button
              type="button"
              onClick={() => setSubtitlesEnabled((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                subtitlesEnabled
                  ? 'border-sky-500/60 bg-sky-500/15 text-sky-300'
                  : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Captions className="h-3.5 w-3.5" />
              <span>Legenda</span>
            </button>
          )}
          <select
            value={playbackRate}
            onChange={(e) => setPlaybackRate(Number(e.target.value))}
            aria-label="Velocidade de reprodução"
            className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
          >
            <option value={0.75}>0.75x</option>
            <option value={1}>1.0x</option>
            <option value={1.25}>1.25x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2.0x</option>
          </select>
          <button
            type="button"
            onClick={handlePip}
            aria-label="Picture-in-Picture"
            title="Picture-in-Picture"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <PictureInPicture2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setIsTheater((prev) => !prev)}
            aria-label={isTheater ? 'Modo compacto' : 'Modo teatro'}
            title={isTheater ? 'Modo compacto' : 'Modo teatro'}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            {isTheater ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar player"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="relative bg-black">
        <video
          ref={videoRef}
          src={activeTrack.streamUrl}
          controls
          autoPlay
          playsInline
          onPlay={(e) => {
            setIsPlaying(true);
            if (Date.now() > suppressSyncEmitUntilRef.current) {
              onPlaybackControl?.('play', e.currentTarget.currentTime, true);
            }
          }}
          onPause={(e) => {
            setIsPlaying(false);
            if (Date.now() > suppressSyncEmitUntilRef.current) {
              onPlaybackControl?.('pause', e.currentTarget.currentTime, false);
            }
          }}
          onSeeked={(e) => {
            if (Date.now() > suppressSyncEmitUntilRef.current) {
              onPlaybackControl?.('seek', e.currentTarget.currentTime, !e.currentTarget.paused);
            }
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onEnded={() => {
            if (hasNext) onNext();
          }}
          onError={() =>
            setMediaError(
              'Este formato/codec de vídeo (ex: MKV HEVC/AC3) pode não ser suportado nativamente pelo navegador. Prefira MP4/WebM H.264 ou AAC.'
            )
          }
          className={`mx-auto w-full bg-black object-contain ${
            isTheater ? 'max-h-[76vh]' : 'max-h-[54vh]'
          }`}
        >
          {activeTrack.subtitleUrl && (
            <track
              kind="subtitles"
              label={activeTrack.subtitleLabel || 'Português'}
              src={activeTrack.subtitleUrl}
              default
            />
          )}
        </video>

        {showUpNextOverlay && (
          <div className="absolute right-4 bottom-16 z-10 flex items-center gap-3 rounded-xl border border-slate-700 bg-[#0F1626]/95 px-4 py-3 shadow-2xl backdrop-blur-sm">
            <div className="min-w-0 max-w-[220px]">
              <p className="text-[11px] font-medium text-sky-400">A seguir na pasta</p>
              <p className="truncate text-xs font-semibold text-slate-100">
                {nextTrackName || 'Próximo vídeo'}
              </p>
            </div>
            <button
              type="button"
              onClick={onNext}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 whitespace-nowrap shrink-0"
            >
              <span>Próximo Vídeo</span>
              <SkipForward className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 bg-[#0F1626] px-4 py-2 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPrev}
            disabled={!hasPrev}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-slate-300 hover:bg-slate-800 disabled:opacity-35 whitespace-nowrap"
          >
            <SkipBack className="h-3.5 w-3.5" />
            <span>Anterior</span>
          </button>
          {hasNext ? (
            <button
              type="button"
              onClick={onNext}
              title={nextTrackName ? `Ir para: ${nextTrackName}` : 'Ir para o próximo vídeo'}
              className="inline-flex max-w-[260px] items-center gap-1.5 rounded bg-sky-600/15 px-2.5 py-1 font-medium text-sky-300 hover:bg-sky-600/25 whitespace-nowrap"
            >
              <span className="truncate">
                Próximo Vídeo{nextTrackName ? `: ${nextTrackName}` : ''}
              </span>
              <SkipForward className="h-3.5 w-3.5 shrink-0" />
            </button>
          ) : (
            <span className="px-2 py-1 text-[11px] text-slate-500 whitespace-nowrap">
              Último item disponível
            </span>
          )}
          <button
            type="button"
            onClick={handleFullscreen}
            className="rounded px-2 py-1 text-slate-300 hover:bg-slate-800 whitespace-nowrap"
          >
            Tela cheia (F)
          </button>
        </div>

        <span className="font-mono text-[11px] tabular-nums">
          {formatTimeSeconds(currentTime)} / {formatTimeSeconds(duration)}
        </span>
      </div>

      {mediaError && (
        <div role="alert" className="border-t border-amber-900/50 bg-amber-950/40 px-4 py-2 text-xs text-amber-200">
          {mediaError}
        </div>
      )}
    </div>
  );
};
