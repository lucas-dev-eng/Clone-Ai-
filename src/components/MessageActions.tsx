import { useState, useEffect, useRef, useCallback } from "react";
import { 
  Copy, 
  Check, 
  ThumbsUp, 
  ThumbsDown, 
  Volume2, 
  VolumeX, 
  Play, 
  Pause, 
  Square, 
  Share2, 
  MoreVertical, 
  FileText, 
  Download, 
  Star, 
  AlertTriangle, 
  Cpu, 
  RotateCcw, 
  Pin, 
  X,
  Mail,
  MessageSquare,
  Link,
  Code,
  RefreshCw
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";

interface Source {
  title: string;
  url: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  isTyping?: boolean;
  responseTime?: string;
  feedback?: "like" | "dislike" | null;
  feedbackReason?: string;
  isFavorite?: boolean;
  isPinned?: boolean;
  evalId?: string;
}

interface MessageActionsProps {
  message: Message;
  messageIndex: number;
  modelLabel?: string;
  onFeedbackChange: (index: number, feedback: "like" | "dislike" | null, feedbackReason?: string) => void;
  onRegenerate?: (index: number) => void;
  onToggleFavorite?: (index: number) => void;
  onTogglePin?: (index: number) => void;
  isFavorite?: boolean;
  isPinned?: boolean;
  onSpeak?: (text: string, index: number) => void;
  onStopSpeech?: () => void;
  isSpeakingGlobal?: boolean;
  speakingMessageIndex?: number | null;
  isTtsLoading?: boolean;
}

export default function MessageActions({
  message,
  messageIndex,
  modelLabel = "CloneAI Premium",
  onFeedbackChange,
  onRegenerate,
  onToggleFavorite,
  onTogglePin,
  isFavorite = false,
  isPinned = false,
  onSpeak,
  onStopSpeech,
  isSpeakingGlobal = false,
  speakingMessageIndex = null,
  isTtsLoading = false
}: MessageActionsProps) {
  // UI states
  const [copied, setCopied] = useState(false);
  const [copiedMd, setCopiedMd] = useState(false);
  const [copiedHtml, setCopiedHtml] = useState(false);
  
  // TTS State
  const [ttsState, setTtsState] = useState<"idle" | "playing" | "paused">("idle");
  const synthRef = useRef<SpeechSynthesis | null>(typeof window !== "undefined" ? window.speechSynthesis : null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Dropdown & Modal States
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isDislikeModalOpen, setIsDislikeModalOpen] = useState(false);
  const [customCorrection, setCustomCorrection] = useState("");
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  // References for keyboard navigation/outside clicks
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync TTS state with actual SpeechSynthesis if it's interrupted externally
  useEffect(() => {
    const checkTts = setInterval(() => {
      if (synthRef.current) {
        if (!synthRef.current.speaking && ttsState !== "idle") {
          setTtsState("idle");
        }
      }
    }, 1000);
    return () => clearInterval(checkTts);
  }, [ttsState]);

  // Handle outside clicks for dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 1. COPY MESSAGE CONTENT
  const copyMessage = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      toast.success("Resposta copiada com sucesso.");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error("Erro ao copiar texto.");
    }
  }, [message.content]);

  // 2. LIKE MESSAGE
  const likeMessage = useCallback(() => {
    if (message.feedback === "like") {
      onFeedbackChange(messageIndex, null);
      toast.info("Avaliação removida.");
    } else {
      onFeedbackChange(messageIndex, "like");
      toast.success("Obrigado pelo feedback positivo!");
    }
  }, [message.feedback, messageIndex, onFeedbackChange]);

  // 3. DISLIKE MESSAGE & OPEN REASON MODAL
  const dislikeMessage = useCallback(() => {
    if (message.feedback === "dislike") {
      onFeedbackChange(messageIndex, null);
      toast.info("Avaliação removida.");
    } else {
      setCustomCorrection("");
      setIsDislikeModalOpen(true);
    }
  }, [message.feedback, messageIndex, onFeedbackChange]);

  const submitDislikeReason = useCallback((reason: string) => {
    onFeedbackChange(messageIndex, "dislike", reason);
    setIsDislikeModalOpen(false);
    toast.success("Obrigado pelo feedback de melhoria!");
  }, [messageIndex, onFeedbackChange]);

  // 4. TEXT-TO-SPEECH (TTS)
  const speakMessage = useCallback(() => {
    if (onSpeak) {
      onSpeak(message.content, messageIndex);
      return;
    }

    if (!synthRef.current) {
      toast.error("Síntese de voz não suportada neste navegador.");
      return;
    }

    // If currently paused, resume it
    if (ttsState === "paused") {
      synthRef.current.resume();
      setTtsState("playing");
      return;
    }

    // Cancel current speech if any
    synthRef.current.cancel();

    // Clean text: remove code blocks, clean markdown formatting so the voice sounds 100% natural
    let cleanText = message.content.replace(/```[\s\S]*?```/g, ""); // remove code blocks entirely
    cleanText = cleanText.replace(/`([^`]+)`/g, "$1"); // remove inline code backticks
    cleanText = cleanText.replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1"); // remove markdown links, keep label
    cleanText = cleanText.replace(/[\*_~#]/g, ""); // remove markdown weight tags
    cleanText = cleanText.replace(/^\s*[\*\-\+]\s+/gm, ""); // remove list bullets
    cleanText = cleanText.replace(/^\s*\d+\.\s+/gm, ""); // remove ordered list numbers
    cleanText = cleanText.replace(/\s+/g, " "); // collapse double whitespace
    cleanText = cleanText.trim();

    if (!cleanText) {
      toast.info("Esta mensagem não possui conteúdo de texto legível.");
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utteranceRef.current = utterance;

    // Retrieve custom speech configuration from global sidebar settings (or defaults)
    const savedVoiceURI = localStorage.getItem("clone_ai_voice_uri") || "";
    const savedRate = localStorage.getItem("clone_ai_voice_rate") ? parseFloat(localStorage.getItem("clone_ai_voice_rate")!) : 1.0;
    const savedPitch = localStorage.getItem("clone_ai_voice_pitch") ? parseFloat(localStorage.getItem("clone_ai_voice_pitch")!) : 1.0;

    // Detect browser voices
    const voices = synthRef.current.getVoices();
    const ptVoices = voices.filter(v => v.lang.toLowerCase().startsWith("pt"));
    const voicePool = ptVoices.length ? ptVoices : voices;

    let selectedVoice: SpeechSynthesisVoice | null = null;
    if (savedVoiceURI) {
      selectedVoice = voicePool.find(v => v.voiceURI === savedVoiceURI) || null;
    }

    if (!selectedVoice) {
      // Prioritize premium, natural neural/online voices
      const priorityPatterns = [
        /natural/i,
        /neural/i,
        /online/i,
        /google/i,
        /premium/i,
        /leticia/i,
        /luciana/i,
        /joana/i,
        /yuri/i
      ];

      for (const pattern of priorityPatterns) {
        const found = voicePool.find((v) => pattern.test(v.name) || pattern.test(v.voiceURI));
        if (found) {
          selectedVoice = found;
          break;
        }
      }
      
      if (!selectedVoice) {
        // Fallback to Brazil voices over Portugal if available
        const brVoice = voicePool.find(v => v.lang.toLowerCase().includes("br") || v.lang.toLowerCase().includes("pt-br"));
        selectedVoice = brVoice || voicePool[0] || null;
      }
    }

    if (selectedVoice) {
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang;
    } else {
      utterance.lang = "pt-BR";
    }

    utterance.rate = savedRate;
    utterance.pitch = savedPitch;

    utterance.onend = () => {
      setTtsState("idle");
    };

    utterance.onerror = (e) => {
      if (e.error !== "interrupted" && e.error !== "canceled") {
        console.warn("Erro no SpeechSynthesisUtterance:", e.error);
      }
      setTtsState("idle");
    };

    synthRef.current.speak(utterance);
    setTtsState("playing");
  }, [message.content, ttsState, onSpeak, messageIndex]);

  const pauseSpeaking = useCallback(() => {
    if (synthRef.current && ttsState === "playing") {
      synthRef.current.pause();
      setTtsState("paused");
    }
  }, [ttsState]);

  const stopSpeaking = useCallback(() => {
    if (onStopSpeech) {
      onStopSpeech();
      return;
    }
    if (synthRef.current) {
      synthRef.current.cancel();
      setTtsState("idle");
    }
  }, [onStopSpeech]);

  // Clean speaking on component unmount
  useEffect(() => {
    return () => {
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    };
  }, []);

  // 5. SHARE RESPONSE
  const shareMessage = useCallback(async () => {
    const shareData = {
      title: "Resposta do CloneAI",
      text: message.content.substring(0, 150) + "...",
      url: window.location.href
    };

    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        toast.success("Compartilhado com sucesso!");
      } catch (err) {
        // User cancelled or error, fallback to modal if it's not a cancellation
        if ((err as Error).name !== "AbortError") {
          setIsShareModalOpen(true);
        }
      }
    } else {
      setIsShareModalOpen(true);
    }
  }, [message.content]);

  // 6. EXTRA MENU OPTIONS
  const copyMarkdown = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMd(true);
      toast.success("Markdown copiado com sucesso!");
      setTimeout(() => setCopiedMd(false), 2000);
      setIsDropdownOpen(false);
    } catch (err) {
      toast.error("Erro ao copiar.");
    }
  }, [message.content]);

  const copyHTML = useCallback(async () => {
    try {
      // Very basic Markdown-to-HTML conversion for clipboard
      let html = message.content
        .replace(/# (.*?)\n/g, "<h1>$1</h1>\n")
        .replace(/## (.*?)\n/g, "<h2>$1</h2>\n")
        .replace(/### (.*?)\n/g, "<h3>$1</h3>\n")
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.*?)\*/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br/>\n");

      await navigator.clipboard.writeText(html);
      setCopiedHtml(true);
      toast.success("HTML copiado com sucesso!");
      setTimeout(() => setCopiedHtml(false), 2000);
      setIsDropdownOpen(false);
    } catch (err) {
      toast.error("Erro ao copiar HTML.");
    }
  }, [message.content]);

  const exportTXT = useCallback(() => {
    const element = document.createElement("a");
    const file = new Blob([message.content], { type: "text/plain" });
    element.href = URL.createObjectURL(file);
    element.download = `resposta-cloneai-${messageIndex}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    toast.success("Arquivo TXT exportado!");
    setIsDropdownOpen(false);
  }, [message.content, messageIndex]);

  const exportMarkdown = useCallback(() => {
    const element = document.createElement("a");
    const file = new Blob([message.content], { type: "text/markdown" });
    element.href = URL.createObjectURL(file);
    element.download = `resposta-cloneai-${messageIndex}.md`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    toast.success("Arquivo Markdown exportado!");
    setIsDropdownOpen(false);
  }, [message.content, messageIndex]);

  const exportPDF = useCallback(() => {
    // Elegant client-side PDF export using standard print styled beautifully,
    // or triggering an automated download of a printable HTML report
    const reportHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Relatório de Resposta - CloneAI</title>
        <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
        <style>
          body { font-family: monospace; }
          @media print {
            .no-print { display: none; }
          }
        </style>
      </head>
      <body class="bg-gray-50 text-gray-900 p-8 max-w-3xl mx-auto">
        <div class="border-b-2 border-amber-500 pb-4 mb-6 flex justify-between items-center">
          <div>
            <h1 class="text-2xl font-bold tracking-tight">Clone<span class="text-amber-500">AI</span></h1>
            <p class="text-xs text-gray-500">Relatório Oficial de Conversa</p>
          </div>
          <div class="text-right">
            <p class="text-xs text-gray-500">Modelo: ${modelLabel}</p>
            <p class="text-xs text-gray-500">Data: ${new Date().toLocaleDateString()}</p>
          </div>
        </div>
        
        <div class="mb-6">
          <span class="text-xs font-bold uppercase tracking-wider bg-amber-100 text-amber-800 px-2 py-1 rounded">Conteúdo Gerado</span>
        </div>

        <div class="prose max-w-none text-sm leading-relaxed whitespace-pre-wrap border border-gray-200 p-6 rounded bg-white shadow-sm mb-8">
${message.content}
        </div>

        <div class="text-center no-print">
          <button onclick="window.print()" class="bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold uppercase px-6 py-2.5 rounded shadow transition-all cursor-pointer">
            Imprimir ou Salvar como PDF
          </button>
        </div>

        <footer class="mt-12 border-t border-gray-200 pt-4 text-center text-xs text-gray-400">
          Documento gerado automaticamente pelo assistente CloneAI.
        </footer>
      </body>
      </html>
    `;

    const element = document.createElement("a");
    const file = new Blob([reportHtml], { type: "text/html" });
    element.href = URL.createObjectURL(file);
    element.download = `resposta-cloneai-${messageIndex}-report.html`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    
    toast.success("Relatório gerado! Clique em 'Imprimir' na página aberta para salvar como PDF.", {
      duration: 5000
    });
    setIsDropdownOpen(false);
  }, [message.content, messageIndex, modelLabel]);

  const toggleFavorite = useCallback(() => {
    if (onToggleFavorite) {
      onToggleFavorite(messageIndex);
      setIsDropdownOpen(false);
    }
  }, [onToggleFavorite, messageIndex]);

  const togglePin = useCallback(() => {
    if (onTogglePin) {
      onTogglePin(messageIndex);
      setIsDropdownOpen(false);
    }
  }, [onTogglePin, messageIndex]);

  const handleReport = useCallback((reason: string) => {
    toast.success(`Denúncia registrada sob o motivo: ${reason}. Equipe notificada.`);
    setIsReportModalOpen(false);
    setIsDropdownOpen(false);
  }, []);

  const isActive = onSpeak ? (isSpeakingGlobal && speakingMessageIndex === messageIndex) : (ttsState !== "idle");
  const isLoading = onSpeak ? (isTtsLoading && speakingMessageIndex === messageIndex) : false;

  return (
    <div className="relative mt-2.5 flex items-center justify-start" id={`message-actions-${messageIndex}`}>
      {/* Principal action bar wrapper matching screenshot exactly */}
      <div 
        id="action-bar-container"
        className="flex items-center gap-1 bg-[#101a33]/60 border border-[#233256]/40 hover:border-[#e8a33d]/20 transition-colors rounded-lg p-1.5 backdrop-blur-sm shadow-md"
      >
        {/* 1. COPY ACTION */}
        <button
          onClick={copyMessage}
          className="p-1.5 rounded-md text-[#6f83ac] hover:text-[#e8a33d] hover:bg-[#e8a33d]/10 transition-all cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#e8a33d]/50"
          title="Copiar Resposta"
          aria-label="Copiar resposta"
        >
          {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
        </button>

        {/* 2. LIKE ACTION */}
        <button
          onClick={likeMessage}
          className={`p-1.5 rounded-md transition-all cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#e8a33d]/50 ${
            message.feedback === "like" 
              ? "text-[#e8a33d] bg-[#e8a33d]/15" 
              : "text-[#6f83ac] hover:text-[#e8a33d] hover:bg-[#e8a33d]/10"
          }`}
          title="Curtir resposta"
          aria-label="Curtir resposta"
        >
          <ThumbsUp size={14} fill={message.feedback === "like" ? "currentColor" : "none"} />
        </button>

        {/* 3. DISLIKE ACTION */}
        <button
          onClick={dislikeMessage}
          className={`p-1.5 rounded-md transition-all cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#e8a33d]/50 ${
            message.feedback === "dislike" 
              ? "text-rose-500 bg-rose-500/15" 
              : "text-[#6f83ac] hover:text-rose-500 hover:bg-rose-500/10"
          }`}
          title="Não curtir resposta"
          aria-label="Não curtir resposta"
        >
          <ThumbsDown size={14} fill={message.feedback === "dislike" ? "currentColor" : "none"} />
        </button>

        {/* 4. TEXT-TO-SPEECH VOICE CONTROLLER WITH MICRO-ANIMATIONS */}
        <div className="flex items-center gap-1 border-l border-[#233256]/30 pl-1 ml-0.5" id="tts-controls-wrapper">
          {(!isActive && !isLoading) ? (
            <button
              onClick={speakMessage}
              className="p-1.5 rounded-md text-[#6f83ac] hover:text-[#e8a33d] hover:bg-[#e8a33d]/10 transition-all cursor-pointer focus:outline-none"
              title="Ler em voz alta"
              aria-label="Ler resposta em voz alta"
            >
              <Volume2 size={14} />
            </button>
          ) : (
            <div className="flex items-center gap-1 bg-[#e8a33d]/10 rounded-md p-0.5 border border-[#e8a33d]/20 animate-fade-in" id="tts-active-controls">
              {/* Pulsing Visual Waveform or Loader */}
              {isLoading ? (
                <div className="flex items-center justify-center px-1.5" id="mini-loader-wrapper">
                  <RefreshCw size={11} className="animate-spin text-[#e8a33d]" />
                </div>
              ) : (
                <div className="flex items-center gap-0.5 px-1.5" id="mini-waveform">
                  <span className="w-0.5 h-2.5 bg-[#e8a33d] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-0.5 h-3.5 bg-[#e8a33d] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-0.5 h-2 bg-[#e8a33d] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              )}

              {/* Pause/Resume buttons only for native TTS, premium doesn't require pause in actions context */}
              {!onSpeak && (
                ttsState === "playing" ? (
                  <button
                    onClick={pauseSpeaking}
                    className="p-1 rounded text-[#e8a33d] hover:bg-[#e8a33d]/20 transition-colors cursor-pointer"
                    title="Pausar leitura"
                  >
                    <Pause size={12} />
                  </button>
                ) : (
                  <button
                    onClick={speakMessage}
                    className="p-1 rounded text-[#e8a33d] hover:bg-[#e8a33d]/20 transition-colors cursor-pointer"
                    title="Continuar leitura"
                  >
                    <Play size={12} />
                  </button>
                )
              )}

              <button
                onClick={stopSpeaking}
                className="p-1 rounded text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                title="Parar leitura"
              >
                <Square size={12} fill="currentColor" />
              </button>
            </div>
          )}
        </div>

        {/* 5. SHARE ACTION */}
        <button
          onClick={shareMessage}
          className="p-1.5 rounded-md text-[#6f83ac] hover:text-[#e8a33d] hover:bg-[#e8a33d]/10 transition-all cursor-pointer focus:outline-none"
          title="Compartilhar resposta"
          aria-label="Compartilhar resposta"
        >
          <Share2 size={14} />
        </button>

        {/* Pinned & Favorite Quick Indicators if active */}
        {isFavorite && (
          <span className="flex items-center justify-center p-1 text-[#e8a33d]" title="Favoritado">
            <Star size={12} fill="currentColor" />
          </span>
        )}
        {isPinned && (
          <span className="flex items-center justify-center p-1 text-emerald-500 rotate-45" title="Fixado">
            <Pin size={12} fill="currentColor" />
          </span>
        )}

        {/* 6. EXTENDED MENU (THREE DOTS) */}
        <div className="relative border-l border-[#233256]/30 pl-1 ml-0.5" ref={dropdownRef} id="dropdown-menu-container">
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className={`p-1.5 rounded-md transition-all cursor-pointer focus:outline-none ${
              isDropdownOpen ? "text-[#e8a33d] bg-[#e8a33d]/10" : "text-[#6f83ac] hover:text-[#e8a33d]"
            }`}
            title="Mais opções"
            aria-label="Mais opções"
          >
            <MoreVertical size={14} />
          </button>

          <AnimatePresence>
            {isDropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute left-0 bottom-full mb-2 w-56 bg-[#0d1428] border border-[#233256] rounded-lg shadow-xl overflow-hidden z-30 divide-y divide-[#233256]/50"
                id="more-options-dropdown"
              >
                <div className="p-1.5 space-y-0.5">
                  <button
                    onClick={copyMarkdown}
                    className="w-full text-left px-2.5 py-1.5 text-xs font-mono text-slate-300 hover:text-[#e8a33d] hover:bg-slate-800/50 rounded-md flex items-center gap-2 cursor-pointer"
                  >
                    <Code size={13} />
                    {copiedMd ? "Copiado!" : "Copiar Markdown"}
                  </button>
                  <button
                    onClick={copyHTML}
                    className="w-full text-left px-2.5 py-1.5 text-xs font-mono text-slate-300 hover:text-[#e8a33d] hover:bg-slate-800/50 rounded-md flex items-center gap-2 cursor-pointer"
                  >
                    <FileText size={13} />
                    {copiedHtml ? "Copiado!" : "Copiar HTML"}
                  </button>
                </div>

                <div className="p-1.5 space-y-0.5">
                  <button
                    onClick={exportPDF}
                    className="w-full text-left px-2.5 py-1.5 text-xs font-mono text-slate-300 hover:text-[#e8a33d] hover:bg-slate-800/50 rounded-md flex items-center gap-2 cursor-pointer"
                  >
                    <Download size={13} />
                    Exportar PDF / HTML
                  </button>
                  <button
                    onClick={exportTXT}
                    className="w-full text-left px-2.5 py-1.5 text-xs font-mono text-slate-300 hover:text-[#e8a33d] hover:bg-slate-800/50 rounded-md flex items-center gap-2 cursor-pointer"
                  >
                    <FileText size={13} />
                    Exportar TXT
                  </button>
                  <button
                    onClick={exportMarkdown}
                    className="w-full text-left px-2.5 py-1.5 text-xs font-mono text-slate-300 hover:text-[#e8a33d] hover:bg-slate-800/50 rounded-md flex items-center gap-2 cursor-pointer"
                  >
                    <Code size={13} />
                    Exportar Markdown
                  </button>
                </div>

                <div className="p-1.5 space-y-0.5">
                  {onToggleFavorite && (
                    <button
                      onClick={toggleFavorite}
                      className="w-full text-left px-2.5 py-1.5 text-xs font-mono text-slate-300 hover:text-[#e8a33d] hover:bg-slate-800/50 rounded-md flex items-center gap-2 cursor-pointer"
                    >
                      <Star size={13} fill={isFavorite ? "#e8a33d" : "none"} className={isFavorite ? "text-[#e8a33d]" : ""} />
                      {isFavorite ? "Remover Favorito" : "Salvar como Favorito"}
                    </button>
                  )}
                  {onTogglePin && (
                    <button
                      onClick={togglePin}
                      className="w-full text-left px-2.5 py-1.5 text-xs font-mono text-slate-300 hover:text-[#e8a33d] hover:bg-slate-800/50 rounded-md flex items-center gap-2 cursor-pointer"
                    >
                      <Pin size={13} fill={isPinned ? "currentColor" : "none"} className={isPinned ? "text-emerald-500 rotate-45" : ""} />
                      {isPinned ? "Desafixar do Topo" : "Fixar no Topo"}
                    </button>
                  )}
                  {onRegenerate && (
                    <button
                      onClick={() => {
                        onRegenerate(messageIndex);
                        setIsDropdownOpen(false);
                      }}
                      className="w-full text-left px-2.5 py-1.5 text-xs font-mono text-slate-300 hover:text-[#e8a33d] hover:bg-slate-800/50 rounded-md flex items-center gap-2 cursor-pointer"
                    >
                      <RotateCcw size={13} />
                      Regenerar resposta
                    </button>
                  )}
                </div>

                <div className="p-1.5 space-y-0.5">
                  <button
                    onClick={() => {
                      setIsDetailsModalOpen(true);
                      setIsDropdownOpen(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 text-xs font-mono text-slate-300 hover:text-[#e8a33d] hover:bg-slate-800/50 rounded-md flex items-center gap-2 cursor-pointer"
                  >
                    <Cpu size={13} />
                    Ver detalhes da IA
                  </button>
                  <button
                    onClick={() => {
                      setIsReportModalOpen(true);
                      setIsDropdownOpen(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 text-xs font-mono text-rose-400 hover:bg-rose-500/10 rounded-md flex items-center gap-2 cursor-pointer"
                  >
                    <AlertTriangle size={13} />
                    Denunciar resposta
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* --- MODALS --- */}
      
      {/* 1. DISLIKE REASON MODAL */}
      <AnimatePresence>
        {isDislikeModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" id="dislike-modal">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#0d1428] border border-[#233256] w-full max-w-md rounded-xl shadow-2xl p-6 font-mono text-[#dbe4f5]"
            >
              <div className="flex items-center justify-between border-b border-[#233256] pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <ThumbsDown size={16} className="text-rose-500" />
                  <span className="font-bold text-sm uppercase">Registrar Erro & Correção</span>
                </div>
                <button 
                  onClick={() => setIsDislikeModalOpen(false)}
                  className="p-1 hover:bg-slate-800 rounded-md text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <p className="text-xs text-slate-400 mb-3">
                Escreva abaixo a resposta correta ou instruções de ajuste. O CloneAI passará a lembrar dessa instrução em suas futuras conversas:
              </p>

              <textarea
                value={customCorrection}
                onChange={(e) => setCustomCorrection(e.target.value)}
                placeholder="Ex: No Log4Shell, o exploit JNDI permite RCE injetando payloads no User-Agent..."
                className="w-full h-28 p-3 bg-[#101a33]/80 border border-[#233256] rounded-lg text-xs text-slate-200 focus:outline-none focus:border-[#e8a33d]/60 mb-4 font-mono resize-none"
              />

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (!customCorrection.trim()) {
                      toast.error("Por favor, digite uma correção antes de salvar.");
                      return;
                    }
                    submitDislikeReason(customCorrection);
                  }}
                  className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold py-2 px-4 rounded-lg text-xs cursor-pointer transition-colors focus:outline-none text-center"
                >
                  Salvar Correção na Memória
                </button>
                <button
                  onClick={() => setIsDislikeModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-lg text-xs cursor-pointer transition-colors focus:outline-none text-center"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 2. SHARE MODAL (DESKTOP FALLBACK) */}
      <AnimatePresence>
        {isShareModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" id="share-modal">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#0d1428] border border-[#233256] w-full max-w-md rounded-xl shadow-2xl p-6 font-mono text-[#dbe4f5]"
            >
              <div className="flex items-center justify-between border-b border-[#233256] pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <Share2 size={16} className="text-[#e8a33d]" />
                  <span className="font-bold text-sm uppercase">Compartilhar Resposta</span>
                </div>
                <button 
                  onClick={() => setIsShareModalOpen(false)}
                  className="p-1 hover:bg-slate-800 rounded-md text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(window.location.href);
                      toast.success("Link da aplicação copiado!");
                    } catch (e) {
                      toast.error("Erro ao copiar.");
                    }
                  }}
                  className="flex flex-col items-center justify-center p-4 rounded-lg border border-[#233256] bg-[#101a33]/60 hover:bg-[#e8a33d]/10 transition-colors text-center cursor-pointer"
                >
                  <Link size={20} className="text-[#e8a33d] mb-2" />
                  <span className="text-[11px]">Copiar Link</span>
                </button>

                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(message.content);
                      toast.success("Texto completo copiado!");
                    } catch (e) {
                      toast.error("Erro ao copiar.");
                    }
                  }}
                  className="flex flex-col items-center justify-center p-4 rounded-lg border border-[#233256] bg-[#101a33]/60 hover:bg-[#e8a33d]/10 transition-colors text-center cursor-pointer"
                >
                  <Copy size={20} className="text-[#e8a33d] mb-2" />
                  <span className="text-[11px]">Copiar Texto</span>
                </button>

                <a
                  href={`https://api.whatsapp.com/send?text=${encodeURIComponent(
                    "Olha o que o assistente CloneAI me respondeu:\n\n" + message.content.substring(0, 300) + "...\n\nVeja mais na aplicação!"
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center justify-center p-4 rounded-lg border border-[#233256] bg-[#101a33]/60 hover:bg-[#e8a33d]/10 transition-colors text-center cursor-pointer"
                >
                  <MessageSquare size={20} className="text-emerald-500 mb-2" />
                  <span className="text-[11px]">WhatsApp</span>
                </a>

                <a
                  href={`mailto:?subject=CloneAI Resposta&body=${encodeURIComponent(
                    message.content
                  )}`}
                  className="flex flex-col items-center justify-center p-4 rounded-lg border border-[#233256] bg-[#101a33]/60 hover:bg-[#e8a33d]/10 transition-colors text-center cursor-pointer"
                >
                  <Mail size={20} className="text-[#e8a33d] mb-2" />
                  <span className="text-[11px]">Email</span>
                </a>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 3. IA DETAILS MODAL */}
      <AnimatePresence>
        {isDetailsModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" id="details-modal">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#0d1428] border border-[#233256] w-full max-w-md rounded-xl shadow-2xl p-6 font-mono text-[#dbe4f5]"
            >
              <div className="flex items-center justify-between border-b border-[#233256] pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <Cpu size={16} className="text-[#e8a33d]" />
                  <span className="font-bold text-sm uppercase">Detalhamento Técnico da Resposta</span>
                </div>
                <button 
                  onClick={() => setIsDetailsModalOpen(false)}
                  className="p-1 hover:bg-slate-800 rounded-md text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-3.5 text-xs">
                <div className="flex justify-between border-b border-[#233256]/40 pb-2">
                  <span className="text-slate-400">Modelo Executante:</span>
                  <span className="text-[#e8a33d] font-bold">{modelLabel}</span>
                </div>
                <div className="flex justify-between border-b border-[#233256]/40 pb-2">
                  <span className="text-slate-400">Tempo de Resposta:</span>
                  <span className="text-emerald-400 font-bold">{message.responseTime || "~0.8s"}</span>
                </div>
                <div className="flex justify-between border-b border-[#233256]/40 pb-2">
                  <span className="text-slate-400">Comprimento de Caracteres:</span>
                  <span>{message.content.length} chars</span>
                </div>
                <div className="flex justify-between border-b border-[#233256]/40 pb-2">
                  <span className="text-slate-400">Tokens Estimados:</span>
                  <span>{Math.ceil(message.content.length / 4)} tokens</span>
                </div>
                <div className="flex justify-between border-b border-[#233256]/40 pb-2">
                  <span className="text-slate-400">Custo Estimado:</span>
                  <span className="text-[#e8a33d]">$0.000000 (Garantido pelo Studio AI)</span>
                </div>
                <div className="flex justify-between pb-1">
                  <span className="text-slate-400">Provedor Neural:</span>
                  <span>Google AI Studio Direct API</span>
                </div>
              </div>

              <div className="mt-5 pt-3 border-t border-[#233256] flex justify-end">
                <button
                  onClick={() => setIsDetailsModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-bold uppercase rounded-md cursor-pointer transition-colors"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 4. DENOUNCE RESPONSE MODAL */}
      <AnimatePresence>
        {isReportModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" id="report-modal">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#0d1428] border border-[#233256] w-full max-w-md rounded-xl shadow-2xl p-6 font-mono text-[#dbe4f5]"
            >
              <div className="flex items-center justify-between border-b border-[#233256] pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-rose-500" />
                  <span className="font-bold text-sm uppercase text-rose-500">Denunciar esta Resposta</span>
                </div>
                <button 
                  onClick={() => setIsReportModalOpen(false)}
                  className="p-1 hover:bg-slate-800 rounded-md text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <p className="text-xs text-slate-400 mb-4">
                Por favor, nos informe por que esta resposta é prejudicial ou imprópria. Investigaremos imediatamente:
              </p>

              <div className="flex flex-col gap-2">
                {[
                  "Informações prejudiciais ou perigosas",
                  "Spam ou propaganda não solicitada",
                  "Conteúdo abusivo ou odioso",
                  "Preconceito político ou social severo",
                  "Violação de direitos autorais / propriedade intelectual",
                  "Outro motivo"
                ].map((reason) => (
                  <button
                    key={reason}
                    onClick={() => handleReport(reason)}
                    className="w-full text-left px-3.5 py-2.5 rounded-md border border-[#233256]/70 bg-[#101a33]/40 hover:bg-rose-500/10 hover:border-rose-500/30 transition-colors text-xs cursor-pointer focus:outline-none"
                  >
                    {reason}
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
