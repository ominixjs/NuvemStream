import React, { useState } from 'react';
import { Check, Copy, ExternalLink, Play, Radio, Share2, Tv, Wifi, X } from 'lucide-react';
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
  onSendAndPlayOnTv: (() => Promise<void>) | null;
}

interface ShareMediaModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: ShareTargetInfo | null;
  networkInfo: TvNetworkInfo | null;
  presence?: SyncPresence;
  autoSyncPlayback?: boolean;
  onToggleAutoSync?: (enabled: boolean) => void;
  onOpenTvPlay: (tvItemId: string) => void;
}

export const ShareMediaModal: React.FC<ShareMediaModalProps> = ({
  isOpen,
  onClose,
  target,
  networkInfo,
  presence,
  autoSyncPlayback = true,
  onToggleAutoSync,
  onOpenTvPlay,
}) => {
  const [copiedField, setCopiedField] = useState<'tv' | 'stream' | null>(null);
  const [pushedToTv, setPushedToTv] = useState(false);
  const [isSendingToTv, setIsSendingToTv] = useState(false);

  if (!isOpen || !target) return null;

  const baseLanUrl =
    networkInfo?.preferredBaseUrl && networkInfo.lanIps.length > 0
      ? networkInfo.preferredBaseUrl
      : window.location.origin;

  const tvShareUrl = target.tvItemId ? `${baseLanUrl}/tv?play=${encodeURIComponent(target.tvItemId)}` : null;
  const mediaStreamUrl = target.tvItemId
    ? `${baseLanUrl}/api/tv/media/${encodeURIComponent(target.tvItemId)}`
    : target.directStreamUrl
    ? target.directStreamUrl.startsWith('/')
      ? `${window.location.origin}${target.directStreamUrl}`
      : target.directStreamUrl
    : null;

  const copyText = async (text: string, field: 'tv' | 'stream') => {
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
    const shareUrl = tvShareUrl || mediaStreamUrl;
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

  const handlePushNow = async () => {
    if (!target.onSendAndPlayOnTv) return;
    setIsSendingToTv(true);
    setPushedToTv(false);
    try {
      await target.onSendAndPlayOnTv();
      setPushedToTv(true);
      window.setTimeout(() => setPushedToTv(false), 3500);
    } finally {
      setIsSendingToTv(false);
    }
  };

  const tvConnectedCount = presence?.tvCount ?? 0;

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
                Compartilhar com a TV na Rede Local
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
          {/* Instant Live Push PC -> TV */}
          <div className="rounded-lg border border-sky-900/50 bg-sky-950/25 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
                  <Radio className="h-3.5 w-3.5 text-sky-400" />
                  <span>Envio Instantâneo para Smart TV</span>
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  {tvConnectedCount > 0
                    ? `${tvConnectedCount} ${tvConnectedCount === 1 ? 'tela de TV conectada' : 'telas de TV conectadas'} na rede agora. Ao enviar, a TV carrega e reproduz automaticamente.`
                    : 'Abra /tv na Smart TV da mesma rede para receber e reproduzir automaticamente.'}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-sky-400 tabular-nums">
                {tvConnectedCount} TV
              </span>
            </div>

            {target.onSendAndPlayOnTv && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isSendingToTv || target.isPublishing}
                  onClick={() => void handlePushNow()}
                  className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>
                    {isSendingToTv || target.isPublishing
                      ? 'Enviando para a TV...'
                      : 'Enviar e Reproduzir na TV Agora'}
                  </span>
                </button>
                {pushedToTv && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                    <Check className="h-3.5 w-3.5" />
                    <span>Enviado para a TV!</span>
                  </span>
                )}
              </div>
            )}
          </div>

          {onToggleAutoSync && (
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3.5 py-2.5">
              <div className="min-w-0">
                <span className="block text-xs font-medium text-slate-200">
                  Recebimento automático (PC ↔ TV)
                </span>
                <span className="block text-[11px] text-slate-400">
                  Ao carregar vídeo/música no PC ou na TV, o outro dispositivo recebe na hora
                </span>
              </div>
              <input
                type="checkbox"
                checked={autoSyncPlayback}
                onChange={(e) => onToggleAutoSync(e.target.checked)}
                className="h-4 w-4 shrink-0 rounded border-slate-700 bg-slate-950 accent-sky-500"
              />
            </label>
          )}

          {!target.tvItemId && target.onPublishToLan && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <Wifi className="h-4 w-4 text-sky-400 shrink-0" />
                  <span>Gerar link permanente na biblioteca da TV</span>
                </div>
                <button
                  type="button"
                  disabled={target.isPublishing}
                  onClick={() => void target.onPublishToLan?.()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap"
                >
                  <Tv className="h-3.5 w-3.5 text-sky-400" />
                  <span>{target.isPublishing ? 'Gerando...' : 'Gerar Link'}</span>
                </button>
              </div>
            </div>
          )}

          {tvShareUrl && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Link direto para abrir na TV (Rede Local)
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

          {mediaStreamUrl && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Link direto do fluxo de mídia
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
            <div className="flex items-center gap-2">
              {canNativeShare && (tvShareUrl || mediaStreamUrl) && (
                <button
                  type="button"
                  onClick={() => void handleNativeShare()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  <span>Compartilhar</span>
                </button>
              )}
              {target.tvItemId && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenTvPlay(target.tvItemId!);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-sky-400" />
                  <span>Abrir Modo TV Aqui</span>
                </button>
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
