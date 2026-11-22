import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Captions,
  ChevronLeft,
  ChevronRight,
  Check,
  Film,
  Image as ImageIcon,
  Monitor,
  Music,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Share2,
  SkipBack,
  SkipForward,
  Tv,
  Wifi,
  X,
} from 'lucide-react';
import { Radio } from 'lucide-react';
import { useLiveSync } from '../hooks/useLiveSync';
import type {
  AppPreferences,
  LivePlaybackState,
  TvCatalogItem,
  TvNetworkInfo,
} from '../types/media';
import { formatBytes, formatDate, formatTimeSeconds } from '../utils/media';

const AUDIO_COVER_ART = '/src/assets/images/audio_vinyl_artwork_1795357589564.jpg';
const TV_BACKDROP_ART = '/src/assets/images/cinema_welcome_backdrop_1795357589226.jpg';

type TvCategory = 'all' | 'video' | 'audio' | 'image';
type FocusZone = 'tabs' | 'collections' | 'grid';

interface TvAppProps {
  onSwitchToPc: () => void;
}

export const TvApp: React.FC<TvAppProps> = ({ onSwitchToPc }) => {
  const [items, setItems] = useState<TvCatalogItem[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [activeCloudSyncs, setActiveCloudSyncs] = useState(0);
  const [networkInfo, setNetworkInfo] = useState<TvNetworkInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoSyncPlayback, setAutoSyncPlayback] = useState(true);
  const [remoteNotice, setRemoteNotice] = useState<string | null>(null);

  const [category, setCategory] = useState<TvCategory>('all');
  const [selectedCollection, setSelectedCollection] = useState<string>('all');
  const [clockText, setClockText] = useState('');

  // Spatial D-Pad focus state
  const [focusZone, setFocusZone] = useState<FocusZone>('grid');
  const [tabFocusIdx, setTabFocusIdx] = useState(0);
  const [collectionFocusIdx, setCollectionFocusIdx] = useState(0);
  const [gridFocusIdx, setGridFocusIdx] = useState(0);

  // Fullscreen TV Player state
  const [playingQueue, setPlayingQueue] = useState<TvCatalogItem[]>([]);
  const [playingIdx, setPlayingIdx] = useState(0);
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [hudVisible, setHudVisible] = useState(true);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [copiedShareId, setCopiedShareId] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hudTimerRef = useRef<number | null>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const initialPlayHandledRef = useRef(false);
  const suppressSyncEmitUntilRef = useRef<number>(0);
  const itemsRef = useRef<TvCatalogItem[]>([]);
  const playingQueueRef = useRef<TvCatalogItem[]>([]);
  const playingIdxRef = useRef(0);
  const isPlayerOpenRef = useRef(false);
  const autoSyncRef = useRef(true);

  itemsRef.current = items;
  playingQueueRef.current = playingQueue;
  playingIdxRef.current = playingIdx;
  isPlayerOpenRef.current = isPlayerOpen;
  autoSyncRef.current = autoSyncPlayback;

  const categories: { id: TvCategory; label: string }[] = [
    { id: 'all', label: 'Tudo' },
    { id: 'video', label: 'Vídeos' },
    { id: 'audio', label: 'Músicas' },
    { id: 'image', label: 'Fotos' },
  ];

  const fetchCatalog = useCallback(async (silent = false): Promise<TvCatalogItem[]> => {
    if (!silent) setIsLoading(true);
    try {
      const res = await fetch('/api/tv/catalog');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Não foi possível ler o catálogo local.');
      }
      const nextItems = (data.items || []) as TvCatalogItem[];
      setItems(nextItems);
      setCollections((data.collections || []) as string[]);
      setActiveCloudSyncs(Array.isArray(data.activeCloudSyncs) ? data.activeCloudSyncs.length : 0);
      setError(null);
      return nextItems;
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Erro de conexão com a rede local.');
      }
      return itemsRef.current;
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  const showRemoteNotice = useCallback((text: string) => {
    setRemoteNotice(text);
    window.setTimeout(() => {
      setRemoteNotice((prev) => (prev === text ? null : prev));
    }, 4500);
  }, []);

  const handleRemotePlayback = useCallback(
    async (playback: LivePlaybackState) => {
      if (!autoSyncRef.current) return;
      if (playback.senderRole !== 'pc') return;

      if (playback.action === 'close') {
        return;
      }

      const currentActive = isPlayerOpenRef.current
        ? playingQueueRef.current[playingIdxRef.current] || null
        : null;

      // Control command on the already-open item
      if (
        currentActive &&
        currentActive.id === playback.itemId &&
        playback.action !== 'load'
      ) {
        suppressSyncEmitUntilRef.current = Date.now() + 900;
        const el = currentActive.kind === 'video' ? videoRef.current : audioRef.current;
        if (el) {
          if (Math.abs((el.currentTime || 0) - playback.currentTime) > 1.5) {
            try {
              el.currentTime = playback.currentTime;
              setCurrentTime(playback.currentTime);
            } catch {
              // Ignore seek before metadata ready
            }
          }
          if (playback.action === 'pause') el.pause();
          else if (playback.action === 'play') void el.play().catch(() => undefined);
        }
        return;
      }

      let pool = itemsRef.current;
      let target = pool.find((i) => i.id === playback.itemId);
      if (!target) {
        pool = await fetchCatalog(true);
        target = pool.find((i) => i.id === playback.itemId);
      }
      if (!target) return;

      suppressSyncEmitUntilRef.current = Date.now() + 1200;
      const queue = pool.filter((entry) =>
        target!.kind === 'image' ? entry.kind === 'image' : entry.kind === 'video' || entry.kind === 'audio'
      );
      const idx = Math.max(
        0,
        queue.findIndex((q) => q.id === target!.id)
      );
      setPlayingQueue(queue.length > 0 ? queue : [target]);
      setPlayingIdx(idx);
      setCurrentTime(playback.currentTime || 0);
      setDuration(0);
      setPlayerError(null);
      setIsPlayerOpen(true);
      showRemoteNotice(`Recebido automaticamente do PC: ${target.name}`);

      if (playback.currentTime > 1) {
        window.setTimeout(() => {
          const el = target!.kind === 'video' ? videoRef.current : audioRef.current;
          if (el) {
            try {
              el.currentTime = playback.currentTime;
            } catch {
              // Ignore if metadata still loading
            }
          }
        }, 450);
      }
    },
    [fetchCatalog, showRemoteNotice]
  );

  const { isConnected: isSyncConnected, presence, emitPlaybackSync } = useLiveSync({
    role: 'tv',
    label: 'Smart TV',
    onCatalogUpdate: (payload) => {
      setItems(payload.items);
      setCollections(payload.collections);
      setActiveCloudSyncs(payload.activeCloudSyncsCount);
      setIsLoading(false);
    },
    onPreferencesUpdate: (prefs: AppPreferences) => {
      setAutoSyncPlayback(prefs.autoSyncPlayback);
    },
    onRemotePlayback: (playback) => {
      void handleRemotePlayback(playback);
    },
  });

  const handleToggleAutoSync = async (next: boolean) => {
    setAutoSyncPlayback(next);
    try {
      await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSyncPlayback: next }),
      });
    } catch {
      // Ignore network failure
    }
  };

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

  // Auto-open shared item if /tv?play=<id> was requested on startup
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

  // Live TV clock
  useEffect(() => {
    const updateClock = () => {
      setClockText(
        new Intl.DateTimeFormat('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date())
      );
    };
    updateClock();
    const id = window.setInterval(updateClock, 15000);
    return () => window.clearInterval(id);
  }, []);

  const collectionTabs = useMemo(() => ['all', ...collections], [collections]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (category !== 'all' && item.kind !== category) return false;
      if (selectedCollection !== 'all' && item.collection !== selectedCollection) return false;
      return true;
    });
  }, [items, category, selectedCollection]);

  useEffect(() => {
    setGridFocusIdx((prev) => Math.min(prev, Math.max(0, filteredItems.length - 1)));
  }, [filteredItems.length]);

  useEffect(() => {
    if (focusZone === 'grid' && cardRefs.current[gridFocusIdx]) {
      cardRefs.current[gridFocusIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusZone, gridFocusIdx]);

  const activeItem = isPlayerOpen ? playingQueue[playingIdx] || null : null;

  const pokeHud = useCallback(() => {
    setHudVisible(true);
    if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
    hudTimerRef.current = window.setTimeout(() => {
      setHudVisible(false);
    }, 3500);
  }, []);

  useEffect(() => {
    if (isPlayerOpen) {
      pokeHud();
    }
    return () => {
      if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
    };
  }, [isPlayerOpen, pokeHud]);

  const openItemInPlayer = useCallback(
    (item: TvCatalogItem) => {
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

      if (autoSyncRef.current && Date.now() > suppressSyncEmitUntilRef.current) {
        void emitPlaybackSync({
          itemId: item.id,
          action: 'load',
          currentTime: 0,
          isPlaying: true,
        });
      }
    },
    [filteredItems, emitPlaybackSync]
  );

  const closePlayer = useCallback(() => {
    setIsPlayerOpen(false);
    setPlayingQueue([]);
    setIsPlaying(false);
    setPlayerError(null);
  }, []);

  const hasPrevInQueue = playingIdx > 0;
  const hasNextInQueue = playingIdx < playingQueue.length - 1;
  const nextQueueItem = hasNextInQueue ? playingQueue[playingIdx + 1] : null;

  const handlePlayerNext = useCallback(() => {
    if (playingIdx >= playingQueue.length - 1) return;
    const nextIdx = playingIdx + 1;
    const nextItem = playingQueue[nextIdx];
    setPlayingIdx(nextIdx);
    setCurrentTime(0);
    setDuration(0);
    setPlayerError(null);
    pokeHud();

    if (nextItem && autoSyncRef.current && Date.now() > suppressSyncEmitUntilRef.current) {
      void emitPlaybackSync({
        itemId: nextItem.id,
        action: 'load',
        currentTime: 0,
        isPlaying: true,
      });
    }
  }, [playingIdx, playingQueue, pokeHud, emitPlaybackSync]);

  const handlePlayerPrev = useCallback(() => {
    if (playingIdx <= 0) return;
    const prevIdx = playingIdx - 1;
    const prevItem = playingQueue[prevIdx];
    setPlayingIdx(prevIdx);
    setCurrentTime(0);
    setDuration(0);
    setPlayerError(null);
    pokeHud();

    if (prevItem && autoSyncRef.current && Date.now() > suppressSyncEmitUntilRef.current) {
      void emitPlaybackSync({
        itemId: prevItem.id,
        action: 'load',
        currentTime: 0,
        isPlaying: true,
      });
    }
  }, [playingIdx, playingQueue, pokeHud, emitPlaybackSync]);

  const handleShareTvItem = useCallback(
    async (item: TvCatalogItem) => {
      const base =
        networkInfo?.preferredBaseUrl && networkInfo.lanIps.length > 0
          ? networkInfo.preferredBaseUrl
          : window.location.origin;
      const shareUrl = `${base}/tv?play=${encodeURIComponent(item.id)}`;
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          await navigator.share({
            title: item.name,
            text: `Assistir "${item.name}" na TV`,
            url: shareUrl,
          });
        } catch {
          // Ignore share sheet cancel
        }
      }
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopiedShareId(item.id);
        window.setTimeout(() => setCopiedShareId(null), 2500);
      } catch {
        // Ignore clipboard failure
      }
    },
    [networkInfo]
  );

  const togglePlayPause = useCallback(() => {
    const el = activeItem?.kind === 'video' ? videoRef.current : audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => undefined);
    } else {
      el.pause();
    }
    pokeHud();
  }, [activeItem?.kind, pokeHud]);

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const el = activeItem?.kind === 'video' ? videoRef.current : audioRef.current;
      if (!el) return;
      el.currentTime = Math.max(0, Math.min(el.duration || el.currentTime + deltaSeconds, el.currentTime + deltaSeconds));
      pokeHud();
    },
    [activeItem?.kind, pokeHud]
  );

  // Subtitle track visibility sync
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !vid.textTracks) return;
    for (let i = 0; i < vid.textTracks.length; i++) {
      vid.textTracks[i].mode = subtitlesEnabled ? 'showing' : 'hidden';
    }
  }, [subtitlesEnabled, activeItem?.id]);

  // Remote Control / D-Pad Keyboard Handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isPlayerOpen && activeItem) {
        pokeHud();
        if (e.key === 'Escape' || e.key === 'Backspace') {
          e.preventDefault();
          closePlayer();
          return;
        }
        if (activeItem.kind === 'image') {
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            handlePlayerNext();
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            handlePlayerPrev();
          }
          return;
        }
        if (e.code === 'Space' || e.key === 'Enter') {
          const target = e.target as HTMLElement | null;
          if (target?.tagName === 'BUTTON' && e.key === 'Enter') return;
          e.preventDefault();
          togglePlayPause();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          seekBy(10);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          seekBy(-10);
        }
        return;
      }

      // Grid / Menu D-Pad Navigation
      const cols = window.innerWidth >= 1280 ? 4 : window.innerWidth >= 768 ? 3 : 2;

      if (focusZone === 'tabs') {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setTabFocusIdx((prev) => (prev + 1) % categories.length);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setTabFocusIdx((prev) => (prev - 1 + categories.length) % categories.length);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (collections.length > 1) setFocusZone('collections');
          else if (filteredItems.length > 0) setFocusZone('grid');
        } else if (e.key === 'Enter') {
          e.preventDefault();
          setCategory(categories[tabFocusIdx].id);
        }
        return;
      }

      if (focusZone === 'collections') {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setCollectionFocusIdx((prev) => (prev + 1) % collectionTabs.length);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setCollectionFocusIdx((prev) => (prev - 1 + collectionTabs.length) % collectionTabs.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setFocusZone('tabs');
        } else if (e.key === 'ArrowDown' && filteredItems.length > 0) {
          e.preventDefault();
          setFocusZone('grid');
        } else if (e.key === 'Enter') {
          e.preventDefault();
          setSelectedCollection(collectionTabs[collectionFocusIdx]);
        }
        return;
      }

      if (focusZone === 'grid') {
        if (filteredItems.length === 0) {
          if (e.key === 'ArrowUp') setFocusZone('tabs');
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setGridFocusIdx((prev) => Math.min(filteredItems.length - 1, prev + 1));
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setGridFocusIdx((prev) => Math.max(0, prev - 1));
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setGridFocusIdx((prev) => Math.min(filteredItems.length - 1, prev + cols));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (gridFocusIdx - cols < 0) {
            if (collections.length > 1) setFocusZone('collections');
            else setFocusZone('tabs');
          } else {
            setGridFocusIdx((prev) => Math.max(0, prev - cols));
          }
        } else if (e.key === 'Enter') {
          const target = e.target as HTMLElement | null;
          if (target?.tagName === 'BUTTON') return;
          e.preventDefault();
          const chosen = filteredItems[gridFocusIdx];
          if (chosen) openItemInPlayer(chosen);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isPlayerOpen,
    activeItem,
    focusZone,
    tabFocusIdx,
    collectionFocusIdx,
    gridFocusIdx,
    categories,
    collections.length,
    collectionTabs,
    filteredItems,
    pokeHud,
    closePlayer,
    handlePlayerNext,
    handlePlayerPrev,
    togglePlayPause,
    seekBy,
    openItemInPlayer,
  ]);

  const focusedItem = filteredItems[gridFocusIdx] || filteredItems[0] || null;
  const primaryLanDisplay = networkInfo?.lanIps?.[0]
    ? `${networkInfo.lanIps[0]}:${networkInfo.port}`
    : 'Rede Local';

  // Fullscreen 10-Foot TV Player
  if (isPlayerOpen && activeItem) {
    return (
      <div
        onMouseMove={pokeHud}
        className="fixed inset-0 z-50 flex flex-col bg-black text-slate-100 select-none"
      >
        {activeItem.kind === 'image' ? (
          <div className="relative flex h-full w-full items-center justify-center bg-black p-8">
            <img
              src={`/api/tv/media/${activeItem.id}`}
              alt={activeItem.name}
              referrerPolicy="no-referrer"
              className="max-h-full max-w-full object-contain"
            />
            <div
              className={`absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/85 to-transparent px-10 py-6 transition-opacity duration-200 ${
                hudVisible ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <div>
                <h2 className="text-2xl font-bold text-white">{activeItem.name}</h2>
                <p className="mt-1 text-sm text-slate-300">
                  {activeItem.collection}
                  <span className="mx-2" aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {playingIdx + 1} / {playingQueue.length}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-3">
                {playingQueue.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={handlePlayerPrev}
                      className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/90 text-white hover:bg-slate-800"
                    >
                      <ChevronLeft className="h-6 w-6" />
                    </button>
                    <button
                      type="button"
                      onClick={handlePlayerNext}
                      className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/90 text-white hover:bg-slate-800"
                    >
                      <ChevronRight className="h-6 w-6" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={closePlayer}
                  className="inline-flex h-12 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/90 px-5 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  <ArrowLeft className="h-5 w-5" />
                  <span>Voltar</span>
                </button>
              </div>
            </div>
          </div>
        ) : activeItem.kind === 'audio' ? (
          <div className="relative flex h-full w-full flex-col items-center justify-center bg-[#0B1120] px-10">
            <audio
              ref={audioRef}
              src={`/api/tv/media/${activeItem.id}`}
              autoPlay
              onPlay={(e) => {
                setIsPlaying(true);
                if (autoSyncRef.current && Date.now() > suppressSyncEmitUntilRef.current) {
                  void emitPlaybackSync({
                    itemId: activeItem.id,
                    action: 'play',
                    currentTime: e.currentTarget.currentTime,
                    isPlaying: true,
                  });
                }
              }}
              onPause={(e) => {
                setIsPlaying(false);
                if (autoSyncRef.current && Date.now() > suppressSyncEmitUntilRef.current) {
                  void emitPlaybackSync({
                    itemId: activeItem.id,
                    action: 'pause',
                    currentTime: e.currentTarget.currentTime,
                    isPlaying: false,
                  });
                }
              }}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              onEnded={() => {
                if (playingIdx < playingQueue.length - 1) handlePlayerNext();
              }}
              onError={() => setPlayerError('Formato de áudio incompatível com o navegador desta TV.')}
            />

            <button
              type="button"
              onClick={closePlayer}
              className="absolute top-8 left-10 inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-5 py-3 text-base font-medium text-slate-200 hover:bg-slate-800"
            >
              <ArrowLeft className="h-5 w-5" />
              <span>Voltar à Biblioteca</span>
            </button>

            <div className="flex w-full max-w-4xl flex-col items-center gap-8 md:flex-row">
              <div className="h-64 w-64 shrink-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
                <img
                  src={AUDIO_COVER_ART}
                  alt={activeItem.name}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>

              <div className="min-w-0 flex-1 space-y-5 text-center md:text-left">
                <div>
                  <p className="text-sm font-medium text-sky-400">{activeItem.collection}</p>
                  <h2 className="mt-1 truncate text-3xl font-bold text-slate-100">{activeItem.name}</h2>
                  <p className="mt-2 text-sm text-slate-400">
                    <span>{activeItem.extension.toUpperCase()}</span>
                    <span className="mx-2" aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{formatBytes(activeItem.size)}</span>
                    <span className="mx-2" aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      Faixa {playingIdx + 1} de {playingQueue.length}
                    </span>
                  </p>
                </div>

                <div className="space-y-2">
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
                      if (autoSyncRef.current && Date.now() > suppressSyncEmitUntilRef.current) {
                        void emitPlaybackSync({
                          itemId: activeItem.id,
                          action: 'seek',
                          currentTime: next,
                          isPlaying,
                        });
                      }
                    }}
                    className="h-2 w-full cursor-pointer accent-sky-500"
                  />
                  <div className="flex justify-between font-mono text-sm text-slate-400 tabular-nums">
                    <span>{formatTimeSeconds(currentTime)}</span>
                    <span>{formatTimeSeconds(duration)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-center gap-4 md:justify-start">
                  <button
                    type="button"
                    onClick={handlePlayerPrev}
                    disabled={!hasPrevInQueue}
                    className="flex h-14 w-14 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-200 hover:bg-slate-800 disabled:opacity-35"
                  >
                    <SkipBack className="h-6 w-6" />
                  </button>
                  <button
                    type="button"
                    onClick={togglePlayPause}
                    className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-600 text-white hover:bg-sky-500"
                  >
                    {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7 translate-x-0.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={handlePlayerNext}
                    disabled={!hasNextInQueue}
                    className="flex h-14 w-14 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-200 hover:bg-slate-800 disabled:opacity-35"
                  >
                    <SkipForward className="h-6 w-6" />
                  </button>
                </div>

                {playerError && <p className="text-sm text-amber-300">{playerError}</p>}
              </div>
            </div>
          </div>
        ) : (
          <div className="relative flex h-full w-full items-center justify-center bg-black">
            <video
              ref={videoRef}
              src={`/api/tv/media/${activeItem.id}`}
              autoPlay
              playsInline
              onClick={togglePlayPause}
              onPlay={(e) => {
                setIsPlaying(true);
                if (autoSyncRef.current && Date.now() > suppressSyncEmitUntilRef.current) {
                  void emitPlaybackSync({
                    itemId: activeItem.id,
                    action: 'play',
                    currentTime: e.currentTarget.currentTime,
                    isPlaying: true,
                  });
                }
              }}
              onPause={(e) => {
                setIsPlaying(false);
                if (autoSyncRef.current && Date.now() > suppressSyncEmitUntilRef.current) {
                  void emitPlaybackSync({
                    itemId: activeItem.id,
                    action: 'pause',
                    currentTime: e.currentTarget.currentTime,
                    isPlaying: false,
                  });
                }
              }}
              onSeeked={(e) => {
                if (autoSyncRef.current && Date.now() > suppressSyncEmitUntilRef.current) {
                  void emitPlaybackSync({
                    itemId: activeItem.id,
                    action: 'seek',
                    currentTime: e.currentTarget.currentTime,
                    isPlaying: !e.currentTarget.paused,
                  });
                }
              }}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              onEnded={() => {
                if (playingIdx < playingQueue.length - 1) handlePlayerNext();
              }}
              onError={() =>
                setPlayerError('Formato de vídeo não suportado diretamente pelo navegador desta TV.')
              }
              className="h-full w-full object-contain"
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

            {remoteNotice && (
              <div className="absolute top-20 left-10 z-20 rounded-xl border border-sky-500/60 bg-[#0F1626]/95 px-4 py-2.5 text-sm font-medium text-sky-200 shadow-2xl">
                {remoteNotice}
              </div>
            )}

            {/* Top OSD Bar */}
            <div
              className={`absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/90 via-black/50 to-transparent px-10 py-6 transition-opacity duration-200 ${
                hudVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-sky-400">{activeItem.collection}</p>
                <h2 className="truncate text-2xl font-bold text-white">{activeItem.name}</h2>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleShareTvItem(activeItem)}
                  className="inline-flex h-12 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/90 px-4 text-sm font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
                >
                  {copiedShareId === activeItem.id ? (
                    <>
                      <Check className="h-4 w-4 text-emerald-400" />
                      <span>Link Copiado</span>
                    </>
                  ) : (
                    <>
                      <Share2 className="h-4 w-4 text-sky-400" />
                      <span>Compartilhar</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={closePlayer}
                  className="inline-flex h-12 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/90 px-5 text-sm font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <X className="h-5 w-5" />
                  <span>Fechar (Esc)</span>
                </button>
              </div>
            </div>

            {/* Bottom 10-Foot TV Controls OSD */}
            <div
              className={`absolute inset-x-0 bottom-0 space-y-4 bg-gradient-to-t from-black/95 via-black/75 to-transparent px-10 pt-12 pb-8 transition-opacity duration-200 ${
                hudVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
            >
              {playerError && (
                <div className="rounded-lg border border-amber-800 bg-amber-950/80 px-4 py-2 text-sm text-amber-200">
                  {playerError}
                </div>
              )}

              <div className="flex items-center gap-4">
                <span className="w-16 font-mono text-sm text-slate-200 tabular-nums">
                  {formatTimeSeconds(currentTime)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  step={0.5}
                  value={Math.min(currentTime, duration || 100)}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (videoRef.current) videoRef.current.currentTime = next;
                    setCurrentTime(next);
                    pokeHud();
                  }}
                  aria-label="Progresso do vídeo"
                  className="h-2 flex-1 cursor-pointer accent-sky-500"
                />
                <span className="w-16 text-right font-mono text-sm text-slate-300 tabular-nums">
                  {formatTimeSeconds(duration)}
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={togglePlayPause}
                    className="inline-flex h-12 items-center gap-2 rounded-xl bg-sky-600 px-6 text-sm font-semibold text-white hover:bg-sky-500 whitespace-nowrap"
                  >
                    {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                    <span>{isPlaying ? 'Pausar' : 'Reproduzir'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => seekBy(-10)}
                    className="inline-flex h-12 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/90 px-4 text-sm font-medium text-slate-100 hover:bg-slate-800 whitespace-nowrap"
                  >
                    <RotateCcw className="h-4 w-4" />
                    <span>-10s</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => seekBy(10)}
                    className="inline-flex h-12 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/90 px-4 text-sm font-medium text-slate-100 hover:bg-slate-800 whitespace-nowrap"
                  >
                    <RotateCw className="h-4 w-4" />
                    <span>+10s</span>
                  </button>

                  <button
                    type="button"
                    onClick={handlePlayerPrev}
                    disabled={!hasPrevInQueue}
                    className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/90 text-slate-100 hover:bg-slate-800 disabled:opacity-35"
                    aria-label="Vídeo anterior"
                  >
                    <SkipBack className="h-5 w-5" />
                  </button>

                  {nextQueueItem && (
                    <button
                      type="button"
                      onClick={handlePlayerNext}
                      className="inline-flex h-12 max-w-[300px] items-center gap-2 rounded-xl border border-sky-500/60 bg-sky-500/20 px-4 text-sm font-semibold text-sky-200 hover:bg-sky-500/30 whitespace-nowrap"
                    >
                      <span className="truncate">Próximo: {nextQueueItem.name}</span>
                      <SkipForward className="h-4 w-4 shrink-0" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {activeItem.subtitleId && (
                    <button
                      type="button"
                      onClick={() => {
                        setSubtitlesEnabled((prev) => !prev);
                        pokeHud();
                      }}
                      className={`inline-flex h-12 items-center gap-2 rounded-xl border px-4 text-sm font-medium whitespace-nowrap ${
                        subtitlesEnabled
                          ? 'border-sky-500 bg-sky-500/20 text-sky-300'
                          : 'border-slate-700 bg-slate-900/90 text-slate-300'
                      }`}
                    >
                      <Captions className="h-4 w-4" />
                      <span>Legenda {subtitlesEnabled ? 'Ativa' : 'Oculta'}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Main 10-Foot TV Interface (Strictly Read-Only)
  return (
    <div className="flex min-h-screen w-full flex-col bg-[#0B1120] text-slate-100">
      {/* TV Top Bar (3-zone contract) */}
      <header className="flex items-center justify-between gap-8 border-b border-slate-800/80 bg-[#0F1626] px-6 py-5 sm:px-12">
        <div className="flex items-center gap-3 shrink-0">
          <Tv className="h-6 w-6 text-sky-400" />
          <span className="text-xl font-bold tracking-tight text-slate-100 whitespace-nowrap">
            NuvemStream TV
          </span>
        </div>

        <nav className="flex items-center gap-2 overflow-x-auto" aria-label="Categorias da TV">
          {categories.map((cat, idx) => {
            const active = category === cat.id;
            const focused = focusZone === 'tabs' && tabFocusIdx === idx;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setCategory(cat.id);
                  setTabFocusIdx(idx);
                  setFocusZone('tabs');
                }}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                } ${focused ? 'ring-2 ring-sky-400 ring-offset-2 ring-offset-[#0F1626]' : ''}`}
              >
                {cat.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => void handleToggleAutoSync(!autoSyncPlayback)}
            title="Receber vídeos e controles automaticamente do PC"
            className={`hidden items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors md:inline-flex whitespace-nowrap ${
              autoSyncPlayback
                ? 'border-sky-500/60 bg-sky-500/15 text-sky-300'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="h-3.5 w-3.5" />
            <span>
              {autoSyncPlayback
                ? `Receber Auto (${isSyncConnected ? `${presence.pcCount} PC` : 'Conectando'})`
                : 'Receber Auto Pausado'}
            </span>
          </button>

          <span className="hidden items-center gap-2 text-xs text-slate-400 lg:inline-flex whitespace-nowrap">
            <Wifi className="h-4 w-4 text-sky-400" />
            <span className="font-mono tabular-nums">{primaryLanDisplay}</span>
          </span>

          {clockText && (
            <span className="hidden font-mono text-base font-semibold text-slate-200 tabular-nums sm:inline">
              {clockText}
            </span>
          )}

          <button
            type="button"
            onClick={() => void fetchCatalog(false)}
            title="Atualizar catálogo da TV"
            aria-label="Atualizar catálogo da TV"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin text-sky-400' : ''}`} />
          </button>

          <button
            type="button"
            onClick={onSwitchToPc}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Monitor className="h-4 w-4 text-slate-400" />
            <span>Modo PC</span>
          </button>
        </div>
      </header>

      {/* Main TV Viewport */}
      <main className="flex-1 px-6 py-8 sm:px-12">
        <div className="mx-auto max-w-[1440px] space-y-8">
          {remoteNotice && (
            <div className="rounded-xl border border-sky-800/70 bg-sky-950/40 px-5 py-3 text-sm font-medium text-sky-200">
              {remoteNotice}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-900/60 bg-red-950/40 px-5 py-4 text-sm text-red-200"
            >
              {error}
            </div>
          )}

          {isLoading && items.length === 0 ? (
            <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-56 rounded-xl border border-slate-800 bg-[#111827] p-5"
                />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-[#111827]">
              <img
                src={TV_BACKDROP_ART}
                alt="Tela inicial da TV aguardando mídias"
                referrerPolicy="no-referrer"
                className="h-80 w-full object-cover opacity-45 sm:h-96"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0B1120] via-[#0B1120]/80 to-transparent" />
              <div className="absolute inset-0 flex flex-col justify-end p-8 sm:p-12">
                <h1 className="max-w-2xl text-3xl font-bold tracking-tight text-slate-100 text-balance sm:text-4xl">
                  Nenhum conteúdo adicionado para esta TV ainda
                </h1>
                <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-300">
                  Este aplicativo de TV exibe apenas os vídeos, músicas e fotos adicionados na mesma rede local. No computador, acesse o Modo PC e adicione arquivos ou pastas à Biblioteca da TV.
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    onClick={onSwitchToPc}
                    className="inline-flex items-center gap-2.5 rounded-xl bg-sky-600 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-sky-500 whitespace-nowrap"
                  >
                    <Monitor className="h-4 w-4" />
                    <span>Gerenciar no Modo PC</span>
                  </button>
                  {networkInfo?.tvUrls?.[0] && (
                    <span className="font-mono text-sm text-slate-300">
                      Endereço na rede local: {networkInfo.tvUrls[0]}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Spotlight Banner for Focused Item */}
              {focusedItem && (
                <section className="relative overflow-hidden rounded-2xl border border-slate-800 bg-[#111827]">
                  <img
                    src={
                      focusedItem.kind === 'image'
                        ? `/api/tv/media/${focusedItem.id}`
                        : focusedItem.kind === 'audio'
                        ? AUDIO_COVER_ART
                        : TV_BACKDROP_ART
                    }
                    alt={focusedItem.name}
                    referrerPolicy="no-referrer"
                    className="h-60 w-full object-cover opacity-40 sm:h-72"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#0B1120] via-[#0B1120]/85 to-transparent" />
                  <div className="absolute inset-0 flex flex-col justify-end p-8">
                    <p className="text-sm font-semibold text-sky-400">{focusedItem.collection}</p>
                    <h1 className="mt-1 max-w-3xl truncate text-3xl font-bold tracking-tight text-white sm:text-4xl">
                      {focusedItem.name}
                    </h1>
                    <p className="mt-2 text-sm text-slate-300">
                      <span>{focusedItem.extension.toUpperCase()}</span>
                      <span className="mx-2" aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{formatBytes(focusedItem.size)}</span>
                      <span className="mx-2" aria-hidden="true">·</span>
                      <span>{focusedItem.sourceLabel}</span>
                      <span className="mx-2" aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{formatDate(focusedItem.addedAt)}</span>
                    </p>
                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => openItemInPlayer(focusedItem)}
                        className="inline-flex items-center gap-2.5 rounded-xl bg-sky-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-500 whitespace-nowrap"
                      >
                        <Play className="h-4 w-4" />
                        <span>
                          {focusedItem.kind === 'image' ? 'Visualizar na Tela' : 'Reproduzir Agora'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleShareTvItem(focusedItem)}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/90 px-5 py-3 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-800 whitespace-nowrap"
                      >
                        {copiedShareId === focusedItem.id ? (
                          <>
                            <Check className="h-4 w-4 text-emerald-400" />
                            <span>Link Copiado</span>
                          </>
                        ) : (
                          <>
                            <Share2 className="h-4 w-4 text-sky-400" />
                            <span>Compartilhar</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </section>
              )}

              {/* Collections Filter Row */}
              {collections.length > 1 && (
                <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
                  {collectionTabs.map((col, idx) => {
                    const active = selectedCollection === col;
                    const focused = focusZone === 'collections' && collectionFocusIdx === idx;
                    return (
                      <button
                        key={col}
                        type="button"
                        onClick={() => {
                          setSelectedCollection(col);
                          setCollectionFocusIdx(idx);
                          setFocusZone('collections');
                        }}
                        className={`rounded-lg border px-4 py-2 text-sm font-medium transition-all whitespace-nowrap shrink-0 ${
                          active
                            ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                            : 'border-slate-800 bg-[#111827] text-slate-300 hover:bg-slate-800'
                        } ${focused ? 'ring-2 ring-sky-400' : ''}`}
                      >
                        {col === 'all' ? 'Todas as Coleções' : col}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 10-Foot TV Media Grid */}
              {filteredItems.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-[#111827] px-8 py-14 text-center">
                  <p className="text-base font-medium text-slate-200">
                    Nenhum item nesta categoria
                  </p>
                  <p className="mt-1 text-sm text-slate-400">
                    Selecione outra categoria ou coleção acima.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {filteredItems.map((item, idx) => {
                    const isFocused = focusZone === 'grid' && gridFocusIdx === idx;
                    return (
                      <button
                        key={item.id}
                        ref={(el) => {
                          cardRefs.current[idx] = el;
                        }}
                        type="button"
                        onMouseEnter={() => {
                          setFocusZone('grid');
                          setGridFocusIdx(idx);
                        }}
                        onClick={() => openItemInPlayer(item)}
                        className={`group flex flex-col overflow-hidden rounded-xl border text-left transition-all duration-150 ${
                          isFocused
                            ? 'scale-[1.02] border-sky-400 bg-[#172136] ring-2 ring-sky-400/70 shadow-2xl'
                            : 'border-slate-800 bg-[#111827] hover:border-slate-700'
                        }`}
                      >
                        <div className="relative aspect-video w-full overflow-hidden bg-slate-950">
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
                              className="h-full w-full object-cover opacity-80"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-900 to-[#0B1120]">
                              <Film className="h-12 w-12 text-slate-600 transition-colors group-hover:text-sky-400" />
                            </div>
                          )}

                          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
                          <div className="absolute bottom-3 left-3 flex items-center gap-2 text-xs font-medium text-slate-200">
                            {item.kind === 'video' ? (
                              <Film className="h-4 w-4 text-sky-400" />
                            ) : item.kind === 'audio' ? (
                              <Music className="h-4 w-4 text-sky-400" />
                            ) : (
                              <ImageIcon className="h-4 w-4 text-sky-400" />
                            )}
                            <span>{item.extension.toUpperCase()}</span>
                          </div>
                        </div>

                        <div className="p-4">
                          <h3 className="truncate text-base font-semibold text-slate-100">
                            {item.name}
                          </h3>
                          <p className="mt-1 truncate text-xs text-slate-400">
                            <span>{item.collection}</span>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">{formatBytes(item.size)}</span>
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Remote Control Navigation Legend Footer */}
      <footer className="border-t border-slate-800/80 bg-[#0F1626] px-6 py-3.5 sm:px-12">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
          <span>
            Setas: Navegar
            <span className="mx-2" aria-hidden="true">·</span>
            OK / Enter: Reproduzir
            <span className="mx-2" aria-hidden="true">·</span>
            Voltar / Esc: Retornar
          </span>
          <span>
            {activeCloudSyncs > 0
              ? `Nuvem sincronizada (${activeCloudSyncs}) · Atualiza automaticamente`
              : 'Biblioteca local somente leitura'}
          </span>
        </div>
      </footer>
    </div>
  );
};
