export type MediaKind = 'folder' | 'video' | 'audio' | 'image' | 'subtitle' | 'other';

export type SourceMode = 'cloud' | 'local';

export type MediaFilter = 'all' | 'video' | 'audio' | 'image';

export type ViewMode = 'list' | 'grid';

export type SortField = 'name' | 'size' | 'lastModified' | 'kind';
export type SortDirection = 'asc' | 'desc';

export interface CloudEntry {
  name: string;
  path: string;
  isFolder: boolean;
  kind: MediaKind;
  size: number;
  mimeType: string;
  lastModified: string | null;
  extension: string;
}

export interface CloudConnection {
  sessionId: string;
  providerName: string;
  serverHost: string;
  username: string;
}

export interface LocalFileRecord {
  entry: CloudEntry;
  file: File;
}

export interface FolderTreeNode {
  name: string;
  path: string;
  children: FolderTreeNode[];
  loaded: boolean;
  loading?: boolean;
}

export interface ActiveMediaTrack {
  entry: CloudEntry;
  streamUrl: string;
  subtitleUrl: string | null;
  subtitleLabel: string | null;
  tvItemId?: string | null;
}

export interface AppPreferences {
  autoSaveCloud: boolean;
  defaultTtlMinutes: number;
  lastProviderName: string;
  lastServerUrl: string;
  lastUsername: string;
  lastSyncPath: string;
  updatedAt: string | null;
}

export interface SyncPresence {
  pcCount: number;
  tvCount: number;
  mobileCount: number;
  totalCount: number;
}

export interface CloudPreset {
  id: string;
  name: string;
  freeTier: string;
  serverUrl: string;
  urlPlaceholder: string;
  usernamePlaceholder: string;
  passwordLabel: string;
  helpSteps: string[];
}

export interface TvCatalogItem {
  id: string;
  name: string;
  collection: string;
  kind: 'video' | 'audio' | 'image';
  extension: string;
  mimeType: string;
  size: number;
  sourceLabel: string;
  addedAt: string;
  subtitleId?: string | null;
  subtitleName?: string | null;
  isTemporaryCloud?: boolean;
  expiresAt?: string | null;
}

export interface SavedCloudRegistration {
  id: string;
  providerName: string;
  serverHost: string;
  username: string;
  syncPath: string;
  createdAt: string;
  expiresAt: string;
  lastSyncedAt: string | null;
  itemCount: number;
  syncError: string | null;
}

export interface TvNetworkInfo {
  port: number;
  lanIps: string[];
  pcUrls?: string[];
  tvUrls: string[];
  mobileUrls?: string[];
  currentOriginTvUrl: string;
  currentOriginMobileUrl?: string;
  preferredBaseUrl?: string;
}
