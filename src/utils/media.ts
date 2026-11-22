import type {
  CloudEntry,
  CloudPreset,
  FolderTreeNode,
  LocalFileRecord,
  MediaKind,
  SortDirection,
  SortField,
} from '../types/media';

export const CLOUD_PRESETS: CloudPreset[] = [
  {
    id: 'koofr',
    name: 'Koofr',
    freeTier: '10 GB grátis',
    serverUrl: 'https://app.koofr.net/dav/Koofr',
    urlPlaceholder: 'https://app.koofr.net/dav/Koofr',
    usernamePlaceholder: 'seu-email@exemplo.com',
    passwordLabel: 'Senha de Aplicativo (App Password)',
    helpSteps: [
      'Crie uma conta gratuita em koofr.eu (10 GB sem cartão).',
      'No painel do Koofr, abra Perfil -> Preferências -> Senha -> Senhas de aplicativos.',
      'Gere uma nova senha com o nome "NuvemStream" e cole abaixo junto com seu e-mail.',
    ],
  },
  {
    id: 'nextcloud',
    name: 'Nextcloud',
    freeTier: 'Provedores grátis (2–8 GB)',
    serverUrl: '',
    urlPlaceholder: 'https://seu-provedor.com/remote.php/dav/files/SEU_USUARIO',
    usernamePlaceholder: 'seu-usuario',
    passwordLabel: 'Senha ou Senha de Aplicativo',
    helpSteps: [
      'Use um provedor gratuito de Nextcloud (como Disroot, Tab.digital ou servidor próprio).',
      'Em Configurações -> Arquivos (canto inferior esquerdo no Nextcloud), copie sua URL WebDAV.',
      'Cole a URL completa e entre com seu usuário e senha de aplicativo.',
    ],
  },
  {
    id: 'pcloud',
    name: 'pCloud',
    freeTier: '10 GB grátis',
    serverUrl: 'https://webdav.pcloud.com',
    urlPlaceholder: 'https://webdav.pcloud.com (ou https://ewebdav.pcloud.com na Europa)',
    usernamePlaceholder: 'seu-email@exemplo.com',
    passwordLabel: 'Senha do pCloud',
    helpSteps: [
      'Se sua conta pCloud for do servidor europeu, use https://ewebdav.pcloud.com.',
      'Para contas globais (EUA), mantenha https://webdav.pcloud.com.',
      'Nota: contas pCloud com 2FA exigem WebDAV habilitado ou uso via Koofr/Nextcloud.',
    ],
  },
  {
    id: 'custom',
    name: 'Outro WebDAV',
    freeTier: 'HTTPS WebDAV compatível',
    serverUrl: '',
    urlPlaceholder: 'https://servidor.exemplo.com/dav',
    usernamePlaceholder: 'usuario (opcional se público)',
    passwordLabel: 'Senha / Token',
    helpSteps: [
      'Compatível com qualquer nuvem ou NAS pessoal exposto via HTTPS WebDAV.',
      'Informe o endereço completo da pasta raiz WebDAV.',
      'Se o diretório WebDAV for público, os campos de usuário e senha podem ficar vazios.',
    ],
  },
];

const VIDEO_EXTS = new Set(['mp4', 'm4v', 'webm', 'mkv', 'mov', 'avi', 'ogv', 'ts', '3gp']);
const AUDIO_EXTS = new Set(['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'opus', 'wma', 'weba']);
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg', 'avif']);
const SUBTITLE_EXTS = new Set(['vtt', 'srt']);

export function getFileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx <= 0 || idx === name.length - 1) return '';
  return name.slice(idx + 1).toLowerCase();
}

export function getBaseNameWithoutExt(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return name;
  return name.slice(0, idx);
}

