import { useEffect, useRef, useState } from 'react';
import type { AppPreferences, SyncPresence, TvCatalogItem } from '../types/media';

export interface CatalogUpdatePayload {
  items: TvCatalogItem[];
  collections: string[];
  activeCloudSyncsCount: number;
}

interface UseLiveSyncOptions {
  role: 'pc' | 'tv' | 'mobile';
  label: string;
  onCatalogUpdate?: (payload: CatalogUpdatePayload) => void;
  onPreferencesUpdate?: (prefs: AppPreferences) => void;
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
}: UseLiveSyncOptions) {
  const deviceIdRef = useRef<string>(createDeviceId());
  const wsRef = useRef<WebSocket | null>(null);

  const onCatalogRef = useRef(onCatalogUpdate);
  const onPrefsRef = useRef(onPreferencesUpdate);

  onCatalogRef.current = onCatalogUpdate;
  onPrefsRef.current = onPreferencesUpdate;

  const [isConnected, setIsConnected] = useState(false);
  const [presence, setPresence] = useState<SyncPresence>({
    pcCount: role === 'pc' ? 1 : 0,
    tvCount: role === 'tv' ? 1 : 0,
    mobileCount: role === 'mobile' ? 1 : 0,
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

  return {
    deviceId: deviceIdRef.current,
    isConnected,
    presence,
  };
}
