import React, { useState } from 'react';
import { Check, Copy, Share2, Smartphone, Tv, Wifi, X } from 'lucide-react';
import type { SyncPresence, TvNetworkInfo } from '../types/media';
import { formatBytes } from '../utils/media';

export interface ShareTargetInfo {
  name: string;
  size: number;
  kindLabel: string;
  tvItemId: string | null;
  directStreamUrl: string | null;
  isPublishing: boolean;
  onPublishToLan: (() => Promise<void>) | null;
}

interface ShareMediaModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: ShareTargetInfo | null;
  networkInfo: TvNetworkInfo | null;
  presence?: SyncPresence;
  onOpenTvPlay: (tvItemId: string) => void;
  onOpenMobilePlay: (tvItemId: string) => void;
}

export const ShareMediaModal: React.FC<ShareMediaModalProps> = ({
  isOpen,
  onClose,
  target,
  networkInfo,
  presence,
  onOpenTvPlay,
  onOpenMobilePlay,
}) => {
  const [copiedField, setCopiedField] = useState<'tv' | 'mobile' | 'stream' | null>(null);

  if (!isOpen || !target) return null;

  const baseLanUrl =
    networkInfo?.preferredBaseUrl && networkInfo.lanIps.length > 0
      ? networkInfo.preferredBaseUrl
      : window.location.origin;

  const tvShareUrl = target.tvItemId ? `${baseLanUrl}/tv?play=${encodeURIComponent(target.tvItemId)}` : null;
  const mobileShareUrl = target.tvItemId
    ? `${baseLanUrl}/mobile?play=${encodeURIComponent(target.tvItemId)}`
    : null;
  const mediaStreamUrl = target.tvItemId
    ? `${baseLanUrl}/api/tv/media/${encodeURIComponent(target.tvItemId)}`
    : target.directStreamUrl
    ? target.directStreamUrl.startsWith('/')
      ? `${window.location.origin}${target.directStreamUrl}`
      : target.directStreamUrl
    : null;

  const copyText = async (text: string, field: 'tv' | 'mobile' | 'stream') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Ignore clipboard permission failure
    }
  };

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleNativeShare = async () => {
    const shareUrl = mobileShareUrl || tvShareUrl || mediaStreamUrl;
    if (!shareUrl || !canNativeShare) return;
    try {
      await navigator.share({
        title: target.name,
        text: `Assistir "${target.name}" no NuvemStream`,
        url: shareUrl,
      });
    } catch {
      // User cancelled share sheet
    }
  };

  const tvCount = presence?.tvCount ?? 0;
  const mobileCount = presence?.mobileCount ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-media-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-[#111827] shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
              <Share2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 id="share-media-title" className="truncate text-sm font-semibold text-slate-100">
                Disponibilizar na Rede Local (TV e Celular)
              </h2>
              <p className="truncate text-xs text-slate-400">
                {target.name}
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span>{target.kindLabel}</span>
                {target.size > 0 && (
                  <>
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{formatBytes(target.size)}</span>
                  </>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela de compartilhamento"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {!target.tvItemId && target.onPublishToLan ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-xs font-semibold text-slate-100">
                    <Wifi className="h-4 w-4 text-sky-400 shrink-0" />
                    <span>Publicar no Catálogo da TV e Celular</span>
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                    Adiciona à lista de reprodução individual da TV e do Celular sem iniciar vídeo em duas telas ao mesmo tempo.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={target.isPublishing}
                  onClick={() => void target.onPublishToLan?.()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <Tv className="h-3.5 w-3.5" />
                  <span>{target.isPublishing ? 'Adicionando...' : 'Adicionar ao Catálogo'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3.5 py-2.5 text-xs text-slate-300">
              <span>Disponível na rede local para streaming individual</span>
              <span className="mx-1.5 text-slate-600" aria-hidden="true">·</span>
              <span className="font-mono text-sky-400 tabular-nums">
                {tvCount} TV · {mobileCount} Celular
              </span>
            </div>
          )}

          {tvShareUrl && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Link individual para TV (/tv)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={tvShareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-sky-300 focus:border-sky-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void copyText(tvShareUrl, 'tv')}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  {copiedField === 'tv' ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copiar</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {mobileShareUrl && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Link individual para Celular (/mobile)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={mobileShareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-sky-300 focus:border-sky-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void copyText(mobileShareUrl, 'mobile')}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  {copiedField === 'mobile' ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copiar</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {mediaStreamUrl && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Link direto do arquivo de mídia
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={mediaStreamUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-300 focus:border-sky-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void copyText(mediaStreamUrl, 'stream')}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  {copiedField === 'stream' ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copiar</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              {canNativeShare && (mobileShareUrl || tvShareUrl || mediaStreamUrl) && (
                <button
                  type="button"
                  onClick={() => void handleNativeShare()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  <span>Enviar Link</span>
                </button>
              )}
              {target.tvItemId && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenTvPlay(target.tvItemId!);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                  >
                    <Tv className="h-3.5 w-3.5 text-sky-400" />
                    <span>Abrir na TV</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenMobilePlay(target.tvItemId!);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                  >
                    <Smartphone className="h-3.5 w-3.5 text-sky-400" />
                    <span>Abrir no Celular</span>
                  </button>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
