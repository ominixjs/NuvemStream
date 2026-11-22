import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Captions,
  ChevronLeft,
  ChevronRight,
  Film,
  Image as ImageIcon,
  Music,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Tv,
  Wifi,
  X,
} from 'lucide-react';
import { useLiveSync } from '../hooks/useLiveSync';
import type { TvCatalogItem, TvNetworkInfo } from '../types/media';
import { formatBytes, formatTimeSeconds } from '../utils/media';

const AUDIO_COVER_ART = '/src/assets/images/audio_vinyl_artwork_1795357589564.jpg';
const TV_BACKDROP_ART = '/src/assets/images/cinema_welcome_backdrop_1795357589226.jpg';

type TvCategory = 'all' | 'video' | 'audio' | 'image';
type FocusZone = 'tabs' | 'collections' | 'grid';
type PlayerOsdAction = 'play' | 'rew' | 'fwd' | 'prev' | 'next' | 'sub' | 'close';

function getGridColumnCount(): number {
  const w = window.innerWidth;
  if (w >= 1280) return 6;
  if (w >= 1024) return 5;
  if (w >= 768) return 4;
  if (w >= 640) return 3;
  return 2;
}

export const TvApp: React.FC = () => {
  const [items, setItems] = useState<TvCatalogItem[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [activeCloudSyncs, setActiveCloudSyncs] = useState(0);
  const [networkInfo, setNetworkInfo] = useState<TvNetworkInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catalogNotice, setCatalogNotice] = useState<string | null>(null);

  const [category, setCategory] = useState<TvCategory>('all');
  const [selectedCollection, setSelectedCollection] = useState<string>('all');
  const [clockText, setClockText] = useState('');

  // Spatial D-Pad remote control focus state
  const [focusZone, setFocusZone] = useState<FocusZone>('grid');
  const [tabFocusIdx, setTabFocusIdx] = useState(0);
  const [collectionFocusIdx, setCollectionFocusIdx] = useState(0);
  const [gridFocusIdx, setGridFocusIdx] = useState(0);

  // Fullscreen individual TV Player state
  const [playingQueue, setPlayingQueue] = useState<TvCatalogItem[]>([]);
  const [playingIdx, setPlayingIdx] = useState(0);
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [hudVisible, setHudVisible] = useState(true);
  const [playerOsdIdx, setPlayerOsdIdx] = useState(0);
  const [playerFocusBar, setPlayerFocusBar] = useState<'seek' | 'buttons'>('seek');
  const [playerError, setPlayerError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hudTimerRef = useRef<number | null>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const initialPlayHandledRef = useRef(false);
  const prevCountRef = useRef<number>(0);

  const categories: { id: TvCategory; label: string }[] = [
    { id: 'all', label: 'Tudo' },
    { id: 'video', label: 'Vídeos' },
    { id: 'audio', label: 'Músicas' },
    { id: 'image', label: 'Fotos' },
  ];

  const showCatalogNotice = useCallback((text: string) => {
    setCatalogNotice(text);
    window.setTimeout(() => {
      setCatalogNotice((prev) => (prev === text ? null : prev));
    }, 4000);
  }, []);

  const fetchCatalog = useCallback(async (silent = false): Promise<TvCatalogItem[]> => {
    if (!silent) setIsLoading(true);
    try {
      const res = await fetch('/api/tv/catalog');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Não foi possível carregar o catálogo local.');
      }
      const nextItems = (data.items || []) as TvCatalogItem[];
      prevCountRef.current = nextItems.length;
      setItems(nextItems);
      setCollections((data.collections || []) as string[]);
      setActiveCloudSyncs(Array.isArray(data.activeCloudSyncs) ? data.activeCloudSyncs.length : 0);
      setError(null);
      return nextItems;
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Erro de conexão com a rede local.');
      }
      return [];
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  const { isConnected: isSyncConnected } = useLiveSync({
    role: 'tv',
    label: 'Smart TV',
    onCatalogUpdate: (payload) => {
      const prevCount = prevCountRef.current;
      prevCountRef.current = payload.items.length;
      setItems(payload.items);
      setCollections(payload.collections);
      setActiveCloudSyncs(payload.activeCloudSyncsCount);
      setIsLoading(false);
      setError(null);
      if (payload.items.length !== prevCount) {
        showCatalogNotice(
          `Catálogo atualizado pelo PC (${payload.items.length} ${
            payload.items.length === 1 ? 'mídia' : 'mídias'
          })`
        );
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

  // Open single item if /tv?play=<id> was opened via shared link
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

  useEffect(() => {
    if (selectedCollection !== 'all' && !collections.includes(selectedCollection)) {
      setSelectedCollection('all');
    }
  }, [collections, selectedCollection]);

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
  const hasPrevInQueue = playingIdx > 0;
  const hasNextInQueue = playingIdx < playingQueue.length - 1;
  const nextQueueItem = hasNextInQueue ? playingQueue[playingIdx + 1] : null;

  const playerOsdActions = useMemo<PlayerOsdAction[]>(() => {
    if (!activeItem || activeItem.kind === 'image') return [];
    const list: PlayerOsdAction[] = ['play', 'rew', 'fwd'];
    if (hasPrevInQueue) list.push('prev');
    if (hasNextInQueue) list.push('next');
    if (activeItem.subtitleId) list.push('sub');
    list.push('close');
    return list;
  }, [activeItem, hasPrevInQueue, hasNextInQueue]);

  useEffect(() => {
    setPlayerOsdIdx((prev) => Math.min(prev, Math.max(0, playerOsdActions.length - 1)));
  }, [playerOsdActions.length]);

  const pokeHud = useCallback(() => {
    setHudVisible(true);
    if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
    hudTimerRef.current = window.setTimeout(() => {
      setHudVisible(false);
    }, 4000);
  }, []);

  useEffect(() => {
    if (isPlayerOpen) {
      setPlayerFocusBar('seek');
      setPlayerOsdIdx(0);
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
    },
    [filteredItems]
  );

  const closePlayer = useCallback(() => {
    setIsPlayerOpen(false);
    setPlayingQueue([]);
    setIsPlaying(false);
    setPlayerError(null);
  }, []);

  const handlePlayerNext = useCallback(() => {
    if (playingIdx >= playingQueue.length - 1) return;
    setPlayingIdx((prev) => prev + 1);
    setCurrentTime(0);
    setDuration(0);
    setPlayerError(null);
    pokeHud();
  }, [playingIdx, playingQueue.length, pokeHud]);

  const handlePlayerPrev = useCallback(() => {
    if (playingIdx <= 0) return;
    setPlayingIdx((prev) => prev - 1);
    setCurrentTime(0);
    setDuration(0);
    setPlayerError(null);
    pokeHud();
  }, [playingIdx, pokeHud]);

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
      el.currentTime = Math.max(
        0,
        Math.min(el.duration || el.currentTime + deltaSeconds, el.currentTime + deltaSeconds)
      );
      pokeHud();
    },
    [activeItem?.kind, pokeHud]
  );

  const executePlayerOsdAction = useCallback(
    (action: PlayerOsdAction) => {
      switch (action) {
        case 'play':
          togglePlayPause();
          break;
        case 'rew':
          seekBy(-10);
          break;
        case 'fwd':
          seekBy(10);
          break;
        case 'prev':
          handlePlayerPrev();
          break;
        case 'next':
          handlePlayerNext();
          break;
        case 'sub':
          setSubtitlesEnabled((prev) => !prev);
          pokeHud();
          break;
        case 'close':
          closePlayer();
          break;
      }
    },
    [togglePlayPause, seekBy, handlePlayerPrev, handlePlayerNext, pokeHud, closePlayer]
  );

  // Subtitle track visibility sync
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !vid.textTracks) return;
    for (let i = 0; i < vid.textTracks.length; i++) {
      vid.textTracks[i].mode = subtitlesEnabled ? 'showing' : 'hidden';
    }
  }, [subtitlesEnabled, activeItem?.id]);

  // Smart TV Remote Control / D-Pad Keyboard Handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Fullscreen Player Remote Control Handling
      if (isPlayerOpen && activeItem) {
        pokeHud();
        if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack') {
          e.preventDefault();
          closePlayer();
          return;
        }

        if (activeItem.kind === 'image') {
          if (e.key === 'ArrowRight' || e.key === 'ChannelUp' || e.key === 'MediaTrackNext') {
            e.preventDefault();
            handlePlayerNext();
          } else if (
            e.key === 'ArrowLeft' ||
            e.key === 'ChannelDown' ||
            e.key === 'MediaTrackPrevious'
          ) {
            e.preventDefault();
            handlePlayerPrev();
          }
          return;
        }

        if (e.key === 'MediaPlayPause' || e.code === 'Space') {
          e.preventDefault();
          togglePlayPause();
          return;
        }
        if (e.key === 'MediaPlay') {
          e.preventDefault();
          const el = activeItem.kind === 'video' ? videoRef.current : audioRef.current;
          void el?.play().catch(() => undefined);
          return;
        }
        if (e.key === 'MediaPause') {
          e.preventDefault();
          const el = activeItem.kind === 'video' ? videoRef.current : audioRef.current;
          el?.pause();
          return;
        }
        if (e.key === 'MediaFastForward') {
          e.preventDefault();
          seekBy(15);
          return;
        }
        if (e.key === 'MediaRewind') {
          e.preventDefault();
          seekBy(-15);
          return;
        }
        if (e.key === 'MediaTrackNext' || e.key === 'ChannelUp') {
          e.preventDefault();
          handlePlayerNext();
          return;
        }
        if (e.key === 'MediaTrackPrevious' || e.key === 'ChannelDown') {
          e.preventDefault();
          handlePlayerPrev();
          return;
        }

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setPlayerFocusBar('buttons');
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setPlayerFocusBar('seek');
          return;
        }

        if (playerFocusBar === 'buttons' && playerOsdActions.length > 0) {
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            setPlayerOsdIdx((prev) => (prev + 1) % playerOsdActions.length);
            return;
          }
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            setPlayerOsdIdx((prev) => (prev - 1 + playerOsdActions.length) % playerOsdActions.length);
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            const chosen = playerOsdActions[playerOsdIdx];
            if (chosen) executePlayerOsdAction(chosen);
            return;
          }
        } else {
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            seekBy(10);
            return;
          }
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            seekBy(-10);
            return;
          }
          if (e.key === 'Enter') {
            const target = e.target as HTMLElement | null;
            if (target?.tagName === 'BUTTON') return;
            e.preventDefault();
            togglePlayPause();
            return;
          }
        }
        return;
      }

      // Catalog Grid / Remote D-Pad Navigation
      const cols = getGridColumnCount();

      if (focusZone === 'tabs') {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          const next = (tabFocusIdx + 1) % categories.length;
          setTabFocusIdx(next);
          setCategory(categories[next].id);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          const next = (tabFocusIdx - 1 + categories.length) % categories.length;
          setTabFocusIdx(next);
          setCategory(categories[next].id);
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
          const next = (collectionFocusIdx + 1) % collectionTabs.length;
          setCollectionFocusIdx(next);
          setSelectedCollection(collectionTabs[next]);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          const next = (collectionFocusIdx - 1 + collectionTabs.length) % collectionTabs.length;
          setCollectionFocusIdx(next);
          setSelectedCollection(collectionTabs[next]);
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
          if (e.key === 'ArrowUp') {
            if (collections.length > 1) setFocusZone('collections');
            else setFocusZone('tabs');
          }
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
    playerFocusBar,
    playerOsdActions,
    playerOsdIdx,
    pokeHud,
    closePlayer,
    handlePlayerNext,
    handlePlayerPrev,
    togglePlayPause,
    seekBy,
    executePlayerOsdAction,
    openItemInPlayer,
  ]);

  const focusedItem =
    focusZone === 'grid' ? filteredItems[gridFocusIdx] || filteredItems[0] || null : null;
  const primaryLanDisplay = networkInfo?.lanIps?.[0]
    ? `${networkInfo.lanIps[0]}:${networkInfo.port}`
    : 'Rede Local';

  // Fullscreen 10-Foot Individual TV Player
  if (isPlayerOpen && activeItem) {
    const focusedAction = playerFocusBar === 'buttons' ? playerOsdActions[playerOsdIdx] : null;
    return (
      <div
        onMouseMove={pokeHud}
        className="fixed inset-0 z-50 flex flex-col bg-black text-slate-100 select-none"
      >
        {activeItem.kind === 'image' ? (
          <div className="relative flex h-full w-full items-center justify-center bg-black p-6">
            <img
              src={`/api/tv/media/${activeItem.id}`}
              alt={activeItem.name}
              referrerPolicy="no-referrer"
              className="max-h-full max-w-full object-contain"
            />
            <div
              className={`absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/85 to-transparent px-8 py-5 transition-opacity duration-200 ${
                hudVisible ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <div>
                <h2 className="text-xl font-bold text-white">{activeItem.name}</h2>
                <p className="mt-0.5 text-xs text-slate-300">
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
                      disabled={!hasPrevInQueue}
                      className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/90 text-white hover:bg-slate-800 disabled:opacity-35"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={handlePlayerNext}
                      disabled={!hasNextInQueue}
                      className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/90 text-white hover:bg-slate-800 disabled:opacity-35"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={closePlayer}
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/90 px-4 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  <ArrowLeft className="h-4 w-4" />
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
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
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
              className="absolute top-6 left-8 inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Voltar à Biblioteca</span>
            </button>

            <div className="flex w-full max-w-4xl flex-col items-center gap-8 md:flex-row">
              <div className="h-56 w-56 shrink-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
                <img
                  src={AUDIO_COVER_ART}
                  alt={activeItem.name}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>

              <div className="min-w-0 flex-1 space-y-5 text-center md:text-left">
                <div>
                  <p className="text-xs font-medium text-sky-400">{activeItem.collection}</p>
                  <h2 className="mt-1 truncate text-2xl font-bold text-slate-100">{activeItem.name}</h2>
                  <p className="mt-1.5 text-xs text-slate-400">
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
                    }}
                    className="h-2 w-full cursor-pointer accent-sky-500"
                  />
                  <div className="flex justify-between font-mono text-xs text-slate-400 tabular-nums">
                    <span>{formatTimeSeconds(currentTime)}</span>
                    <span>{formatTimeSeconds(duration)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-center gap-3 md:justify-start">
                  <button
                    type="button"
                    onClick={handlePlayerPrev}
                    disabled={!hasPrevInQueue}
                    className={`flex h-12 w-12 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-200 hover:bg-slate-800 disabled:opacity-35 ${
                      focusedAction === 'prev' ? 'ring-2 ring-sky-400' : ''
                    }`}
                  >
                    <SkipBack className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={togglePlayPause}
                    className={`flex h-14 w-14 items-center justify-center rounded-full bg-sky-600 text-white hover:bg-sky-500 ${
                      focusedAction === 'play' ? 'ring-2 ring-white' : ''
                    }`}
                  >
                    {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 translate-x-0.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={handlePlayerNext}
                    disabled={!hasNextInQueue}
                    className={`flex h-12 w-12 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-200 hover:bg-slate-800 disabled:opacity-35 ${
                      focusedAction === 'next' ? 'ring-2 ring-sky-400' : ''
                    }`}
                  >
                    <SkipForward className="h-5 w-5" />
                  </button>
                </div>

                {playerError && <p className="text-xs text-amber-300">{playerError}</p>}
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
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
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

            {/* Top OSD Bar */}
            <div
              className={`absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/90 via-black/50 to-transparent px-8 py-5 transition-opacity duration-200 ${
                hudVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-sky-400">{activeItem.collection}</p>
                <h2 className="truncate text-xl font-bold text-white">{activeItem.name}</h2>
              </div>

              <button
                type="button"
                onClick={closePlayer}
                className={`inline-flex h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/90 px-4 text-sm font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 ${
                  focusedAction === 'close' ? 'ring-2 ring-sky-400' : ''
                }`}
              >
                <X className="h-4 w-4" />
                <span>Voltar (Esc)</span>
              </button>
            </div>

            {/* Bottom 10-Foot TV Controls OSD */}
            <div
              className={`absolute inset-x-0 bottom-0 space-y-3 bg-gradient-to-t from-black/95 via-black/75 to-transparent px-8 pt-10 pb-6 transition-opacity duration-200 ${
                hudVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
            >
              {playerError && (
                <div className="rounded-lg border border-amber-800 bg-amber-950/80 px-4 py-2 text-xs text-amber-200">
                  {playerError}
                </div>
              )}

              <div
                className={`flex items-center gap-3 rounded-lg px-2 py-1 ${
                  playerFocusBar === 'seek' ? 'ring-1 ring-sky-500/50 bg-slate-950/40' : ''
                }`}
              >
                <span className="w-14 font-mono text-xs text-slate-200 tabular-nums">
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
                <span className="w-14 text-right font-mono text-xs text-slate-300 tabular-nums">
                  {formatTimeSeconds(duration)}
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={togglePlayPause}
                    className={`inline-flex h-11 items-center gap-2 rounded-xl bg-sky-600 px-5 text-sm font-semibold text-white hover:bg-sky-500 whitespace-nowrap ${
                      focusedAction === 'play' ? 'ring-2 ring-white ring-offset-2 ring-offset-black' : ''
                    }`}
                  >
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    <span>{isPlaying ? 'Pausar' : 'Reproduzir'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => seekBy(-10)}
                    className={`inline-flex h-11 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/90 px-3.5 text-xs font-medium text-slate-100 hover:bg-slate-800 whitespace-nowrap ${
                      focusedAction === 'rew' ? 'ring-2 ring-sky-400' : ''
                    }`}
                  >
                    <RotateCcw className="h-4 w-4" />
                    <span>-10s</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => seekBy(10)}
                    className={`inline-flex h-11 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/90 px-3.5 text-xs font-medium text-slate-100 hover:bg-slate-800 whitespace-nowrap ${
                      focusedAction === 'fwd' ? 'ring-2 ring-sky-400' : ''
                    }`}
                  >
                    <RotateCw className="h-4 w-4" />
                    <span>+10s</span>
                  </button>

                  {hasPrevInQueue && (
                    <button
                      type="button"
                      onClick={handlePlayerPrev}
                      className={`inline-flex h-11 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/90 px-3.5 text-xs font-medium text-slate-100 hover:bg-slate-800 whitespace-nowrap ${
                        focusedAction === 'prev' ? 'ring-2 ring-sky-400' : ''
                      }`}
                    >
                      <SkipBack className="h-4 w-4" />
                      <span>Anterior</span>
                    </button>
                  )}

                  {nextQueueItem && (
                    <button
                      type="button"
                      onClick={handlePlayerNext}
                      className={`inline-flex h-11 max-w-[260px] items-center gap-1.5 rounded-xl border border-sky-500/60 bg-sky-500/20 px-4 text-xs font-semibold text-sky-200 hover:bg-sky-500/30 whitespace-nowrap ${
                        focusedAction === 'next' ? 'ring-2 ring-sky-400' : ''
                      }`}
                    >
                      <span className="truncate">Próximo: {nextQueueItem.name}</span>
                      <SkipForward className="h-4 w-4 shrink-0" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2.5">
                  {activeItem.subtitleId && (
                    <button
                      type="button"
                      onClick={() => {
                        setSubtitlesEnabled((prev) => !prev);
                        pokeHud();
                      }}
                      className={`inline-flex h-11 items-center gap-2 rounded-xl border px-3.5 text-xs font-medium whitespace-nowrap ${
                        subtitlesEnabled
                          ? 'border-sky-500 bg-sky-500/20 text-sky-300'
                          : 'border-slate-700 bg-slate-900/90 text-slate-300'
                      } ${focusedAction === 'sub' ? 'ring-2 ring-sky-400' : ''}`}
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

  // Main 10-Foot Compact Read-Only TV Interface (Zero direct PC config access)
  return (
    <div className="flex min-h-screen w-full flex-col bg-[#0B1120] text-slate-100">
      {/* Slim TV Top Bar (3-zone contract) */}
      <header className="flex items-center justify-between gap-6 border-b border-slate-800/80 bg-[#0F1626] px-6 py-3.5 sm:px-10">
        <div className="flex items-center gap-2.5 shrink-0">
          <Tv className="h-5 w-5 text-sky-400" />
          <span className="text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap">
            NuvemStream TV
          </span>
        </div>

        <nav className="flex items-center gap-1.5 overflow-x-auto" aria-label="Categorias da TV">
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
                className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${
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
          {clockText && (
            <span className="hidden font-mono text-sm font-semibold text-slate-300 tabular-nums sm:inline">
              {clockText}
            </span>
          )}

          <button
            type="button"
            onClick={() => void fetchCatalog(false)}
            title="Atualizar biblioteca da TV"
            aria-label="Atualizar biblioteca da TV"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin text-sky-400' : ''}`} />
          </button>
        </div>
      </header>

      {/* Main Compact TV Viewport */}
      <main className="flex-1 px-6 py-5 sm:px-10">
        <div className="mx-auto max-w-[1600px] space-y-4">
          {catalogNotice && (
            <div className="rounded-lg border border-sky-800/70 bg-sky-950/40 px-4 py-2 text-xs font-medium text-sky-200">
              {catalogNotice}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-xs text-red-200"
            >
              {error}
            </div>
          )}

          {isLoading && items.length === 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="h-40 rounded-lg border border-slate-800 bg-[#111827] p-3"
                />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-[#111827]">
              <img
                src={TV_BACKDROP_ART}
                alt="Tela inicial da TV aguardando mídias do PC"
                referrerPolicy="no-referrer"
                className="h-72 w-full object-cover opacity-40"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0B1120] via-[#0B1120]/85 to-transparent" />
              <div className="absolute inset-0 flex flex-col justify-end p-8">
                <h1 className="max-w-2xl text-2xl font-bold tracking-tight text-slate-100 text-balance sm:text-3xl">
                  Aguardando conteúdo configurado no PC
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
                  Esta tela de TV é somente leitura. No computador, conecte o Koofr/WebDAV ou adicione pastas locais — os vídeos aparecem aqui automaticamente logo em seguida.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <Wifi className="h-4 w-4 text-sky-400" />
                    <span className="font-mono">{primaryLanDisplay}</span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {isSyncConnected ? 'Conectado ao PC em tempo real' : 'Aguardando conexão local'}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Compact Collection Tabs + Focused Item Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                {collections.length > 1 ? (
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
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
                          className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                            active
                              ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                              : 'border-slate-800 bg-[#111827] text-slate-300 hover:bg-slate-800'
                          } ${focused ? 'ring-2 ring-sky-400' : ''}`}
                        >
                          {col === 'all' ? 'Todas as Pastas' : col}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs font-medium text-slate-400">
                    {collections[0] || 'Biblioteca da TV'}
                  </div>
                )}

                {focusedItem && (
                  <div className="hidden items-center gap-2 text-xs text-slate-300 lg:flex max-w-md">
                    <span className="text-sky-400 font-medium shrink-0">OK para assistir:</span>
                    <span className="truncate font-semibold text-slate-100">{focusedItem.name}</span>
                  </div>
                )}
              </div>

              {/* Compact High-Density 10-Foot TV Grid (Smaller cards, more videos visible) */}
              {filteredItems.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-[#111827] px-8 py-12 text-center">
                  <p className="text-sm font-medium text-slate-200">
                    Nenhum item nesta categoria
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Use as setas para trocar de categoria ou pasta acima.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
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
                        className={`group flex flex-col overflow-hidden rounded-lg border text-left transition-transform duration-150 ${
                          isFocused
                            ? 'scale-[1.03] border-sky-400 bg-[#182238] ring-2 ring-sky-400/80 shadow-xl z-10'
                            : 'border-slate-800/90 bg-[#111827] hover:border-slate-700'
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
                              <Film
                                className={`h-8 w-8 transition-colors ${
                                  isFocused ? 'text-sky-400' : 'text-slate-600 group-hover:text-sky-400'
                                }`}
                              />
                            </div>
                          )}

                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                          <div className="absolute bottom-1.5 left-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-200">
                            {item.kind === 'video' ? (
                              <Film className="h-3.5 w-3.5 text-sky-400" />
                            ) : item.kind === 'audio' ? (
                              <Music className="h-3.5 w-3.5 text-sky-400" />
                            ) : (
                              <ImageIcon className="h-3.5 w-3.5 text-sky-400" />
                            )}
                            <span>{item.extension.toUpperCase()}</span>
                          </div>
                        </div>

                        <div className="p-2.5">
                          <h3 className="truncate text-xs font-semibold text-slate-100 sm:text-[13px]">
                            {item.name}
                          </h3>
                          <p className="mt-0.5 truncate text-[11px] text-slate-400">
                            <span>{item.collection}</span>
                            <span className="mx-1" aria-hidden="true">·</span>
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
      <footer className="border-t border-slate-800/80 bg-[#0F1626] px-6 py-2.5 sm:px-10">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 text-[11px] text-slate-400">
          <span>
            Setas: Navegar
            <span className="mx-2" aria-hidden="true">·</span>
            OK / Enter: Reproduzir
            <span className="mx-2" aria-hidden="true">·</span>
            Voltar / Esc: Retornar
          </span>
          <span className="font-mono tabular-nums">
            {filteredItems.length} {filteredItems.length === 1 ? 'vídeo/item' : 'itens'}
            <span className="mx-2" aria-hidden="true">·</span>
            {activeCloudSyncs > 0
              ? `Nuvem sincronizada (${activeCloudSyncs})`
              : isSyncConnected
              ? 'Sincronizado com o PC'
              : primaryLanDisplay}
          </span>
        </div>
      </footer>
    </div>
  );
};