export function detectLocalMediaKind(file: File): MediaKind {
  const ext = getFileExtension(file.name);
  const type = (file.type || '').toLowerCase();
  if (VIDEO_EXTS.has(ext) || type.startsWith('video/')) return 'video';
  if (AUDIO_EXTS.has(ext) || type.startsWith('audio/')) return 'audio';
  if (IMAGE_EXTS.has(ext) || type.startsWith('image/')) return 'image';
  if (SUBTITLE_EXTS.has(ext)) return 'subtitle';
  return 'other';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  const formatted = idx === 0 ? `${Math.round(val)}` : val >= 100 ? val.toFixed(0) : val.toFixed(1);
  return `${formatted.replace('.', ',')} ${units[idx]}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

export function formatTimeSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  if (h > 0) {
    return `${h}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export function getMediaTypeLabel(entry: CloudEntry): string {
  if (entry.isFolder) return 'Pasta';
  if (entry.extension) return entry.extension.toUpperCase();
  switch (entry.kind) {
    case 'video':
      return 'Vídeo';
    case 'audio':
      return 'Áudio';
    case 'image':
      return 'Imagem';
    case 'subtitle':
      return 'Legenda';
    default:
      return 'Arquivo';
  }
}

export function sortEntries(entries: CloudEntry[], field: SortField, direction: SortDirection): CloudEntry[] {
  const dir = direction === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    // Keep folders grouped at top when sorting ascending by name or kind
    if (a.isFolder !== b.isFolder) {
      return a.isFolder ? -1 : 1;
    }

    if (field === 'size') {
      if (a.size !== b.size) return (a.size - b.size) * dir;
    } else if (field === 'lastModified') {
      const ta = a.lastModified ? new Date(a.lastModified).getTime() : 0;
      const tb = b.lastModified ? new Date(b.lastModified).getTime() : 0;
      if (ta !== tb) return (ta - tb) * dir;
    } else if (field === 'kind') {
      const ka = getMediaTypeLabel(a);
      const kb = getMediaTypeLabel(b);
      const cmp = ka.localeCompare(kb, 'pt-BR', { sensitivity: 'base' });
      if (cmp !== 0) return cmp * dir;
    }

    return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base', numeric: true }) * dir;
  });
}

export function getParentPath(folderPath: string): string {
  if (!folderPath || folderPath === '/') return '/';
  const clean = folderPath.replace(/\/+$/, '');
  const idx = clean.lastIndexOf('/');
  if (idx <= 0) return '/';
  return clean.slice(0, idx);
}

export function buildBreadcrumbs(folderPath: string): { label: string; path: string }[] {
  const segments = folderPath.split('/').filter(Boolean);
  const crumbs: { label: string; path: string }[] = [{ label: 'Raiz', path: '/' }];
  let current = '';
  for (const seg of segments) {
    current += `/${seg}`;
    crumbs.push({ label: seg, path: current });
  }
  return crumbs;
}

export function convertSrtTextToVtt(srtText: string): string {
  const normalized = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\uFEFF/, '');
  const converted = normalized.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2 --> $3.$4'
  );
  return `WEBVTT\n\n${converted}`;
}

export interface LocalIndex {
  rootLabel: string;
  foldersMap: Map<string, CloudEntry[]>;
  filesByPath: Map<string, LocalFileRecord>;
  tree: FolderTreeNode;
}

