import React from 'react';
import {
  ChevronDown,
  ChevronRight,
  Cloud,
  Download,
  Film,
  Folder,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  LogOut,
  Music,
  Plus,
  Smartphone,
  Tv,
  Wifi,
} from 'lucide-react';
import type {
  CloudConnection,
  FolderTreeNode,
  MediaFilter,
  SourceMode,
} from '../types/media';

interface SidebarProps {
  sourceMode: SourceMode | null;
  cloudConnection: CloudConnection | null;
  localRootLabel: string | null;
  currentPath: string;
  mediaFilter: MediaFilter;
  onChangeFilter: (filter: MediaFilter) => void;
  onSelectPath: (path: string) => void;
  treeRoot: FolderTreeNode | null;
  expandedPaths: Set<string>;
  onToggleExpand: (node: FolderTreeNode) => void;
  onOpenConnectModal: () => void;
  onOpenLocalFolder: () => void;
  onDisconnect: () => void;
  activePanel: 'browser' | 'tv-manager';
  onSelectPanel: (panel: 'browser' | 'tv-manager') => void;
  onOpenTvMode: () => void;
  onOpenMobileMode: () => void;
  onOpenDesktopModal: () => void;
  tvItemCount: number;
  filterCounts: {
    all: number;
    video: number;
    audio: number;
    image: number;
  };
}

interface TreeRowProps {
  node: FolderTreeNode;
  depth: number;
  currentPath: string;
  expandedPaths: Set<string>;
  onSelectPath: (path: string) => void;
  onToggleExpand: (node: FolderTreeNode) => void;
}

