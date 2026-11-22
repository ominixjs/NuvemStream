import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Captions,
  Cloud,
  File as FileIcon,
  Film,
  Folder,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Music,
  Play,
  Share2,
  Tv,
} from 'lucide-react';
import type {
  CloudEntry,
  SortDirection,
  SortField,
  SourceMode,
  ViewMode,
} from '../types/media';
import { formatBytes, formatDate, getMediaTypeLabel } from '../utils/media';

const WELCOME_BACKDROP = '/src/assets/images/cinema_welcome_backdrop_1795357589226.jpg';

interface FolderBrowserProps {
  sourceMode: SourceMode | null;
  items: CloudEntry[];
  isLoading: boolean;
  error: string | null;
  activeTrackPath: string | null;
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  sortField: SortField;
  sortDirection: SortDirection;
  onChangeSort: (field: SortField) => void;
  onOpenFolder: (entry: CloudEntry) => void;
  onPlayFile: (entry: CloudEntry) => void;
  onPlayAllMedia: () => void;
  onOpenConnectModal: () => void;
  onOpenLocalFolder: () => void;
  onSendToTv?: (entry: CloudEntry) => void;
  onShareEntry?: (entry: CloudEntry) => void;
  sendingTvPath?: string | null;
  onSyncFolderToTv?: () => void;
  isSyncingFolderToTv?: boolean;
  syncNotice?: string | null;
  searchQuery: string;
  isGlobalSearch: boolean;
}

function renderEntryIcon(entry: CloudEntry, isActive: boolean) {
  if (entry.isFolder) {
    return <Folder className="h-4 w-4 shrink-0 text-sky-400" />;
  }
  const color = isActive ? 'text-sky-400' : 'text-slate-400';
  switch (entry.kind) {
    case 'video':
      return <Film className={`h-4 w-4 shrink-0 ${color}`} />;
    case 'audio':
      return <Music className={`h-4 w-4 shrink-0 ${color}`} />;
    case 'image':
      return <ImageIcon className={`h-4 w-4 shrink-0 ${color}`} />;
    case 'subtitle':
      return <Captions className={`h-4 w-4 shrink-0 ${color}`} />;
    default:
      return <FileIcon className={`h-4 w-4 shrink-0 ${color}`} />;
  }
}

