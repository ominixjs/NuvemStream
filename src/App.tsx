import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Cloud,
  Menu,
  Radio,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { ConnectCloudModal } from './components/ConnectCloudModal';
import { DesktopExeModal } from './components/DesktopExeModal';
import { FolderBrowser } from './components/FolderBrowser';
import { MediaPlayerStage, type RemotePlaybackCommand } from './components/MediaPlayerStage';
import { ShareMediaModal, type ShareTargetInfo } from './components/ShareMediaModal';
import { Sidebar } from './components/Sidebar';
import { TvApp } from './components/TvApp';
import { TvManagerPanel } from './components/TvManagerPanel';
import { useLiveSync } from './hooks/useLiveSync';
import type {
  ActiveMediaTrack,
  AppPreferences,
  CloudConnection,
  CloudEntry,
  FolderTreeNode,
  LivePlaybackState,
  MediaFilter,
  SavedCloudRegistration,
  SortDirection,
  SortField,
  SourceMode,
  TvCatalogItem,
  TvNetworkInfo,
  ViewMode,
} from './types/media';
import {
  buildBreadcrumbs,
  convertSrtTextToVtt,
  getBaseNameWithoutExt,
  getParentPath,
  indexLocalFileList,
  readDirectoryHandleRecursively,
  sortEntries,
  type LocalIndex,
} from './utils/media';

function updateTreeNodeChildren(
  node: FolderTreeNode,
  targetPath: string,
  updater: (target: FolderTreeNode) => FolderTreeNode
): FolderTreeNode {
  if (node.path === targetPath) {
    return updater(node);
  }
  if (!node.children || node.children.length === 0) {
    return node;
  }
  return {
    ...node,
    children: node.children.map((child) => updateTreeNodeChildren(child, targetPath, updater)),
  };
}

