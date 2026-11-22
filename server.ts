import 'dotenv/config';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import express, { type NextFunction, type Request, type Response } from 'express';
import { XMLParser } from 'fast-xml-parser';
import { WebSocket, WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const TICKET_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024; // 5 MB
const TV_STORAGE_DIR = path.resolve(process.cwd(), 'tv-storage');
const TV_FILES_DIR = path.resolve(TV_STORAGE_DIR, 'files');
const TV_CATALOG_FILE = path.resolve(TV_STORAGE_DIR, 'catalog.json');
const TV_PREFERENCES_FILE = path.resolve(TV_STORAGE_DIR, 'preferences.json');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MediaKind = 'folder' | 'video' | 'audio' | 'image' | 'subtitle' | 'other';

interface CloudSession {
  id: string;
  providerName: string;
  baseUrl: string; // normalized without trailing slash
  origin: string;
  basePathname: string; // normalized with leading slash, without trailing slash (or '')
  authHeader: string | null;
  username: string;
  createdAt: number;
  lastAccessAt: number;
}

interface CloudEntry {
  name: string;
  path: string;
  isFolder: boolean;
  kind: MediaKind;
  size: number;
  mimeType: string;
  lastModified: string | null;
  extension: string;
}

interface SavedCloudSyncItem {
  id: string;
  name: string;
  collection: string;
  kind: 'video' | 'audio' | 'image' | 'subtitle';
  extension: string;
  mimeType: string;
  size: number;
  virtualPath: string;
  addedAt: string;
}

interface SavedCloudSync {
  id: string;
  providerName: string;
  serverHost: string;
  baseUrl: string;
  origin: string;
  basePathname: string;
  authHeader: string | null;
  username: string;
  syncPath: string;
  createdAt: number;
  expiresAt: number;
  lastSyncedAt: number | null;
  syncError: string | null;
  syncingPromise: Promise<void> | null;
  pathToId: Map<string, string>;
  items: SavedCloudSyncItem[];
}

interface InstantCloudItem {
  id: string;
  key: string; // `${baseUrl}::${virtualPath}`
  name: string;
  collection: string;
  kind: 'video' | 'audio' | 'image';
  extension: string;
  mimeType: string;
  size: number;
  virtualPath: string;
  subtitleId: string | null;
  subtitleName: string | null;
  subtitleVirtualPath: string | null;
  subtitleExt: string | null;
  providerName: string;
  baseUrl: string;
  origin: string;
  basePathname: string;
  authHeader: string | null;
  addedAt: string;
  expiresAt: number;
}

interface AppPreferences {
  autoSaveCloud: boolean;
  autoSyncPlayback: boolean;
  defaultTtlMinutes: number;
  lastProviderName: string;
  lastServerUrl: string;
  lastUsername: string;
  lastSyncPath: string;
  updatedAt: string | null;
}

interface LivePlaybackState {
  eventId: string;
  itemId: string;
  name: string;
  collection: string;
  kind: 'video' | 'audio' | 'image';
  extension: string;
  size: number;
  subtitleId: string | null;
  subtitleName: string | null;
  senderRole: 'pc' | 'tv';
  senderDeviceId: string;
  action: 'load' | 'play' | 'pause' | 'seek' | 'close';
  currentTime: number;
  isPlaying: boolean;
  updatedAt: number;
}

const sessions = new Map<string, CloudSession>();
const savedCloudSyncs = new Map<string, SavedCloudSync>();
const instantCloudItems = new Map<string, InstantCloudItem>();

// Periodic cleanup of expired sessions and temporary cloud credentials
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastAccessAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
  for (const [id, reg] of savedCloudSyncs.entries()) {
    if (now >= reg.expiresAt) {
      savedCloudSyncs.delete(id);
    }
  }
  for (const [id, item] of instantCloudItems.entries()) {
    if (now >= item.expiresAt) {
      instantCloudItems.delete(id);
    }
  }
}, 60 * 1000).unref();

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

const VIDEO_EXTS = new Set(['mp4', 'm4v', 'webm', 'mkv', 'mov', 'avi', 'ogv', 'ts', '3gp']);
const AUDIO_EXTS = new Set(['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'opus', 'wma', 'weba']);
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg', 'avif']);
const SUBTITLE_EXTS = new Set(['vtt', 'srt']);

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  ogv: 'video/ogg',
  ts: 'video/mp2t',
  '3gp': 'video/3gpp',
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  opus: 'audio/opus',
  wma: 'audio/x-ms-wma',
  weba: 'audio/webm',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  vtt: 'text/vtt; charset=utf-8',
  srt: 'application/x-subrip; charset=utf-8',
};

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx <= 0 || idx === filename.length - 1) return '';
  return filename.slice(idx + 1).toLowerCase();
}

function classifyMediaKind(isFolder: boolean, ext: string, mimeType: string): MediaKind {
  if (isFolder) return 'folder';
  if (VIDEO_EXTS.has(ext) || mimeType.startsWith('video/')) return 'video';
  if (AUDIO_EXTS.has(ext) || mimeType.startsWith('audio/')) return 'audio';
  if (IMAGE_EXTS.has(ext) || mimeType.startsWith('image/')) return 'image';
  if (SUBTITLE_EXTS.has(ext) || mimeType.includes('vtt') || mimeType.includes('subrip')) return 'subtitle';
  return 'other';
}

function isPrivateOrBlockedIp(ip: string): boolean {
  const cleaned = ip.trim().toLowerCase();
  if (!cleaned) return true;

  // Handle IPv4-mapped IPv6 addresses like ::ffff:127.0.0.1
  if (cleaned.startsWith('::ffff:')) {
    const mapped = cleaned.slice(7);
    if (net.isIPv4(mapped)) {
      return isPrivateOrBlockedIp(mapped);
    }
  }

  if (net.isIPv4(cleaned)) {
    const parts = cleaned.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24
    if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast & reserved
    return false;
  }

  if (net.isIPv6(cleaned)) {
    const noZone = cleaned.split('%')[0];
    if (noZone === '::' || noZone === '::1') return true;
    if (noZone.startsWith('fe8') || noZone.startsWith('fe9') || noZone.startsWith('fea') || noZone.startsWith('feb')) {
      return true; // fe80::/10 link-local
    }
    if (noZone.startsWith('fc') || noZone.startsWith('fd')) {
      return true; // fc00::/7 unique local
    }
    if (noZone.startsWith('ff')) {
      return true; // multicast
    }
    return false;
  }

  return true;
}

async function validateExternalHttpsUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('URL do servidor inválida.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Apenas endereços HTTPS seguros são permitidos.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Não inclua usuário ou senha diretamente na URL.');
  }
  if (parsed.port && parsed.port !== '443' && parsed.port !== '8443') {
    throw new Error('Porta de servidor não suportada. Use HTTPS padrão (443 ou 8443).');
  }

  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.arpa')
  ) {
    throw new Error('Endereços locais ou internos não são permitidos.');
  }

  if (net.isIP(host)) {
    if (isPrivateOrBlockedIp(host)) {
      throw new Error('Endereços IP privados ou reservados não são permitidos.');
    }
    return parsed;
  }

  let records: { address: string }[];
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    throw new Error('Não foi possível resolver o domínio do servidor informado.');
  }

  if (!records || records.length === 0) {
    throw new Error('Domínio do servidor sem endereços IP válidos.');
  }

  for (const record of records) {
    if (isPrivateOrBlockedIp(record.address)) {
      throw new Error('O servidor informado aponta para um endereço de rede privado ou bloqueado.');
    }
  }

  return parsed;
}

function normalizeVirtualPath(inputPath: string | undefined | null): string {
  const raw = (inputPath || '/').trim();
  if (raw.includes('\0') || raw.includes('\\')) {
    throw new Error('Caminho inválido.');
  }
  const normalized = path.posix.normalize(raw.startsWith('/') ? raw : `/${raw}`);
  if (normalized.split('/').some((seg) => seg === '..')) {
    throw new Error('Caminho inválido.');
  }
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function buildUpstreamUrl(session: CloudSession, virtualPath: string, isDirectory: boolean): string {
  const cleanPath = normalizeVirtualPath(virtualPath);
  const encodedSegments =
    cleanPath === '/'
      ? []
      : cleanPath
          .slice(1)
          .split('/')
          .filter(Boolean)
          .map((seg) => encodeURIComponent(seg));

  const base = session.baseUrl.replace(/\/+$/, '');
  const suffix = encodedSegments.length > 0 ? `/${encodedSegments.join('/')}` : '';
  const trailing = isDirectory ? '/' : '';
  return `${base}${suffix}${trailing}`;
}

async function fetchWithSafeRedirects(
  initialUrl: string,
  options: RequestInit,
  sessionOrigin: string,
  authHeader: string | null,
  maxRedirects = 3
): Promise<globalThis.Response> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsedCurrent = await validateExternalHttpsUrl(currentUrl);
    const headers = new Headers(options.headers || {});
    if (authHeader && parsedCurrent.origin === sessionOrigin) {
      headers.set('Authorization', authHeader);
    } else {
      headers.delete('Authorization');
    }

    const res = await fetch(currentUrl, {
      ...options,
      headers,
      redirect: 'manual',
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        return res;
      }
      const nextParsed = new URL(location, currentUrl);
      await validateExternalHttpsUrl(nextParsed.toString());
      currentUrl = nextParsed.toString();
      continue;
    }

    return res;
  }

  throw new Error('Muitos redirecionamentos do servidor WebDAV.');
}

function safeDecodePath(rawHref: string): string {
  try {
    if (rawHref.startsWith('http://') || rawHref.startsWith('https://')) {
      const u = new URL(rawHref);
      return decodeURIComponent(u.pathname);
    }
    return decodeURIComponent(rawHref);
  } catch {
    return rawHref;
  }
}

function stripTrailingSlash(p: string): string {
  if (p.length > 1 && p.endsWith('/')) {
    return p.slice(0, -1);
  }
  return p;
}

