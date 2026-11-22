import React from 'react';
import { Download, Monitor, Terminal, Wifi, X } from 'lucide-react';
import type { TvNetworkInfo } from '../types/media';

interface DesktopExeModalProps {
  isOpen: boolean;
  onClose: () => void;
  networkInfo: TvNetworkInfo | null;
}

export const DesktopExeModal: React.FC<DesktopExeModalProps> = ({
  isOpen,
  onClose,
  networkInfo,
}) => {
  if (!isOpen) return null;

  const lanIp = networkInfo?.lanIps?.[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="desktop-exe-title"
    >
      <div className="w-full max-w-xl rounded-xl border border-slate-800 bg-[#111827] shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
              <Monitor className="h-5 w-5" />
            </div>
            <div>
              <h2 id="desktop-exe-title" className="text-base font-semibold text-slate-100">
                Aplicativo para PC Windows (.exe) e Roteamento Local
              </h2>
              <p className="text-xs text-slate-400">
                Baixe o pacote para rodar localmente no Windows com inicialização em rede Wi-Fi
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
              <Wifi className="h-4 w-4 text-sky-400" />
              <span>Roteamento Local Automático ao Iniciar</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Ao iniciar no seu PC, o servidor vincula automaticamente a porta 3000 à sua rede local para que o app do PC e o app da TV conversem sem internet externa.
            </p>
            <div className="mt-3 space-y-1 font-mono text-[11px] text-slate-300">
              <p>PC Local: http://localhost:3000</p>
              <p>
                TV na Rede:{' '}
                {lanIp ? `http://${lanIp}:3000/tv` : 'http://SEU_IP_LOCAL:3000/tv (detectado ao iniciar no PC)'}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
              <Terminal className="h-4 w-4 text-sky-400" />
              <span>Como usar ou compilar o NuvemStream.exe no Windows</span>
            </div>
            <ol className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-400">
              <li className="flex gap-2">
                <span className="font-mono text-sky-400 tabular-nums">1.</span>
                <span>
                  Clique em <strong className="text-slate-200">Baixar Pacote Windows (.zip)</strong> e extraia a pasta <code className="font-mono text-slate-200">NuvemStream</code>.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-sky-400 tabular-nums">2.</span>
                <span>
                  Para abrir imediatamente como aplicativo de janela no PC, execute{' '}
                  <code className="font-mono text-slate-200">Iniciar-NuvemStream.bat</code>.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-sky-400 tabular-nums">3.</span>
                <span>
                  Para gerar o executável nativo <code className="font-mono text-slate-200">NuvemStream.exe</code> no seu Windows, execute{' '}
                  <code className="font-mono text-slate-200">Gerar-NuvemStream-EXE.bat</code> (requer Node.js 20+ durante a compilação).
                </span>
              </li>
            </ol>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              Fechar
            </button>
            <a
              href="/api/desktop/download"
              download="NuvemStream-Windows.zip"
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-sky-500 whitespace-nowrap"
            >
              <Download className="h-4 w-4" />
              <span>Baixar Pacote Windows (.zip + Gerador .exe)</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