function findMatchingSubtitle(videoEntry: CloudEntry, folderEntries: CloudEntry[]): CloudEntry | null {
  const videoBase = getBaseNameWithoutExt(videoEntry.name).toLowerCase();
  const candidates = folderEntries.filter((e) => !e.isFolder && e.kind === 'subtitle');
  if (candidates.length === 0) return null;

  // Prefer exact basename match, then prefix match (e.g. movie.pt.srt), preferring .vtt over .srt
  const scored = candidates
    .map((sub) => {
      const subBase = getBaseNameWithoutExt(sub.name).toLowerCase();
      let score = 0;
      if (subBase === videoBase) score += 10;
      else if (subBase.startsWith(`${videoBase}.`) || subBase.startsWith(`${videoBase}_`) || subBase.startsWith(`${videoBase}-`)) {
        score += 6;
      }
      if (sub.extension === 'vtt') score += 2;
      return { sub, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.sub || null;
}

export default function App() {
  const [sourceMode, setSourceMode] = useState<SourceMode | null>(null);
  const [cloudConnection, setCloudConnection] = useState<CloudConnection | null>(null);
  const [localIndex, setLocalIndex] = useState<LocalIndex | null>(null);

  const [currentPath, setCurrentPath] = useState<string>('/');
  const [folderCache, setFolderCache] = useState<Record<string, CloudEntry[]>>({});
  const [treeRoot, setTreeRoot] = useState<FolderTreeNode | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(['/']));

  const [isLoadingFolder, setIsLoadingFolder] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);

  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const [searchQuery, setSearchQuery] = useState('');
  const [globalSearchResults, setGlobalSearchResults] = useState<CloudEntry[] | null>(null);
  const [isSearchingGlobal, setIsSearchingGlobal] = useState(false);

  const [playQueue, setPlayQueue] = useState<CloudEntry[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [activeTrack, setActiveTrack] = useState<ActiveMediaTrack | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // TV Mode & LAN Library State
  const [isTvRoute, setIsTvRoute] = useState<boolean>(() => window.location.pathname === '/tv');
  const [pcPanel, setPcPanel] = useState<'browser' | 'tv-manager'>('browser');
  const [tvCatalog, setTvCatalog] = useState<TvCatalogItem[]>([]);
  const [tvNetworkInfo, setTvNetworkInfo] = useState<TvNetworkInfo | null>(null);
  const [isTvUploading, setIsTvUploading] = useState(false);
  const [tvUploadStatus, setTvUploadStatus] = useState<string | null>(null);
  const [sendingTvPath, setSendingTvPath] = useState<string | null>(null);
  const [isDesktopModalOpen, setIsDesktopModalOpen] = useState(false);
  const [shareEntry, setShareEntry] = useState<CloudEntry | null>(null);
  const [shareStreamUrl, setShareStreamUrl] = useState<string | null>(null);
  const [isPublishingShare, setIsPublishingShare] = useState(false);

  // Temporary cloud registrations & automatic live sync
  const [savedRegistrations, setSavedRegistrations] = useState<SavedCloudRegistration[]>([]);
  const [preferences, setPreferences] = useState<AppPreferences | null>(null);
  const [isSyncingFolderToTv, setIsSyncingFolderToTv] = useState(false);
  const [isSyncingCloudId, setIsSyncingCloudId] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [autoSyncNotice, setAutoSyncNotice] = useState<string | null>(null);
  const [remoteCommand, setRemoteCommand] = useState<RemotePlaybackCommand | null>(null);

  const localInputRef = useRef<HTMLInputElement | null>(null);
  const activeObjectUrlsRef = useRef<string[]>([]);
  const suppressSyncEmitUntilRef = useRef<number>(0);
  const tvCatalogRef = useRef<TvCatalogItem[]>([]);
  const activeTrackRef = useRef<ActiveMediaTrack | null>(null);
  const autoSyncEnabledRef = useRef<boolean>(true);
  const sourceModeRef = useRef<SourceMode | null>(null);
  const autoRestoreAttemptedRef = useRef<boolean>(false);
  const userDisconnectedRef = useRef<boolean>(false);

  const autoSyncEnabled = preferences ? preferences.autoSyncPlayback : true;
  tvCatalogRef.current = tvCatalog;
  activeTrackRef.current = activeTrack;
  autoSyncEnabledRef.current = autoSyncEnabled;
  sourceModeRef.current = sourceMode;

  useEffect(() => {
    const onPopState = () => {
      setIsTvRoute(window.location.pathname === '/tv');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateRoute = useCallback((route: string) => {
    const nextUrl = new URL(route, window.location.origin);
    const currentFull = `${window.location.pathname}${window.location.search}`;
    const targetFull = `${nextUrl.pathname}${nextUrl.search}`;
    if (currentFull !== targetFull) {
      window.history.pushState({}, '', targetFull);
    }
    setIsTvRoute(nextUrl.pathname === '/tv');
    setMobileSidebarOpen(false);
  }, []);

  const showAutoSyncToast = useCallback((text: string) => {
    setAutoSyncNotice(text);
    window.setTimeout(() => {
      setAutoSyncNotice((prev) => (prev === text ? null : prev));
    }, 4500);
  }, []);

  const fetchTvCatalog = useCallback(async (): Promise<TvCatalogItem[]> => {
    try {
      const res = await fetch('/api/tv/catalog');
      const data = await res.json();
      if (res.ok && Array.isArray(data.items)) {
        const items = data.items as TvCatalogItem[];
        setTvCatalog(items);
        return items;
      }
    } catch {
      // Ignore background TV catalog fetch errors
    }
    return tvCatalogRef.current;
  }, []);

  const fetchSavedRegistrations = useCallback(async (): Promise<SavedCloudRegistration[]> => {
    try {
      const res = await fetch('/api/cloud/saved');
      const data = await res.json();
      if (res.ok && Array.isArray(data.registrations)) {
        const regs = data.registrations as SavedCloudRegistration[];
        setSavedRegistrations(regs);
        return regs;
      }
    } catch {
      // Ignore background fetch errors
    }
    return [];
  }, []);

  const fetchPreferences = useCallback(async (): Promise<AppPreferences | null> => {
    try {
      const res = await fetch('/api/preferences');
      const data = await res.json();
      if (res.ok && data.preferences) {
        const prefs = data.preferences as AppPreferences;
        setPreferences(prefs);
        return prefs;
      }
    } catch {
      // Ignore background preference errors
    }
    return null;
  }, []);

  const handleToggleAutoSync = useCallback(async (next: boolean) => {
    setPreferences((prev) =>
      prev
        ? { ...prev, autoSyncPlayback: next }
        : {
            autoSaveCloud: true,
            autoSyncPlayback: next,
            defaultTtlMinutes: 720,
            lastProviderName: 'Koofr',
            lastServerUrl: 'https://app.koofr.net/dav/Koofr',
            lastUsername: '',
            lastSyncPath: '/',
            updatedAt: null,
          }
    );
    try {
      const res = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSyncPlayback: next }),
      });
      const data = await res.json();
      if (res.ok && data.preferences) {
        setPreferences(data.preferences as AppPreferences);
      }
    } catch {
      // Ignore network failure
    }
  }, []);

  useEffect(() => {
    void fetchTvCatalog();
    void fetch('/api/tv/network')
      .then((r) => r.json())
      .then((data: TvNetworkInfo) => setTvNetworkInfo(data))
      .catch(() => undefined);
  }, [fetchTvCatalog]);

  const revokeObjectUrls = useCallback(() => {
    for (const url of activeObjectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    activeObjectUrlsRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      revokeObjectUrls();
    };
  }, [revokeObjectUrls]);

  const buildTreeFromEntries = useCallback((path: string, entries: CloudEntry[]) => {
    const childFolders: FolderTreeNode[] = entries
      .filter((e) => e.isFolder)
      .map((f) => ({
        name: f.name,
        path: f.path,
        children: [],
        loaded: false,
      }));

    setTreeRoot((prev) => {
      if (!prev) return prev;
      return updateTreeNodeChildren(prev, path, (target) => ({
        ...target,
        loaded: true,
        loading: false,
        children: childFolders,
      }));
    });
  }, []);

  const fetchCloudFolder = useCallback(
    async (conn: CloudConnection, folderPath: string, force = false): Promise<CloudEntry[]> => {
      if (!force && folderCache[folderPath]) {
        return folderCache[folderPath];
      }

      const res = await fetch(`/api/cloud/list?path=${encodeURIComponent(folderPath)}`, {
        headers: {
          Authorization: `Bearer ${conn.sessionId}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Não foi possível ler a pasta na nuvem.');
      }

      const items = (data.items || []) as CloudEntry[];
      setFolderCache((prev) => ({ ...prev, [folderPath]: items }));
      buildTreeFromEntries(folderPath, items);
      return items;
    },
    [folderCache, buildTreeFromEntries]
  );

  const navigateToPath = useCallback(
    async (targetPath: string, force = false) => {
      setPcPanel('browser');
      setGlobalSearchResults(null);
      setCurrentPath(targetPath);
      setMobileSidebarOpen(false);
      setFolderError(null);

      // Expand ancestor paths in tree
      const parts = targetPath.split('/').filter(Boolean);
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        next.add('/');
        let acc = '';
        for (const p of parts) {
          acc += `/${p}`;
          next.add(acc);
        }
        return next;
      });

      if (sourceMode === 'cloud' && cloudConnection) {
        setIsLoadingFolder(true);
        try {
          await fetchCloudFolder(cloudConnection, targetPath, force);
        } catch (err) {
          setFolderError(err instanceof Error ? err.message : 'Erro ao abrir pasta.');
        } finally {
          setIsLoadingFolder(false);
        }
      }
    },
    [sourceMode, cloudConnection, fetchCloudFolder]
  );

  const handleToggleTreeExpand = useCallback(
    async (node: FolderTreeNode) => {
      const isExpanded = expandedPaths.has(node.path);
      if (isExpanded) {
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          next.delete(node.path);
          return next;
        });
        return;
      }

      setExpandedPaths((prev) => {
        const next = new Set(prev);
        next.add(node.path);
        return next;
      });

      if (sourceMode === 'cloud' && cloudConnection && !node.loaded) {
        setTreeRoot((prev) =>
          prev
            ? updateTreeNodeChildren(prev, node.path, (t) => ({ ...t, loading: true }))
            : prev
        );
        try {
          await fetchCloudFolder(cloudConnection, node.path, false);
        } catch {
          setTreeRoot((prev) =>
            prev
              ? updateTreeNodeChildren(prev, node.path, (t) => ({ ...t, loading: false }))
              : prev
          );
        }
      }
    },
    [expandedPaths, sourceMode, cloudConnection, fetchCloudFolder]
  );

  const applyOpenedCloudSession = useCallback(
    (data: {
      sessionId: string;
      providerName: string;
      serverHost: string;
      username: string;
      items?: CloudEntry[];
    }) => {
      revokeObjectUrls();
      setActiveTrack(null);
      setPlayQueue([]);
      setLocalIndex(null);
      setGlobalSearchResults(null);
      setSearchQuery('');
      setMediaFilter('all');
      setSyncNotice(null);

      const conn: CloudConnection = {
        sessionId: data.sessionId,
        providerName: data.providerName,
        serverHost: data.serverHost,
        username: data.username,
      };
      const rootItems = (data.items || []) as CloudEntry[];

      setCloudConnection(conn);
      setSourceMode('cloud');
      setPcPanel('browser');
      setCurrentPath('/');
      setFolderCache({ '/': rootItems });
      setExpandedPaths(new Set(['/']));
      setTreeRoot({
        name: conn.providerName,
        path: '/',
        loaded: true,
        children: rootItems
          .filter((item) => item.isFolder)
          .map((f) => ({
            name: f.name,
            path: f.path,
            children: [],
            loaded: false,
          })),
      });
      setFolderError(null);
      setIsConnectModalOpen(false);
    },
    [revokeObjectUrls]
  );

  const handleConnectCloud = async (params: {
    serverUrl: string;
    username: string;
    password: string;
    providerName: string;
    saveTemporarily?: boolean;
    ttlMinutes?: number;
    syncPath?: string;
  }) => {
    setIsConnecting(true);
    setConnectError(null);
    try {
      const res = await fetch('/api/cloud/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Falha ao conectar ao serviço em nuvem.');
      }

      applyOpenedCloudSession(data);
      if (data.savedRegistration) {
        await Promise.all([fetchSavedRegistrations(), fetchTvCatalog()]);
        const count = data.savedRegistration.itemCount ?? 0;
        setSyncNotice(
          `Credenciais salvas temporariamente em memória e TV sincronizada (${count} mídias encontradas em "${data.savedRegistration.syncPath}").`
        );
      }
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Erro ao conectar.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSyncCurrentFolderToTv = useCallback(async () => {
    if (!cloudConnection) return;
    setIsSyncingFolderToTv(true);
    setFolderError(null);
    setSyncNotice(null);
    try {
      const res = await fetch('/api/cloud/saved/from-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cloudConnection.sessionId}`,
        },
        body: JSON.stringify({
          syncPath: currentPath,
          ttlMinutes: 720,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Não foi possível sincronizar esta pasta com a TV.');
      }
      await Promise.all([fetchSavedRegistrations(), fetchTvCatalog()]);
      const reg = data.registration as SavedCloudRegistration | undefined;
      setSyncNotice(
        `Pasta "${reg?.syncPath || currentPath}" sincronizada na biblioteca da TV (${reg?.itemCount ?? 0} mídias, válido por 12h em memória).`
      );
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : 'Erro ao sincronizar pasta com a TV.');
    } finally {
      setIsSyncingFolderToTv(false);
    }
  }, [cloudConnection, currentPath, fetchSavedRegistrations, fetchTvCatalog]);

  const handleSyncSavedCloud = useCallback(
    async (id: string, syncPath?: string) => {
      setIsSyncingCloudId(id);
      try {
        const res = await fetch(`/api/cloud/saved/${encodeURIComponent(id)}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(syncPath ? { syncPath } : {}),
        });
        const data = await res.json();
        if (res.ok) {
          await Promise.all([fetchSavedRegistrations(), fetchTvCatalog()]);
          const reg = data.registration as SavedCloudRegistration | undefined;
          if (reg) {
            setTvUploadStatus(
              reg.syncError
                ? `Erro ao sincronizar ${reg.providerName}: ${reg.syncError}`
                : `${reg.providerName} (${reg.syncPath}) atualizado na TV com ${reg.itemCount} mídias.`
            );
          }
        }
      } catch {
        // Ignore transient sync errors
      } finally {
        setIsSyncingCloudId(null);
      }
    },
    [fetchSavedRegistrations, fetchTvCatalog]
  );

  const handleOpenSavedSession = useCallback(
    async (id: string, silent = false) => {
      if (!silent) {
        setIsConnecting(true);
        setConnectError(null);
      }
      try {
        const res = await fetch(`/api/cloud/saved/${encodeURIComponent(id)}/open-session`, {
          method: 'POST',
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || 'Não foi possível reabrir sessão temporária.');
        }
        applyOpenedCloudSession(data);
        if (silent) {
          showAutoSyncToast(`Sessão restaurada automaticamente: ${data.providerName} (${data.username})`);
        }
      } catch (err) {
        if (!silent) {
          setConnectError(err instanceof Error ? err.message : 'Erro ao reabrir nuvem.');
        }
      } finally {
        if (!silent) {
          setIsConnecting(false);
        }
      }
    },
    [applyOpenedCloudSession, showAutoSyncToast]
  );

  // Auto-restore active temporary cloud credentials on startup / page reload
  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      const [prefs, regs] = await Promise.all([fetchPreferences(), fetchSavedRegistrations()]);
      if (cancelled || autoRestoreAttemptedRef.current) return;
      autoRestoreAttemptedRef.current = true;
      if (
        !userDisconnectedRef.current &&
        !sourceModeRef.current &&
        regs.length > 0 &&
        prefs?.autoSaveCloud !== false
      ) {
        await handleOpenSavedSession(regs[0].id, true);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [fetchPreferences, fetchSavedRegistrations, handleOpenSavedSession]);

  const handleDeleteSavedCloud = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/cloud/saved/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          await Promise.all([fetchSavedRegistrations(), fetchTvCatalog()]);
          setTvUploadStatus('Cadastro temporário removido da memória e da biblioteca da TV.');
        }
      } catch {
        // Ignore network error
      }
    },
    [fetchSavedRegistrations, fetchTvCatalog]
  );

  const applyLocalIndex = useCallback(
    (index: LocalIndex) => {
      revokeObjectUrls();
      setActiveTrack(null);
      setPlayQueue([]);
      setCloudConnection(null);
      setFolderCache({});
      setGlobalSearchResults(null);
      setSearchQuery('');
      setMediaFilter('all');
      setFolderError(null);

      setLocalIndex(index);
      setSourceMode('local');
      setCurrentPath('/');
      setTreeRoot(index.tree);
      setExpandedPaths(new Set(['/']));
    },
    [revokeObjectUrls]
  );

  const handleOpenLocalFolder = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> })
      .showDirectoryPicker;
    if (typeof picker === 'function') {
      try {
        const handle = await picker();
        setIsLoadingFolder(true);
        const index = await readDirectoryHandleRecursively(handle);
        applyLocalIndex(index);
        setIsLoadingFolder(false);
        return;
      } catch (err) {
        setIsLoadingFolder(false);
        // If user cancelled picker, do nothing; if blocked by iframe security, fall back to input
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
      }
    }
    localInputRef.current?.click();
  };

  const handleLocalInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const index = indexLocalFileList(files);
    applyLocalIndex(index);
    e.target.value = '';
  };

  const handleDisconnect = async () => {
    userDisconnectedRef.current = true;
    if (sourceMode === 'cloud' && cloudConnection) {
      try {
        await fetch('/api/cloud/disconnect', {
          method: 'POST',
          headers: { Authorization: `Bearer ${cloudConnection.sessionId}` },
        });
      } catch {
        // Ignore network failure on disconnect
      }
    }
    revokeObjectUrls();
    setSourceMode(null);
    setCloudConnection(null);
    setLocalIndex(null);
    setFolderCache({});
    setTreeRoot(null);
    setCurrentPath('/');
    setActiveTrack(null);
    setPlayQueue([]);
    setGlobalSearchResults(null);
    setSearchQuery('');
    setFolderError(null);
  };

  const currentFolderRawItems = useMemo<CloudEntry[]>(() => {
    if (sourceMode === 'cloud') {
      return folderCache[currentPath] || [];
    }
    if (sourceMode === 'local' && localIndex) {
      return localIndex.foldersMap.get(currentPath) || [];
    }
    return [];
  }, [sourceMode, folderCache, currentPath, localIndex]);

  const handleRemotePlaybackFromTv = useCallback(
    async (playback: LivePlaybackState) => {
      if (!autoSyncEnabledRef.current) return;
      if (playback.senderRole !== 'tv') return;
      if (playback.action === 'close') return;

      const currentActive = activeTrackRef.current;
      if (currentActive?.tvItemId === playback.itemId && playback.action !== 'load') {
        suppressSyncEmitUntilRef.current = Date.now() + 900;
        setRemoteCommand({
          action: playback.action === 'pause' ? 'pause' : playback.action === 'seek' ? 'seek' : 'play',
          currentTime: playback.currentTime,
          isPlaying: playback.isPlaying,
          seq: Date.now(),
        });
        return;
      }

      let pool = tvCatalogRef.current;
      let target = pool.find((i) => i.id === playback.itemId);
      if (!target) {
        pool = await fetchTvCatalog();
        target = pool.find((i) => i.id === playback.itemId);
      }
      if (!target) return;

      suppressSyncEmitUntilRef.current = Date.now() + 1200;
      revokeObjectUrls();

      const matchingKindItems = pool.filter((item) =>
        target!.kind === 'image'
          ? item.kind === 'image'
          : item.kind === 'video' || item.kind === 'audio'
      );
      const mappedQueue: CloudEntry[] = matchingKindItems.map((item) => ({
        name: item.name,
        path: `/tv/${item.id}/${item.name}`,
        isFolder: false,
        kind: item.kind,
        size: item.size,
        mimeType: item.mimeType,
        lastModified: item.addedAt,
        extension: item.extension,
      }));
      const targetIdx = Math.max(
        0,
        matchingKindItems.findIndex((i) => i.id === target!.id)
      );
      const targetEntry = mappedQueue[targetIdx] || {
        name: target.name,
        path: `/tv/${target.id}/${target.name}`,
        isFolder: false,
        kind: target.kind,
        size: target.size,
        mimeType: target.mimeType,
        lastModified: target.addedAt,
        extension: target.extension,
      };

      setPcPanel('browser');
      setPlayQueue(mappedQueue.length > 0 ? mappedQueue : [targetEntry]);
      setQueueIndex(targetIdx);
      setActiveTrack({
        entry: targetEntry,
        streamUrl: `/api/tv/media/${encodeURIComponent(target.id)}`,
        subtitleUrl: target.subtitleId ? `/api/tv/subtitle/${encodeURIComponent(target.subtitleId)}` : null,
        subtitleLabel: target.subtitleName || null,
        tvItemId: target.id,
        remoteSourceLabel: 'Recebido automaticamente da TV',
      });

      if (playback.currentTime > 1 || !playback.isPlaying) {
        window.setTimeout(() => {
          setRemoteCommand({
            action: playback.isPlaying ? 'play' : 'pause',
            currentTime: playback.currentTime,
            isPlaying: playback.isPlaying,
            seq: Date.now(),
          });
        }, 450);
      }

      showAutoSyncToast(`Recebido automaticamente da TV: ${target.name}`);
    },
    [fetchTvCatalog, revokeObjectUrls, showAutoSyncToast]
  );

  const { presence, emitPlaybackSync } = useLiveSync({
    role: 'pc',
    label: 'PC Principal',
    onCatalogUpdate: (payload) => {
      setTvCatalog(payload.items);
    },
    onPreferencesUpdate: (prefs) => {
      setPreferences(prefs);
    },
    onRemotePlayback: (playback) => {
      void handleRemotePlaybackFromTv(playback);
    },
  });

  const ensureEntryOnTv = useCallback(
    async (entry: CloudEntry, matchedSub?: CloudEntry | null): Promise<TvCatalogItem | null> => {
      if (entry.isFolder || entry.kind === 'subtitle' || entry.kind === 'other') return null;

      const existing = tvCatalogRef.current.find(
        (item) => item.name === entry.name && item.size === entry.size
      );
      if (existing) return existing;

      const parentParts = getParentPath(entry.path).split('/').filter(Boolean);
      const collectionName =
        parentParts[parentParts.length - 1] ||
        (sourceMode === 'cloud' ? cloudConnection?.providerName : localIndex?.rootLabel) ||
        'Biblioteca';

      if (sourceMode === 'cloud' && cloudConnection) {
        const res = await fetch('/api/tv/share-cloud-item', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cloudConnection.sessionId}`,
          },
          body: JSON.stringify({
            path: entry.path,
            name: entry.name,
            size: entry.size,
            mimeType: entry.mimeType,
            collection: collectionName,
            subtitlePath: matchedSub?.path || null,
            subtitleName: matchedSub?.name || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || 'Falha ao compartilhar item da nuvem na TV.');
        }
        const created = (data.item || null) as TvCatalogItem | null;
        if (created) {
          setTvCatalog((prev) => [created, ...prev.filter((i) => i.id !== created.id)]);
        }
        return created;
      }

      if (sourceMode === 'local' && localIndex) {
        const record = localIndex.filesByPath.get(entry.path);
        if (!record) return null;
        // Skip auto-upload for oversized local files
        if (record.file.size > 1.5 * 1024 * 1024 * 1024) return null;

        if (matchedSub) {
          const subRecord = localIndex.filesByPath.get(matchedSub.path);
          if (subRecord) {
            await fetch('/api/tv/upload', {
              method: 'POST',
              headers: {
                'X-File-Name': encodeURIComponent(subRecord.file.name),
                'X-Collection-Name': encodeURIComponent(collectionName),
                'X-Mime-Type': subRecord.file.type || 'text/plain',
              },
              body: subRecord.file,
            }).catch(() => undefined);
          }
        }

        const res = await fetch('/api/tv/upload', {
          method: 'POST',
          headers: {
            'X-File-Name': encodeURIComponent(record.file.name),
            'X-Collection-Name': encodeURIComponent(collectionName),
            'X-Mime-Type': record.file.type || 'application/octet-stream',
          },
          body: record.file,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || 'Falha ao enviar arquivo local para a TV.');
        }
        const created = (data.item || null) as TvCatalogItem | null;
        await fetchTvCatalog();
        return created;
      }

      return null;
    },
    [sourceMode, cloudConnection, localIndex, fetchTvCatalog]
  );

  const loadTrack = useCallback(
    async (entry: CloudEntry, queue: CloudEntry[], idx: number) => {
      revokeObjectUrls();
      setPlayQueue(queue);
      setQueueIndex(idx);

      // Handle items that came directly from the TV catalog queue (e.g. received from TV)
      if (entry.path.startsWith('/tv/')) {
        const tvId = entry.path.split('/')[2] || '';
        const matchedTv = tvCatalogRef.current.find((i) => i.id === tvId);
        if (matchedTv) {
          setActiveTrack({
            entry,
            streamUrl: `/api/tv/media/${encodeURIComponent(matchedTv.id)}`,
            subtitleUrl: matchedTv.subtitleId
              ? `/api/tv/subtitle/${encodeURIComponent(matchedTv.subtitleId)}`
              : null,
            subtitleLabel: matchedTv.subtitleName || null,
            tvItemId: matchedTv.id,
            remoteSourceLabel: 'Sincronizado com a TV',
          });
          if (autoSyncEnabledRef.current && Date.now() > suppressSyncEmitUntilRef.current) {
            void emitPlaybackSync({
              itemId: matchedTv.id,
              action: 'load',
              currentTime: 0,
              isPlaying: true,
            });
          }
          return;
        }
      }

      const parentFolderPath = getParentPath(entry.path);
      const siblingEntries =
        sourceMode === 'cloud'
          ? folderCache[parentFolderPath] || currentFolderRawItems
          : localIndex?.foldersMap.get(parentFolderPath) || currentFolderRawItems;

      const matchedSub =
        entry.kind === 'video' ? findMatchingSubtitle(entry, siblingEntries) : null;

      const existingTvMatch = tvCatalogRef.current.find(
        (item) => item.name === entry.name && item.size === entry.size
      );

      if (sourceMode === 'local' && localIndex) {
        const fileRecord = localIndex.filesByPath.get(entry.path);
        if (!fileRecord) return;
        const streamUrl = URL.createObjectURL(fileRecord.file);
        activeObjectUrlsRef.current.push(streamUrl);

        let subtitleUrl: string | null = null;
        let subtitleLabel: string | null = null;
        if (matchedSub) {
          const subRecord = localIndex.filesByPath.get(matchedSub.path);
          if (subRecord) {
            if (matchedSub.extension === 'srt') {
              const srtText = await subRecord.file.text();
              const vttBlob = new Blob([convertSrtTextToVtt(srtText)], { type: 'text/vtt' });
              subtitleUrl = URL.createObjectURL(vttBlob);
            } else {
              subtitleUrl = URL.createObjectURL(subRecord.file);
            }
            activeObjectUrlsRef.current.push(subtitleUrl);
            subtitleLabel = matchedSub.name;
          }
        }

        setActiveTrack({
          entry,
          streamUrl,
          subtitleUrl,
          subtitleLabel,
          tvItemId: existingTvMatch?.id || null,
        });

        if (
          autoSyncEnabledRef.current &&
          Date.now() > suppressSyncEmitUntilRef.current &&
          (entry.kind === 'video' || entry.kind === 'audio' || entry.kind === 'image')
        ) {
          void ensureEntryOnTv(entry, matchedSub)
            .then((tvItem) => {
              if (!tvItem) return;
              setActiveTrack((prev) =>
                prev && prev.entry.path === entry.path ? { ...prev, tvItemId: tvItem.id } : prev
              );
              return emitPlaybackSync({
                itemId: tvItem.id,
                action: 'load',
                currentTime: 0,
                isPlaying: true,
              });
            })
            .catch(() => undefined);
        }
        return;
      }

      if (sourceMode === 'cloud' && cloudConnection) {
        try {
          const res = await fetch('/api/cloud/ticket', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${cloudConnection.sessionId}`,
            },
            body: JSON.stringify({ path: entry.path }),
          });
          const data = await res.json();
          if (!res.ok || !data.ticket) {
            throw new Error(data?.error || 'Não foi possível iniciar o streaming.');
          }
          const streamUrl = `/api/cloud/stream?ticket=${encodeURIComponent(data.ticket)}`;

          let subtitleUrl: string | null = null;
          let subtitleLabel: string | null = null;
          if (matchedSub) {
            const subRes = await fetch('/api/cloud/ticket', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${cloudConnection.sessionId}`,
              },
              body: JSON.stringify({
                path: matchedSub.path,
                convertSrt: matchedSub.extension === 'srt',
              }),
            });
            const subData = await subRes.json();
            if (subRes.ok && subData.ticket) {
              subtitleUrl = `/api/cloud/stream?ticket=${encodeURIComponent(subData.ticket)}`;
              subtitleLabel = matchedSub.name;
            }
          }

          setActiveTrack({
            entry,
            streamUrl,
            subtitleUrl,
            subtitleLabel,
            tvItemId: existingTvMatch?.id || null,
          });

          if (
            autoSyncEnabledRef.current &&
            Date.now() > suppressSyncEmitUntilRef.current &&
            (entry.kind === 'video' || entry.kind === 'audio' || entry.kind === 'image')
          ) {
            void ensureEntryOnTv(entry, matchedSub)
              .then((tvItem) => {
                if (!tvItem) return;
                setActiveTrack((prev) =>
                  prev && prev.entry.path === entry.path ? { ...prev, tvItemId: tvItem.id } : prev
                );
                return emitPlaybackSync({
                  itemId: tvItem.id,
                  action: 'load',
                  currentTime: 0,
                  isPlaying: true,
                });
              })
              .catch(() => undefined);
          }
        } catch (err) {
          setFolderError(err instanceof Error ? err.message : 'Erro ao abrir mídia.');
        }
      }
    },
    [
      sourceMode,
      cloudConnection,
      localIndex,
      folderCache,
      currentFolderRawItems,
      revokeObjectUrls,
      ensureEntryOnTv,
      emitPlaybackSync,
    ]
  );

  const displayedItems = useMemo(() => {
    const base = globalSearchResults !== null ? globalSearchResults : currentFolderRawItems;
    const byKind =
      mediaFilter === 'all'
        ? base
        : base.filter((item) => item.isFolder || item.kind === mediaFilter);

    const q = searchQuery.trim().toLowerCase();
    const byQuery =
      globalSearchResults !== null || !q
        ? byKind
        : byKind.filter((item) => item.name.toLowerCase().includes(q));

    return sortEntries(byQuery, sortField, sortDirection);
  }, [globalSearchResults, currentFolderRawItems, mediaFilter, searchQuery, sortField, sortDirection]);

  const filterCounts = useMemo(() => {
    const base = globalSearchResults !== null ? globalSearchResults : currentFolderRawItems;
    const filesOnly = base.filter((i) => !i.isFolder);
    return {
      all: filesOnly.length,
      video: filesOnly.filter((i) => i.kind === 'video').length,
      audio: filesOnly.filter((i) => i.kind === 'audio').length,
      image: filesOnly.filter((i) => i.kind === 'image').length,
    };
  }, [globalSearchResults, currentFolderRawItems]);

  const handlePlayFile = (entry: CloudEntry) => {
    const sameCategoryQueue = displayedItems.filter((item) => {
      if (item.isFolder) return false;
      if (entry.kind === 'image') return item.kind === 'image';
      return item.kind === 'video' || item.kind === 'audio';
    });
    const idx = Math.max(
      0,
      sameCategoryQueue.findIndex((i) => i.path === entry.path)
    );
    const queue = sameCategoryQueue.length > 0 ? sameCategoryQueue : [entry];
    void loadTrack(entry, queue, idx);
  };

  const handlePlayAllMedia = () => {
    const queue = displayedItems.filter((i) => !i.isFolder && (i.kind === 'video' || i.kind === 'audio'));
    if (queue.length === 0) return;
    void loadTrack(queue[0], queue, 0);
  };

  const handlePrevTrack = () => {
    if (queueIndex <= 0) return;
    const prevIdx = queueIndex - 1;
    void loadTrack(playQueue[prevIdx], playQueue, prevIdx);
  };

  const handleNextTrack = () => {
    if (queueIndex >= playQueue.length - 1) return;
    const nextIdx = queueIndex + 1;
    void loadTrack(playQueue[nextIdx], playQueue, nextIdx);
  };

  const handleGlobalSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q || q.length < 2 || !sourceMode) {
      setGlobalSearchResults(null);
      return;
    }

    if (sourceMode === 'local' && localIndex) {
      const lowered = q.toLowerCase();
      const matched: CloudEntry[] = [];
      for (const [, list] of localIndex.foldersMap.entries()) {
        for (const item of list) {
          if (item.name.toLowerCase().includes(lowered)) {
            matched.push(item);
          }
        }
      }
      setGlobalSearchResults(matched);
      return;
    }

    if (sourceMode === 'cloud' && cloudConnection) {
      setIsSearchingGlobal(true);
      setFolderError(null);
      try {
        const res = await fetch(
          `/api/cloud/search?q=${encodeURIComponent(q)}&path=${encodeURIComponent(currentPath)}`,
          {
            headers: { Authorization: `Bearer ${cloudConnection.sessionId}` },
          }
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || 'Falha na busca pelas pastas.');
        }
        setGlobalSearchResults((data.items || []) as CloudEntry[]);
      } catch (err) {
        setFolderError(err instanceof Error ? err.message : 'Erro ao pesquisar pastas.');
      } finally {
        setIsSearchingGlobal(false);
      }
    }
  };

  const handleChangeSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleUploadFilesToTv = useCallback(
    async (files: FileList, customCollection?: string) => {
      const list = Array.from(files);
      if (list.length === 0) return;

      setIsTvUploading(true);
      let addedCount = 0;
      let skippedCount = 0;

      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
        const folderFromRel = rel.includes('/') ? rel.split('/')[0] : '';
        const collection = customCollection || folderFromRel || 'Adicionados do PC';

        setTvUploadStatus(`Enviando para TV (${i + 1}/${list.length}): ${file.name}`);

        try {
          const res = await fetch('/api/tv/upload', {
            method: 'POST',
            headers: {
              'X-File-Name': encodeURIComponent(file.name),
              'X-Collection-Name': encodeURIComponent(collection),
              'X-Mime-Type': file.type || 'application/octet-stream',
            },
            body: file,
          });
          if (res.ok) {
            addedCount++;
          } else {
            skippedCount++;
          }
        } catch {
          skippedCount++;
        }
      }

      await fetchTvCatalog();
      setIsTvUploading(false);
      setTvUploadStatus(
        skippedCount > 0
          ? `${addedCount} arquivo(s) adicionados à TV (${skippedCount} ignorado(s) por formato não compatível).`
          : `${addedCount} arquivo(s) adicionados à biblioteca da TV na rede local.`
      );
    },
    [fetchTvCatalog]
  );

  const handleRemoveTvItem = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/tv/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (res.ok) {
          setTvCatalog((prev) => prev.filter((item) => item.id !== id));
        }
      } catch {
        // Ignore network error
      }
    },
    []
  );

  const handleSendEntryToTv = useCallback(
    async (entry: CloudEntry): Promise<TvCatalogItem | null> => {
      if (entry.isFolder) return null;
      setSendingTvPath(entry.path);
      setFolderError(null);

      try {
        const parentFolderPath = getParentPath(entry.path);
        const siblingEntries =
          sourceMode === 'cloud'
            ? folderCache[parentFolderPath] || currentFolderRawItems
            : localIndex?.foldersMap.get(parentFolderPath) || currentFolderRawItems;
        const matchedSub =
          entry.kind === 'video' ? findMatchingSubtitle(entry, siblingEntries) : null;

        const createdItem = await ensureEntryOnTv(entry, matchedSub);
        if (createdItem) {
          await fetchTvCatalog();
          setTvUploadStatus(`"${entry.name}" pronto na biblioteca da TV.`);
        }
        return createdItem;
      } catch (err) {
        setFolderError(err instanceof Error ? err.message : 'Erro ao enviar arquivo para a TV.');
        return null;
      } finally {
        setSendingTvPath(null);
      }
    },
    [sourceMode, localIndex, folderCache, currentFolderRawItems, ensureEntryOnTv, fetchTvCatalog]
  );

  const handleSendAndPlayEntryOnTv = useCallback(
    async (entry: CloudEntry) => {
      setIsPublishingShare(true);
      try {
        const tvItem = await handleSendEntryToTv(entry);
        if (tvItem) {
          setActiveTrack((prev) =>
            prev && prev.entry.path === entry.path ? { ...prev, tvItemId: tvItem.id } : prev
          );
          await emitPlaybackSync({
            itemId: tvItem.id,
            action: 'load',
            currentTime: 0,
            isPlaying: true,
          });
          showAutoSyncToast(`Enviado para reprodução automática na TV: ${tvItem.name}`);
        }
      } finally {
        setIsPublishingShare(false);
      }
    },
    [handleSendEntryToTv, emitPlaybackSync, showAutoSyncToast]
  );

  const openShareForEntry = useCallback(
    (entry: CloudEntry, knownStreamUrl?: string | null) => {
      setShareEntry(entry);
      setShareStreamUrl(knownStreamUrl || null);
    },
    []
  );

  const shareModalTarget = useMemo<ShareTargetInfo | null>(() => {
    if (!shareEntry) return null;
    const matchedTv = tvCatalog.find(
      (item) => item.name === shareEntry.name && item.size === shareEntry.size
    );
    return {
      name: shareEntry.name,
      size: shareEntry.size,
      kindLabel: shareEntry.extension ? shareEntry.extension.toUpperCase() : shareEntry.kind,
      tvItemId: matchedTv?.id || null,
      directStreamUrl:
        shareStreamUrl ||
        (activeTrack?.entry.path === shareEntry.path && sourceMode === 'cloud'
          ? activeTrack.streamUrl
          : null),
      isPublishing: isPublishingShare,
      onPublishToLan: matchedTv
        ? null
        : async () => {
            setIsPublishingShare(true);
            try {
              await handleSendEntryToTv(shareEntry);
            } finally {
              setIsPublishingShare(false);
            }
          },
      onSendAndPlayOnTv:
        shareEntry.isFolder || shareEntry.kind === 'subtitle' || shareEntry.kind === 'other'
          ? null
          : async () => {
              await handleSendAndPlayEntryOnTv(shareEntry);
            },
    };
  }, [
    shareEntry,
    tvCatalog,
    shareStreamUrl,
    activeTrack,
    sourceMode,
    isPublishingShare,
    handleSendEntryToTv,
    handleSendAndPlayEntryOnTv,
  ]);

  const breadcrumbs = useMemo(() => buildBreadcrumbs(currentPath), [currentPath]);

  if (isTvRoute) {
    return (
      <TvApp
        onSwitchToPc={() => {
          void fetchTvCatalog();
          navigateRoute('/');
        }}
      />
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#0B1120] text-slate-100">
      {/* Hidden input fallback for reading local PC folders */}
      <input
        ref={localInputRef}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory is supported by Chromium/Firefox/Safari desktop browsers
        webkitdirectory=""
        directory=""
        onChange={handleLocalInputChange}
        className="hidden"
      />

      {/* Desktop Sidebar */}
      <div className="hidden lg:flex">
        <Sidebar
          sourceMode={sourceMode}
          cloudConnection={cloudConnection}
          localRootLabel={localIndex?.rootLabel || null}
          currentPath={currentPath}
          mediaFilter={mediaFilter}
          onChangeFilter={(f) => {
            setPcPanel('browser');
            setMediaFilter(f);
          }}
          onSelectPath={(p) => void navigateToPath(p)}
          treeRoot={treeRoot}
          expandedPaths={expandedPaths}
          onToggleExpand={(node) => void handleToggleTreeExpand(node)}
          onOpenConnectModal={() => {
            setConnectError(null);
            setIsConnectModalOpen(true);
          }}
          onOpenLocalFolder={() => void handleOpenLocalFolder()}
          onDisconnect={() => void handleDisconnect()}
          activePanel={pcPanel}
          onSelectPanel={(panel) => {
            setPcPanel(panel);
            setMobileSidebarOpen(false);
          }}
          onOpenTvMode={() => navigateRoute('/tv')}
          onOpenDesktopModal={() => setIsDesktopModalOpen(true)}
          tvItemCount={tvCatalog.length}
          filterCounts={filterCounts}
        />
      </div>

      {/* Mobile Drawer Sidebar */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="relative z-10 flex h-full">
            <Sidebar
              sourceMode={sourceMode}
              cloudConnection={cloudConnection}
              localRootLabel={localIndex?.rootLabel || null}
              currentPath={currentPath}
              mediaFilter={mediaFilter}
              onChangeFilter={(f) => {
                setPcPanel('browser');
                setMediaFilter(f);
              }}
              onSelectPath={(p) => void navigateToPath(p)}
              treeRoot={treeRoot}
              expandedPaths={expandedPaths}
              onToggleExpand={(node) => void handleToggleTreeExpand(node)}
              onOpenConnectModal={() => {
                setMobileSidebarOpen(false);
                setConnectError(null);
                setIsConnectModalOpen(true);
              }}
              onOpenLocalFolder={() => {
                setMobileSidebarOpen(false);
                void handleOpenLocalFolder();
              }}
              onDisconnect={() => void handleDisconnect()}
              activePanel={pcPanel}
              onSelectPanel={(panel) => {
                setPcPanel(panel);
                setMobileSidebarOpen(false);
              }}
              onOpenTvMode={() => navigateRoute('/tv')}
              onOpenDesktopModal={() => {
                setMobileSidebarOpen(false);
                setIsDesktopModalOpen(true);
              }}
              tvItemCount={tvCatalog.length}
              filterCounts={filterCounts}
            />
          </div>
        </div>
      )}

      {/* Main Desktop Workspace */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-800/90 bg-[#0F1626] px-4 sm:px-6">
          {/* Left Zone: Breadcrumbs & Folder Back */}
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Abrir barra lateral"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>

            {sourceMode && (
              <>
                <button
                  type="button"
                  onClick={() => void navigateToPath(getParentPath(currentPath))}
                  disabled={currentPath === '/'}
                  aria-label="Voltar pasta anterior"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-35"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>

                <nav aria-label="Caminho da pasta" className="flex min-w-0 items-center gap-1 overflow-x-auto text-xs">
                  {breadcrumbs.map((crumb, idx) => {
                    const isLast = idx === breadcrumbs.length - 1;
                    const label =
                      idx === 0
                        ? sourceMode === 'cloud'
                          ? cloudConnection?.providerName || 'Nuvem'
                          : localIndex?.rootLabel || 'PC'
                        : crumb.label;
                    return (
                      <React.Fragment key={crumb.path}>
                        {idx > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-600" />}
                        <button
                          type="button"
                          onClick={() => void navigateToPath(crumb.path)}
                          className={`max-w-[160px] truncate rounded px-1.5 py-1 transition-colors whitespace-nowrap ${
                            isLast
                              ? 'font-semibold text-slate-100'
                              : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                          }`}
                        >
                          {label}
                        </button>
                      </React.Fragment>
                    );
                  })}
                </nav>
              </>
            )}

            {!sourceMode && (
              <span className="text-sm font-medium text-slate-300 whitespace-nowrap">
                Biblioteca de Streaming
              </span>
            )}
          </div>

          {/* Right Zone: Search + Refresh + Primary Action */}
          <div className="flex items-center gap-2.5 shrink-0">
            {sourceMode && (
              <form onSubmit={handleGlobalSearch} className="relative hidden sm:block">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (!e.target.value.trim()) {
                      setGlobalSearchResults(null);
                    }
                  }}
                  placeholder="Buscar nesta pasta (Enter: todas)..."
                  aria-label="Buscar arquivos e pastas"
                  className="h-9 w-60 rounded-lg border border-slate-800 bg-slate-950 py-1.5 pr-8 pl-8 text-xs text-slate-100 placeholder:text-slate-500 focus:w-72 focus:border-sky-500 focus:outline-none transition-all"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setGlobalSearchResults(null);
                    }}
                    aria-label="Limpar busca"
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </form>
            )}

            {sourceMode === 'cloud' && (
              <button
                type="button"
                onClick={() => void navigateToPath(currentPath, true)}
                disabled={isLoadingFolder}
                title="Atualizar pasta"
                aria-label="Atualizar pasta"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${isLoadingFolder ? 'animate-spin text-sky-400' : ''}`} />
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleToggleAutoSync(!autoSyncEnabled)}
              title="Ao carregar mídia no PC ou na TV, o outro dispositivo recebe automaticamente"
              className={`hidden items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors md:inline-flex whitespace-nowrap shrink-0 ${
                autoSyncEnabled
                  ? 'border-sky-500/60 bg-sky-500/15 text-sky-300'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Radio className="h-3.5 w-3.5" />
              <span>
                {autoSyncEnabled
                  ? `Receber Auto · ${presence.tvCount} TV`
                  : 'Receber Auto Pausado'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setConnectError(null);
                setIsConnectModalOpen(true);
              }}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-sky-600 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-sky-500 whitespace-nowrap shrink-0"
            >
              <Cloud className="h-4 w-4" />
              <span>{cloudConnection ? 'Nuvem Conectada' : 'Conectar Nuvem'}</span>
            </button>
          </div>
        </header>

        {/* Main Scrollable Viewport */}
        <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto max-w-6xl">
            {autoSyncNotice && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-sky-800/70 bg-sky-950/35 px-4 py-2.5 text-xs font-medium text-sky-200">
                <span className="flex items-center gap-2 min-w-0">
                  <Radio className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                  <span className="truncate">{autoSyncNotice}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setAutoSyncNotice(null)}
                  aria-label="Fechar aviso"
                  className="text-sky-300/70 hover:text-white shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {pcPanel === 'tv-manager' ? (
              <TvManagerPanel
                items={tvCatalog}
                networkInfo={tvNetworkInfo}
                isUploading={isTvUploading}
                uploadStatus={tvUploadStatus}
                onUploadFiles={handleUploadFilesToTv}
                onRemoveItem={handleRemoveTvItem}
                onOpenTvMode={() => navigateRoute('/tv')}
                savedRegistrations={savedRegistrations}
                isSyncingCloudId={isSyncingCloudId}
                onSyncSavedCloud={handleSyncSavedCloud}
                onOpenSavedSession={handleOpenSavedSession}
                onDeleteSavedCloud={handleDeleteSavedCloud}
                onOpenConnectCloud={() => {
                  setConnectError(null);
                  setIsConnectModalOpen(true);
                }}
              />
            ) : (
              <>
                <MediaPlayerStage
                  activeTrack={activeTrack}
                  queueIndex={queueIndex}
                  queueLength={playQueue.length}
                  nextTrackName={
                    queueIndex < playQueue.length - 1 ? playQueue[queueIndex + 1]?.name || null : null
                  }
                  onPrev={handlePrevTrack}
                  onNext={handleNextTrack}
                  onShare={
                    activeTrack
                      ? () =>
                          openShareForEntry(
                            activeTrack.entry,
                            sourceMode === 'cloud' ? activeTrack.streamUrl : null
                          )
                      : undefined
                  }
                  onSendToTvNow={
                    activeTrack &&
                    (activeTrack.entry.kind === 'video' ||
                      activeTrack.entry.kind === 'audio' ||
                      activeTrack.entry.kind === 'image')
                      ? () => void handleSendAndPlayEntryOnTv(activeTrack.entry)
                      : undefined
                  }
                  remoteCommand={remoteCommand}
                  onPlaybackControl={(action, currentTime, isPlaying) => {
                    if (
                      autoSyncEnabledRef.current &&
                      activeTrack?.tvItemId &&
                      Date.now() > suppressSyncEmitUntilRef.current
                    ) {
                      void emitPlaybackSync({
                        itemId: activeTrack.tvItemId,
                        action,
                        currentTime,
                        isPlaying,
                      });
                    }
                  }}
                  onClose={() => {
                    revokeObjectUrls();
                    setActiveTrack(null);
                  }}
                />

                <FolderBrowser
                  sourceMode={sourceMode}
                  items={displayedItems}
                  isLoading={isLoadingFolder || isSearchingGlobal}
                  error={folderError}
                  activeTrackPath={activeTrack?.entry.path || null}
                  viewMode={viewMode}
                  onChangeViewMode={setViewMode}
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onChangeSort={handleChangeSort}
                  onOpenFolder={(entry) => void navigateToPath(entry.path)}
                  onPlayFile={handlePlayFile}
                  onPlayAllMedia={handlePlayAllMedia}
                  onOpenConnectModal={() => {
                    setConnectError(null);
                    setIsConnectModalOpen(true);
                  }}
                  onOpenLocalFolder={() => void handleOpenLocalFolder()}
                  onSendToTv={(entry) => void handleSendEntryToTv(entry)}
                  onShareEntry={(entry) => openShareForEntry(entry)}
                  sendingTvPath={sendingTvPath}
                  onSyncFolderToTv={
                    sourceMode === 'cloud' ? () => void handleSyncCurrentFolderToTv() : undefined
                  }
                  isSyncingFolderToTv={isSyncingFolderToTv}
                  syncNotice={syncNotice}
                  searchQuery={searchQuery}
                  isGlobalSearch={globalSearchResults !== null}
                />
              </>
            )}
          </div>
        </main>
      </div>

      <ConnectCloudModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        onConnect={handleConnectCloud}
        onOpenLocalFolder={() => void handleOpenLocalFolder()}
        isConnecting={isConnecting}
        error={connectError}
        preferences={preferences}
        savedRegistrations={savedRegistrations}
        onOpenSavedSession={(id) => handleOpenSavedSession(id, false)}
        onDeleteSavedCloud={handleDeleteSavedCloud}
      />

      <ShareMediaModal
        isOpen={Boolean(shareEntry)}
        onClose={() => {
          setShareEntry(null);
          setShareStreamUrl(null);
        }}
        target={shareModalTarget}
        networkInfo={tvNetworkInfo}
        presence={presence}
        autoSyncPlayback={autoSyncEnabled}
        onToggleAutoSync={(enabled) => void handleToggleAutoSync(enabled)}
        onOpenTvPlay={(tvItemId) => navigateRoute(`/tv?play=${encodeURIComponent(tvItemId)}`)}
      />

      <DesktopExeModal
        isOpen={isDesktopModalOpen}
        onClose={() => setIsDesktopModalOpen(false)}
        networkInfo={tvNetworkInfo}
      />
    </div>
  );
}