function parsePropfindXml(xmlText: string, session: CloudSession, requestedVirtualPath: string): CloudEntry[] {
  const parsed = xmlParser.parse(xmlText);
  const multistatus = parsed?.multistatus;
  if (!multistatus) {
    throw new Error('Resposta WebDAV inesperada do servidor.');
  }

  const rawResponses = multistatus.response;
  const responses = Array.isArray(rawResponses) ? rawResponses : rawResponses ? [rawResponses] : [];

  const requestedFullPath = stripTrailingSlash(
    `${session.basePathname}${requestedVirtualPath === '/' ? '' : requestedVirtualPath}` || '/'
  );

  const entries: CloudEntry[] = [];

  for (const item of responses) {
    const rawHref = typeof item?.href === 'string' ? item.href : '';
    if (!rawHref) continue;

    const decodedHref = stripTrailingSlash(safeDecodePath(rawHref)) || '/';

    // Skip the directory itself
    if (decodedHref === requestedFullPath) {
      continue;
    }

    // Extract relative path under session.basePathname
    let relativePath = decodedHref;
    if (session.basePathname && decodedHref.startsWith(session.basePathname)) {
      relativePath = decodedHref.slice(session.basePathname.length) || '/';
    }
    if (!relativePath.startsWith('/')) {
      relativePath = `/${relativePath}`;
    }

    // Ensure item is an immediate child (or valid relative path)
    if (relativePath === requestedVirtualPath) continue;

    const propstats = Array.isArray(item.propstat) ? item.propstat : item.propstat ? [item.propstat] : [];
    const okPropstat =
      propstats.find((ps: Record<string, unknown>) => typeof ps?.status === 'string' && ps.status.includes('200')) ||
      propstats[0];
    const prop = (okPropstat?.prop || {}) as Record<string, unknown>;

    const resourceType = prop.resourcetype as Record<string, unknown> | string | undefined;
    const isFolder =
      Boolean(
        resourceType &&
          typeof resourceType === 'object' &&
          Object.prototype.hasOwnProperty.call(resourceType, 'collection')
      ) || rawHref.endsWith('/');

    const rawDisplayName = typeof prop.displayname === 'string' ? prop.displayname.trim() : '';
    const baseName = path.posix.basename(relativePath);
    const name = rawDisplayName || baseName || 'Sem nome';

    const rawSize = typeof prop.getcontentlength === 'string' ? Number(prop.getcontentlength) : Number(prop.getcontentlength || 0);
    const size = Number.isFinite(rawSize) && rawSize >= 0 ? rawSize : 0;

    const rawMime = typeof prop.getcontenttype === 'string' ? prop.getcontenttype.trim().toLowerCase() : '';
    const ext = isFolder ? '' : getExtension(name);
    const mimeType = rawMime || MIME_BY_EXT[ext] || (isFolder ? 'inode/directory' : 'application/octet-stream');

    let lastModified: string | null = null;
    if (typeof prop.getlastmodified === 'string' && prop.getlastmodified.trim()) {
      const parsedDate = new Date(prop.getlastmodified);
      if (!Number.isNaN(parsedDate.getTime())) {
        lastModified = parsedDate.toISOString();
      }
    }

    entries.push({
      name,
      path: relativePath,
      isFolder,
      kind: classifyMediaKind(isFolder, ext, mimeType),
      size,
      mimeType,
      lastModified,
      extension: ext,
    });
  }

  entries.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base', numeric: true });
  });

  return entries;
}

