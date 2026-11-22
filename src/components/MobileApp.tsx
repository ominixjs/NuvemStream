import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Captions,
  Check,
  ChevronLeft,
  ChevronRight,
  Film,
  Image as ImageIcon,
  LayoutGrid,
  Music,
  Pause,
  Play,
  RefreshCw,
  Search,
  Share2,
  SkipBack,
  SkipForward,
  Smartphone,
  Wifi,
  X,
} from 'lucide-react';
import { useLiveSync } from '../hooks/useLiveSync';
import type { TvCatalogItem, TvNetworkInfo } from '../types/media';
import { formatBytes, formatDate, formatTimeSeconds } from '../utils/media';

const AUDIO_COVER_ART = '/src/assets/images/audio_vinyl_artwork_1795357589564.jpg';
const MOBILE_BACKDROP_ART = '/src/assets/images/cinema_welcome_backdrop_1795357589226.jpg';

type MobileCategory = 'all' | 'video' | 'audio' | 'image';

export const MobileApp: React.FC = () => {
  const [items, setItems] = useState<TvCatalogItem[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [networkInfo, setNetworkInfo] = useState<TvNetworkInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catalogNotice, setCatalogNotice] = useState<string | null>(null);

  const [category, setCategory] = useState<MobileCategory>('all');
  const [selectedCollection, setSelectedCollection] = useState<string>('all');
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Individual mobile player state
  const [playingQueue, setPlayingQueue] = useState<TvCatalogItem[]>([]);
  const [playingIdx, setPlayingIdx] = useState(0);
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const initialPlayHandledRef = useRef(false);
  const prevCountRef = useRef<number>(0);

  const showNotice = useCallback((text: string) => {
    setCatalogNotice(text);
    window.setTimeout(() => {
      setCatalogNotice((prev) => (prev === text ? null : prev));
    }, 3500);
  }, []);

  const fetchCatalog = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const res = await fetch('/api/tv/catalog');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Não foi possível carregar os arquivos da rede local.');
      }
      const nextItems = (data.items || []) as TvCatalogItem[];
      prevCountRef.current = nextItems.length;
      setItems(nextItems);
      setCollections((data.collections || []) as string[]);
      setError(null);
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Erro de conexão na rede local.');
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  const { isConnected } = useLiveSync({
    role: 'mobile',
    label: 'Celular',
    onCatalogUpdate: (payload) => {
      const prev = prevCountRef.current;
      prevCountRef.current = payload.items.length;
      setItems(payload.items);
      setCollections(payload.collections);
      setIsLoading(false);
      setError(null);
      if (payload.items.length !== prev) {
        showNotice(`Atualizado pelo PC (${payload.items.length} mídias)`);
      }
    },
  });

  useEffect(() => {
    void fetchCatalog(false);
    void fetch('/api/tv/network')
      .then((r) => r.json())
      .then((data: TvNetworkInfo) => setNetworkInfo(data))
      .catch(() => undefined);

    const poll = window.setInterval(() => {
      void fetchCatalog(true);
    }, 20000);
    return () => window.clearInterval(poll);
  }, [fetchCatalog]);

  // Open single item if /mobile?play=<id> was requested
  useEffect(() => {
    if (initialPlayHandledRef.current || items.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const playId = params.get('play');
    if (!playId) {
      initialPlayHandledRef.current = true;
      return;
    }
    const target = items.find((i) => i.id === playId);
    if (target) {
      initialPlayHandledRef.current = true;
      const queue = items.filter((entry) =>
        target.kind === 'image' ? entry.kind === 'image' : entry.kind === 'video' || entry.kind === 'audio'
      );
      const idx = Math.max(
        0,
        queue.findIndex((q) => q.id === target.id)
      );
      setPlayingQueue(queue.length > 0 ? queue : [target]);
      setPlayingIdx(idx);
      setIsPlayerOpen(true);
    }
  }, [items]);

  useEffect(() => {
    if (selectedCollection !== 'all' && !collections.includes(selectedCollection)) {
      setSelectedCollection('all');
    }
  }, [collections, selectedCollection]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== 'all' && item.kind !== category) return false;
      if (selectedCollection !== 'all' && item.collection !== selectedCollection) return false;
      if (q && !item.name.toLowerCase().includes(q) && !item.collection.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [items, category, selectedCollection, searchQuery]);

  const activeItem = isPlayerOpen ? playingQueue[playingIdx] || null : null;
  const hasPrev = playingIdx > 0;
  const hasNext = playingIdx < playingQueue.length - 1;

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !vid.textTracks) return;
    for (let i = 0; i < vid.textTracks.length; i++) {
      vid.textTracks[i].mode = subtitlesEnabled ? 'showing' : 'hidden';
    }
  }, [subtitlesEnabled, activeItem?.id]);

  const openItemInPlayer = (item: TvCatalogItem) => {
    const queue = filteredItems.filter((entry) =>
      item.kind === 'image' ? entry.kind === 'image' : entry.kind === 'video' || entry.kind === 'audio'
    );
    const idx = Math.max(
      0,
      queue.findIndex((q) => q.id === item.id)
    );
    setPlayingQueue(queue.length > 0 ? queue : [item]);
    setPlayingIdx(idx);
    setCurrentTime(0);
    setDuration(0);
    setPlayerError(null);
    setIsPlayerOpen(true);
  };

  const closePlayer = () => {
    setIsPlayerOpen(false);
    setPlayingQueue([]);
    setIsPlaying(false);
    setPlayerError(null);
  };

  const handlePrev = () => {
    if (!hasPrev) return;
    setPlayingIdx((prev) => prev - 1);
    setCurrentTime(0);
    setDuration(0);
    setPlayerError(null);
  };

  const handleNext = () => {
    if (!hasNext) return;
    setPlayingIdx((prev) => prev + 1);
    setCurrentTime(0);
    setDuration(0);
    setPlayerError(null);
  };

  const togglePlayPause = () => {
    const el = activeItem?.kind === 'audio' ? audioRef.current : videoRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => undefined);
    } else {
      el.pause();
    }
  };

  const handleShareItem = async (item: TvCatalogItem) => {
    const base =
      networkInfo?.preferredBaseUrl && networkInfo.lanIps.length > 0
        ? networkInfo.preferredBaseUrl
        : window.location.origin;
    const shareUrl = `${base}/mobile?play=${encodeURIComponent(item.id)}`;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: item.name,
          text: `Assistir "${item.name}" no NuvemStream`,
          url: shareUrl,
        });
      } catch {
        // User cancelled share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  const tabs: { id: MobileCategory; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: 'Tudo', icon: <LayoutGrid className="h-5 w-5" /> },
    { id: 'video', label: 'Vídeos', icon: <Film className="h-5 w-5" /> },
    { id: 'audio', label: 'Músicas', icon: <Music className="h-5 w-5" /> },
    { id: 'image', label: 'Fotos', icon: <ImageIcon className="h-5 w-5" /> },
  ];

  // Fullscreen Mobile Player View
  if (isPlayerOpen && activeItem) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-[#0B1120] text-slate-100">
        {/* Top Mobile Player Bar */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-800/80 bg-[#0F1626] px-3">
          <button
            type="button"
            onClick={closePlayer}
            aria-label="Voltar à lista"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-200 hover:bg-slate-800"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1 text-center">
            <h2 className="truncate text-sm font-semibold text-slate-100">{activeItem.name}</h2>
            <p className="truncate text-[11px] text-slate-400">{activeItem.collection}</p>
          </div>

          <button
            type="button"
            onClick={() => void handleShareItem(activeItem)}
            aria-label="Compartilhar link"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-200 hover:bg-slate-800"
          >
            {copiedId === activeItem.id ? (
              <Check className="h-5 w-5 text-emerald-400" />
            ) : (
              <Share2 className="h-5 w-5 text-sky-400" />
            )}
          </button>
        </header>

        {/* Player Stage */}
        <div className="flex min-h-0 flex-1 flex-col justify-between overflow-y-auto">
          {activeItem.kind === 'image' ? (
            <div className="flex flex-1 flex-col items-center justify-center bg-black p-3">
              <img
                src={`/api/tv/media/${activeItem.id}`}
                alt={activeItem.name}
                referrerPolicy="no-referrer"
                className="max-h-[70vh] w-auto rounded-lg object-contain"
              />
            </div>
          ) : activeItem.kind === 'audio' ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-6">
              <audio
                ref={audioRef}
                src={`/api/tv/media/${activeItem.id}`}
                autoPlay
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                onEnded={() => {
                  if (hasNext) handleNext();
                }}
                onError={() => setPlayerError('Formato de áudio não suportado neste celular.')}
              />

              <div className="h-52 w-52 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl sm:h-64 sm:w-64">
                <img
                  src={AUDIO_COVER_ART}
                  alt={activeItem.name}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>

              <div className="w-full max-w-md space-y-2 text-center">
                <h3 className="truncate text-lg font-bold text-slate-100">{activeItem.name}</h3>
                <p className="text-xs text-slate-400">
                  {activeItem.extension.toUpperCase()} ·{' '}
                  <span className="font-mono tabular-nums">{formatBytes(activeItem.size)}</span>
                </p>

                <div className="pt-3 space-y-1.5">
                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    step={0.5}
                    value={Math.min(currentTime, duration || 100)}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      if (audioRef.current) audioRef.current.currentTime = next;
                      setCurrentTime(next);
                    }}
                    className="h-2 w-full cursor-pointer accent-sky-500"
                  />
                  <div className="flex justify-between font-mono text-xs text-slate-400 tabular-nums">
                    <span>{formatTimeSeconds(currentTime)}</span>
                    <span>{formatTimeSeconds(duration)}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col bg-black">
              <div className="flex flex-1 items-center justify-center">
                <video
                  ref={videoRef}
                  src={`/api/tv/media/${activeItem.id}`}
                  controls
                  autoPlay
                  playsInline
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                  onEnded={() => {
                    if (hasNext) handleNext();
                  }}
                  onError={() =>
                    setPlayerError('Formato de vídeo não suportado diretamente pelo navegador do celular.')
                  }
                  className="max-h-[68vh] w-full bg-black object-contain"
                >
                  {activeItem.subtitleId && (
                    <track
                      kind="subtitles"
                      label={activeItem.subtitleName || 'Legenda'}
                      src={`/api/tv/subtitle/${activeItem.subtitleId}`}
                      default
                    />
                  )}
                </video>
              </div>
            </div>
          )}

          {playerError && (
            <div className="mx-4 my-2 rounded-xl border border-amber-800 bg-amber-950/60 px-4 py-2.5 text-xs text-amber-200">
              {playerError}
            </div>
          )}

          {/* Thumb-Zone Bottom Controls */}
          <div className="shrink-0 border-t border-slate-800 bg-[#0F1626] px-4 py-3">
            <div className="mx-auto flex max-w-lg items-center justify-between gap-2">
              <button
                type="button"
                onClick={handlePrev}
                disabled={!hasPrev}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-35"
              >
                {activeItem.kind === 'image' ? (
                  <ChevronLeft className="h-5 w-5" />
                ) : (
                  <SkipBack className="h-5 w-5" />
                )}
                <span>Anterior</span>
              </button>

              {activeItem.kind !== 'image' && (
                <button
                  type="button"
                  onClick={togglePlayPause}
                  aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
                  className="flex min-h-[48px] min-w-[64px] items-center justify-center rounded-xl bg-sky-600 px-5 text-white hover:bg-sky-500"
                >
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-0.5" />}
                </button>
              )}

              <button
                type="button"
                onClick={handleNext}
                disabled={!hasNext}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-35"
              >
                <span>Próximo</span>
                {activeItem.kind === 'image' ? (
                  <ChevronRight className="h-5 w-5" />
                ) : (
                  <SkipForward className="h-5 w-5" />
                )}
              </button>

              {activeItem.subtitleId && (
                <button
                  type="button"
                  onClick={() => setSubtitlesEnabled((prev) => !prev)}
                  aria-label="Alternar legenda"
                  className={`flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border px-3 text-xs font-medium ${
                    subtitlesEnabled
                      ? 'border-sky-500 bg-sky-500/20 text-sky-300'
                      : 'border-slate-800 bg-slate-900 text-slate-400'
                  }`}
                >
                  <Captions className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Main Touch-First Read-Only Mobile View
  return (
    <div className="flex min-h-screen w-full flex-col bg-[#0B1120] text-slate-100 pb-20">
      {/* Compact Sticky Top App Bar (56px height) */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-slate-800/80 bg-[#0F1626]/95 px-4 backdrop-blur-md">
        <div className="flex items-center gap-2 min-w-0">
          <Smartphone className="h-5 w-5 shrink-0 text-sky-400" />
          <span className="truncate text-base font-bold tracking-tight text-slate-100 whitespace-nowrap">
            NuvemStream
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setShowSearch((prev) => !prev)}
            aria-label="Pesquisar mídias"
            className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl transition-colors ${
              showSearch ? 'bg-sky-500/15 text-sky-300' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {showSearch ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={() => void fetchCatalog(false)}
            aria-label="Atualizar biblioteca"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-300 hover:bg-slate-800"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin text-sky-400' : ''}`} />
          </button>
        </div>
      </header>

      {/* Scrollable Middle Feed (Expands cleanly across mobile & wider viewports) */}
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-4 px-4 py-4">
        {showSearch && (
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar vídeo, música ou pasta..."
              autoFocus
              className="h-11 w-full rounded-xl border border-slate-800 bg-[#111827] pr-4 pl-10 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>
        )}

        {catalogNotice && (
          <div className="rounded-xl border border-sky-800/70 bg-sky-950/40 px-4 py-2.5 text-xs font-medium text-sky-200">
            {catalogNotice}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-xs text-red-200"
          >
            {error}
          </div>
        )}

        {/* Horizontal Collection Filter Strip */}
        {collections.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {['all', ...collections].map((col) => {
              const active = selectedCollection === col;
              return (
                <button
                  key={col}
                  type="button"
                  onClick={() => setSelectedCollection(col)}
                  className={`min-h-[40px] rounded-xl border px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                      : 'border-slate-800 bg-[#111827] text-slate-300'
                  }`}
                >
                  {col === 'all' ? 'Todas as Pastas' : col}
                </button>
              );
            })}
          </div>
        )}

        {isLoading && items.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-20 rounded-2xl border border-slate-800 bg-[#111827]"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#111827]">
            <img
              src={MOBILE_BACKDROP_ART}
              alt="Aguardando biblioteca configurada no PC"
              referrerPolicy="no-referrer"
              className="h-44 w-full object-cover opacity-45"
            />
            <div className="space-y-2 p-5">
              <h1 className="text-lg font-bold text-slate-100">
                Nenhuma mídia carregada ainda
              </h1>
              <p className="text-xs leading-relaxed text-slate-400">
                Este leitor é individual e somente leitura. Adicione uma nuvem ou pasta no computador que o catálogo aparece aqui automaticamente.
              </p>
              <p className="flex items-center gap-1.5 pt-1 text-[11px] text-slate-400">
                <Wifi className="h-3.5 w-3.5 text-sky-400" />
                <span>{isConnected ? 'Sincronizado na rede local' : 'Conectando ao PC...'}</span>
              </p>
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-[#111827] px-6 py-12 text-center">
            <p className="text-sm font-medium text-slate-200">Nenhum arquivo encontrado</p>
            <p className="mt-1 text-xs text-slate-400">
              Altere a categoria abaixo ou limpe a pesquisa.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openItemInPlayer(item)}
                className="flex min-h-[76px] w-full items-center gap-3.5 rounded-2xl border border-slate-800/90 bg-[#111827] p-2.5 text-left transition-transform active:scale-[0.99] hover:border-slate-700"
              >
                <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-950">
                  {item.kind === 'image' ? (
                    <img
                      src={`/api/tv/media/${item.id}`}
                      alt={item.name}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : item.kind === 'audio' ? (
                    <img
                      src={AUDIO_COVER_ART}
                      alt={item.name}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover opacity-85"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-slate-900">
                      <Film className="h-6 w-6 text-sky-400" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-slate-100">{item.name}</h3>
                  <p className="mt-0.5 truncate text-xs text-slate-400">
                    <span>{item.collection}</span>
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    <span>{item.extension.toUpperCase()}</span>
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500 tabular-nums">
                    {formatBytes(item.size)} · {formatDate(item.addedAt)}
                  </p>
                </div>

                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sky-400">
                  <Play className="h-4 w-4" />
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      {/* Fixed Bottom Thumb Tab Bar (60px height, stays within 15% sticky budget) */}
      <nav
        aria-label="Categorias no celular"
        className="fixed right-0 bottom-0 left-0 z-40 grid h-[60px] grid-cols-4 items-center border-t border-slate-800/90 bg-[#0F1626]/95 backdrop-blur-md"
      >
        {tabs.map((tab) => {
          const active = category === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setCategory(tab.id)}
              className={`flex min-h-[48px] flex-col items-center justify-center gap-0.5 transition-colors ${
                active ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.icon}
              <span className="text-[11px] font-medium tracking-tight whitespace-nowrap">
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
