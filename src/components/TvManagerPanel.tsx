import React, { useRef, useState } from 'react';
import {
  Check,
  Clock,
  Cloud,
  Copy,
  Film,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Music,
  Plus,
  RefreshCw,
  Smartphone,
  Trash2,
  Tv,
  Upload,
  Wifi,
} from 'lucide-react';
import type { SavedCloudRegistration, SyncPresence, TvCatalogItem, TvNetworkInfo } from '../types/media';
import { formatBytes, formatDate } from '../utils/media';

interface TvManagerPanelProps {
  items: TvCatalogItem[];
  networkInfo: TvNetworkInfo | null;
  presence?: SyncPresence;
  isUploading: boolean;
  uploadStatus: string | null;
  onUploadFiles: (files: FileList, collectionName?: string) => Promise<void>;
  onRemoveItem: (id: string) => Promise<void>;
  onOpenTvMode: () => void;
  onOpenMobileMode: () => void;
  savedRegistrations: SavedCloudRegistration[];
  isSyncingCloudId: string | null;
  onSyncSavedCloud: (id: string, syncPath?: string) => Promise<void>;
  onOpenSavedSession: (id: string) => Promise<void>;
  onDeleteSavedCloud: (id: string) => Promise<void>;
  onOpenConnectCloud: () => void;
}