export const FolderBrowser: React.FC<FolderBrowserProps> = ({
  sourceMode,
  items,
  isLoading,
  error,
  activeTrackPath,
  viewMode,
  onChangeViewMode,
  sortField,
  sortDirection,
  onChangeSort,
  onOpenFolder,
  onPlayFile,
  onPlayAllMedia,
  onOpenConnectModal,
  onOpenLocalFolder,
  onSendToTv,
  onShareEntry,
  sendingTvPath,
  onSyncFolderToTv,
  isSyncingFolderToTv,
  syncNotice,
  searchQuery,
  isGlobalSearch,
}) => {
  // Welcome / Unconnected State
  if (!sourceMode) {
    return (
      <div className="space-y-6">
        <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-[#111827]">
          <img
            src={WELCOME_BACKDROP}
            alt="Sala de cinema minimalista para streaming em nuvem"
            referrerPolicy="no-referrer"
            className="h-72 w-full object-cover opacity-55 sm:h-80"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B1120] via-[#0B1120]/75 to-transparent" />
          <div className="absolute inset-0 flex flex-col justify-end p-6 sm:p-10">
            <h1 className="max-w-2xl text-2xl font-bold tracking-tight text-slate-100 text-balance sm:text-3xl">
              Streaming direto das suas pastas na nuvem e no PC
            </h1>
            <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-slate-300">
              Conecte uma conta gratuita como o Koofr (10 GB grátis via WebDAV) ou Nextcloud, navegue por toda a árvore de pastas e reproduza vídeos, músicas, fotos e legendas SRT sem baixar o arquivo inteiro.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onOpenConnectModal}
                className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-500 whitespace-nowrap shrink-0"
              >
                <Cloud className="h-4 w-4" />
                <span>Conectar Koofr / Nuvem</span>
              </button>
              <button
                type="button"
                onClick={onOpenLocalFolder}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/90 px-5 py-2.5 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <HardDrive className="h-4 w-4 text-slate-300" />
                <span>Ler Pasta do PC</span>
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-[#111827] p-5">
            <h2 className="text-sm font-semibold text-slate-100">01. Nuvem Gratuita via WebDAV</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Suporte nativo ao Koofr (10 GB grátis), Nextcloud e pCloud usando conexão segura HTTPS e senha de aplicativo.
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#111827] p-5">
            <h2 className="text-sm font-semibold text-slate-100">02. Streaming com Avanço Instantâneo</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Transmissão por blocos HTTP Range (206 Partial Content) para pular para qualquer minuto do vídeo na hora.
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#111827] p-5">
            <h2 className="text-sm font-semibold text-slate-100">03. Leitura de Pastas & Legendas</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Lê subpastas da nuvem ou do computador, ordena mídias em fila e converte legendas SRT automaticamente.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const folderCount = items.filter((i) => i.isFolder).length;
  const fileCount = items.length - folderCount;
  const totalBytes = items.reduce((acc, item) => acc + (item.isFolder ? 0 : item.size), 0);
  const playableCount = items.filter((i) => i.kind === 'video' || i.kind === 'audio').length;

  const SortIndicator = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? (
      <ArrowUp className="h-3 w-3 text-sky-400" />
    ) : (
      <ArrowDown className="h-3 w-3 text-sky-400" />
    );
  };

  return (
    <div className="space-y-4">
      {/* Browser Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-400">
          {isGlobalSearch && searchQuery ? (
            <span>
              Resultados para <strong className="text-slate-200">&ldquo;{searchQuery}&rdquo;</strong>
              <span className="mx-1.5" aria-hidden="true">·</span>
            </span>
          ) : null}
          <span className="font-mono tabular-nums">{folderCount}</span>{' '}
          {folderCount === 1 ? 'pasta' : 'pastas'}
          <span className="mx-1.5" aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">{fileCount}</span>{' '}
          {fileCount === 1 ? 'arquivo' : 'arquivos'}
          {totalBytes > 0 && (
            <>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{formatBytes(totalBytes)}</span>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onSyncFolderToTv && (
            <button
              type="button"
              disabled={isSyncingFolderToTv}
              onClick={onSyncFolderToTv}
              title="Enviar e carregar os vídeos desta pasta imediatamente na TV e no Celular"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 hover:text-sky-300 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Tv className="h-3.5 w-3.5 text-sky-400" />
              <span>{isSyncingFolderToTv ? 'Sincronizando...' : 'Sincronizar Pasta na TV'}</span>
            </button>
          )}

          {playableCount > 0 && (
            <button
              type="button"
              onClick={onPlayAllMedia}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-500 whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5" />
              <span>Reproduzir Fila ({playableCount})</span>
            </button>
          )}

          <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900 p-0.5">
            <button
              type="button"
              onClick={() => onChangeViewMode('list')}
              aria-label="Visualização em lista"
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                viewMode === 'list' ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <List className="h-3.5 w-3.5" />
              <span>Lista</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeViewMode('grid')}
              aria-label="Visualização em grade"
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                viewMode === 'grid' ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>Grade</span>
            </button>
          </div>
        </div>
      </div>

      {syncNotice && (
        <div className="rounded-lg border border-sky-900/60 bg-sky-950/40 px-4 py-2.5 text-xs text-sky-200">
          {syncNotice}
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

      {/* Loading Skeleton */}
      {isLoading ? (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#111827]">
          {Array.from({ length: 7 }).map((_, idx) => (
            <div
              key={idx}
              className="flex h-11 items-center justify-between border-b border-slate-800/70 px-4 last:border-b-0"
            >
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded bg-slate-800" />
                <div className="h-3.5 w-52 rounded bg-slate-800" />
              </div>
              <div className="flex items-center gap-6">
                <div className="h-3 w-12 rounded bg-slate-800" />
                <div className="h-3 w-16 rounded bg-slate-800" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-[#111827] px-6 py-16 text-center">
          <FolderOpen className="h-9 w-9 text-slate-600" />
          <p className="mt-3 text-sm font-medium text-slate-200">
            {searchQuery ? 'Nenhum arquivo ou pasta encontrado para essa busca' : 'Esta pasta está vazia'}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {searchQuery
              ? 'Tente outro termo de pesquisa ou limpe o filtro.'
              : 'Selecione outra pasta na barra lateral ou verifique o filtro de mídia.'}
          </p>
        </div>
      ) : viewMode === 'list' ? (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#111827]">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
                <th className="px-4 py-2.5 font-medium">
                  <button
                    type="button"
                    onClick={() => onChangeSort('name')}
                    className="inline-flex items-center gap-1.5 hover:text-slate-100"
                  >
                    <span>Nome</span>
                    <SortIndicator field="name" />
                  </button>
                </th>
                <th className="w-24 px-4 py-2.5 font-medium">
                  <button
                    type="button"
                    onClick={() => onChangeSort('kind')}
                    className="inline-flex items-center gap-1.5 hover:text-slate-100"
                  >
                    <span>Tipo</span>
                    <SortIndicator field="kind" />
                  </button>
                </th>
                <th className="w-28 px-4 py-2.5 text-right font-medium">
                  <button
                    type="button"
                    onClick={() => onChangeSort('size')}
                    className="inline-flex items-center justify-end gap-1.5 hover:text-slate-100"
                  >
                    <span>Tamanho</span>
                    <SortIndicator field="size" />
                  </button>
                </th>
                <th className="hidden w-32 px-4 py-2.5 text-right font-medium sm:table-cell">
                  <button
                    type="button"
                    onClick={() => onChangeSort('lastModified')}
                    className="inline-flex items-center justify-end gap-1.5 hover:text-slate-100"
                  >
                    <span>Modificado</span>
                    <SortIndicator field="lastModified" />
                  </button>
                </th>
                <th className="w-40 px-4 py-2.5 text-right font-medium">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {items.map((entry) => {
                const isActive = activeTrackPath === entry.path;
                const isPlayable = entry.kind === 'video' || entry.kind === 'audio' || entry.kind === 'image';
                const canSendToTv = !entry.isFolder && (isPlayable || entry.kind === 'subtitle');
                const isSendingThis = sendingTvPath === entry.path;
                return (
                  <tr
                    key={entry.path}
                    onClick={() => (entry.isFolder ? onOpenFolder(entry) : isPlayable ? onPlayFile(entry) : undefined)}
                    className={`h-10 transition-colors ${
                      entry.isFolder || isPlayable ? 'cursor-pointer' : ''
                    } ${isActive ? 'bg-sky-500/10' : 'hover:bg-slate-800/45'}`}
                  >
                    <td className="max-w-md px-4 py-2">
                      <div className="flex items-center gap-2.5">
                        {renderEntryIcon(entry, isActive)}
                        <span
                          className={`truncate font-medium ${
                            isActive ? 'text-sky-300' : 'text-slate-100'
                          }`}
                        >
                          {entry.name}
                        </span>
                      </div>
                      {isGlobalSearch && (
                        <p className="mt-0.5 truncate pl-6.5 font-mono text-[10px] text-slate-500">
                          {entry.path}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-400 whitespace-nowrap">
                      {getMediaTypeLabel(entry)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-slate-400 tabular-nums whitespace-nowrap">
                      {entry.isFolder ? '—' : formatBytes(entry.size)}
                    </td>
                    <td className="hidden px-4 py-2 text-right font-mono text-slate-400 tabular-nums whitespace-nowrap sm:table-cell">
                      {formatDate(entry.lastModified)}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1">
                        {isPlayable && onShareEntry && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onShareEntry(entry);
                            }}
                            title="Compartilhar este arquivo na rede local"
                            aria-label={`Compartilhar ${entry.name}`}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-slate-400 hover:bg-slate-800 hover:text-sky-300"
                          >
                            <Share2 className="h-3 w-3" />
                            <span>Compartilhar</span>
                          </button>
                        )}
                        {canSendToTv && onSendToTv && (
                          <button
                            type="button"
                            disabled={isSendingThis}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSendToTv(entry);
                            }}
                            title="Enviar para a biblioteca somente leitura da TV na rede local"
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-slate-400 hover:bg-slate-800 hover:text-sky-300 disabled:opacity-50"
                          >
                            <Tv className="h-3 w-3" />
                            <span>{isSendingThis ? 'Enviando...' : 'TV'}</span>
                          </button>
                        )}
                        {entry.isFolder ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenFolder(entry);
                            }}
                            className="rounded px-2.5 py-1 text-xs font-medium text-sky-400 hover:bg-sky-500/10"
                          >
                            Abrir
                          </button>
                        ) : isPlayable ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onPlayFile(entry);
                            }}
                            className={`rounded px-2.5 py-1 text-xs font-medium ${
                              isActive
                                ? 'bg-sky-500/20 text-sky-300'
                                : 'text-slate-200 hover:bg-slate-800'
                            }`}
                          >
                            {isActive ? 'Reproduzindo' : entry.kind === 'image' ? 'Visualizar' : 'Reproduzir'}
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-600">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((entry) => {
            const isActive = activeTrackPath === entry.path;
            const isPlayable = entry.kind === 'video' || entry.kind === 'audio' || entry.kind === 'image';
            return (
              <button
                key={entry.path}
                type="button"
                onClick={() => (entry.isFolder ? onOpenFolder(entry) : isPlayable ? onPlayFile(entry) : undefined)}
                disabled={!entry.isFolder && !isPlayable}
                className={`group flex flex-col justify-between rounded-xl border p-4 text-left transition-colors ${
                  isActive
                    ? 'border-sky-500/70 bg-sky-500/10'
                    : 'border-slate-800 bg-[#111827] hover:border-slate-700 hover:bg-slate-900'
                } disabled:cursor-default disabled:opacity-65`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-slate-950">
                    {renderEntryIcon(entry, isActive)}
                  </div>
                  {isActive && (
                    <span className="text-[11px] font-medium text-sky-400">Reproduzindo</span>
                  )}
                </div>

                <div className="mt-3 min-w-0">
                  <h3 className="truncate text-sm font-medium text-slate-100">{entry.name}</h3>
                  <p className="mt-1 truncate text-xs text-slate-400">
                    <span>{getMediaTypeLabel(entry)}</span>
                    {!entry.isFolder && (
                      <>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{formatBytes(entry.size)}</span>
                      </>
                    )}
                    {entry.lastModified && (
                      <>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{formatDate(entry.lastModified)}</span>
                      </>
                    )}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