const TreeRow: React.FC<TreeRowProps> = ({
  node,
  depth,
  currentPath,
  expandedPaths,
  onSelectPath,
  onToggleExpand,
}) => {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = currentPath === node.path;
  const hasKnownChildren = !node.loaded || node.children.length > 0;

  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded-md pr-2 py-1.5 text-xs transition-colors ${
          isSelected
            ? 'bg-sky-500/15 text-sky-300 font-medium'
            : 'text-slate-300 hover:bg-slate-800/70 hover:text-slate-100'
        }`}
        style={{ paddingLeft: `${Math.min(depth, 6) * 14 + 6}px` }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(node);
          }}
          aria-label={isExpanded ? `Recolher ${node.name}` : `Expandir ${node.name}`}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-700/60 hover:text-slate-200 ${
            !hasKnownChildren ? 'invisible' : ''
          }`}
        >
          {node.loading ? (
            <Loader2 className="h-3 w-3 animate-spin text-sky-400" />
          ) : isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>

        <button
          type="button"
          onClick={() => onSelectPath(node.path)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {isExpanded || isSelected ? (
            <FolderOpen className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-sky-400' : 'text-slate-400'}`} />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
      </div>

      {isExpanded && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              currentPath={currentPath}
              expandedPaths={expandedPaths}
              onSelectPath={onSelectPath}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  sourceMode,
  cloudConnection,
  localRootLabel,
  currentPath,
  mediaFilter,
  onChangeFilter,
  onSelectPath,
  treeRoot,
  expandedPaths,
  onToggleExpand,
  onOpenConnectModal,
  onOpenLocalFolder,
  onDisconnect,
  activePanel,
  onSelectPanel,
  onOpenTvMode,
  onOpenMobileMode,
  onOpenDesktopModal,
  tvItemCount,
  filterCounts,
}) => {
  const filterItems: { id: MediaFilter; label: string; count: number; icon: React.ReactNode }[] = [
    { id: 'all', label: 'Todos os Arquivos', count: filterCounts.all, icon: <LayoutGrid className="h-4 w-4" /> },
    { id: 'video', label: 'Vídeos', count: filterCounts.video, icon: <Film className="h-4 w-4" /> },
    { id: 'audio', label: 'Músicas', count: filterCounts.audio, icon: <Music className="h-4 w-4" /> },
    { id: 'image', label: 'Imagens', count: filterCounts.image, icon: <ImageIcon className="h-4 w-4" /> },
  ];

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800/90 bg-[#0F1626] select-none">
      {/* Brand Header */}
      <div className="flex h-14 items-center justify-between border-b border-slate-800/80 px-4">
        <span className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap">
          NuvemStream
        </span>
      </div>

      {/* Source Actions */}
      <div className="space-y-2 border-b border-slate-800/80 p-3">
        <button
          type="button"
          onClick={onOpenConnectModal}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-sky-500 whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          <span>{cloudConnection ? 'Trocar Nuvem' : 'Conectar Nuvem'}</span>
        </button>

        <button
          type="button"
          onClick={onOpenLocalFolder}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 whitespace-nowrap"
        >
          <HardDrive className="h-3.5 w-3.5 text-slate-400" />
          <span>Abrir Pasta do PC</span>
        </button>
      </div>

      {/* TV & Mobile Local Network Section */}
      <div className="space-y-1 border-b border-slate-800/80 p-3">
        <p className="mb-1.5 px-2 text-[11px] font-medium text-slate-400">TV e Celular na Rede</p>
        <button
          type="button"
          onClick={() => onSelectPanel('tv-manager')}
          className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs transition-colors ${
            activePanel === 'tv-manager'
              ? 'bg-slate-800 text-slate-100 font-medium'
              : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100'
          }`}
        >
          <span className="flex items-center gap-2.5">
            <Wifi className={`h-4 w-4 ${activePanel === 'tv-manager' ? 'text-sky-400' : 'text-slate-400'}`} />
            <span className="whitespace-nowrap">Biblioteca TV e Celular</span>
          </span>
          <span className="font-mono text-[11px] text-slate-400 tabular-nums">{tvItemCount}</span>
        </button>

        <button
          type="button"
          onClick={onOpenTvMode}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-slate-100"
        >
          <Tv className="h-4 w-4 text-sky-400" />
          <span className="whitespace-nowrap">Abrir App da TV</span>
        </button>

        <button
          type="button"
          onClick={onOpenMobileMode}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-slate-100"
        >
          <Smartphone className="h-4 w-4 text-sky-400" />
          <span className="whitespace-nowrap">Abrir App do Celular</span>
        </button>

        <button
          type="button"
          onClick={onOpenDesktopModal}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-slate-100"
        >
          <Download className="h-4 w-4 text-slate-400" />
          <span className="whitespace-nowrap">App Windows (.exe)</span>
        </button>
      </div>

      {/* Connected Source Summary */}
      {sourceMode && (
        <div className="border-b border-slate-800/80 px-3 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                {sourceMode === 'cloud' ? (
                  <Cloud className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                ) : (
                  <HardDrive className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                )}
                <span className="truncate">
                  {sourceMode === 'cloud'
                    ? cloudConnection?.providerName || 'Nuvem'
                    : localRootLabel || 'Pasta Local'}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-slate-400">
                {sourceMode === 'cloud'
                  ? `${cloudConnection?.username} · ${cloudConnection?.serverHost}`
                  : 'Leitura direta do computador'}
              </p>
            </div>
            <button
              type="button"
              onClick={onDisconnect}
              title="Desconectar origem atual"
              aria-label="Desconectar origem atual"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Media Filters */}
      <div className="border-b border-slate-800/80 p-3">
        <p className="mb-2 px-2 text-[11px] font-medium text-slate-400">Filtrar Pasta Atual</p>
        <nav className="space-y-0.5" aria-label="Filtros de mídia">
          {filterItems.map((item) => {
            const active = mediaFilter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangeFilter(item.id)}
                className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs transition-colors ${
                  active
                    ? 'bg-slate-800 text-slate-100 font-medium'
                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <span className={active ? 'text-sky-400' : 'text-slate-500'}>{item.icon}</span>
                  <span className="whitespace-nowrap">{item.label}</span>
                </span>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">{item.count}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Directory Tree */}
      <div className="flex min-h-0 flex-1 flex-col p-3">
        <p className="mb-2 px-2 text-[11px] font-medium text-slate-400">Árvore de Pastas</p>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {treeRoot ? (
            <TreeRow
              node={treeRoot}
              depth={0}
              currentPath={currentPath}
              expandedPaths={expandedPaths}
              onSelectPath={onSelectPath}
              onToggleExpand={onToggleExpand}
            />
          ) : (
            <p className="px-2 py-4 text-xs leading-relaxed text-slate-500">
              Conecte sua conta Koofr / WebDAV ou selecione uma pasta do PC para navegar pelas subpastas.
            </p>
          )}
        </div>
      </div>
    </aside>
  );
};
