import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AppPreferences,
  LivePlaybackState,
  SyncPresence,
  TvCatalogItem,
} from '../types/media';

export interface CatalogUpdatePayload {
  items: TvCatalogItem[];
  collections: string[];
  activeCloudSyncsCount: number;
}

interface UseLiveSyncOptions {
  role: 'pc' | 'tv';
  label: string;
  onCatalogUpdate?: (payload: CatalogUpdatePayload) => void;
  onPreferencesUpdate?: (prefs: AppPreferences) => void;
  onRemotePlayback?: (playback: LivePlaybackState) => void;
}

function createDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useLiveSync({
  role,
  label,
  onCatalogUpdate,
  onPreferencesUpdate,
  onRemotePlayback,
}: UseLiveSyncOptions) {
  const deviceIdRef = useRef<string>(createDeviceId());
  const wsRef = useRef<WebSocket | null>(null);
  const lastHandledEventIdRef = useRef<string | null>(null);

  const onCatalogRef = useRef(onCatalogUpdate);
  const onPrefsRef = useRef(onPreferencesUpdate);
  const onRemotePlaybackRef = useRef(onRemotePlayback);

  onCatalogRef.current = onCatalogUpdate;
  onPrefsRef.current = onPreferencesUpdate;
  onRemotePlaybackRef.current = onRemotePlayback;

  const [isConnected, setIsConnected] = useState(false);
  const [presence, setPresence] = useState<SyncPresence>({
    pcCount: role === 'pc' ? 1 : 0,
    tvCount: role === 'tv' ? 1 : 0,
    totalCount: 1,
  });

  useEffect(() => {
    let unmounted = false;
    let reconnectTimer: number | null = null;
    let backoffMs = 1000;

    const connect = () => {
      if (unmounted) return;
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/ws/sync`;

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        reconnectTimer = window.setTimeout(connect, backoffMs);
        backoffMs = Math.min(8000, backoffMs * 1.5);
        return;
      }

      wsRef.current = ws;

      ws.onopen = () => {
        if (unmounted) {
          ws.close();
          return;
        }
        backoffMs = 1000;
        setIsConnected(true);
        ws.send(
          JSON.stringify({
            type: 'client:hello',
            role,
            deviceId: deviceIdRef.current,
            label,
          })
        );
      };

      ws.onmessage = (event) => {
        if (unmounted || typeof event.data !== 'string') return;
        try {
          const msg = JSON.parse(event.data) as Record<string, unknown>;
          const type = typeof msg.type === 'string' ? msg.type : '';

          if (type === 'sync:init') {
            if (msg.presence && typeof msg.presence === 'object') {
              setPresence(msg.presence as SyncPresence);
            }
            if (msg.preferences && typeof msg.preferences === 'object') {
              onPrefsRef.current?.(msg.preferences as AppPreferences);
            }
            if (msg.catalog && typeof msg.catalog === 'object') {
              const cat = msg.catalog as {
                items?: TvCatalogItem[];
                collections?: string[];
                activeCloudSyncs?: unknown[];
              };
              onCatalogRef.current?.({
                items: Array.isArray(cat.items) ? cat.items : [],
                collections: Array.isArray(cat.collections) ? cat.collections : [],
                activeCloudSyncsCount: Array.isArray(cat.activeCloudSyncs)
                  ? cat.activeCloudSyncs.length
                  : 0,
              });
            }
            // If the other device loaded something very recently (< 15s), auto-receive on connect
            if (msg.activePlayback && typeof msg.activePlayback === 'object') {
              const pb = msg.activePlayback as LivePlaybackState;
              const isRecent = Date.now() - pb.updatedAt < 15000;
              if (
                isRecent &&
                pb.action !== 'close' &&
                pb.senderDeviceId !== deviceIdRef.current &&
                pb.senderRole !== role &&
                pb.eventId !== lastHandledEventIdRef.current
              ) {
                lastHandledEventIdRef.current = pb.eventId;
                onRemotePlaybackRef.current?.(pb);
              }
            }
            return;
          }

          if (type === 'presence:updated' && msg.presence && typeof msg.presence === 'object') {
            setPresence(msg.presence as SyncPresence);
            return;
          }

          if (type === 'preferences:updated' && msg.preferences && typeof msg.preferences === 'object') {
            onPrefsRef.current?.(msg.preferences as AppPreferences);
            return;
          }

          if (type === 'catalog:updated') {
            const items = Array.isArray(msg.items) ? (msg.items as TvCatalogItem[]) : [];
            const collections = Array.isArray(msg.collections) ? (msg.collections as string[]) : [];
            const activeCloudSyncsCount = Array.isArray(msg.activeCloudSyncs)
              ? msg.activeCloudSyncs.length
              : 0;
            onCatalogRef.current?.({
              items,
              collections,
              activeCloudSyncsCount,
            });
            return;
          }

          if (type === 'playback:updated' && msg.playback && typeof msg.playback === 'object') {
            const pb = msg.playback as LivePlaybackState;
            if (pb.senderDeviceId === deviceIdRef.current) return;
            if (pb.eventId && pb.eventId === lastHandledEventIdRef.current) return;
            lastHandledEventIdRef.current = pb.eventId;
            onRemotePlaybackRef.current?.(pb);
          }
        } catch {
          // Ignore invalid WebSocket frame
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        setIsConnected(false);
        wsRef.current = null;
        reconnectTimer = window.setTimeout(connect, backoffMs);
        backoffMs = Math.min(8000, Math.round(backoffMs * 1.5));
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [role, label]);

  const emitPlaybackSync = useCallback(
    async (payload: {
      itemId: string;
      action: LivePlaybackState['action'];
      currentTime?: number;
      isPlaying?: boolean;
    }) => {
      const msg = {
        type: 'playback:sync',
        itemId: payload.itemId,
        action: payload.action,
        currentTime: payload.currentTime ?? 0,
        isPlaying: payload.isPlaying ?? true,
      };

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
        return;
      }

      // Fallback to HTTP endpoint if socket is reconnecting
      try {
        await fetch('/api/sync/playback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...msg,
            senderRole: role,
            senderDeviceId: deviceIdRef.current,
          }),
        });
      } catch {
        // Ignore transient failure during reconnect
      }
    },
    [role]
  );

  return {
    deviceId: deviceIdRef.current,
    isConnected,
    presence,
    emitPlaybackSync,
  };
}