async function listWebdavDirectory(session: CloudSession, virtualPath: string): Promise<CloudEntry[]> {
  const targetUrl = buildUpstreamUrl(session, virtualPath, true);
  const propfindBody = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
    <D:getcontentlength/>
    <D:getcontenttype/>
    <D:getlastmodified/>
  </D:prop>
</D:propfind>`;

  const res = await fetchWithSafeRedirects(
    targetUrl,
    {
      method: 'PROPFIND',
      headers: {
        Depth: '1',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: propfindBody,
    },
    session.origin,
    session.authHeader
  );

  if (res.status === 401 || res.status === 403) {
    throw new Error('AUTH_FAILED: Usuário ou senha de aplicativo incorretos para este servidor.');
  }
  if (res.status === 404) {
    throw new Error('NOT_FOUND: Pasta não encontrada no servidor em nuvem.');
  }
  if (!res.ok && res.status !== 207) {
    throw new Error(`Servidor WebDAV retornou erro HTTP ${res.status}.`);
  }

  const xmlText = await res.text();
  return parsePropfindXml(xmlText, session, virtualPath);
}

function signTicket(payload: { sid: string; path: string; srt: boolean; exp: number }): string {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifyTicket(token: string): { sid: string; path: string; srt: boolean; exp: number } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (
      typeof parsed?.sid !== 'string' ||
      typeof parsed?.path !== 'string' ||
      typeof parsed?.exp !== 'number' ||
      Date.now() > parsed.exp
    ) {
      return null;
    }
    return {
      sid: parsed.sid,
      path: parsed.path,
      srt: Boolean(parsed.srt),
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

function srtToVtt(srtContent: string): string {
  const normalized = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\uFEFF/, '');
  const vttBody = normalized.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2 --> $3.$4'
  );
  return `WEBVTT\n\n${vttBody}`;
}

interface AuthedRequest extends Request {
  cloudSession?: CloudSession;
}

function requireCloudAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sessão em nuvem ausente ou expirada.' });
    return;
  }
  const token = authHeader.slice(7).trim();
  const session = sessions.get(token);
  if (!session || Date.now() - session.lastAccessAt > SESSION_TTL_MS) {
    if (session) sessions.delete(token);
    res.status(401).json({ error: 'Sessão em nuvem expirada. Conecte novamente.' });
    return;
  }
  session.lastAccessAt = Date.now();
  req.cloudSession = session;
  next();
}

async function startServer() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  function purgeExpiredSavedSyncs() {
    const now = Date.now();
    for (const [id, reg] of savedCloudSyncs.entries()) {
      if (now >= reg.expiresAt) {
        savedCloudSyncs.delete(id);
      }
    }
  }

  function clampTtlMinutes(raw: unknown): number {
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(num)) return 720; // 12h default
    return Math.min(1440, Math.max(15, Math.round(num)));
  }

  function serializeSavedSync(reg: SavedCloudSync) {
    return {
      id: reg.id,
      providerName: reg.providerName,
      serverHost: reg.serverHost,
      username: reg.username,
      syncPath: reg.syncPath,
      createdAt: new Date(reg.createdAt).toISOString(),
      expiresAt: new Date(reg.expiresAt).toISOString(),
      lastSyncedAt: reg.lastSyncedAt ? new Date(reg.lastSyncedAt).toISOString() : null,
      itemCount: reg.items.filter((i) => i.kind !== 'subtitle').length,
      syncError: reg.syncError,
    };
  }

  async function syncSavedCloudLibrary(reg: SavedCloudSync): Promise<void> {
    if (reg.syncingPromise) {
      return reg.syncingPromise;
    }

    const task = (async () => {
      try {
        const tempSession: CloudSession = {
          id: reg.id,
          providerName: reg.providerName,
          baseUrl: reg.baseUrl,
          origin: reg.origin,
          basePathname: reg.basePathname,
          authHeader: reg.authHeader,
          username: reg.username,
          createdAt: reg.createdAt,
          lastAccessAt: Date.now(),
        };

        const queue: string[] = [reg.syncPath];
        const visited = new Set<string>();
        const discovered: SavedCloudSyncItem[] = [];
        const MAX_FOLDERS = 15;
        const MAX_ITEMS = 250;

        while (queue.length > 0 && visited.size < MAX_FOLDERS && discovered.length < MAX_ITEMS) {
          const dirPath = queue.shift()!;
          if (visited.has(dirPath)) continue;
          visited.add(dirPath);

          const entries = await listWebdavDirectory(tempSession, dirPath);
          const dirBase = path.posix.basename(dirPath);
          const collectionLabel =
            dirBase && dirBase !== '/' ? `${reg.providerName} · ${dirBase}` : reg.providerName;

          for (const entry of entries) {
            if (entry.isFolder) {
              if (visited.size + queue.length < MAX_FOLDERS) {
                queue.push(entry.path);
              }
              continue;
            }
            if (
              entry.kind !== 'video' &&
              entry.kind !== 'audio' &&
              entry.kind !== 'image' &&
              entry.kind !== 'subtitle'
            ) {
              continue;
            }
            if (entry.extension === 'svg') continue;

            let stableId = reg.pathToId.get(entry.path);
            if (!stableId) {
              stableId = crypto.randomUUID();
              reg.pathToId.set(entry.path, stableId);
            }

            discovered.push({
              id: stableId,
              name: entry.name,
              collection: collectionLabel,
              kind: entry.kind,
              extension: entry.extension,
              mimeType: entry.mimeType || MIME_BY_EXT[entry.extension] || 'application/octet-stream',
              size: entry.size,
              virtualPath: entry.path,
              addedAt: entry.lastModified || new Date(reg.createdAt).toISOString(),
            });

            if (discovered.length >= MAX_ITEMS) break;
          }
        }

        reg.items = discovered;
        reg.lastSyncedAt = Date.now();
        reg.syncError = null;
      } catch (err) {
        reg.syncError =
          err instanceof Error
            ? err.message.replace(/^(AUTH_FAILED|NOT_FOUND):\s*/, '')
            : 'Erro ao sincronizar pasta da nuvem.';
      } finally {
        reg.syncingPromise = null;
      }
    })();

    reg.syncingPromise = task;
    return task;
  }

  app.post('/api/cloud/connect', async (req, res) => {
    try {
      const serverUrlRaw = typeof req.body?.serverUrl === 'string' ? req.body.serverUrl : '';
      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const providerName =
        typeof req.body?.providerName === 'string' && req.body.providerName.trim()
          ? req.body.providerName.trim().slice(0, 48)
          : 'WebDAV';
      const saveTemporarily = Boolean(req.body?.saveTemporarily);
      const ttlMinutes = clampTtlMinutes(req.body?.ttlMinutes);
      const syncPath = normalizeVirtualPath(
        typeof req.body?.syncPath === 'string' ? req.body.syncPath : '/'
      );

      if (!serverUrlRaw) {
        res.status(400).json({ error: 'Informe a URL do servidor WebDAV (ex: https://app.koofr.net/dav/Koofr).' });
        return;
      }

      const parsedUrl = await validateExternalHttpsUrl(serverUrlRaw);
      const cleanPathname = stripTrailingSlash(parsedUrl.pathname);
      const normalizedBaseUrl = `${parsedUrl.origin}${cleanPathname === '/' ? '' : cleanPathname}`;

      const authHeader =
        username || password
          ? `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
          : null;

      const tempSession: CloudSession = {
        id: crypto.randomBytes(32).toString('hex'),
        providerName,
        baseUrl: normalizedBaseUrl,
        origin: parsedUrl.origin,
        basePathname: cleanPathname === '/' ? '' : cleanPathname,
        authHeader,
        username: username || 'Anônimo',
        createdAt: Date.now(),
        lastAccessAt: Date.now(),
      };

      const rootItems = await listWebdavDirectory(tempSession, '/');
      sessions.set(tempSession.id, tempSession);

      const prefs = await readPreferences();
      const shouldSaveTemporarily =
        typeof req.body?.saveTemporarily === 'boolean'
          ? Boolean(req.body.saveTemporarily)
          : prefs.autoSaveCloud;

      await writePreferences({
        ...prefs,
        lastProviderName: providerName,
        lastServerUrl: normalizedBaseUrl,
        lastUsername: username,
        lastSyncPath: syncPath,
        defaultTtlMinutes: req.body?.ttlMinutes !== undefined ? ttlMinutes : prefs.defaultTtlMinutes,
        updatedAt: new Date().toISOString(),
      });

      let savedRegistration = null;
      if (shouldSaveTemporarily) {
        purgeExpiredSavedSyncs();
        const existingReg = Array.from(savedCloudSyncs.values()).find(
          (r) => r.baseUrl === tempSession.baseUrl && r.username === tempSession.username
        );
        const now = Date.now();
        let reg: SavedCloudSync;
        if (existingReg) {
          existingReg.providerName = tempSession.providerName;
          existingReg.serverHost = parsedUrl.host;
          existingReg.authHeader = tempSession.authHeader;
          existingReg.syncPath = syncPath;
          existingReg.expiresAt = now + ttlMinutes * 60 * 1000;
          reg = existingReg;
        } else {
          reg = {
            id: crypto.randomUUID(),
            providerName: tempSession.providerName,
            serverHost: parsedUrl.host,
            baseUrl: tempSession.baseUrl,
            origin: tempSession.origin,
            basePathname: tempSession.basePathname,
            authHeader: tempSession.authHeader,
            username: tempSession.username,
            syncPath,
            createdAt: now,
            expiresAt: now + ttlMinutes * 60 * 1000,
            lastSyncedAt: null,
            syncError: null,
            syncingPromise: null,
            pathToId: new Map(),
            items: [],
          };
          savedCloudSyncs.set(reg.id, reg);
        }
        await syncSavedCloudLibrary(reg);
        savedRegistration = serializeSavedSync(reg);
        await broadcastCatalogUpdated();
      }

      res.json({
        sessionId: tempSession.id,
        providerName: tempSession.providerName,
        serverHost: parsedUrl.host,
        username: tempSession.username,
        items: rootItems,
        savedRegistration,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao conectar ao serviço em nuvem.';
      const cleanMsg = message.replace(/^(AUTH_FAILED|NOT_FOUND):\s*/, '');
      const status = message.startsWith('AUTH_FAILED') ? 401 : message.startsWith('NOT_FOUND') ? 404 : 400;
      res.status(status).json({ error: cleanMsg });
    }
  });

  app.get('/api/cloud/saved', (_req, res) => {
    purgeExpiredSavedSyncs();
    const list = Array.from(savedCloudSyncs.values()).map(serializeSavedSync);
    res.json({ registrations: list });
  });

  app.post('/api/cloud/saved/from-session', requireCloudAuth, async (req: AuthedRequest, res) => {
    try {
      const session = req.cloudSession!;
      purgeExpiredSavedSyncs();
      const ttlMinutes = clampTtlMinutes(req.body?.ttlMinutes);
      const syncPath = normalizeVirtualPath(
        typeof req.body?.syncPath === 'string' ? req.body.syncPath : '/'
      );
      const serverHost = new URL(session.origin).host;

      // Update existing registration for same host+username or create new one
      const existing = Array.from(savedCloudSyncs.values()).find(
        (r) => r.baseUrl === session.baseUrl && r.username === session.username
      );

      const now = Date.now();
      let reg: SavedCloudSync;
      if (existing) {
        existing.syncPath = syncPath;
        existing.expiresAt = now + ttlMinutes * 60 * 1000;
        existing.authHeader = session.authHeader;
        reg = existing;
      } else {
        reg = {
          id: crypto.randomUUID(),
          providerName: session.providerName,
          serverHost,
          baseUrl: session.baseUrl,
          origin: session.origin,
          basePathname: session.basePathname,
          authHeader: session.authHeader,
          username: session.username,
          syncPath,
          createdAt: now,
          expiresAt: now + ttlMinutes * 60 * 1000,
          lastSyncedAt: null,
          syncError: null,
          syncingPromise: null,
          pathToId: new Map(),
          items: [],
        };
        savedCloudSyncs.set(reg.id, reg);
      }

      await syncSavedCloudLibrary(reg);
      const prefs = await readPreferences();
      await writePreferences({
        ...prefs,
        lastSyncPath: reg.syncPath,
        updatedAt: new Date().toISOString(),
      });
      await broadcastCatalogUpdated();
      res.status(201).json({ registration: serializeSavedSync(reg) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar credenciais temporárias.';
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/cloud/saved/:id/sync', async (req, res) => {
    purgeExpiredSavedSyncs();
    const id = req.params.id;
    const reg = savedCloudSyncs.get(id);
    if (!reg) {
      res.status(404).json({ error: 'Cadastro temporário não encontrado ou expirado.' });
      return;
    }
    if (typeof req.body?.syncPath === 'string' && req.body.syncPath.trim()) {
      try {
        reg.syncPath = normalizeVirtualPath(req.body.syncPath);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Pasta inválida.' });
        return;
      }
    }
    await syncSavedCloudLibrary(reg);
    await broadcastCatalogUpdated();
    res.json({ registration: serializeSavedSync(reg) });
  });

  app.post('/api/cloud/saved/:id/open-session', async (req, res) => {
    purgeExpiredSavedSyncs();
    const id = req.params.id;
    const reg = savedCloudSyncs.get(id);
    if (!reg) {
      res.status(404).json({ error: 'Cadastro temporário não encontrado ou expirado.' });
      return;
    }
    try {
      const newSession: CloudSession = {
        id: crypto.randomBytes(32).toString('hex'),
        providerName: reg.providerName,
        baseUrl: reg.baseUrl,
        origin: reg.origin,
        basePathname: reg.basePathname,
        authHeader: reg.authHeader,
        username: reg.username,
        createdAt: Date.now(),
        lastAccessAt: Date.now(),
      };
      const rootItems = await listWebdavDirectory(newSession, '/');
      sessions.set(newSession.id, newSession);
      res.json({
        sessionId: newSession.id,
        providerName: newSession.providerName,
        serverHost: reg.serverHost,
        username: newSession.username,
        items: rootItems,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao reabrir sessão na nuvem.';
      res.status(502).json({ error: message.replace(/^(AUTH_FAILED|NOT_FOUND):\s*/, '') });
    }
  });

  app.delete('/api/cloud/saved/:id', async (req, res) => {
    const id = req.params.id;
    const deleted = savedCloudSyncs.delete(id);
    if (!deleted) {
      res.status(404).json({ error: 'Cadastro temporário não encontrado.' });
      return;
    }
    await broadcastCatalogUpdated();
    res.json({ ok: true });
  });

  app.get('/api/cloud/list', requireCloudAuth, async (req: AuthedRequest, res) => {
    try {
      const session = req.cloudSession!;
      const rawPath = typeof req.query.path === 'string' ? req.query.path : '/';
      const virtualPath = normalizeVirtualPath(rawPath);
      const items = await listWebdavDirectory(session, virtualPath);
      res.json({ path: virtualPath, items });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao listar pasta na nuvem.';
      const cleanMsg = message.replace(/^(AUTH_FAILED|NOT_FOUND):\s*/, '');
      const status = message.startsWith('AUTH_FAILED') ? 401 : message.startsWith('NOT_FOUND') ? 404 : 502;
      res.status(status).json({ error: cleanMsg });
    }
  });

  app.get('/api/cloud/search', requireCloudAuth, async (req: AuthedRequest, res) => {
    try {
      const session = req.cloudSession!;
      const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const startPath = normalizeVirtualPath(typeof req.query.path === 'string' ? req.query.path : '/');

      if (!query || query.length < 2) {
        res.status(400).json({ error: 'Digite ao menos 2 caracteres para buscar nas pastas.' });
        return;
      }

      // Bounded breadth-first scan across up to 30 folders so large clouds stay responsive
      const queue: string[] = [startPath];
      const visited = new Set<string>();
      const matches: CloudEntry[] = [];
      let scannedFolders = 0;
      const MAX_FOLDERS = 30;

      while (queue.length > 0 && scannedFolders < MAX_FOLDERS) {
        const currentDir = queue.shift()!;
        if (visited.has(currentDir)) continue;
        visited.add(currentDir);
        scannedFolders++;

        let entries: CloudEntry[] = [];
        try {
          entries = await listWebdavDirectory(session, currentDir);
        } catch {
          continue;
        }

        for (const entry of entries) {
          if (entry.name.toLowerCase().includes(query)) {
            matches.push(entry);
          }
          if (entry.isFolder && visited.size + queue.length < MAX_FOLDERS) {
            queue.push(entry.path);
          }
        }
      }

      res.json({
        query,
        scannedFolders,
        truncated: queue.length > 0,
        items: matches,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao pesquisar pastas.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/cloud/ticket', requireCloudAuth, (req: AuthedRequest, res) => {
    try {
      const session = req.cloudSession!;
      const rawPath = typeof req.body?.path === 'string' ? req.body.path : '';
      if (!rawPath) {
        res.status(400).json({ error: 'Caminho do arquivo é obrigatório.' });
        return;
      }
      const virtualPath = normalizeVirtualPath(rawPath);
      const convertSrt = Boolean(req.body?.convertSrt);
      const exp = Date.now() + TICKET_TTL_MS;
      const ticket = signTicket({
        sid: session.id,
        path: virtualPath,
        srt: convertSrt,
        exp,
      });
      res.json({ ticket, expiresAt: exp });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao gerar link de streaming.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/cloud/stream', async (req, res) => {
    try {
      const ticketParam = typeof req.query.ticket === 'string' ? req.query.ticket : '';
      const payload = verifyTicket(ticketParam);
      if (!payload) {
        res.status(401).send('Ticket de streaming inválido ou expirado.');
        return;
      }

      const session = sessions.get(payload.sid);
      if (!session) {
        res.status(401).send('Sessão encerrada.');
        return;
      }
      session.lastAccessAt = Date.now();

      const targetUrl = buildUpstreamUrl(session, payload.path, false);

      if (payload.srt && payload.path.toLowerCase().endsWith('.srt')) {
        const upstream = await fetchWithSafeRedirects(
          targetUrl,
          { method: 'GET' },
          session.origin,
          session.authHeader
        );
        if (!upstream.ok) {
          res.status(upstream.status).send('Não foi possível carregar a legenda.');
          return;
        }
        const contentLen = Number(upstream.headers.get('content-length') || 0);
        if (contentLen > MAX_SUBTITLE_BYTES) {
          res.status(413).send('Arquivo de legenda muito grande.');
          return;
        }
        const srtText = await upstream.text();
        const vtt = srtToVtt(srtText);
        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.send(vtt);
        return;
      }

      const upstreamHeaders: Record<string, string> = {};
      const rangeHeader = req.headers.range;
      if (typeof rangeHeader === 'string' && /^bytes=\d*-\d*(,\s*\d*-\d*)*$/.test(rangeHeader)) {
        upstreamHeaders['Range'] = rangeHeader;
      }

      const upstream = await fetchWithSafeRedirects(
        targetUrl,
        {
          method: 'GET',
          headers: upstreamHeaders,
        },
        session.origin,
        session.authHeader
      );

      if (!upstream.ok && upstream.status !== 206) {
        res.status(upstream.status).send('Erro ao transmitir mídia da nuvem.');
        return;
      }

      const ext = getExtension(payload.path);
      const upstreamType = upstream.headers.get('content-type') || '';
      const resolvedType =
        upstreamType && upstreamType !== 'application/octet-stream'
          ? upstreamType
          : MIME_BY_EXT[ext] || 'application/octet-stream';

      res.status(upstream.status);
      res.setHeader('Content-Type', resolvedType);
      res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
      res.setHeader('Cache-Control', 'private, no-store');

      const contentLength = upstream.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);

      const contentRange = upstream.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);

      if (!upstream.body) {
        res.end();
        return;
      }

      const nodeStream = Readable.fromWeb(upstream.body as unknown as import('stream/web').ReadableStream);
      req.on('close', () => {
        if (!nodeStream.destroyed) {
          nodeStream.destroy();
        }
      });
      nodeStream.on('error', () => {
        if (!res.headersSent) {
          res.status(502).end();
        } else {
          res.end();
        }
      });
      nodeStream.pipe(res);
    } catch {
      if (!res.headersSent) {
        res.status(502).send('Falha na transmissão do arquivo.');
      }
    }
  });

  app.post('/api/cloud/disconnect', requireCloudAuth, (req: AuthedRequest, res) => {
    if (req.cloudSession) {
      sessions.delete(req.cloudSession.id);
    }
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Local Network TV Library (Read-Only for TV, Managed from PC)
  // ---------------------------------------------------------------------------
  await fsPromises.mkdir(TV_FILES_DIR, { recursive: true });

  interface StoredTvRecord {
    id: string;
    name: string;
    collection: string;
    kind: 'video' | 'audio' | 'image' | 'subtitle';
    extension: string;
    mimeType: string;
    size: number;
    storedFilename: string;
    sourceLabel: string;
    addedAt: string;
  }

  let catalogLock: Promise<void> = Promise.resolve();

  function withCatalogLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = catalogLock.then(fn, fn);
    catalogLock = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function readTvCatalog(): Promise<StoredTvRecord[]> {
    try {
      const raw = await fsPromises.readFile(TV_CATALOG_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as StoredTvRecord[]) : [];
    } catch {
      return [];
    }
  }

  async function writeTvCatalog(records: StoredTvRecord[]): Promise<void> {
    const tmpFile = `${TV_CATALOG_FILE}.tmp`;
    await fsPromises.writeFile(tmpFile, JSON.stringify(records, null, 2), 'utf8');
    await fsPromises.rename(tmpFile, TV_CATALOG_FILE);
  }

  function resolveSafeTvFilePath(storedFilename: string): string {
    const cleanName = path.basename(storedFilename);
    const resolved = path.resolve(TV_FILES_DIR, cleanName);
    if (!resolved.startsWith(TV_FILES_DIR + path.sep)) {
      throw new Error('Caminho de arquivo inválido.');
    }
    return resolved;
  }

  function isTvAllowedExt(ext: string): boolean {
    if (!ext || ext === 'svg') return false;
    return VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext) || IMAGE_EXTS.has(ext) || SUBTITLE_EXTS.has(ext);
  }

  function getTvKindFromExt(ext: string): StoredTvRecord['kind'] | null {
    if (VIDEO_EXTS.has(ext)) return 'video';
    if (AUDIO_EXTS.has(ext)) return 'audio';
    if (IMAGE_EXTS.has(ext)) return 'image';
    if (SUBTITLE_EXTS.has(ext)) return 'subtitle';
    return null;
  }

  function getBaseName(filename: string): string {
    const idx = filename.lastIndexOf('.');
    return idx > 0 ? filename.slice(0, idx) : filename;
  }

  function sanitizeLabel(raw: string | undefined | null, fallback: string): string {
    const cleaned = (raw || '').replace(/[\r\n\0<>]/g, ' ').trim().slice(0, 120);
    return cleaned || fallback;
  }

  function getLanIpv4Addresses(): string[] {
    const interfaces = os.networkInterfaces();
    const lanIps: string[] = [];
    for (const entries of Object.values(interfaces)) {
      if (!entries) continue;
      for (const info of entries) {
        if (info.family === 'IPv4' && !info.internal && !info.address.startsWith('169.254.')) {
          lanIps.push(info.address);
        }
      }
    }
    return lanIps;
  }

  // Detect local network IPv4 addresses for connecting Smart TVs and sharing on the same LAN
  app.get('/api/tv/network', (req, res) => {
    const lanIps = getLanIpv4Addresses();
    const hostHeader = typeof req.headers.host === 'string' ? req.headers.host : `localhost:${PORT}`;
    const protocol = req.protocol || 'http';
    const currentOriginBase = `${protocol}://${hostHeader}`;
    const preferredBaseUrl = lanIps.length > 0 ? `http://${lanIps[0]}:${PORT}` : currentOriginBase;
    res.json({
      port: PORT,
      lanIps,
      pcUrls: lanIps.map((ip) => `http://${ip}:${PORT}`),
      tvUrls: lanIps.map((ip) => `http://${ip}:${PORT}/tv`),
      currentOriginTvUrl: `${currentOriginBase}/tv`,
      preferredBaseUrl,
    });
  });

  const DEFAULT_PREFERENCES: AppPreferences = {
    autoSaveCloud: true,
    autoSyncPlayback: true,
    defaultTtlMinutes: 720,
    lastProviderName: 'Koofr',
    lastServerUrl: 'https://app.koofr.net/dav/Koofr',
    lastUsername: '',
    lastSyncPath: '/',
    updatedAt: null,
  };

  async function readPreferences(): Promise<AppPreferences> {
    try {
      const raw = await fsPromises.readFile(TV_PREFERENCES_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AppPreferences>;
      return {
        autoSaveCloud:
          typeof parsed.autoSaveCloud === 'boolean'
            ? parsed.autoSaveCloud
            : DEFAULT_PREFERENCES.autoSaveCloud,
        autoSyncPlayback:
          typeof parsed.autoSyncPlayback === 'boolean'
            ? parsed.autoSyncPlayback
            : DEFAULT_PREFERENCES.autoSyncPlayback,
        defaultTtlMinutes: clampTtlMinutes(parsed.defaultTtlMinutes),
        lastProviderName: sanitizeLabel(parsed.lastProviderName, DEFAULT_PREFERENCES.lastProviderName),
        lastServerUrl:
          typeof parsed.lastServerUrl === 'string' && parsed.lastServerUrl.startsWith('https://')
            ? parsed.lastServerUrl.slice(0, 300)
            : DEFAULT_PREFERENCES.lastServerUrl,
        lastUsername: sanitizeLabel(parsed.lastUsername, ''),
        lastSyncPath:
          typeof parsed.lastSyncPath === 'string' && parsed.lastSyncPath.startsWith('/')
            ? parsed.lastSyncPath.slice(0, 300)
            : '/',
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      };
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }

  async function writePreferences(next: AppPreferences): Promise<void> {
    const tmpFile = `${TV_PREFERENCES_FILE}.tmp`;
    await fsPromises.writeFile(tmpFile, JSON.stringify(next, null, 2), 'utf8');
    await fsPromises.rename(tmpFile, TV_PREFERENCES_FILE);
  }

  function purgeExpiredInstantShares() {
    const now = Date.now();
    for (const [id, item] of instantCloudItems.entries()) {
      if (now >= item.expiresAt) {
        instantCloudItems.delete(id);
      }
    }
  }

  async function buildFullTvCatalog(refreshStaleCloud = false) {
    purgeExpiredSavedSyncs();
    purgeExpiredInstantShares();
    const now = Date.now();
    const activeRegs = Array.from(savedCloudSyncs.values());

    if (refreshStaleCloud) {
      await Promise.all(
        activeRegs.map((reg) => {
          if (!reg.lastSyncedAt || now - reg.lastSyncedAt > 25 * 1000) {
            return syncSavedCloudLibrary(reg);
          }
          return Promise.resolve();
        })
      );
    }

    const records = await readTvCatalog();
    const localSubtitles = records.filter((r) => r.kind === 'subtitle');
    const localMediaItems = records.filter((r) => r.kind !== 'subtitle');

    const matchSubtitleForItem = (
      itemName: string,
      itemCollection: string,
      subs: { id: string; name: string; collection: string; extension: string }[]
    ) => {
      const itemBase = getBaseName(itemName).toLowerCase();
      const matchedSub = subs
        .filter((s) => s.collection.toLowerCase() === itemCollection.toLowerCase())
        .map((s) => {
          const subBase = getBaseName(s.name).toLowerCase();
          let score = 0;
          if (subBase === itemBase) score += 10;
          else if (
            subBase.startsWith(`${itemBase}.`) ||
            subBase.startsWith(`${itemBase}_`) ||
            subBase.startsWith(`${itemBase}-`)
          ) {
            score += 6;
          }
          if (s.extension === 'vtt') score += 2;
          return { s, score };
        })
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.s;

      return matchedSub
        ? { subtitleId: matchedSub.id, subtitleName: matchedSub.name }
        : { subtitleId: null, subtitleName: null };
    };

    const mappedLocal = localMediaItems.map((item) => {
      const sub =
        item.kind === 'video'
          ? matchSubtitleForItem(item.name, item.collection, localSubtitles)
          : { subtitleId: null, subtitleName: null };
      return {
        id: item.id,
        name: item.name,
        collection: item.collection,
        kind: item.kind,
        extension: item.extension,
        mimeType: item.mimeType,
        size: item.size,
        sourceLabel: item.sourceLabel,
        addedAt: item.addedAt,
        subtitleId: sub.subtitleId,
        subtitleName: sub.subtitleName,
        isTemporaryCloud: false,
        expiresAt: null as string | null,
      };
    });

    const mappedCloud = activeRegs.flatMap((reg) => {
      const cloudSubs = reg.items.filter((i) => i.kind === 'subtitle');
      const cloudMedia = reg.items.filter((i) => i.kind !== 'subtitle');
      const expiresIso = new Date(reg.expiresAt).toISOString();

      return cloudMedia.map((item) => {
        const sub =
          item.kind === 'video'
            ? matchSubtitleForItem(item.name, item.collection, cloudSubs)
            : { subtitleId: null, subtitleName: null };
        return {
          id: item.id,
          name: item.name,
          collection: item.collection,
          kind: item.kind,
          extension: item.extension,
          mimeType: item.mimeType,
          size: item.size,
          sourceLabel: `${reg.providerName} (Temporário)`,
          addedAt: item.addedAt,
          subtitleId: sub.subtitleId,
          subtitleName: sub.subtitleName,
          isTemporaryCloud: true,
          expiresAt: expiresIso,
        };
      });
    });

    const seenIds = new Set([...mappedLocal, ...mappedCloud].map((i) => i.id));
    const mappedInstant = Array.from(instantCloudItems.values())
      .filter((item) => !seenIds.has(item.id))
      .map((item) => ({
        id: item.id,
        name: item.name,
        collection: item.collection,
        kind: item.kind,
        extension: item.extension,
        mimeType: item.mimeType,
        size: item.size,
        sourceLabel: `${item.providerName} (Instantâneo)`,
        addedAt: item.addedAt,
        subtitleId: item.subtitleId,
        subtitleName: item.subtitleName,
        isTemporaryCloud: true,
        expiresAt: new Date(item.expiresAt).toISOString(),
      }));

    const items = [...mappedInstant, ...mappedLocal, ...mappedCloud];
    const collections = Array.from(new Set(items.map((i) => i.collection))).sort((a, b) =>
      a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
    );

    return {
      items,
      collections,
      activeCloudSyncs: activeRegs.map((reg) => ({
        id: reg.id,
        providerName: reg.providerName,
        syncPath: reg.syncPath,
        expiresAt: new Date(reg.expiresAt).toISOString(),
        lastSyncedAt: reg.lastSyncedAt ? new Date(reg.lastSyncedAt).toISOString() : null,
        itemCount: reg.items.filter((i) => i.kind !== 'subtitle').length,
      })),
    };
  }

  // Real-time WebSocket Hub (PC <-> TV instant state sync)
  interface WsClientMeta {
    deviceId: string;
    role: 'pc' | 'tv';
    label: string;
    connectedAt: number;
  }

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws/sync',
    maxPayload: 16 * 1024,
  });
  const wsClients = new Map<WebSocket, WsClientMeta>();
  let activePlayback: LivePlaybackState | null = null;

  function getSyncPresence() {
    let pcCount = 0;
    let tvCount = 0;
    for (const meta of wsClients.values()) {
      if (meta.role === 'tv') tvCount++;
      else pcCount++;
    }
    return { pcCount, tvCount, totalCount: pcCount + tvCount };
  }

  function broadcastWs(payload: unknown, excludeSocket?: WebSocket) {
    const serialized = JSON.stringify(payload);
    for (const client of wsClients.keys()) {
      if (client !== excludeSocket && client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  }

  async function broadcastCatalogUpdated() {
    const catalog = await buildFullTvCatalog(false);
    broadcastWs({ type: 'catalog:updated', ...catalog });
  }

  async function applyLivePlaybackEvent(input: {
    itemId: string;
    action: LivePlaybackState['action'];
    currentTime: number;
    isPlaying: boolean;
    senderRole: 'pc' | 'tv';
    senderDeviceId: string;
    excludeSocket?: WebSocket;
  }): Promise<LivePlaybackState | null> {
    if (input.action === 'close') {
      activePlayback = null;
      const closeEvent: LivePlaybackState = {
        eventId: crypto.randomUUID(),
        itemId: input.itemId,
        name: '',
        collection: '',
        kind: 'video',
        extension: '',
        size: 0,
        subtitleId: null,
        subtitleName: null,
        senderRole: input.senderRole,
        senderDeviceId: input.senderDeviceId,
        action: 'close',
        currentTime: 0,
        isPlaying: false,
        updatedAt: Date.now(),
      };
      broadcastWs({ type: 'playback:updated', playback: closeEvent }, input.excludeSocket);
      return closeEvent;
    }

    if (!UUID_RE.test(input.itemId)) return null;
    const catalog = await buildFullTvCatalog(false);
    const target = catalog.items.find((i) => i.id === input.itemId);
    if (!target || target.kind === 'subtitle') return null;

    const nextState: LivePlaybackState = {
      eventId: crypto.randomUUID(),
      itemId: target.id,
      name: target.name,
      collection: target.collection,
      kind: target.kind,
      extension: target.extension,
      size: target.size,
      subtitleId: target.subtitleId || null,
      subtitleName: target.subtitleName || null,
      senderRole: input.senderRole,
      senderDeviceId: input.senderDeviceId,
      action: input.action,
      currentTime: Number.isFinite(input.currentTime) && input.currentTime >= 0 ? input.currentTime : 0,
      isPlaying: Boolean(input.isPlaying),
      updatedAt: Date.now(),
    };

    activePlayback = nextState;
    broadcastWs({ type: 'playback:updated', playback: nextState }, input.excludeSocket);
    return nextState;
  }

  wss.on('connection', (ws) => {
    const defaultMeta: WsClientMeta = {
      deviceId: crypto.randomUUID(),
      role: 'pc',
      label: 'Dispositivo',
      connectedAt: Date.now(),
    };
    wsClients.set(ws, defaultMeta);

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        const type = typeof msg.type === 'string' ? msg.type : '';

        if (type === 'client:hello') {
          const role = msg.role === 'tv' ? 'tv' : 'pc';
          const deviceId =
            typeof msg.deviceId === 'string' && msg.deviceId.trim().length > 0
              ? msg.deviceId.trim().slice(0, 80)
              : defaultMeta.deviceId;
          const label = sanitizeLabel(typeof msg.label === 'string' ? msg.label : '', role === 'tv' ? 'Smart TV' : 'PC');
          wsClients.set(ws, {
            deviceId,
            role,
            label,
            connectedAt: Date.now(),
          });

          const [preferences, catalog] = await Promise.all([
            readPreferences(),
            buildFullTvCatalog(false),
          ]);
          const presence = getSyncPresence();
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'sync:init',
                presence,
                preferences,
                activePlayback,
                catalog,
              })
            );
          }
          broadcastWs({ type: 'presence:updated', presence });
          return;
        }

        if (type === 'playback:sync') {
          const meta = wsClients.get(ws) || defaultMeta;
          const itemId = typeof msg.itemId === 'string' ? msg.itemId : '';
          const actionRaw = typeof msg.action === 'string' ? msg.action : 'load';
          const allowedActions: LivePlaybackState['action'][] = ['load', 'play', 'pause', 'seek', 'close'];
          const action = allowedActions.includes(actionRaw as LivePlaybackState['action'])
            ? (actionRaw as LivePlaybackState['action'])
            : 'load';
          const currentTime = typeof msg.currentTime === 'number' ? msg.currentTime : 0;
          const isPlaying = typeof msg.isPlaying === 'boolean' ? msg.isPlaying : action !== 'pause';

          await applyLivePlaybackEvent({
            itemId,
            action,
            currentTime,
            isPlaying,
            senderRole: meta.role,
            senderDeviceId: meta.deviceId,
            excludeSocket: ws,
          });
        }
      } catch {
        // Ignore malformed WebSocket payloads
      }
    });

    ws.on('close', () => {
      wsClients.delete(ws);
      broadcastWs({ type: 'presence:updated', presence: getSyncPresence() });
    });

    ws.on('error', () => {
      wsClients.delete(ws);
      broadcastWs({ type: 'presence:updated', presence: getSyncPresence() });
    });
  });

  app.get('/api/preferences', async (_req, res) => {
    const preferences = await readPreferences();
    res.json({ preferences });
  });

  app.put('/api/preferences', async (req, res) => {
    try {
      const current = await readPreferences();
      const next: AppPreferences = {
        autoSaveCloud:
          typeof req.body?.autoSaveCloud === 'boolean'
            ? req.body.autoSaveCloud
            : current.autoSaveCloud,
        autoSyncPlayback:
          typeof req.body?.autoSyncPlayback === 'boolean'
            ? req.body.autoSyncPlayback
            : current.autoSyncPlayback,
        defaultTtlMinutes:
          req.body?.defaultTtlMinutes !== undefined
            ? clampTtlMinutes(req.body.defaultTtlMinutes)
            : current.defaultTtlMinutes,
        lastProviderName:
          typeof req.body?.lastProviderName === 'string'
            ? sanitizeLabel(req.body.lastProviderName, current.lastProviderName)
            : current.lastProviderName,
        lastServerUrl: current.lastServerUrl,
        lastUsername: current.lastUsername,
        lastSyncPath:
          typeof req.body?.lastSyncPath === 'string' && req.body.lastSyncPath.startsWith('/')
            ? req.body.lastSyncPath.slice(0, 300)
            : current.lastSyncPath,
        updatedAt: new Date().toISOString(),
      };
      await writePreferences(next);
      broadcastWs({ type: 'preferences:updated', preferences: next });
      res.json({ preferences: next });
    } catch {
      res.status(500).json({ error: 'Não foi possível salvar as preferências automáticas.' });
    }
  });

  app.post('/api/sync/playback', async (req, res) => {
    try {
      const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId : '';
      const senderRole = req.body?.senderRole === 'tv' ? 'tv' : 'pc';
      const senderDeviceId =
        typeof req.body?.senderDeviceId === 'string' && req.body.senderDeviceId.trim()
          ? req.body.senderDeviceId.trim().slice(0, 80)
          : senderRole;
      const actionRaw = typeof req.body?.action === 'string' ? req.body.action : 'load';
      const allowedActions: LivePlaybackState['action'][] = ['load', 'play', 'pause', 'seek', 'close'];
      const action = allowedActions.includes(actionRaw as LivePlaybackState['action'])
        ? (actionRaw as LivePlaybackState['action'])
        : 'load';
      const currentTime = typeof req.body?.currentTime === 'number' ? req.body.currentTime : 0;
      const isPlaying = typeof req.body?.isPlaying === 'boolean' ? req.body.isPlaying : true;

      const event = await applyLivePlaybackEvent({
        itemId,
        action,
        currentTime,
        isPlaying,
        senderRole,
        senderDeviceId,
      });

      if (!event) {
        res.status(404).json({ error: 'Item não encontrado para sincronização.' });
        return;
      }
      res.json({ playback: event });
    } catch {
      res.status(500).json({ error: 'Erro ao sincronizar reprodução.' });
    }
  });

  // Detect local network IPv4 addresses for connecting Smart TVs and sharing on the same LAN
  app.get('/api/tv/network', (req, res) => {
    const lanIps = getLanIpv4Addresses();
    const hostHeader = typeof req.headers.host === 'string' ? req.headers.host : `localhost:${PORT}`;
    const protocol = req.protocol || 'http';
    const currentOriginBase = `${protocol}://${hostHeader}`;
    const preferredBaseUrl = lanIps.length > 0 ? `http://${lanIps[0]}:${PORT}` : currentOriginBase;
    res.json({
      port: PORT,
      lanIps,
      pcUrls: lanIps.map((ip) => `http://${ip}:${PORT}`),
      tvUrls: lanIps.map((ip) => `http://${ip}:${PORT}/tv`),
      currentOriginTvUrl: `${currentOriginBase}/tv`,
      preferredBaseUrl,
    });
  });

  // Read-only TV catalog: merges PC-added items + active temporary cloud library items + instant cloud shares
  app.get('/api/tv/catalog', async (_req, res) => {
    try {
      const catalog = await buildFullTvCatalog(true);
      res.json(catalog);
    } catch {
      res.status(500).json({ error: 'Erro ao ler o catálogo local da TV.' });
    }
  });

  // Zero-copy instant cloud media share (registers cloud file + sibling subtitle in RAM for TV streaming)
  app.post('/api/tv/share-cloud-item', requireCloudAuth, async (req: AuthedRequest, res) => {
    try {
      const session = req.cloudSession!;
      const rawPath = typeof req.body?.path === 'string' ? req.body.path : '';
      if (!rawPath) {
        res.status(400).json({ error: 'Caminho do arquivo na nuvem é obrigatório.' });
        return;
      }
      const virtualPath = normalizeVirtualPath(rawPath);
      const name = sanitizeLabel(
        typeof req.body?.name === 'string' ? req.body.name : path.posix.basename(virtualPath),
        path.posix.basename(virtualPath) || 'midia'
      );
      const ext = getExtension(name);
      const kind = getTvKindFromExt(ext);
      if (!kind || kind === 'subtitle' || !isTvAllowedExt(ext)) {
        res.status(400).json({ error: 'Formato não suportado para compartilhamento na TV.' });
        return;
      }

      const rawSubPath = typeof req.body?.subtitlePath === 'string' ? req.body.subtitlePath : '';
      const subtitleVirtualPath = rawSubPath ? normalizeVirtualPath(rawSubPath) : null;
      const subtitleName =
        subtitleVirtualPath && typeof req.body?.subtitleName === 'string'
          ? sanitizeLabel(req.body.subtitleName, path.posix.basename(subtitleVirtualPath))
          : subtitleVirtualPath
          ? path.posix.basename(subtitleVirtualPath)
          : null;
      const subtitleExt = subtitleVirtualPath ? getExtension(subtitleVirtualPath) : null;

      purgeExpiredInstantShares();
      const dedupeKey = `${session.baseUrl}::${virtualPath}`;
      const existing = Array.from(instantCloudItems.values()).find((i) => i.key === dedupeKey);

      const parentDir = path.posix.basename(path.posix.dirname(virtualPath));
      const collection = sanitizeLabel(
        typeof req.body?.collection === 'string' ? req.body.collection : '',
        parentDir && parentDir !== '/' ? `${session.providerName} · ${parentDir}` : session.providerName
      );

      const size = typeof req.body?.size === 'number' && Number.isFinite(req.body.size) ? req.body.size : 0;
      const mimeType =
        typeof req.body?.mimeType === 'string' && req.body.mimeType
          ? req.body.mimeType
          : MIME_BY_EXT[ext] || 'application/octet-stream';

      const id = existing ? existing.id : crypto.randomUUID();
      const subtitleId = subtitleVirtualPath
        ? existing?.subtitleId || crypto.randomUUID()
        : null;

      const item: InstantCloudItem = {
        id,
        key: dedupeKey,
        name,
        collection,
        kind,
        extension: ext,
        mimeType,
        size,
        virtualPath,
        subtitleId,
        subtitleName,
        subtitleVirtualPath,
        subtitleExt,
        providerName: session.providerName,
        baseUrl: session.baseUrl,
        origin: session.origin,
        basePathname: session.basePathname,
        authHeader: session.authHeader,
        addedAt: existing?.addedAt || new Date().toISOString(),
        expiresAt: Date.now() + 12 * 60 * 60 * 1000,
      };

      instantCloudItems.set(item.id, item);
      await broadcastCatalogUpdated();

      res.status(201).json({
        item: {
          id: item.id,
          name: item.name,
          collection: item.collection,
          kind: item.kind,
          extension: item.extension,
          mimeType: item.mimeType,
          size: item.size,
          sourceLabel: `${item.providerName} (Instantâneo)`,
          addedAt: item.addedAt,
          subtitleId: item.subtitleId,
          subtitleName: item.subtitleName,
          isTemporaryCloud: true,
          expiresAt: new Date(item.expiresAt).toISOString(),
        },
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Erro ao compartilhar item da nuvem na TV.',
      });
    }
  });

  function findCloudSyncItemById(id: string): { reg: SavedCloudSync; item: SavedCloudSyncItem } | null {
    purgeExpiredSavedSyncs();
    for (const reg of savedCloudSyncs.values()) {
      const found = reg.items.find((i) => i.id === id);
      if (found) return { reg, item: found };
    }
    return null;
  }

  function findInstantShareItemById(id: string): InstantCloudItem | null {
    purgeExpiredInstantShares();
    return instantCloudItems.get(id) || null;
  }

  function findInstantShareBySubtitleId(subId: string): InstantCloudItem | null {
    purgeExpiredInstantShares();
    for (const item of instantCloudItems.values()) {
      if (item.subtitleId === subId && item.subtitleVirtualPath) {
        return item;
      }
    }
    return null;
  }

  // Read-only HTTP Range streaming endpoint for TV media playback (local + temporary cloud + instant share)
  app.get('/api/tv/media/:id', async (req, res) => {
    try {
      const id = req.params.id;
      if (!UUID_RE.test(id)) {
        res.status(400).send('Identificador inválido.');
        return;
      }

      const records = await readTvCatalog();
      const record = records.find((r) => r.id === id && r.kind !== 'subtitle');

      if (!record) {
        const cloudMatch = findCloudSyncItemById(id);
        const instantMatch = cloudMatch ? null : findInstantShareItemById(id);

        if ((!cloudMatch || cloudMatch.item.kind === 'subtitle') && !instantMatch) {
          res.status(404).send('Mídia não encontrada no catálogo da TV.');
          return;
        }

        const proxySource = cloudMatch
          ? {
              id: cloudMatch.reg.id,
              providerName: cloudMatch.reg.providerName,
              baseUrl: cloudMatch.reg.baseUrl,
              origin: cloudMatch.reg.origin,
              basePathname: cloudMatch.reg.basePathname,
              authHeader: cloudMatch.reg.authHeader,
              username: cloudMatch.reg.username,
              createdAt: cloudMatch.reg.createdAt,
              virtualPath: cloudMatch.item.virtualPath,
              mimeType: cloudMatch.item.mimeType,
              extension: cloudMatch.item.extension,
            }
          : {
              id: instantMatch!.id,
              providerName: instantMatch!.providerName,
              baseUrl: instantMatch!.baseUrl,
              origin: instantMatch!.origin,
              basePathname: instantMatch!.basePathname,
              authHeader: instantMatch!.authHeader,
              username: 'share',
              createdAt: Date.now(),
              virtualPath: instantMatch!.virtualPath,
              mimeType: instantMatch!.mimeType,
              extension: instantMatch!.extension,
            };

        const tempSession: CloudSession = {
          id: proxySource.id,
          providerName: proxySource.providerName,
          baseUrl: proxySource.baseUrl,
          origin: proxySource.origin,
          basePathname: proxySource.basePathname,
          authHeader: proxySource.authHeader,
          username: proxySource.username,
          createdAt: proxySource.createdAt,
          lastAccessAt: Date.now(),
        };
        const targetUrl = buildUpstreamUrl(tempSession, proxySource.virtualPath, false);
        const upstreamHeaders: Record<string, string> = {};
        const rangeHeader = req.headers.range;
        if (typeof rangeHeader === 'string' && /^bytes=\d*-\d*(,\s*\d*-\d*)*$/.test(rangeHeader)) {
          upstreamHeaders['Range'] = rangeHeader;
        }

        const upstream = await fetchWithSafeRedirects(
          targetUrl,
          { method: 'GET', headers: upstreamHeaders },
          proxySource.origin,
          proxySource.authHeader
        );
        if (!upstream.ok && upstream.status !== 206) {
          res.status(upstream.status || 502).send('Erro ao transmitir mídia temporária da nuvem.');
          return;
        }

        const resolvedType =
          proxySource.mimeType && proxySource.mimeType !== 'application/octet-stream'
            ? proxySource.mimeType
            : MIME_BY_EXT[proxySource.extension] || 'application/octet-stream';

        res.status(upstream.status);
        res.setHeader('Content-Type', resolvedType);
        res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, no-store');

        const contentLength = upstream.headers.get('content-length');
        if (contentLength) res.setHeader('Content-Length', contentLength);
        const contentRange = upstream.headers.get('content-range');
        if (contentRange) res.setHeader('Content-Range', contentRange);

        if (!upstream.body) {
          res.end();
          return;
        }
        const nodeStream = Readable.fromWeb(upstream.body as unknown as import('stream/web').ReadableStream);
        req.on('close', () => {
          if (!nodeStream.destroyed) nodeStream.destroy();
        });
        nodeStream.on('error', () => {
          if (!res.headersSent) res.status(502).end();
          else res.end();
        });
        nodeStream.pipe(res);
        return;
      }

      const filePath = resolveSafeTvFilePath(record.storedFilename);
      const stat = await fsPromises.stat(filePath);
      const totalSize = stat.size;
      const mimeType = record.mimeType || MIME_BY_EXT[record.extension] || 'application/octet-stream';

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=3600');

      const rangeHeader = req.headers.range;
      if (typeof rangeHeader === 'string' && rangeHeader.startsWith('bytes=')) {
        const parts = rangeHeader.replace(/^bytes=/, '').split('-');
        const start = parts[0] ? Number(parts[0]) : 0;
        const end = parts[1] ? Number(parts[1]) : totalSize - 1;

        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start < 0 ||
          end >= totalSize ||
          start > end
        ) {
          res.status(416).setHeader('Content-Range', `bytes */${totalSize}`).end();
          return;
        }

        const chunkSize = end - start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
        res.setHeader('Content-Length', String(chunkSize));

        const stream = fs.createReadStream(filePath, { start, end });
        req.on('close', () => stream.destroy());
        stream.pipe(res);
        return;
      }

      res.status(200);
      res.setHeader('Content-Length', String(totalSize));
      const stream = fs.createReadStream(filePath);
      req.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch {
      if (!res.headersSent) {
        res.status(404).send('Arquivo de mídia indisponível.');
      }
    }
  });

  // Read-only subtitle endpoint (local + temporary cloud + instant share, auto-converts SRT to WebVTT)
  app.get('/api/tv/subtitle/:id', async (req, res) => {
    try {
      const id = req.params.id;
      if (!UUID_RE.test(id)) {
        res.status(400).send('Identificador de legenda inválido.');
        return;
      }
      const records = await readTvCatalog();
      const record = records.find((r) => r.id === id && r.kind === 'subtitle');

      if (!record) {
        const cloudMatch = findCloudSyncItemById(id);
        const instantSubOwner = cloudMatch ? null : findInstantShareBySubtitleId(id);

        if ((!cloudMatch || cloudMatch.item.kind !== 'subtitle') && !instantSubOwner) {
          res.status(404).send('Legenda não encontrada.');
          return;
        }

        const subProxy = cloudMatch
          ? {
              id: cloudMatch.reg.id,
              providerName: cloudMatch.reg.providerName,
              baseUrl: cloudMatch.reg.baseUrl,
              origin: cloudMatch.reg.origin,
              basePathname: cloudMatch.reg.basePathname,
              authHeader: cloudMatch.reg.authHeader,
              username: cloudMatch.reg.username,
              createdAt: cloudMatch.reg.createdAt,
              virtualPath: cloudMatch.item.virtualPath,
              extension: cloudMatch.item.extension,
            }
          : {
              id: instantSubOwner!.id,
              providerName: instantSubOwner!.providerName,
              baseUrl: instantSubOwner!.baseUrl,
              origin: instantSubOwner!.origin,
              basePathname: instantSubOwner!.basePathname,
              authHeader: instantSubOwner!.authHeader,
              username: 'share',
              createdAt: Date.now(),
              virtualPath: instantSubOwner!.subtitleVirtualPath!,
              extension: instantSubOwner!.subtitleExt || 'srt',
            };

        const tempSession: CloudSession = {
          id: subProxy.id,
          providerName: subProxy.providerName,
          baseUrl: subProxy.baseUrl,
          origin: subProxy.origin,
          basePathname: subProxy.basePathname,
          authHeader: subProxy.authHeader,
          username: subProxy.username,
          createdAt: subProxy.createdAt,
          lastAccessAt: Date.now(),
        };
        const targetUrl = buildUpstreamUrl(tempSession, subProxy.virtualPath, false);
        const upstream = await fetchWithSafeRedirects(
          targetUrl,
          { method: 'GET' },
          subProxy.origin,
          subProxy.authHeader
        );
        if (!upstream.ok) {
          res.status(upstream.status).send('Erro ao carregar legenda da nuvem.');
          return;
        }
        const len = Number(upstream.headers.get('content-length') || 0);
        if (len > MAX_SUBTITLE_BYTES) {
          res.status(413).send('Arquivo de legenda muito grande.');
          return;
        }
        const rawText = await upstream.text();
        const vttText = subProxy.extension === 'srt' ? srtToVtt(rawText) : rawText;
        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.send(vttText);
        return;
      }

      const filePath = resolveSafeTvFilePath(record.storedFilename);
      const stat = await fsPromises.stat(filePath);
      if (stat.size > MAX_SUBTITLE_BYTES) {
        res.status(413).send('Arquivo de legenda muito grande.');
        return;
      }

      const rawText = await fsPromises.readFile(filePath, 'utf8');
      const vttText = record.extension === 'srt' ? srtToVtt(rawText) : rawText;
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(vttText);
    } catch {
      res.status(404).send('Erro ao ler legenda.');
    }
  });

  // Add local PC file directly into the LAN TV catalog (streams directly to disk)
  app.post('/api/tv/upload', async (req, res) => {
    const rawFileNameHeader = typeof req.headers['x-file-name'] === 'string' ? req.headers['x-file-name'] : '';
    const rawCollectionHeader =
      typeof req.headers['x-collection-name'] === 'string' ? req.headers['x-collection-name'] : '';
    const rawMimeHeader = typeof req.headers['x-mime-type'] === 'string' ? req.headers['x-mime-type'] : '';

    let decodedName = '';
    let decodedCollection = '';
    try {
      decodedName = path.basename(decodeURIComponent(rawFileNameHeader));
      decodedCollection = decodeURIComponent(rawCollectionHeader);
    } catch {
      res.status(400).json({ error: 'Nome do arquivo inválido.' });
      return;
    }

    const safeName = sanitizeLabel(decodedName, 'arquivo');
    const safeCollection = sanitizeLabel(decodedCollection, 'Adicionados do PC');
    const ext = getExtension(safeName);
    const kind = getTvKindFromExt(ext);

    if (!isTvAllowedExt(ext) || !kind) {
      res.status(400).json({
        error: 'Formato não suportado para TV. Envie vídeos, músicas, fotos ou legendas (.srt/.vtt).',
      });
      return;
    }

    const id = crypto.randomUUID();
    const storedFilename = `${id}.${ext}`;
    const destPath = resolveSafeTvFilePath(storedFilename);

    let totalBytes = 0;
    const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB limit per file
    const writeStream = fs.createWriteStream(destPath);
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_UPLOAD_BYTES && !aborted) {
        aborted = true;
        writeStream.destroy();
        req.destroy();
      }
    });

    try {
      await pipeline(req, writeStream);
      if (aborted || totalBytes === 0) {
        await fsPromises.unlink(destPath).catch(() => undefined);
        res.status(400).json({ error: 'Arquivo vazio ou excedeu o limite permitido.' });
        return;
      }

      const record: StoredTvRecord = {
        id,
        name: safeName,
        collection: safeCollection,
        kind,
        extension: ext,
        mimeType: MIME_BY_EXT[ext] || sanitizeLabel(rawMimeHeader, 'application/octet-stream'),
        size: totalBytes,
        storedFilename,
        sourceLabel: 'PC Local',
        addedAt: new Date().toISOString(),
      };

      await withCatalogLock(async () => {
        const current = await readTvCatalog();
        current.unshift(record);
        await writeTvCatalog(current);
      });

      await broadcastCatalogUpdated();

      res.status(201).json({
        item: {
          id: record.id,
          name: record.name,
          collection: record.collection,
          kind: record.kind,
          extension: record.extension,
          mimeType: record.mimeType,
          size: record.size,
          sourceLabel: record.sourceLabel,
          addedAt: record.addedAt,
        },
      });
    } catch {
      await fsPromises.unlink(destPath).catch(() => undefined);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Falha ao salvar mídia na biblioteca da TV.' });
      }
    }
  });

  // Copy an item from an authenticated Koofr/WebDAV session to the LAN TV library
  app.post('/api/tv/import-cloud', requireCloudAuth, async (req: AuthedRequest, res) => {
    try {
      const session = req.cloudSession!;
      const rawPath = typeof req.body?.path === 'string' ? req.body.path : '';
      const rawCollection = typeof req.body?.collection === 'string' ? req.body.collection : '';
      if (!rawPath) {
        res.status(400).json({ error: 'Caminho do arquivo na nuvem é obrigatório.' });
        return;
      }

      const virtualPath = normalizeVirtualPath(rawPath);
      const fileName = sanitizeLabel(path.posix.basename(virtualPath), 'midia');
      const ext = getExtension(fileName);
      const kind = getTvKindFromExt(ext);
      if (!isTvAllowedExt(ext) || !kind) {
        res.status(400).json({ error: 'Formato não suportado para reprodução na TV.' });
        return;
      }

      const targetUrl = buildUpstreamUrl(session, virtualPath, false);
      const upstream = await fetchWithSafeRedirects(
        targetUrl,
        { method: 'GET' },
        session.origin,
        session.authHeader
      );

      if (!upstream.ok || !upstream.body) {
        res.status(upstream.status || 502).json({ error: 'Não foi possível ler o arquivo da nuvem.' });
        return;
      }

      const id = crypto.randomUUID();
      const storedFilename = `${id}.${ext}`;
      const destPath = resolveSafeTvFilePath(storedFilename);

      const nodeStream = Readable.fromWeb(upstream.body as unknown as import('stream/web').ReadableStream);
      await pipeline(nodeStream, fs.createWriteStream(destPath));
      const stat = await fsPromises.stat(destPath);

      const parentDirName = path.posix.basename(path.posix.dirname(virtualPath));
      const collection = sanitizeLabel(
        rawCollection,
        parentDirName && parentDirName !== '/' ? parentDirName : session.providerName
      );

      const record: StoredTvRecord = {
        id,
        name: fileName,
        collection,
        kind,
        extension: ext,
        mimeType: MIME_BY_EXT[ext] || 'application/octet-stream',
        size: stat.size,
        storedFilename,
        sourceLabel: session.providerName,
        addedAt: new Date().toISOString(),
      };

      await withCatalogLock(async () => {
        const current = await readTvCatalog();
        current.unshift(record);
        await writeTvCatalog(current);
      });

      await broadcastCatalogUpdated();

      res.status(201).json({
        item: {
          id: record.id,
          name: record.name,
          collection: record.collection,
          kind: record.kind,
          extension: record.extension,
          mimeType: record.mimeType,
          size: record.size,
          sourceLabel: record.sourceLabel,
          addedAt: record.addedAt,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao enviar arquivo da nuvem para a TV.';
      res.status(500).json({ error: msg });
    }
  });

  // Remove item from the LAN TV library (only accessible from management panel)
  app.delete('/api/tv/items/:id', async (req, res) => {
    try {
      const id = req.params.id;
      if (!UUID_RE.test(id)) {
        res.status(400).json({ error: 'Identificador inválido.' });
        return;
      }

      let removed: StoredTvRecord | undefined;
      await withCatalogLock(async () => {
        const current = await readTvCatalog();
        removed = current.find((r) => r.id === id);
        if (!removed) return;
        const remaining = current.filter((r) => r.id !== id);
        await writeTvCatalog(remaining);
      });

      if (!removed) {
        if (instantCloudItems.delete(id)) {
          await broadcastCatalogUpdated();
          res.json({ ok: true });
          return;
        }
        res.status(404).json({ error: 'Item não encontrado.' });
        return;
      }

      const filePath = resolveSafeTvFilePath(removed.storedFilename);
      await fsPromises.unlink(filePath).catch(() => undefined);
      await broadcastCatalogUpdated();
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Erro ao remover item da biblioteca da TV.' });
    }
  });

  // ---------------------------------------------------------------------------
  // Windows Desktop Package (.zip with 1-click Launcher & .EXE Compiler Script)
  // ---------------------------------------------------------------------------
  const crc32Table = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function computeCrc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = crc32Table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function buildZipBuffer(entries: { name: string; data: Buffer }[]): Buffer {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBuf = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
      const crc = computeCrc32(entry.data);
      const size = entry.data.length;

      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4); // version needed
      localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
      localHeader.writeUInt16LE(0, 8); // store (no compression)
      localHeader.writeUInt16LE(0, 10);
      localHeader.writeUInt16LE(0, 12);
      localHeader.writeUInt32LE(crc, 14);
      localHeader.writeUInt32LE(size, 18);
      localHeader.writeUInt32LE(size, 22);
      localHeader.writeUInt16LE(nameBuf.length, 26);
      localHeader.writeUInt16LE(0, 28);

      localParts.push(localHeader, nameBuf, entry.data);

      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4);
      centralHeader.writeUInt16LE(20, 6);
      centralHeader.writeUInt16LE(0x0800, 8);
      centralHeader.writeUInt16LE(0, 10);
      centralHeader.writeUInt16LE(0, 12);
      centralHeader.writeUInt16LE(0, 14);
      centralHeader.writeUInt32LE(crc, 16);
      centralHeader.writeUInt32LE(size, 20);
      centralHeader.writeUInt32LE(size, 24);
      centralHeader.writeUInt16LE(nameBuf.length, 28);
      centralHeader.writeUInt16LE(0, 30);
      centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34);
      centralHeader.writeUInt16LE(0, 36);
      centralHeader.writeUInt32LE(0, 38);
      centralHeader.writeUInt32LE(offset, 42);

      centralParts.push(centralHeader, nameBuf);
      offset += localHeader.length + nameBuf.length + entry.data.length;
    }

    const centralDirBuf = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralDirBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, centralDirBuf, eocd]);
  }

  async function collectProjectFiles(
    rootDir: string,
    relDir: string,
    out: { name: string; data: Buffer }[]
  ): Promise<void> {
    const absDir = path.resolve(rootDir, relDir);
    if (absDir !== rootDir && !absDir.startsWith(rootDir + path.sep)) return;
    const dirents = await fsPromises.readdir(absDir, { withFileTypes: true });
    for (const dirent of dirents) {
      if (
        dirent.name === 'node_modules' ||
        dirent.name === 'tv-storage' ||
        dirent.name === '.git' ||
        dirent.name === 'dist' ||
        dirent.name.startsWith('.env')
      ) {
        continue;
      }
      const childRel = relDir ? `${relDir}/${dirent.name}` : dirent.name;
      const childAbs = path.resolve(rootDir, childRel);
      if (!childAbs.startsWith(rootDir + path.sep)) continue;

      if (dirent.isDirectory()) {
        await collectProjectFiles(rootDir, childRel, out);
      } else if (dirent.isFile()) {
        const data = await fsPromises.readFile(childAbs);
        out.push({ name: `NuvemStream/${childRel}`, data });
      }
    }
  }

  app.get('/api/desktop/download', async (_req, res) => {
    try {
      const projectRoot = path.resolve(process.cwd());
      const zipEntries: { name: string; data: Buffer }[] = [];

      const allowedTopFiles = [
        'package.json',
        'tsconfig.json',
        'vite.config.ts',
        'index.html',
        'metadata.json',
        'server.ts',
      ];

      for (const fileName of allowedTopFiles) {
        const absFile = path.resolve(projectRoot, fileName);
        if (absFile.startsWith(projectRoot + path.sep)) {
          try {
            const data = await fsPromises.readFile(absFile);
            zipEntries.push({ name: `NuvemStream/${fileName}`, data });
          } catch {
            // Skip missing optional file
          }
        }
      }

      await collectProjectFiles(projectRoot, 'src', zipEntries);

      const startBat = `@echo off
setlocal enabledelayedexpansion
title NuvemStream PC & TV - Roteador Local
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale o Node.js 20+ em https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando dependencias iniciais...
  call npm install
)

if not exist "dist\\index.html" (
  echo Compilando interface do NuvemStream...
  call npm run build
)

echo.
echo ===================================================
echo   NuvemStream iniciado com roteamento local na rede
echo   Modo PC: http://localhost:3000
echo   Modo TV: http://SEU_IP_LOCAL:3000/tv
echo ===================================================
echo.

start "" cmd /c "timeout /t 2 /nobreak >nul && (start msedge --app=http://localhost:3000 2>nul || start chrome --app=http://localhost:3000 2>nul || start http://localhost:3000)"
set NODE_ENV=production
call npx tsx server.ts
pause
`;

      const buildExeBat = `@echo off
setlocal
title Gerar NuvemStream.exe para Windows
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale o Node.js 20+ em https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando dependencias...
  call npm install
)

echo [1/3] Compilando interface web...
call npm run build
if errorlevel 1 pause & exit /b 1

echo [2/3] Empacotando servidor para Windows...
call npx esbuild server.ts --bundle --platform=node --format=cjs --outfile=nuvemstream-bundle.cjs
if errorlevel 1 pause & exit /b 1

echo [3/3] Gerando executavel NuvemStream.exe...
call npx @yao-pkg/pkg nuvemstream-bundle.cjs --targets node22-win-x64 --output NuvemStream.exe --public
if errorlevel 1 (
  echo.
  echo Falha ao gerar .exe com pkg. Voce ainda pode iniciar o app pelo Iniciar-NuvemStream.bat.
  pause
  exit /b 1
)

echo.
echo Concluido! Arquivo NuvemStream.exe criado nesta pasta.
echo Mantenha a pasta "dist" junto ao NuvemStream.exe ao mover ou criar atalho.
pause
`;

      const readmeTxt = `NuvemStream para Windows (PC + Smart TV na Rede Local)
=====================================================

COMO USAR RAPIDAMENTE NO WINDOWS:
1. Extraia esta pasta para o local desejado (ex: C:\\NuvemStream).
2. Clique duas vezes em "Iniciar-NuvemStream.bat".
   - O aplicativo inicia o roteamento local na porta 3000 e abre em janela dedicada no PC.
   - Na aba "TV na Rede Local -> Biblioteca da TV", copie o endereco http://192.168.x.x:3000/tv
     e abra no navegador da sua Smart TV conectada ao mesmo Wi-Fi.

COMO GERAR O EXECUTAVEL NuvemStream.exe:
1. Execute "Gerar-NuvemStream-EXE.bat".
2. O script compila a interface, empacota o servidor e gera o arquivo "NuvemStream.exe"
   na mesma pasta (requer Node.js 20+ instalado durante a compilacao).
3. Depois de gerado, voce pode criar um atalho para NuvemStream.exe na Area de Trabalho.
`;

      zipEntries.push(
        { name: 'NuvemStream/Iniciar-NuvemStream.bat', data: Buffer.from(startBat.replace(/\n/g, '\r\n'), 'utf8') },
        {
          name: 'NuvemStream/Gerar-NuvemStream-EXE.bat',
          data: Buffer.from(buildExeBat.replace(/\n/g, '\r\n'), 'utf8'),
        },
        { name: 'NuvemStream/README-WINDOWS.txt', data: Buffer.from(readmeTxt.replace(/\n/g, '\r\n'), 'utf8') }
      );

      const zipBuf = buildZipBuffer(zipEntries);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="NuvemStream-Windows.zip"');
      res.setHeader('Content-Length', String(zipBuf.length));
      res.send(zipBuf);
    } catch {
      res.status(500).json({ error: 'Não foi possível gerar o pacote Windows.' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    const lanIps = getLanIpv4Addresses();
    console.log(`NuvemStream server listening on http://localhost:${PORT}`);
    if (lanIps.length > 0) {
      for (const ip of lanIps) {
        console.log(`Roteamento Local (LAN): PC -> http://${ip}:${PORT} | TV -> http://${ip}:${PORT}/tv`);
      }
    }
  });
}

startServer();