export function indexLocalFileList(files: FileList | File[]): LocalIndex {
  const fileArray = Array.from(files);
  const firstRel = (fileArray[0] as File & { webkitRelativePath?: string })?.webkitRelativePath || '';
  const rootLabel = firstRel.includes('/') ? firstRel.split('/')[0] : 'Pasta Local';

  const foldersMap = new Map<string, CloudEntry[]>();
  const filesByPath = new Map<string, LocalFileRecord>();
  const folderSeenInParent = new Map<string, Set<string>>();

  const ensureFolder = (folderPath: string) => {
    if (!foldersMap.has(folderPath)) {
      foldersMap.set(folderPath, []);
    }
    if (!folderSeenInParent.has(folderPath)) {
      folderSeenInParent.set(folderPath, new Set());
    }
  };

  ensureFolder('/');

  for (const file of fileArray) {
    const relRaw = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const parts = relRaw.split('/').filter(Boolean);
    // Strip the top selected folder prefix so / represents the chosen folder
    const innerParts = parts.length > 1 ? parts.slice(1) : parts;
    if (innerParts.length === 0) continue;

    let currentFolder = '/';
    for (let i = 0; i < innerParts.length - 1; i++) {
      const subName = innerParts[i];
      const nextFolder = currentFolder === '/' ? `/${subName}` : `${currentFolder}/${subName}`;
      ensureFolder(currentFolder);
      ensureFolder(nextFolder);

      const seen = folderSeenInParent.get(currentFolder)!;
      if (!seen.has(nextFolder)) {
        seen.add(nextFolder);
        foldersMap.get(currentFolder)!.push({
          name: subName,
          path: nextFolder,
          isFolder: true,
          kind: 'folder',
          size: 0,
          mimeType: 'inode/directory',
          lastModified: null,
          extension: '',
        });
      }
      currentFolder = nextFolder;
    }

    const fileName = innerParts[innerParts.length - 1];
    const filePath = currentFolder === '/' ? `/${fileName}` : `${currentFolder}/${fileName}`;
    const ext = getFileExtension(fileName);
    const entry: CloudEntry = {
      name: fileName,
      path: filePath,
      isFolder: false,
      kind: detectLocalMediaKind(file),
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      lastModified: file.lastModified ? new Date(file.lastModified).toISOString() : null,
      extension: ext,
    };

    ensureFolder(currentFolder);
    foldersMap.get(currentFolder)!.push(entry);
    filesByPath.set(filePath, { entry, file });
  }

  for (const [dirPath, list] of foldersMap.entries()) {
    foldersMap.set(dirPath, sortEntries(list, 'name', 'asc'));
  }

  const buildTree = (dirPath: string, name: string): FolderTreeNode => {
    const childrenEntries = (foldersMap.get(dirPath) || []).filter((e) => e.isFolder);
    return {
      name,
      path: dirPath,
      loaded: true,
      children: childrenEntries.map((child) => buildTree(child.path, child.name)),
    };
  };

  return {
    rootLabel,
    foldersMap,
    filesByPath,
    tree: buildTree('/', rootLabel),
  };
}

export async function readDirectoryHandleRecursively(
  dirHandle: FileSystemDirectoryHandle,
  maxFiles = 4000
): Promise<LocalIndex> {
  const foldersMap = new Map<string, CloudEntry[]>();
  const filesByPath = new Map<string, LocalFileRecord>();
  let totalRead = 0;

  async function walk(handle: FileSystemDirectoryHandle, currentPath: string) {
    const entries: CloudEntry[] = [];
    for await (const [name, childHandle] of handle.entries()) {
      if (totalRead >= maxFiles) break;
      const childPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
      if (childHandle.kind === 'directory') {
        entries.push({
          name,
          path: childPath,
          isFolder: true,
          kind: 'folder',
          size: 0,
          mimeType: 'inode/directory',
          lastModified: null,
          extension: '',
        });
        await walk(childHandle as FileSystemDirectoryHandle, childPath);
      } else {
        totalRead++;
        const file = await (childHandle as FileSystemFileHandle).getFile();
        const ext = getFileExtension(file.name);
        const entry: CloudEntry = {
          name: file.name,
          path: childPath,
          isFolder: false,
          kind: detectLocalMediaKind(file),
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
          lastModified: file.lastModified ? new Date(file.lastModified).toISOString() : null,
          extension: ext,
        };
        entries.push(entry);
        filesByPath.set(childPath, { entry, file });
      }
    }
    foldersMap.set(currentPath, sortEntries(entries, 'name', 'asc'));
  }

  await walk(dirHandle, '/');

  const buildTree = (dirPath: string, name: string): FolderTreeNode => {
    const childrenEntries = (foldersMap.get(dirPath) || []).filter((e) => e.isFolder);
    return {
      name,
      path: dirPath,
      loaded: true,
      children: childrenEntries.map((child) => buildTree(child.path, child.name)),
    };
  };

  return {
    rootLabel: dirHandle.name || 'Pasta do PC',
    foldersMap,
    filesByPath,
    tree: buildTree('/', dirHandle.name || 'Pasta do PC'),
  };
}