function formatExpirationCountdown(expiresAtIso: string): string {
  const diffMs = new Date(expiresAtIso).getTime() - Date.now();
  if (diffMs <= 0) return 'Expirado';
  const totalMinutes = Math.max(1, Math.round(diffMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0 && mins > 0) return `Expira em ${hours}h ${mins}m`;
  if (hours > 0) return `Expira em ${hours}h`;
  return `Expira em ${mins}m`;
}

export const TvManagerPanel: React.FC<TvManagerPanelProps> = ({
  items,
  networkInfo,
  presence,
  isUploading,
  uploadStatus,
  onUploadFiles,
  onRemoveItem,
  onOpenTvMode,
  onOpenMobileMode,
  savedRegistrations,
  isSyncingCloudId,
  onSyncSavedCloud,
  onOpenSavedSession,
  onDeleteSavedCloud,
  onOpenConnectCloud,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [collectionInput, setCollectionInput] = useState('');
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [syncPathDrafts, setSyncPathDrafts] = useState<Record<string, string>>({});

  const displayTvUrls =
    networkInfo?.tvUrls && networkInfo.tvUrls.length > 0
      ? networkInfo.tvUrls
      : networkInfo?.currentOriginTvUrl
      ? [networkInfo.currentOriginTvUrl]
      : [];

  const displayMobileUrls =
    networkInfo?.mobileUrls && networkInfo.mobileUrls.length > 0
      ? networkInfo.mobileUrls
      : networkInfo?.currentOriginMobileUrl
      ? [networkInfo.currentOriginMobileUrl]
      : [];

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      window.setTimeout(() => setCopiedUrl(null), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <div className="space-y-6">
      {/* Hidden inputs for PC files or full folder upload to TV LAN library */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*,audio/*,image/*,.mkv,.avi,.ts,.srt,.vtt,.flac"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void onUploadFiles(e.target.files, collectionInput.trim() || undefined);
          }
          e.target.value = '';
        }}
        className="hidden"
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory supported on desktop browsers
        webkitdirectory=""
        directory=""
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void onUploadFiles(e.target.files, collectionInput.trim() || undefined);
          }
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Header Card: LAN Address + TV & Mobile Launch */}
      <div className="rounded-xl border border-slate-800 bg-[#111827] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-sky-400">
              <Wifi className="h-4 w-4" />
              <span>Central de Configuração no PC · Streaming Individual por Tela</span>
              {presence && (
                <span className="font-mono text-[11px] font-normal text-slate-400 tabular-nums">
                  ({presence.tvCount} TV · {presence.mobileCount} Celular)
                </span>
              )}
            </div>
            <h1 className="mt-1.5 text-xl font-bold text-slate-100">
              Biblioteca da TV e Celular (Somente Leitura)
            </h1>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Todo conteúdo e nuvem é configurado apenas aqui no PC. Ao adicionar uma nuvem ou pasta, a TV e o celular atualizam a biblioteca na hora, reproduzindo cada vídeo de forma independente sem acesso às configurações do computador.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenTvMode}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-sky-500 whitespace-nowrap"
            >
              <Tv className="h-4 w-4" />
              <span>Abrir App da TV</span>
            </button>
            <button
              type="button"
              onClick={onOpenMobileMode}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-xs font-semibold text-slate-100 transition-colors hover:bg-slate-800 whitespace-nowrap"
            >
              <Smartphone className="h-4 w-4 text-sky-400" />
              <span>Abrir App do Celular</span>
            </button>
          </div>
        </div>

        {(displayTvUrls.length > 0 || displayMobileUrls.length > 0) && (
          <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {displayTvUrls.length > 0 && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-300">
                  <Tv className="h-3.5 w-3.5 text-sky-400" />
                  <span>Endereço para Smart TV (mesma rede Wi-Fi):</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {displayTvUrls.map((url) => (
                    <div
                      key={url}
                      className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5"
                    >
                      <span className="font-mono text-xs text-sky-300">{url}</span>
                      <button
                        type="button"
                        onClick={() => void handleCopy(url)}
                        aria-label={`Copiar ${url}`}
                        className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                      >
                        {copiedUrl === url ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {displayMobileUrls.length > 0 && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-300">
                  <Smartphone className="h-3.5 w-3.5 text-sky-400" />
                  <span>Endereço para Celular (navegador do smartphone):</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {displayMobileUrls.map((url) => (
                    <div
                      key={url}
                      className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5"
                    >
                      <span className="font-mono text-xs text-sky-300">{url}</span>
                      <button
                        type="button"
                        onClick={() => void handleCopy(url)}
                        aria-label={`Copiar ${url}`}
                        className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                      >
                        {copiedUrl === url ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Temporary Cloud Registrations Card */}
      <div className="rounded-xl border border-slate-800 bg-[#111827] p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-sky-400">
              <Clock className="h-4 w-4" />
              <span>Salvamento Temporário em Memória</span>
            </div>
            <h2 className="mt-1 text-sm font-semibold text-slate-100">
              Nuvens Cadastradas (Sincronização Automática com a TV)
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              As credenciais ficam apenas na memória RAM do PC até o vencimento e nunca são gravadas em disco.
            </p>
          </div>

          <button
            type="button"
            onClick={onOpenConnectCloud}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-100 transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Cloud className="h-3.5 w-3.5 text-sky-400" />
            <span>Cadastrar Nuvem Temporária</span>
          </button>
        </div>

        {savedRegistrations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-800 bg-slate-950/50 px-4 py-6 text-center text-xs text-slate-400">
            Nenhuma conta em nuvem cadastrada temporariamente. Conecte o Koofr ou outro servidor WebDAV marcando &ldquo;Salvar credenciais temporariamente&rdquo; para atualizar a TV automaticamente.
          </div>
        ) : (
          <div className="space-y-3">
            {savedRegistrations.map((reg) => {
              const pathValue = syncPathDrafts[reg.id] ?? reg.syncPath;
              const isSyncing = isSyncingCloudId === reg.id;
              return (
                <div
                  key={reg.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/70 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-100">
                        {reg.providerName}
                        <span className="mx-1.5 text-slate-600" aria-hidden="true">·</span>
                        <span className="font-mono text-xs font-normal text-slate-300">{reg.username}</span>
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        <span className="font-mono">{reg.serverHost}</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{reg.itemCount} mídias</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span className="font-mono text-sky-400 tabular-nums">
                          {formatExpirationCountdown(reg.expiresAt)}
                        </span>
                        {reg.lastSyncedAt && (
                          <>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              Atualizado em {formatDate(reg.lastSyncedAt)}
                            </span>
                          </>
                        )}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={isSyncing}
                        onClick={() => void onSyncSavedCloud(reg.id, pathValue)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50 whitespace-nowrap"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                        <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void onOpenSavedSession(reg.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 whitespace-nowrap"
                      >
                        <FolderOpen className="h-3.5 w-3.5 text-slate-400" />
                        <span>Abrir no PC</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteSavedCloud(reg.id)}
                        aria-label={`Remover cadastro ${reg.providerName}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:border-red-900/60 hover:bg-red-950/40 hover:text-red-300 whitespace-nowrap"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Remover</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label
                      htmlFor={`sync-path-${reg.id}`}
                      className="text-[11px] font-medium text-slate-400 shrink-0"
                    >
                      Pasta monitorada:
                    </label>
                    <input
                      id={`sync-path-${reg.id}`}
                      type="text"
                      value={pathValue}
                      onChange={(e) =>
                        setSyncPathDrafts((prev) => ({ ...prev, [reg.id]: e.target.value }))
                      }
                      placeholder="/"
                      className="min-w-[180px] flex-1 max-w-sm rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1 font-mono text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                    />
                  </div>

                  {reg.syncError && (
                    <div
                      role="alert"
                      className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-200"
                    >
                      {reg.syncError}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Content Controls */}
      <div className="rounded-xl border border-slate-800 bg-[#111827] p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-[220px] flex-1 max-w-sm">
            <label htmlFor="tv-collection-input" className="mb-1.5 block text-xs font-medium text-slate-300">
              Nome da Coleção na TV (opcional)
            </label>
            <input
              id="tv-collection-input"
              type="text"
              value={collectionInput}
              onChange={(e) => setCollectionInput(e.target.value)}
              placeholder="Ex: Filmes de Domingo, Músicas..."
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              <span>Adicionar Arquivos do PC</span>
            </button>
            <button
              type="button"
              disabled={isUploading}
              onClick={() => folderInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
            >
              <FolderPlus className="h-4 w-4 text-slate-400" />
              <span>Adicionar Pasta do PC</span>
            </button>
          </div>
        </div>

        {uploadStatus && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-sky-900/50 bg-sky-950/30 px-3.5 py-2.5 text-xs text-sky-200">
            <Upload className="h-3.5 w-3.5 shrink-0" />
            <span>{uploadStatus}</span>
          </div>
        )}
      </div>

      {/* Added Items Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#111827]">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">
            Itens Disponíveis na TV
          </h2>
          <span className="font-mono text-xs text-slate-400 tabular-nums">
            {items.length} {items.length === 1 ? 'item' : 'itens'}
          </span>
        </div>

        {items.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <Tv className="mx-auto h-9 w-9 text-slate-600" />
            <p className="mt-3 text-sm font-medium text-slate-200">
              A lista da TV está vazia
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Adicione arquivos acima, cadastre uma nuvem temporária ou clique em &ldquo;TV&rdquo; ao navegar pelas suas pastas.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Arquivo</th>
                  <th className="px-4 py-2.5 font-medium">Coleção</th>
                  <th className="px-4 py-2.5 font-medium">Origem</th>
                  <th className="px-4 py-2.5 text-right font-medium">Tamanho</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Adicionado</th>
                  <th className="w-32 px-4 py-2.5 text-right font-medium">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {items.map((item) => (
                  <tr key={item.id} className="h-11 hover:bg-slate-800/40">
                    <td className="max-w-xs px-4 py-2">
                      <div className="flex items-center gap-2.5">
                        {item.kind === 'video' ? (
                          <Film className="h-4 w-4 shrink-0 text-sky-400" />
                        ) : item.kind === 'audio' ? (
                          <Music className="h-4 w-4 shrink-0 text-sky-400" />
                        ) : (
                          <ImageIcon className="h-4 w-4 shrink-0 text-sky-400" />
                        )}
                        <span className="truncate font-medium text-slate-100">{item.name}</span>
                      </div>
                      {item.subtitleName && (
                        <p className="mt-0.5 truncate pl-6.5 text-[11px] text-slate-400">
                          Legenda vinculada: {item.subtitleName}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-300">{item.collection}</td>
                    <td className="px-4 py-2 text-slate-400">{item.sourceLabel}</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-400 tabular-nums whitespace-nowrap">
                      {formatBytes(item.size)}
                    </td>
                    <td className="hidden px-4 py-2 text-right font-mono text-slate-400 tabular-nums whitespace-nowrap sm:table-cell">
                      {formatDate(item.addedAt)}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {item.isTemporaryCloud ? (
                        <span className="text-[11px] text-sky-400">Nuvem temporária</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void onRemoveItem(item.id)}
                          aria-label={`Remover ${item.name}`}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-950/50 hover:text-red-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Remover</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
