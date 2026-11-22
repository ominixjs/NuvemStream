import React, { useEffect, useState } from 'react';
import { Clock, Cloud, Eye, EyeOff, FolderOpen, HelpCircle, Lock, Server, Trash2, Tv, X } from 'lucide-react';
import { CLOUD_PRESETS } from '../utils/media';
import type { AppPreferences, CloudPreset, SavedCloudRegistration } from '../types/media';

interface ConnectCloudModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (params: {
    serverUrl: string;
    username: string;
    password: string;
    providerName: string;
    saveTemporarily?: boolean;
    ttlMinutes?: number;
    syncPath?: string;
  }) => Promise<void>;
  onOpenLocalFolder: () => void;
  isConnecting: boolean;
  error: string | null;
  preferences?: AppPreferences | null;
  savedRegistrations?: SavedCloudRegistration[];
  onOpenSavedSession?: (id: string) => Promise<void>;
  onDeleteSavedCloud?: (id: string) => Promise<void>;
}

function formatRemainingTime(expiresAtIso: string): string {
  const diffMs = new Date(expiresAtIso).getTime() - Date.now();
  if (diffMs <= 0) return 'Expirado';
  const totalMins = Math.max(1, Math.round(diffMs / 60000));
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

export const ConnectCloudModal: React.FC<ConnectCloudModalProps> = ({
  isOpen,
  onClose,
  onConnect,
  onOpenLocalFolder,
  isConnecting,
  error,
  preferences,
  savedRegistrations = [],
  onOpenSavedSession,
  onDeleteSavedCloud,
}) => {
  const [selectedPreset, setSelectedPreset] = useState<CloudPreset>(CLOUD_PRESETS[0]);
  const [serverUrl, setServerUrl] = useState(CLOUD_PRESETS[0].serverUrl);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saveTemporarily, setSaveTemporarily] = useState(true);
  const [ttlMinutes, setTtlMinutes] = useState(720);
  const [syncPath, setSyncPath] = useState('/');

  useEffect(() => {
    if (!isOpen || !preferences) return;
    const matchedPreset =
      CLOUD_PRESETS.find((p) => p.name === preferences.lastProviderName) || CLOUD_PRESETS[0];
    setSelectedPreset(matchedPreset);
    if (preferences.lastServerUrl) setServerUrl(preferences.lastServerUrl);
    if (preferences.lastUsername) setUsername(preferences.lastUsername);
    if (preferences.lastSyncPath) setSyncPath(preferences.lastSyncPath);
    setSaveTemporarily(preferences.autoSaveCloud);
    setTtlMinutes(preferences.defaultTtlMinutes || 720);
  }, [isOpen, preferences]);

  if (!isOpen) return null;

  const handleSelectPreset = (preset: CloudPreset) => {
    setSelectedPreset(preset);
    if (preset.serverUrl) {
      setServerUrl(preset.serverUrl);
    } else if (preset.id === 'nextcloud' || preset.id === 'custom') {
      setServerUrl('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onConnect({
      serverUrl: serverUrl.trim(),
      username: username.trim(),
      password,
      providerName: selectedPreset.name,
      saveTemporarily,
      ttlMinutes,
      syncPath: syncPath.trim() || '/',
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-cloud-title"
    >
      <div className="my-auto w-full max-w-2xl rounded-xl border border-slate-800 bg-[#111827] shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <h2 id="connect-cloud-title" className="text-base font-semibold text-slate-100">
                Conectar Serviço em Nuvem
              </h2>
              <p className="text-xs text-slate-400">
                Conecte uma conta gratuita (como Koofr 10 GB) via WebDAV para ler pastas e atualizar a TV
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          {savedRegistrations.length > 0 && onOpenSavedSession && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3.5">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-200">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-sky-400" />
                  <span>Credenciais temporárias ativas na memória</span>
                </span>
                <span className="font-mono text-[11px] font-normal text-slate-400 tabular-nums">
                  {savedRegistrations.length} {savedRegistrations.length === 1 ? 'conta' : 'contas'}
                </span>
              </div>
              <div className="space-y-2">
                {savedRegistrations.map((reg) => (
                  <div
                    key={reg.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-100">
                        {reg.providerName} · {reg.username}
                      </p>
                      <p className="truncate font-mono text-[11px] text-slate-400 tabular-nums">
                        Pasta {reg.syncPath} · {reg.itemCount} mídias · expira em {formatRemainingTime(reg.expiresAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={isConnecting}
                        onClick={() => void onOpenSavedSession(reg.id)}
                        className="rounded-md bg-sky-600/20 px-2.5 py-1 text-[11px] font-semibold text-sky-300 hover:bg-sky-600/30 disabled:opacity-50 whitespace-nowrap"
                      >
                        Reabrir sem senha
                      </button>
                      {onDeleteSavedCloud && (
                        <button
                          type="button"
                          onClick={() => void onDeleteSavedCloud(reg.id)}
                          aria-label={`Remover cadastro temporário ${reg.username}`}
                          className="rounded-md p-1 text-slate-400 hover:bg-red-950/50 hover:text-red-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="mb-2 block text-xs font-medium text-slate-300">
              Escolha o provedor em nuvem
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CLOUD_PRESETS.map((preset) => {
                const isActive = selectedPreset.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className={`flex flex-col items-start rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-sky-500 ${
                      isActive
                        ? 'border-sky-500 bg-sky-500/10 text-slate-100'
                        : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <span className="text-sm font-semibold whitespace-nowrap">{preset.name}</span>
                    <span className="mt-0.5 text-[11px] text-slate-400 whitespace-nowrap">
                      {preset.freeTier}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-200">
              <HelpCircle className="h-3.5 w-3.5 text-sky-400" />
              <span>Como conectar ao {selectedPreset.name}</span>
            </div>
            <ol className="space-y-1.5 text-xs leading-relaxed text-slate-400">
              {selectedPreset.helpSteps.map((step, index) => (
                <li key={index} className="flex gap-2">
                  <span className="font-mono text-sky-400 tabular-nums">{index + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="cloud-server-url" className="mb-1.5 block text-xs font-medium text-slate-300">
                Endereço WebDAV (HTTPS)
              </label>
              <div className="relative">
                <Server className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="cloud-server-url"
                  type="url"
                  required
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder={selectedPreset.urlPlaceholder}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 py-2.5 pr-3 pl-9 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="cloud-username" className="mb-1.5 block text-xs font-medium text-slate-300">
                  E-mail ou Usuário
                </label>
                <input
                  id="cloud-username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={selectedPreset.usernamePlaceholder}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="cloud-password" className="mb-1.5 block text-xs font-medium text-slate-300">
                  {selectedPreset.passwordLabel}
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    id="cloud-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••••••"
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 py-2.5 pr-10 pl-9 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-200"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Temporary credential saving for automatic TV library updates */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={saveTemporarily}
                onChange={(e) => setSaveTemporarily(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-950 accent-sky-500"
              />
              <div className="min-w-0">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
                  <Tv className="h-3.5 w-3.5 text-sky-400" />
                  <span>Salvar credenciais temporariamente para atualizar a TV</span>
                </span>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">
                  Mantém o acesso apenas na memória RAM do computador durante o prazo escolhido para sincronizar os vídeos e músicas com a TV da rede local automaticamente, sem gravar senha em disco.
                </p>
              </div>
            </label>

            {saveTemporarily && (
              <div className="grid grid-cols-1 gap-3 border-t border-slate-800/80 pt-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="cloud-ttl-select" className="mb-1 block text-[11px] font-medium text-slate-300">
                    Validade temporária
                  </label>
                  <select
                    id="cloud-ttl-select"
                    value={ttlMinutes}
                    onChange={(e) => setTtlMinutes(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    <option value={60}>1 hora</option>
                    <option value={360}>6 horas</option>
                    <option value={720}>12 horas (padrão)</option>
                    <option value={1440}>24 horas</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="cloud-sync-path" className="mb-1 block text-[11px] font-medium text-slate-300">
                    Pasta da nuvem para a TV
                  </label>
                  <input
                    id="cloud-sync-path"
                    type="text"
                    value={syncPath}
                    onChange={(e) => setSyncPath(e.target.value)}
                    placeholder="/"
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-900/60 bg-red-950/40 px-3.5 py-2.5 text-xs text-red-200"
            >
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenLocalFolder();
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <FolderOpen className="h-4 w-4 text-slate-400" />
              <span>Ou ler pasta do PC</span>
            </button>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isConnecting || !serverUrl.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Cloud className="h-4 w-4" />
                <span>{isConnecting ? 'Conectando...' : 'Conectar e Ler Pastas'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
