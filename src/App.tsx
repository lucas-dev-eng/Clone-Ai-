import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Send, Globe, Terminal, Circle, Link2, Sparkles, RefreshCw, Mic, MicOff, Menu, X, Trash2, Plus, Check, Edit2, Pin, Star, AlertTriangle, Volume2, VolumeX, Play, Square, Sliders, BookOpen, Zap, ZapOff, Brain, ThumbsUp, ThumbsDown, LogIn, LogOut, ShieldCheck } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Toaster, toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import MessageActions from "./components/MessageActions";
import Logo from "./components/Logo";
import AgentStepsViewer from "./components/AgentStepsViewer";

import { auth, googleProvider } from "./lib/firebase.ts";
import { signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";

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
  providerName?: string;
  modelUsed?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  latencyMs?: number;
  estimatedCostUsd?: number;
  cached?: boolean;
  fallbackChain?: string[];
  agentSteps?: Array<{
    iteration: number;
    toolName: string;
    args: any;
    result: any;
    durationMs?: number;
  }>;
  evalId?: string;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  messages: Message[];
}

const MODELS = [
  { id: "auto", label: "⚡ Auto (Melhor Custo/Velocidade)", provider: "Auto" },
  
  // Google Gemini
  { id: "gemini:gemini-3.5-flash", label: "Gemini 3.5 Flash (Google)", provider: "Google Gemini" },
  { id: "gemini:gemini-2.5-flash", label: "Gemini 2.5 Flash (Google)", provider: "Google Gemini" },
  { id: "gemini:gemini-2.5-pro", label: "Gemini 2.5 Pro (Google)", provider: "Google Gemini" },
  
  // OpenAI
  { id: "openai:gpt-4o-mini", label: "GPT-4o mini (OpenAI)", provider: "OpenAI" },
  { id: "openai:gpt-4o", label: "GPT-4o (OpenAI)", provider: "OpenAI" },
  
  // Anthropic Claude
  { id: "claude:claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet (Anthropic)", provider: "Anthropic Claude" },
  { id: "claude:claude-3-5-haiku-latest", label: "Claude 3.5 Haiku (Anthropic)", provider: "Anthropic Claude" },
  
  // Meta Llama
  { id: "llama:llama-3.3-70b", label: "Llama 3.3 70B (Meta)", provider: "Meta Llama" },
  { id: "llama:llama-3.1-8b", label: "Llama 3.1 8B (Meta)", provider: "Meta Llama" },
  
  // DeepSeek
  { id: "deepseek:deepseek-chat", label: "DeepSeek V3 (Chat)", provider: "DeepSeek" },
  { id: "deepseek:deepseek-reasoner", label: "DeepSeek R1 (Raciocínio)", provider: "DeepSeek" },
  
  // Mistral
  { id: "mistral:mistral-small-latest", label: "Mistral Small (Mistral AI)", provider: "Mistral" },
  { id: "mistral:mistral-large-latest", label: "Mistral Large (Mistral AI)", provider: "Mistral" },
];

const COLORS = {
  bg: "#0B1020",
  bgHeader: "#111827",
  surface: "#182235",
  border: "#243248",
  borderSoft: "#243248",
  teal: "#58C7B3",
  sand: "#D8B07A",
  highlight: "#6D8CFF",
  textPrimary: "#F8FAFC",
  textMuted: "#94A3B8",
  error: "#EF4444",
  success: "#22C55E",
  warning: "#F59E0B",
  
  // Backwards compatibility with the layout variables for absolute safety:
  amber: "#D8B07A",
  amberSoft: "rgba(88, 199, 179, 0.1)",
  amberBorder: "rgba(88, 199, 179, 0.25)",
};

const PROMPT_PRESETS = {
  personas: [
    {
      name: "Prof. Harvard 🎓",
      desc: "Professor Doutor de Economia de Harvard. Didático, detalhado e acadêmico.",
      text: "Atue como um professor doutor em economia de Harvard e explique de forma didática, porém profunda: "
    },
    {
      name: "Consultor Startups 🚀",
      desc: "Consultor sênior de inovação e startups. Foco estratégico e de mercado.",
      text: "Atue como um consultor sênior de inovação e startups. Preciso de ideias de negócios baseados no mercado atual. Para o tema abaixo, inclua o problema que resolve, público-alvo e modelo de monetização: "
    },
    {
      name: "Eng. Software Sênior 💻",
      desc: "Desenvolvedor especialista em arquitetura, clean code e boas práticas.",
      text: "Atue como um engenheiro de software sênior. Escreva o código e analise o problema a seguir considerando desempenho ótimo, segurança e boas práticas de engenharia: "
    },
    {
      name: "Copywriter Sênior ✍️",
      desc: "Especialista em marketing e textos persuasivos orientados à conversão.",
      text: "Atue como um redator publicitário especialista em copywriting de alta conversão. Escreva uma estrutura persuasiva, atraente e marcante sobre: "
    }
  ],
  formats: [
    { label: "📊 Tabela Comparativa", text: "Apresente o resultado final formatado em uma tabela comparativa com colunas claras." },
    { label: "📝 Lista (Bullet Points)", text: "Forneça a resposta estruturada como uma lista de tópicos (bullet points) diretos e legíveis." },
    { label: "⏱️ Máx 200 palavras", text: "Limite a sua resposta a no máximo 200 palavras, sendo extremamente claro, focado e conciso." },
    { label: "💼 Resumo Executivo", text: "Apresente um resumo executivo de alto nível, com visão estratégica e sem rodeios técnicos." }
  ],
  fewshots: [
    {
      name: "🏷️ Classificação (Sentimento)",
      desc: "Instrui a IA a categorizar com base em poucos exemplos específicos.",
      text: "Classifique o sentimento da frase fornecida estritamente entre [Positivo], [Neutro] ou [Negativo].\n\nExemplo 1: 'O produto chegou super rápido' -> [Positivo]\nExemplo 2: 'O produto é mediano, nada de especial' -> [Neutro]\nExemplo 3: 'Fiquei frustrado com o atraso' -> [Negativo]\n\nAgora classifique esta frase: "
    },
    {
      name: "💡 Geração de Startups",
      desc: "Estrutura o output usando modelo de exemplo Few-Shot.",
      text: "Por favor, sugira ideias inovadoras seguindo estritamente este padrão de exemplo:\n\nExemplo:\n* Ideia: EcoDelivery\n* Problema: Excesso de plástico em embalagens de entrega rápida\n* Monetização: Taxa de conveniência para restaurantes que usam papel\n\nAgora gere ideias para o setor de: "
    }
  ],
  contextTemplate: "Atue como [Papel/Especialista]. Meu público-alvo principal é [Público-alvo] e meu objetivo final com esta resposta é [Objetivo]. Por favor, considere as seguintes limitações ou preferências: [Limitações/Preferências]. Escreva sobre: "
};

// Global markdownComponents has been migrated inside the App component to dynamically adapt to Reading Mode styling choices in real-time.

// Pick suitable system voice for TTS
function pickBestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const ptVoices = voices.filter((v) => v.lang?.toLowerCase().startsWith("pt"));
  if (!ptVoices.length) return null;

  // Prioritize premium, natural neural voices
  // Microsoft Edge Natural voices (Francisca, Antonio) are incredibly lifelike
  // Google Chrome Online/Neural voices are also very natural
  // iOS/macOS Leticia, Luciana (premium/high quality) are very high quality
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
    const found = ptVoices.find((v) => pattern.test(v.name) || pattern.test(v.voiceURI));
    if (found) return found;
  }

  // Fallback to Brazil voices over Portugal if available
  const brVoice = ptVoices.find(v => v.lang.toLowerCase().includes("br") || v.lang.toLowerCase().includes("pt-br"));
  if (brVoice) return brVoice;

  return ptVoices[0];
}

// Helper to sanitize markdown and code blocks for realistic speech synthesis
const sanitizeTextForSpeech = (text: string): string => {
  if (!text) return "";
  
  // 1. Remove code blocks entirely (they are annoying to read out loud)
  let clean = text.replace(/```[\s\S]*?```/g, "");
  
  // 2. Remove inline code tags (`code`)
  clean = clean.replace(/`([^`]+)`/g, "$1");
  
  // 3. Remove markdown link markup like [Text](Url) -> Text
  clean = clean.replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1");
  
  // 4. Remove bold/italic markers (*, _)
  clean = clean.replace(/[\*_~]/g, "");
  
  // 5. Remove bullet list markers (*, -, numbered lists) at start of lines
  clean = clean.replace(/^\s*[\*\-\+]\s+/gm, "");
  clean = clean.replace(/^\s*\d+\.\s+/gm, "");
  
  // 6. Replace multiple spaces/newlines with single space
  clean = clean.replace(/\s+/g, " ");
  
  return clean.trim();
};

export default function App() {
  const [showSplashScreen, setShowSplashScreen] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplashScreen(false);
    }, 2200);
    return () => clearTimeout(timer);
  }, []);

  const [voiceOn, setVoiceOn] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("clone_ai_voice_on") === "true";
    }
    return false;
  });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("clone_ai_voice_uri") || "";
    }
    return "";
  });
  const [voiceRate, setVoiceRate] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("clone_ai_voice_rate");
      return saved ? parseFloat(saved) : 1.0;
    }
    return 1.0;
  });
  const [voicePitch, setVoicePitch] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("clone_ai_voice_pitch");
      return saved ? parseFloat(saved) : 1.0;
    }
    return 1.0;
  });
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingMessageIndex, setSpeakingMessageIndex] = useState<number | null>(null);

  // States for long press / hold-to-delete messages
  const [holdingMessageIndex, setHoldingMessageIndex] = useState<number | null>(null);
  const [holdTimeoutId, setHoldTimeoutId] = useState<any | null>(null);
  const [revealedDeleteIndex, setRevealedDeleteIndex] = useState<number | null>(null);

  const [isOffline, setIsOffline] = useState(() => {
    return typeof navigator !== "undefined" ? !navigator.onLine : false;
  });

  // Premium TTS state variables
  const [ttsProvider, setTtsProvider] = useState<"browser" | "elevenlabs" | "google_cloud">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("clone_ai_tts_provider");
      return (saved as any) || "browser";
    }
    return "browser";
  });
  const [premiumConfig, setPremiumConfig] = useState<{
    elevenlabs: { configured: boolean; voices: { id: string; name: string }[] };
    google_cloud: { configured: boolean; voices: { id: string; name: string }[] };
  }>({
    elevenlabs: { configured: false, voices: [] },
    google_cloud: { configured: false, voices: [] }
  });
  const [selectedPremiumVoice, setSelectedPremiumVoice] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("clone_ai_premium_voice") || "";
    }
    return "";
  });
  const [isTtsLoading, setIsTtsLoading] = useState(false);

  // User Authentication State
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Handle Sign In with Google popup
  const handleSignIn = useCallback(async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const token = await result.user.getIdToken();
      toast.success(`Bem-vindo, ${result.user.displayName || result.user.email}!`);
    } catch (error: any) {
      console.error("[Auth] Sign in failed:", error);
      
      const errorCode = error?.code || "";
      if (errorCode === "auth/popup-closed-by-user") {
        toast.info("Login cancelado pelo usuário.");
      } else if (errorCode === "auth/cancelled-popup-request") {
        // Request was cancelled by a newer request or general navigation, no toast needed
      } else if (errorCode === "auth/popup-blocked") {
        toast.error("O popup de login foi bloqueado pelo navegador. Por favor, permita popups ou abra o aplicativo em uma nova aba.");
      } else {
        toast.error(`Falha no login: ${error.message || error}`);
      }
    }
  }, []);

  // Handle Sign Out
  const handleSignOut = useCallback(async () => {
    try {
      await signOut(auth);
      toast.success("Logoff efetuado com sucesso.");
    } catch (error: any) {
      console.error("[Auth] Sign out failed:", error);
      toast.error(`Falha no logoff: ${error.message}`);
    }
  }, []);

  const activeAudioRef = useRef<HTMLAudioElement | null>(null);

  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const saved = localStorage.getItem("clone_ai_chat_sessions");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.error("Erro ao carregar sessões do localStorage:", e);
    }

    try {
      const oldSaved = localStorage.getItem("clone_ai_chat_messages");
      if (oldSaved) {
        const oldMsgs = JSON.parse(oldSaved);
        if (Array.isArray(oldMsgs) && oldMsgs.length > 0) {
          return [{
            id: "session_migrated",
            title: "Conversa Migrada",
            createdAt: new Date().toISOString(),
            messages: oldMsgs
          }];
        }
      }
    } catch (e) {
      console.error("Erro ao migrar mensagens antigas:", e);
    }

    return [{
      id: "session_initial",
      title: "Nova Conversa",
      createdAt: new Date().toISOString(),
      messages: []
    }];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    try {
      const savedActive = localStorage.getItem("clone_ai_active_session_id");
      if (savedActive && savedActive !== "undefined") return savedActive;
    } catch (e) {}
    return sessions[0]?.id || "session_initial";
  });

  const [messages, setMessages] = useState<Message[]>(() => {
    const active = sessions.find((s) => s.id === (localStorage.getItem("clone_ai_active_session_id") || "session_initial")) || sessions[0];
    return active ? active.messages : [];
  });

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  // Listen to Firebase Auth state change and sync sessions/memories from PostgreSQL
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setIsAuthLoading(true);
      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          const token = await firebaseUser.getIdToken();
          setIdToken(token);

          // Synchronize user to database
          await fetch("/api/users/sync", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            }
          });

          // Fetch chat sessions from PostgreSQL
          const res = await fetch("/api/chat/sessions", {
            headers: {
              "Authorization": `Bearer ${token}`
            }
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success && Array.isArray(data.sessions) && data.sessions.length > 0) {
              setSessions(data.sessions);
              
              const savedActive = localStorage.getItem("clone_ai_active_session_id");
              let activeId = data.sessions[0].id;
              if (savedActive && data.sessions.some((s: any) => s.id === savedActive)) {
                activeId = savedActive;
              }
              setActiveSessionId(activeId);
              
              const activeSess = data.sessions.find((s: any) => s.id === activeId);
              if (activeSess) {
                setMessages(activeSess.messages);
              }
              toast.success("Sessões carregadas da nuvem com sucesso!");
            } else {
              // Upload existing local sessions to the cloud database upon first login
              for (const session of sessions) {
                if (session.messages.length > 0) {
                  await fetch("/api/chat/sessions", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "Authorization": `Bearer ${token}`
                    },
                    body: JSON.stringify({
                      id: session.id,
                      title: session.title,
                      messages: session.messages
                    })
                  });
                }
              }
              
              // Refresh session list from DB
              const refreshedRes = await fetch("/api/chat/sessions", {
                headers: { "Authorization": `Bearer ${token}` }
              });
              if (refreshedRes.ok) {
                const refreshedData = await refreshedRes.json();
                if (refreshedData.success && refreshedData.sessions && refreshedData.sessions.length > 0) {
                  setSessions(refreshedData.sessions);
                  
                  const savedActive = localStorage.getItem("clone_ai_active_session_id");
                  let activeId = refreshedData.sessions[0].id;
                  if (savedActive && refreshedData.sessions.some((s: any) => s.id === savedActive)) {
                    activeId = savedActive;
                  }
                  setActiveSessionId(activeId);
                  
                  const activeSess = refreshedData.sessions.find((s: any) => s.id === activeId);
                  if (activeSess) {
                    setMessages(activeSess.messages);
                  }
                }
              }
            }
          }
        } catch (e) {
          console.error("[Auth] Sync failed:", e);
        }
      } else {
        setUser(null);
        setIdToken(null);
        
        // Restore local storage sessions when logged out
        try {
          const saved = localStorage.getItem("clone_ai_chat_sessions");
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setSessions(parsed);
              const savedActive = localStorage.getItem("clone_ai_active_session_id");
              let activeId = parsed[0].id;
              if (savedActive && parsed.some((s: any) => s.id === savedActive)) {
                activeId = savedActive;
              }
              setActiveSessionId(activeId);
              
              const activeSess = parsed.find((s: any) => s.id === activeId);
              if (activeSess) {
                setMessages(activeSess.messages);
              }
              setIsAuthLoading(false);
              return;
            }
          }
        } catch (e) {}
      }
      setIsAuthLoading(false);
    });
 
    return () => unsubscribe();
  }, []);
 
  // Sync activeSessionId to messages
  useEffect(() => {
    const active = sessions.find((s) => s.id === activeSessionId);
    if (active) {
      setMessages((prev) => {
        if (prev === active.messages) return prev;
        return active.messages;
      });
    }
    try {
      localStorage.setItem("clone_ai_active_session_id", activeSessionId);
    } catch (e) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);
 
  // Sync messages update back to sessions
  useEffect(() => {
    setSessions((prev) => {
      const activeSession = prev.find((s) => s.id === activeSessionId);
      if (activeSession && activeSession.messages === messages) {
        return prev;
      }
      return prev.map((s) => {
        if (s.id === activeSessionId) {
          return { ...s, messages };
        }
        return s;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Save sessions to localStorage and PostgreSQL with debounce to prevent performance lag
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const sanitized = sessions.map((s) => ({
          ...s,
          messages: s.messages.map((m) => ({ ...m, isTyping: false }))
        }));
        
        // Always cache to localStorage
        localStorage.setItem("clone_ai_chat_sessions", JSON.stringify(sanitized));

        // Save active session to cloud PostgreSQL if logged in and online
        if (idToken && user && !isOffline) {
          const activeSession = sessions.find(s => s.id === activeSessionId);
          if (activeSession && activeSession.messages.length > 0) {
            await fetch("/api/chat/sessions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}`
              },
              body: JSON.stringify({
                id: activeSession.id,
                title: activeSession.title,
                messages: activeSession.messages.map(m => ({ ...m, isTyping: false }))
              })
            });
          }
        }
      } catch (e) {
        console.error("Erro ao sincronizar sessões:", e);
      }
    }, 500); // 500ms debounce
    return () => clearTimeout(timer);
  }, [sessions, idToken, user, activeSessionId, isOffline]);

  // Helper to create a new session
  const createNewSession = useCallback(() => {
    const newId = "session_" + Date.now();
    const newSession: ChatSession = {
      id: newId,
      title: "Nova Conversa",
      createdAt: new Date().toISOString(),
      messages: []
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newId);
    setMessages([]);
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  }, []);

  // Helper to delete a session
  const deleteSession = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    setSessions((prev) => {
      if (prev.length <= 1) {
        // If it's the only session, just reset its messages and title
        setMessages([]);
        return prev.map((s) => (s.id === id ? { ...s, title: "Nova Conversa", messages: [] } : s));
      }

      const index = prev.findIndex((s) => s.id === id);
      const updated = prev.filter((s) => s.id !== id);
      
      // If the active session is deleted, switch to another one
      if (activeSessionId === id) {
        const nextActiveIndex = index === 0 ? 0 : index - 1;
        const nextActive = updated[nextActiveIndex] || updated[0];
        setActiveSessionId(nextActive.id);
      }
      
      return updated;
    });

    // If authenticated, also delete from Cloud SQL database
    if (idToken && user) {
      fetch(`/api/chat/sessions/${id}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${idToken}`
        }
      }).catch(err => console.error("Erro ao deletar sessão no PostgreSQL:", err));
    }
  }, [activeSessionId, idToken, user]);

  // Rename helpers
  const startRenaming = useCallback((id: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionId(id);
    setEditingTitle(currentTitle);
  }, []);

  const saveRename = useCallback((id: string) => {
    if (editingTitle.trim()) {
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title: editingTitle.trim() } : s))
      );
    }
    setEditingSessionId(null);
  }, [editingTitle]);

  // Message actions handlers (Feedback, Favorite, Pin, Regenerate)
  const handleFeedbackChange = useCallback(async (index: number, feedback: "like" | "dislike" | null, feedbackReason?: string) => {
    let evalId: string | undefined;

    setMessages((prev) => {
      const target = prev[index];
      if (target) {
        evalId = target.evalId;
      }
      return prev.map((m, i) => (i === index ? { ...m, feedback, feedbackReason } : m));
    });

    if (evalId) {
      try {
        const res = await fetch("/api/eval/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            evalId,
            approved: feedback === "like",
            correction: feedback === "dislike" ? feedbackReason : null
          })
        });

        const data = await res.json();
        if (res.ok) {
          if (feedback === "dislike") {
            toast.success("Correção gravada na memória de longo prazo com sucesso!");
          } else if (feedback === "like") {
            toast.success("Feedback positivo registrado!");
          } else {
            toast.success("Feedback removido!");
          }
          fetchEvalData();
          fetchMemories();
        } else {
          console.error("Erro ao registrar feedback:", data.error);
        }
      } catch (e) {
        console.error("Erro na chamada de feedback:", e);
      }
    }
  }, []);

  const handleToggleFavorite = useCallback((index: number) => {
    setMessages((prev) =>
      prev.map((m, i) => (i === index ? { ...m, isFavorite: !m.isFavorite } : m))
    );
  }, []);

  const handleTogglePin = useCallback((index: number) => {
    setMessages((prev) =>
      prev.map((m, i) => (i === index ? { ...m, isPinned: !m.isPinned } : m))
    );
  }, []);

  const handleDeleteMessage = useCallback((index: number) => {
    setMessages((prev) => prev.filter((_, i) => i !== index));
    setRevealedDeleteIndex(null);
    toast.success("Mensagem excluída com sucesso!");
  }, []);

  const handleMessageHoldStart = useCallback((index: number) => {
    if (holdTimeoutId) {
      clearTimeout(holdTimeoutId);
    }
    setHoldingMessageIndex(index);
    const timeout = setTimeout(() => {
      setRevealedDeleteIndex(index);
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try {
          navigator.vibrate(50);
        } catch (e) {}
      }
      toast.info("Mensagem selecionada! Toque na lixeira para excluir.", {
        id: `hold-delete-toast-${index}`,
        duration: 2500
      });
    }, 600); // 600ms hold
    setHoldTimeoutId(timeout);
  }, [holdTimeoutId]);

  const handleMessageHoldEnd = useCallback(() => {
    if (holdTimeoutId) {
      clearTimeout(holdTimeoutId);
      setHoldTimeoutId(null);
    }
    setHoldingMessageIndex(null);
  }, [holdTimeoutId]);

  const handleTouchMove = useCallback(() => {
    if (holdTimeoutId) {
      clearTimeout(holdTimeoutId);
      setHoldTimeoutId(null);
    }
    setHoldingMessageIndex(null);
  }, [holdTimeoutId]);

  // Click listener to reset selected messages for deletion when clicking outside
  useEffect(() => {
    const handleDocumentClick = () => {
      setRevealedDeleteIndex(null);
    };
    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, []);

  // Listen for online/offline connection changes
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      toast.success("Conexão estabelecida! Pesquisa web e salvamento em nuvem reativados.");
    };
    const handleOffline = () => {
      setIsOffline(true);
      setWebSearch(false);
      toast.warning("Modo Offline ativado. Pesquisa web e salvamento em nuvem suspensos.");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Initial check
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setWebSearch(false);
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const [input, setInput] = useState("");
  const [model, setModel] = useState(MODELS[0].id);
  const [webSearch, setWebSearch] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isListening, setIsListening] = useState(false);
  const [recognitionSupported, setRecognitionSupported] = useState(false);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  // States for Prompt Engineering Helper
  const [showPromptHelper, setShowPromptHelper] = useState(false);
  const [activeHelperTab, setActiveHelperTab] = useState<"persona" | "format" | "fewshot" | "context">("persona");
  const [chainOfThought, setChainOfThought] = useState(false);

  // States for AI Router Multimodal metrics
  const [metrics, setMetrics] = useState<any[]>([]);
  const [circuitBreakers, setCircuitBreakers] = useState<Record<string, { state: string; failureCount: number; lastFailureTime: number }>>({});
  const [showMetricsPanel, setShowMetricsPanel] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);

  // Fetch metrics helper from AIRouter backend
  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/metrics");
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
      }

      const cbRes = await fetch("/api/circuit-breakers");
      if (cbRes.ok) {
        const cbData = await cbRes.json();
        setCircuitBreakers(cbData);
      }
    } catch (e) {
      console.error("Erro ao carregar métricas do AI Router:", e);
    }
  }, []);

  const handleToggleSimulatedFailure = useCallback(async (providerId: string, currentStatus: boolean) => {
    try {
      const res = await fetch("/api/circuit-breakers/toggle-failure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, active: !currentStatus }),
      });
      if (res.ok) {
        toast.success(`Falha simulada para ${providerId} ${!currentStatus ? "ativada! O disjuntor irá abrir na próxima tentativa de requisição de IA de forma segura." : "desativada! O provedor voltou a operar normalmente."}`);
        fetchMetrics();
      } else {
        toast.error("Erro ao alternar simulação de falha.");
      }
    } catch (e) {
      toast.error("Erro ao se comunicar com o backend do CloneAI.");
    }
  }, [fetchMetrics]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  // Context Template guided state
  const [guidedRole, setGuidedRole] = useState("professor doutor de economia de Harvard");
  const [guidedAudience, setGuidedAudience] = useState("estudantes universitários");
  const [guidedObjective, setGuidedObjective] = useState("explicar a inflação de forma profunda");
  const [guidedLimits, setGuidedLimits] = useState("limitar a 3 tópicos claros");
  const [guidedTopic, setGuidedTopic] = useState("aumento dos preços de energia");

  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth >= 768;
    }
    return true;
  });

  const [isReadingMode, setIsReadingMode] = useState(false);

  // States for Reading Mode configuration and styling overrides
  const [readingFontSize, setReadingFontSize] = useState<'sm' | 'base' | 'lg' | 'xl'>('base');
  const [readingFontSerif, setReadingFontSerif] = useState(false);
  const [readingTheme, setReadingTheme] = useState<'navy' | 'sepia' | 'dark' | 'light'>('navy');
  const [scrollProgress, setScrollProgress] = useState(0);

  // Track scroll position of the chat scroll area for progress bar when in Reading Mode
  useEffect(() => {
    if (!isReadingMode) return;

    const scroller = document.getElementById("chat-scroller");
    if (!scroller) return;

    let lastProgress = -1;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scroller;
      const totalScroll = scrollHeight - clientHeight;
      let pct = 0;
      if (totalScroll <= 0) {
        pct = 100;
      } else {
        pct = Math.min(100, Math.max(0, Math.round((scrollTop / totalScroll) * 100)));
      }
      
      if (pct !== lastProgress) {
        lastProgress = pct;
        setScrollProgress(pct);
      }
    };

    scroller.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll, { passive: true });
    
    // Initial calculation and deferred recalculation for layout settling
    handleScroll();
    const timer = setTimeout(handleScroll, 100);

    return () => {
      scroller.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      clearTimeout(timer);
    };
  }, [isReadingMode, messages]);

  // Memoized dynamic markdownComponents based on reading mode settings
  const markdownComponents = useMemo(() => ({
    p: ({ children }: any) => {
      const textColor = isReadingMode
        ? readingTheme === 'sepia' ? 'text-[#3B2C1B]' :
          readingTheme === 'light' ? 'text-zinc-800' :
          readingTheme === 'dark' ? 'text-zinc-200' :
          'text-[#F8FAFC]/95'
        : 'text-[#F8FAFC]/95';
      
      const textSize = isReadingMode
        ? readingFontSize === 'sm' ? 'text-xs md:text-sm' :
          readingFontSize === 'base' ? 'text-sm md:text-base' :
          readingFontSize === 'lg' ? 'text-base md:text-lg leading-relaxed' :
          'text-lg md:text-xl leading-relaxed'
        : 'text-sm md:text-base';

      return <p className={`mb-3.5 last:mb-0 leading-relaxed ${textColor} ${textSize}`}>{children}</p>;
    },
    strong: ({ children }: any) => {
      const strongColor = isReadingMode
        ? readingTheme === 'sepia' ? 'text-[#8A5A1E] font-bold' :
          readingTheme === 'light' ? 'text-[#0D9488] font-bold' :
          'text-[#58C7B3] font-semibold'
        : 'text-[#58C7B3] font-semibold';
      return <strong className={strongColor}>{children}</strong>;
    },
    em: ({ children }: any) => <em className="italic opacity-90">{children}</em>,
    ul: ({ children }: any) => {
      const textColor = isReadingMode
        ? readingTheme === 'sepia' ? 'text-[#3B2C1B]' :
          readingTheme === 'light' ? 'text-zinc-800' :
          readingTheme === 'dark' ? 'text-zinc-200' :
          'text-[#F8FAFC]/90'
        : 'text-[#F8FAFC]/90';
      const textSize = isReadingMode
        ? readingFontSize === 'sm' ? 'text-xs md:text-sm' :
          readingFontSize === 'base' ? 'text-sm md:text-base' :
          readingFontSize === 'lg' ? 'text-base md:text-lg' :
          'text-lg md:text-xl'
        : 'text-sm md:text-base';
      return <ul className={`list-disc pl-5 my-2.5 space-y-1.5 ${textColor} ${textSize}`}>{children}</ul>;
    },
    ol: ({ children }: any) => {
      const textColor = isReadingMode
        ? readingTheme === 'sepia' ? 'text-[#3B2C1B]' :
          readingTheme === 'light' ? 'text-zinc-800' :
          readingTheme === 'dark' ? 'text-zinc-200' :
          'text-[#F8FAFC]/90'
        : 'text-[#F8FAFC]/90';
      const textSize = isReadingMode
        ? readingFontSize === 'sm' ? 'text-xs md:text-sm' :
          readingFontSize === 'base' ? 'text-sm md:text-base' :
          readingFontSize === 'lg' ? 'text-base md:text-lg' :
          'text-lg md:text-xl'
        : 'text-sm md:text-base';
      return <ol className={`list-decimal pl-5 my-2.5 space-y-1.5 ${textColor} ${textSize}`}>{children}</ol>;
    },
    li: ({ children }: any) => <li className="leading-relaxed">{children}</li>,
    pre: ({ children }: any) => {
      const bgAndBorder = isReadingMode
        ? readingTheme === 'sepia' ? 'bg-[#EDE4CD] border-[#DCD3BC] text-[#433422]' :
          readingTheme === 'light' ? 'bg-zinc-100 border-zinc-200 text-zinc-900' :
          readingTheme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-zinc-200' :
          'bg-[#111827] border-[#243248] text-[#F8FAFC]'
        : 'bg-[#111827] border-[#243248] text-[#F8FAFC]';
      return (
        <pre className={`my-4 p-4 rounded-[12px] border font-mono text-xs overflow-x-auto leading-relaxed shadow-sm ${bgAndBorder}`}>
          {children}
        </pre>
      );
    },
    code: ({ className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '');
      const isInline = !match && !String(children).includes('\n');
      
      if (isInline) {
        const inlineClass = isReadingMode
          ? readingTheme === 'sepia' ? 'bg-[#EDE4CD] border-[#DCD3BC] text-[#8A5A1E] px-1.5 py-0.5 rounded font-mono text-[11px]' :
            readingTheme === 'light' ? 'bg-zinc-100 border-zinc-200 text-[#0D9488] px-1.5 py-0.5 rounded font-mono text-[11px]' :
            readingTheme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-teal-400 px-1.5 py-0.5 rounded font-mono text-[11px]' :
            'bg-[#111827] border-[#243248] text-[#D8B07A] px-1.5 py-0.5 rounded font-mono text-[11px]'
          : 'bg-[#111827] border-[#243248] text-[#D8B07A] px-1.5 py-0.5 rounded font-mono text-[11px]';
        return <code className={inlineClass} {...props}>{children}</code>;
      } else {
        const textClass = isReadingMode
          ? readingTheme === 'sepia' ? 'block font-mono text-xs text-[#433422]' :
            readingTheme === 'light' ? 'block font-mono text-xs text-zinc-900' :
            readingTheme === 'dark' ? 'block font-mono text-xs text-zinc-200' :
            'block font-mono text-xs text-[#F8FAFC]'
          : 'block font-mono text-xs text-[#F8FAFC]';
        return <code className={textClass} {...props}>{children}</code>;
      }
    },
    table: ({ children }: any) => {
      const borderClass = isReadingMode
        ? readingTheme === 'sepia' ? 'border-[#E4DCC8]' :
          readingTheme === 'light' ? 'border-zinc-200' :
          readingTheme === 'dark' ? 'border-zinc-800' :
          'border-[#243248]'
        : 'border-[#243248]';
      return (
        <div className={`overflow-x-auto my-3 rounded-xl border ${borderClass}`}>
          <table className="w-full border-collapse text-left text-xs md:text-sm">
            {children}
          </table>
        </div>
      );
    },
    thead: ({ children }: any) => {
      const bgAndText = isReadingMode
        ? readingTheme === 'sepia' ? 'bg-[#EDE4CD] text-[#8A5A1E]' :
          readingTheme === 'light' ? 'bg-zinc-100 text-zinc-700' :
          readingTheme === 'dark' ? 'bg-zinc-900 text-teal-400' :
          'bg-[#111827] text-[#D8B07A]'
        : 'bg-[#111827] text-[#D8B07A]';
      const borderClass = isReadingMode
        ? readingTheme === 'sepia' ? 'border-[#E4DCC8]' :
          readingTheme === 'light' ? 'border-zinc-200' :
          readingTheme === 'dark' ? 'border-zinc-800' :
          'border-[#243248]'
        : 'border-[#243248]';
      return (
        <thead className={`font-semibold uppercase border-b ${bgAndText} ${borderClass}`}>
          {children}
        </thead>
      );
    },
    tbody: ({ children }: any) => <tbody>{children}</tbody>,
    tr: ({ children }: any) => {
      const borderClass = isReadingMode
        ? readingTheme === 'sepia' ? 'border-[#E4DCC8]' :
          readingTheme === 'light' ? 'border-zinc-200' :
          readingTheme === 'dark' ? 'border-zinc-800' :
          'border-[#243248]'
        : 'border-[#243248]';
      const hoverClass = isReadingMode
        ? readingTheme === 'sepia' ? 'hover:bg-[#EDE4CD]/35' :
          readingTheme === 'light' ? 'hover:bg-zinc-100/40' :
          'hover:bg-[#111827]/30'
        : 'hover:bg-[#111827]/30';
      return (
        <tr className={`border-b ${borderClass} ${hoverClass} transition-colors last:border-b-0`}>
          {children}
        </tr>
      );
    },
    th: ({ children }: any) => {
      const borderClass = isReadingMode
        ? readingTheme === 'sepia' ? 'border-[#E4DCC8]' :
          readingTheme === 'light' ? 'border-zinc-200' :
          readingTheme === 'dark' ? 'border-zinc-800' :
          'border-[#243248]'
        : 'border-[#243248]';
      return (
        <th className={`px-3 py-2 border-r last:border-r-0 text-[10px] tracking-wider uppercase ${borderClass}`}>
          {children}
        </th>
      );
    },
    td: ({ children }: any) => {
      const borderClass = isReadingMode
        ? readingTheme === 'sepia' ? 'border-[#E4DCC8]' :
          readingTheme === 'light' ? 'border-zinc-200' :
          readingTheme === 'dark' ? 'border-zinc-800' :
          'border-[#243248]'
        : 'border-[#243248]';
      return (
        <td className={`px-3 py-2 border-r last:border-r-0 text-xs md:text-sm ${borderClass}`}>
          {children}
        </td>
      );
    },
    a: ({ href, children }: any) => {
      const linkColor = isReadingMode
        ? readingTheme === 'sepia' ? 'text-[#8A5A1E] hover:text-[#AA7A3E]' :
          readingTheme === 'light' ? 'text-teal-600 hover:text-teal-700' :
          'text-[#58C7B3]'
        : 'text-[#58C7B3]';
      return (
        <a href={href} target="_blank" rel="noreferrer" className={`${linkColor} underline hover:opacity-85 transition-opacity font-medium`}>
          {children}
        </a>
      );
    },
  }), [isReadingMode, readingFontSize, readingFontSerif, readingTheme]);

  // States for interactive tool confirmation guardrails
  const [pendingConfirmation, setPendingConfirmation] = useState<{ name: string; args: any } | null>(null);
  const [confirmedTools, setConfirmedTools] = useState<string[]>([]);
  const [deniedTools, setDeniedTools] = useState<string[]>([]);

  // States for RAG (Base de Conhecimento)
  const [showRagPanel, setShowRagPanel] = useState(false);
  const [ragMetrics, setRagMetrics] = useState<{ totalChunks: number; totalSources: number; sources: string[]; chunksWithEmbeddings: number; percentageVectorized: number }>({
    totalChunks: 0,
    totalSources: 0,
    sources: [],
    chunksWithEmbeddings: 0,
    percentageVectorized: 0
  });
  const [ragManualText, setRagManualText] = useState("");
  const [ragManualSource, setRagManualSource] = useState("");
  const [ragSearchQuery, setRagSearchQuery] = useState("");
  const [ragSearchResults, setRagSearchResults] = useState<any[]>([]);
  const [isIngesting, setIsIngesting] = useState(false);
  const [isSearchingRag, setIsSearchingRag] = useState(false);

  // States for Long-Term Memory
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [memories, setMemories] = useState<any[]>([]);
  const [memoryInputText, setMemoryInputText] = useState("");
  const [memoryInputCategory, setMemoryInputCategory] = useState<string>("geral");
  const [memorySearchQuery, setMemorySearchQuery] = useState("");
  const [memorySearchResults, setMemorySearchResults] = useState<any[]>([]);
  const [isSavingMemory, setIsSavingMemory] = useState(false);
  const [isSearchingMemory, setIsSearchingMemory] = useState(false);

  // States for Agent Evaluation loop
  const [showEvalPanel, setShowEvalPanel] = useState(false);
  const [evalMetrics, setEvalMetrics] = useState<{
    total_avaliadas: number;
    taxa_aprovacao: number;
    falhas_por_provedor: Record<string, number>;
    falhas_por_tool: Record<string, number>;
    total_geral: number;
  }>({
    total_avaliadas: 0,
    taxa_aprovacao: 0,
    falhas_por_provedor: {},
    falhas_por_tool: {},
    total_geral: 0
  });
  const [evalInteractions, setEvalInteractions] = useState<any[]>([]);
  const [showEvalModal, setShowEvalModal] = useState(false);
  const [isExportingDataset, setIsExportingDataset] = useState(false);

  const fetchEvalData = useCallback(async () => {
    try {
      const resMetrics = await fetch("/api/eval/metrics");
      if (resMetrics.ok) {
        const data = await resMetrics.json();
        setEvalMetrics(data);
      }

      const resInteractions = await fetch("/api/eval/interactions");
      if (resInteractions.ok) {
        const data = await resInteractions.json();
        setEvalInteractions(data);
      }
    } catch (e) {
      console.error("Erro ao buscar dados de avaliação:", e);
    }
  }, []);

  // Fetch RAG metrics helper
  const fetchRagMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/rag/metrics");
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.metrics) {
          setRagMetrics(data.metrics);
        }
      }
    } catch (e) {
      console.error("Erro ao buscar métricas do RAG:", e);
    }
  }, []);

  // Fetch long-term memories helper
  const fetchMemories = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (idToken) {
        headers["Authorization"] = `Bearer ${idToken}`;
      }
      const res = await fetch("/api/memory/list", { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.facts) {
          setMemories(data.facts);
        }
      }
    } catch (e) {
      console.error("Erro ao buscar memórias do agente:", e);
    }
  }, [idToken]);

  useEffect(() => {
    fetchRagMetrics();
    fetchMemories();
    fetchEvalData();
  }, [fetchRagMetrics, fetchMemories, fetchEvalData]);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      setRecognitionSupported(true);
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = "pt-BR";

      rec.onstart = () => {
        setIsListening(true);
        setRecognitionError(null);
      };

      rec.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          setInput((prev) => {
            const trimmed = prev.trim();
            return trimmed ? `${trimmed} ${transcript}` : transcript;
          });
        }
      };

      rec.onerror = (event: any) => {
        console.error("Erro no reconhecimento de voz:", event.error);
        if (event.error === "not-allowed") {
          setRecognitionError("Permissão de microfone negada. Verifique as configurações do navegador.");
        } else {
          setRecognitionError(`Erro no microfone: ${event.error}`);
        }
        setIsListening(false);
      };

      rec.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = rec;
    } else {
      setRecognitionSupported(false);
    }
  }, []);

  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) return;

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      // Cancel active voice synth before listening
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setRecognitionError(null);
      try {
        recognitionRef.current.start();
      } catch (err) {
        console.error("Falha ao iniciar reconhecimento de voz:", err);
      }
    }
  }, [isListening]);

  // Load and listen to speech voices
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const loadVoices = () => {
      const list = window.speechSynthesis.getVoices() || [];
      // Prefer Portuguese (PT) voices but fallback to list if none found
      const ptList = list.filter(v => v.lang.toLowerCase().startsWith("pt"));
      setVoices(ptList.length ? ptList : list);
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  // Fetch TTS config from server on mount
  useEffect(() => {
    const fetchTtsConfig = async () => {
      try {
        const res = await fetch("/api/tts/config");
        if (res.ok) {
          const config = await res.json();
          setPremiumConfig(config);
          
          // Auto-select or fallback provider if saved provider is not configured
          const savedProvider = localStorage.getItem("clone_ai_tts_provider");
          if (savedProvider === "elevenlabs" && !config.elevenlabs?.configured) {
            setTtsProvider("browser");
            localStorage.setItem("clone_ai_tts_provider", "browser");
          } else if (savedProvider === "google_cloud" && !config.google_cloud?.configured) {
            setTtsProvider("browser");
            localStorage.setItem("clone_ai_tts_provider", "browser");
          } else if (!savedProvider) {
            if (config.elevenlabs?.configured) {
              setTtsProvider("elevenlabs");
              localStorage.setItem("clone_ai_tts_provider", "elevenlabs");
            } else if (config.google_cloud?.configured) {
              setTtsProvider("google_cloud");
              localStorage.setItem("clone_ai_tts_provider", "google_cloud");
            }
          }
        }
      } catch (error) {
        console.error("Erro ao carregar configurações de TTS do servidor:", error);
      }
    };
    fetchTtsConfig();
  }, []);

  // Sync Voice states to localStorage
  useEffect(() => {
    localStorage.setItem("clone_ai_voice_on", String(voiceOn));
  }, [voiceOn]);

  useEffect(() => {
    localStorage.setItem("clone_ai_voice_uri", selectedVoiceURI);
  }, [selectedVoiceURI]);

  useEffect(() => {
    localStorage.setItem("clone_ai_voice_rate", String(voiceRate));
  }, [voiceRate]);

  useEffect(() => {
    localStorage.setItem("clone_ai_voice_pitch", String(voicePitch));
  }, [voicePitch]);

  useEffect(() => {
    localStorage.setItem("clone_ai_tts_provider", ttsProvider);
  }, [ttsProvider]);

  useEffect(() => {
    localStorage.setItem("clone_ai_premium_voice", selectedPremiumVoice);
  }, [selectedPremiumVoice]);

  // Main voice playback function
  const speak = useCallback(async (text: string, messageIndex?: number) => {
    if (typeof window === "undefined") return;

    // 1. Cancel any active speech or audio immediately
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }
    
    const cleanText = sanitizeTextForSpeech(text);
    if (!cleanText) {
      setIsSpeaking(false);
      setSpeakingMessageIndex(null);
      return;
    }

    if (ttsProvider === "browser") {
      if (!window.speechSynthesis) return;

      const utterance = new SpeechSynthesisUtterance(cleanText);
      
      let voice: SpeechSynthesisVoice | null = null;
      if (selectedVoiceURI) {
        voice = voices.find(v => v.voiceURI === selectedVoiceURI) || null;
      }
      if (!voice) {
        voice = pickBestVoice(voices);
      }

      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = "pt-BR";
      }

      utterance.rate = voiceRate;
      utterance.pitch = voicePitch;

      utterance.onstart = () => {
        setIsSpeaking(true);
        if (messageIndex !== undefined) {
          setSpeakingMessageIndex(messageIndex);
        }
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        setSpeakingMessageIndex(null);
      };

      utterance.onerror = (e) => {
        if (e.error !== "interrupted" && e.error !== "canceled") {
          console.error("Erro no SpeechSynthesisUtterance:", e);
        }
        setIsSpeaking(false);
        setSpeakingMessageIndex(null);
      };

      window.speechSynthesis.speak(utterance);
    } else {
      // PREMIUM PROVIDER (ElevenLabs or Google Cloud TTS)
      const isConfigured = ttsProvider === "elevenlabs" 
        ? premiumConfig.elevenlabs?.configured 
        : premiumConfig.google_cloud?.configured;

      if (!isConfigured) {
        // Fallback proactively to native browser SpeechSynthesis without throwing any console.error
        if (typeof window !== "undefined" && window.speechSynthesis) {
          setIsSpeaking(true);
          if (messageIndex !== undefined) {
            setSpeakingMessageIndex(messageIndex);
          }

          const utterance = new SpeechSynthesisUtterance(cleanText);
          
          let voice: SpeechSynthesisVoice | null = null;
          if (selectedVoiceURI) {
            voice = voices.find(v => v.voiceURI === selectedVoiceURI) || null;
          }
          if (!voice) {
            voice = pickBestVoice(voices);
          }

          if (voice) {
            utterance.voice = voice;
            utterance.lang = voice.lang;
          } else {
            utterance.lang = "pt-BR";
          }

          utterance.rate = voiceRate;
          utterance.pitch = voicePitch;

          utterance.onstart = () => {
            setIsSpeaking(true);
            if (messageIndex !== undefined) {
              setSpeakingMessageIndex(messageIndex);
            }
          };

          utterance.onend = () => {
            setIsSpeaking(false);
            setSpeakingMessageIndex(null);
          };

          utterance.onerror = (e) => {
            setIsSpeaking(false);
            setSpeakingMessageIndex(null);
          };

          window.speechSynthesis.speak(utterance);
        }
        return;
      }

      setIsTtsLoading(true);
      setIsSpeaking(true);
      if (messageIndex !== undefined) {
        setSpeakingMessageIndex(messageIndex);
      }

      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            text: cleanText,
            provider: ttsProvider,
            voiceId: selectedPremiumVoice || undefined,
            pitch: voicePitch
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Erro de síntese (Código ${response.status})`);
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        
        const audio = new Audio(audioUrl);
        activeAudioRef.current = audio;
        
        // Support custom playback rate (speed)
        audio.playbackRate = voiceRate;

        audio.onplay = () => {
          setIsTtsLoading(false);
        };

        audio.onended = () => {
          setIsSpeaking(false);
          setSpeakingMessageIndex(null);
          URL.revokeObjectURL(audioUrl);
        };

        audio.onerror = (e) => {
          console.warn("Informação de áudio TTS:", e);
          setIsSpeaking(false);
          setSpeakingMessageIndex(null);
          setIsTtsLoading(false);
          toast.error("Erro ao reproduzir o áudio sintetizado.");
        };

        await audio.play();

      } catch (err: any) {
        console.warn("Informação: Fallback ativo para Premium TTS:", err.message || err);
        setIsTtsLoading(false);
        
        // Graceful fallback to native browser TTS
        if (typeof window !== "undefined" && window.speechSynthesis) {
          toast.info("Fallback: Utilizando voz nativa do navegador.");
          
          const utterance = new SpeechSynthesisUtterance(cleanText);
          
          let voice: SpeechSynthesisVoice | null = null;
          if (selectedVoiceURI) {
            voice = voices.find(v => v.voiceURI === selectedVoiceURI) || null;
          }
          if (!voice) {
            voice = pickBestVoice(voices);
          }

          if (voice) {
            utterance.voice = voice;
            utterance.lang = voice.lang;
          } else {
            utterance.lang = "pt-BR";
          }

          utterance.rate = voiceRate;
          utterance.pitch = voicePitch;

          utterance.onstart = () => {
            setIsSpeaking(true);
            if (messageIndex !== undefined) {
              setSpeakingMessageIndex(messageIndex);
            }
          };

          utterance.onend = () => {
            setIsSpeaking(false);
            setSpeakingMessageIndex(null);
          };

          utterance.onerror = (e) => {
            if (e.error !== "interrupted" && e.error !== "canceled") {
              console.error("Erro no SpeechSynthesisUtterance (Fallback):", e);
            }
            setIsSpeaking(false);
            setSpeakingMessageIndex(null);
          };

          window.speechSynthesis.speak(utterance);
        } else {
          setIsSpeaking(false);
          setSpeakingMessageIndex(null);
          toast.error(`Falha no TTS Premium: ${err.message || err}`);
        }
      }
    }
  }, [voices, selectedVoiceURI, voiceRate, voicePitch, ttsProvider, selectedPremiumVoice]);

  // Cancel voice when active session changes or when component unmounts
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
      }
    }
    setIsSpeaking(false);
    setSpeakingMessageIndex(null);
  }, [activeSessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);



  async function typewriter(fullText: string, index: number) {
    // Definir status de digitação ativo
    setMessages((prev) => {
      const copy = [...prev];
      if (copy[index]) {
        copy[index] = { ...copy[index], content: "", isTyping: true };
      }
      return copy;
    });

    // Velocidade de digitação fluida baseada no comprimento do texto:
    // ~1.5ms por caractere, limitado inteligentemente para excelente legibilidade e fluidez
    const duration = Math.min(1400, Math.max(350, fullText.length * 1.5));
    const startTime = performance.now();

    await new Promise<void>((resolve) => {
      function tick(now: number) {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const currentLength = Math.floor(progress * fullText.length);

        setMessages((prev) => {
          const copy = [...prev];
          if (copy[index]) {
            copy[index] = { ...copy[index], content: fullText.slice(0, currentLength) };
          }
          return copy;
        });

        if (progress < 1) {
          requestAnimationFrame(tick);
        } else {
          resolve();
        }
      }
      requestAnimationFrame(tick);
    });

    // Finalizar com o texto completo e desativar status de digitação
    setMessages((prev) => {
      const copy = [...prev];
      if (copy[index]) {
        copy[index] = { ...copy[index], content: fullText, isTyping: false };
      }
      return copy;
    });
  }

  // Message regeneration handler (ChatGPT-style)
  const regenerateMessage = useCallback(async (index: number) => {
    if (isStreaming) return;
    
    // Find previous user message
    const prevMsg = messages[index - 1];
    if (!prevMsg || prevMsg.role !== "user") {
      toast.error("Não foi possível localizar o prompt original para regeneração.");
      return;
    }

    setConfirmedTools([]);
    setDeniedTools([]);
    setPendingConfirmation(null);

    const promptText = prevMsg.content;
    const historyUpToPrompt = messages.slice(0, index);

    // Set messages up to index, and add empty assistant message
    setMessages([...historyUpToPrompt, { role: "assistant", content: "", sources: [] }]);
    setIsStreaming(true);

    const apiStartTime = performance.now();

    let payloadMessages = historyUpToPrompt.map((m) => ({ role: m.role, content: m.content }));
    if (chainOfThought && payloadMessages.length > 0) {
      const lastMsg = payloadMessages[payloadMessages.length - 1];
      if (lastMsg.role === "user") {
        lastMsg.content += "\n\n[Instrução do Sistema: Mostre seu raciocínio lógico passo a passo, detalhando cada etapa de forma analítica antes de apresentar a conclusão final.]";
      }
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          ...(idToken ? { "Authorization": `Bearer ${idToken}` } : {})
        },
        body: JSON.stringify({
          messages: payloadMessages,
          model: model,
          webSearch: webSearch,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro na comunicação com o servidor.");
      }

      if (data.requiresConfirmation && data.toolToConfirm) {
        setPendingConfirmation(data.toolToConfirm);
        setIsStreaming(false);
        const textToDisplay = data.text || "O agente precisa de sua autorização para executar uma ferramenta real.";
        await typewriter(textToDisplay, index);
        
        setMessages((prev) => {
          const copy = [...prev];
          if (copy[index]) {
            copy[index] = {
              ...copy[index],
              responseTime: ((performance.now() - apiStartTime) / 1000).toFixed(2),
              providerName: data.providerName,
              modelUsed: data.modelUsed,
              agentSteps: data.agentSteps
            };
          }
          return copy;
        });
        return;
      }

      const finalText = data.text || "(sem resposta)";
      const searchResults = data.sources || [];

      await typewriter(finalText, index);
      if (voiceOn) {
        speak(finalText, index);
      }
      
      const durationSeconds = ((performance.now() - apiStartTime) / 1000).toFixed(2);
      
      setMessages((prev) => {
        const copy = [...prev];
        if (copy[index]) {
          copy[index] = { 
            ...copy[index], 
            sources: searchResults,
            responseTime: durationSeconds,
            providerName: data.providerName,
            modelUsed: data.modelUsed,
            usage: data.usage,
            latencyMs: data.latencyMs,
            estimatedCostUsd: data.estimatedCostUsd,
            cached: data.cached,
            fallbackChain: data.fallbackChain,
            agentSteps: data.agentSteps,
            evalId: data.evalId
          };
        }
        return copy;
      });
      fetchMetrics();
    } catch (err: any) {
      const errText = err?.message || "Erro ao consultar o modelo de IA no backend. Tente novamente em alguns instantes.";
      await typewriter(errText, index);
      
      const durationSeconds = ((performance.now() - apiStartTime) / 1000).toFixed(2);
      setMessages((prev) => {
        const copy = [...prev];
        if (copy[index]) {
          copy[index] = {
            ...copy[index],
            responseTime: durationSeconds
          };
        }
        return copy;
      });
    } finally {
      setIsStreaming(false);
    }
  }, [messages, isStreaming, model, webSearch, chainOfThought]);

  // Handle User Confirming Guardrail Tool Execution
  const handleConfirmTool = async () => {
    if (!pendingConfirmation) return;
    
    const toolName = pendingConfirmation.name;
    const nextConfirmed = [...confirmedTools, toolName];
    setConfirmedTools(nextConfirmed);
    setPendingConfirmation(null);
    setIsStreaming(true);

    const apiStartTime = performance.now();
    const lastUserMessageIndex = messages.map((m, idx) => m.role === "user" ? idx : -1).filter(idx => idx !== -1).pop();
    const historyUpToPrompt = lastUserMessageIndex !== undefined ? messages.slice(0, lastUserMessageIndex + 1) : messages;
    const assistantIdx = lastUserMessageIndex !== undefined ? lastUserMessageIndex + 1 : messages.length - 1;

    // Reset last assistant message to empty to restart streaming visual cue
    setMessages((prev) => {
      const copy = [...prev];
      if (copy[assistantIdx]) {
        copy[assistantIdx] = { role: "assistant", content: "", sources: [] };
      }
      return copy;
    });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          ...(idToken ? { "Authorization": `Bearer ${idToken}` } : {})
        },
        body: JSON.stringify({
          messages: historyUpToPrompt.map((m) => ({ role: m.role, content: m.content })),
          model: model,
          webSearch: webSearch,
          confirmedTools: nextConfirmed,
          deniedTools: deniedTools
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro na comunicação com o servidor.");
      }

      if (data.requiresConfirmation && data.toolToConfirm) {
        setPendingConfirmation(data.toolToConfirm);
        setIsStreaming(false);
        const textToDisplay = data.text || "O agente precisa de sua autorização para executar uma ferramenta real.";
        await typewriter(textToDisplay, assistantIdx);
        
        setMessages((prev) => {
          const copy = [...prev];
          if (copy[assistantIdx]) {
            copy[assistantIdx] = {
              ...copy[assistantIdx],
              responseTime: ((performance.now() - apiStartTime) / 1000).toFixed(2),
              providerName: data.providerName,
              modelUsed: data.modelUsed,
              agentSteps: data.agentSteps
            };
          }
          return copy;
        });
        return;
      }

      const finalText = data.text || "(sem resposta)";
      const searchResults = data.sources || [];

      await typewriter(finalText, assistantIdx);
      if (voiceOn) {
        speak(finalText, assistantIdx);
      }
      
      const durationSeconds = ((performance.now() - apiStartTime) / 1000).toFixed(2);
      
      setMessages((prev) => {
        const copy = [...prev];
        if (copy[assistantIdx]) {
          copy[assistantIdx] = { 
            ...copy[assistantIdx], 
            sources: searchResults,
            responseTime: durationSeconds,
            providerName: data.providerName,
            modelUsed: data.modelUsed,
            usage: data.usage,
            latencyMs: data.latencyMs,
            estimatedCostUsd: data.estimatedCostUsd,
            cached: data.cached,
            fallbackChain: data.fallbackChain,
            agentSteps: data.agentSteps
          };
        }
        return copy;
      });
      fetchMetrics();
    } catch (err: any) {
      const errText = err?.message || "Erro ao consultar o modelo de IA no backend. Tente novamente em alguns instantes.";
      await typewriter(errText, assistantIdx);
    } finally {
      setIsStreaming(false);
    }
  };

  // Handle User Denying Guardrail Tool Execution
  const handleDenyTool = async () => {
    if (!pendingConfirmation) return;
    
    const toolName = pendingConfirmation.name;
    const nextDenied = [...deniedTools, toolName];
    setDeniedTools(nextDenied);
    setPendingConfirmation(null);
    setIsStreaming(true);

    const apiStartTime = performance.now();
    const lastUserMessageIndex = messages.map((m, idx) => m.role === "user" ? idx : -1).filter(idx => idx !== -1).pop();
    const historyUpToPrompt = lastUserMessageIndex !== undefined ? messages.slice(0, lastUserMessageIndex + 1) : messages;
    const assistantIdx = lastUserMessageIndex !== undefined ? lastUserMessageIndex + 1 : messages.length - 1;

    setMessages((prev) => {
      const copy = [...prev];
      if (copy[assistantIdx]) {
        copy[assistantIdx] = { role: "assistant", content: "", sources: [] };
      }
      return copy;
    });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          ...(idToken ? { "Authorization": `Bearer ${idToken}` } : {})
        },
        body: JSON.stringify({
          messages: historyUpToPrompt.map((m) => ({ role: m.role, content: m.content })),
          model: model,
          webSearch: webSearch,
          confirmedTools: confirmedTools,
          deniedTools: nextDenied
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro na comunicação com o servidor.");
      }

      const finalText = data.text || "(sem resposta)";
      const searchResults = data.sources || [];

      await typewriter(finalText, assistantIdx);
      if (voiceOn) {
        speak(finalText, assistantIdx);
      }
      
      const durationSeconds = ((performance.now() - apiStartTime) / 1000).toFixed(2);
      
      setMessages((prev) => {
        const copy = [...prev];
        if (copy[assistantIdx]) {
          copy[assistantIdx] = { 
            ...copy[assistantIdx], 
            sources: searchResults,
            responseTime: durationSeconds,
            providerName: data.providerName,
            modelUsed: data.modelUsed,
            usage: data.usage,
            latencyMs: data.latencyMs,
            estimatedCostUsd: data.estimatedCostUsd,
            cached: data.cached,
            fallbackChain: data.fallbackChain,
            agentSteps: data.agentSteps
          };
        }
        return copy;
      });
      fetchMetrics();
    } catch (err: any) {
      const errText = err?.message || "Erro ao consultar o modelo de IA no backend. Tente novamente em alguns instantes.";
      await typewriter(errText, assistantIdx);
    } finally {
      setIsStreaming(false);
    }
  };

  async function sendMessage(textToSend?: string) {
    if (isOffline) {
      toast.error("Você está offline. Conecte-se à internet para enviar mensagens.");
      return;
    }

    const text = textToSend || input;
    if (!text.trim() || isStreaming) return;

    // Reset tool confirmation guardrail contexts for fresh user inputs
    setConfirmedTools([]);
    setDeniedTools([]);
    setPendingConfirmation(null);

    // Auto-generate title if it's "Nova Conversa" or default/empty
    const currentSession = sessions.find((s) => s.id === activeSessionId);
    if (currentSession && (currentSession.title === "Nova Conversa" || currentSession.title.trim() === "")) {
      const generatedTitle = text.length > 24 ? text.slice(0, 22).trim() + "..." : text;
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSessionId ? { ...s, title: generatedTitle } : s))
      );
    }

    const userMsg: Message = { role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages([...nextMessages, { role: "assistant", content: "", sources: [] }]);
    setInput("");
    setIsStreaming(true);

    const apiStartTime = performance.now();

    // Compile messages for API, appending Chain of Thought instructions dynamically if enabled
    let payloadMessages = nextMessages.map((m) => ({ role: m.role, content: m.content }));
    if (chainOfThought && payloadMessages.length > 0) {
      const lastMsg = payloadMessages[payloadMessages.length - 1];
      if (lastMsg.role === "user") {
        lastMsg.content += "\n\n[Instrução do Sistema: Mostre seu raciocínio lógico passo a passo, detalhando cada etapa de forma analítica antes de apresentar a conclusão final.]";
      }
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          ...(idToken ? { "Authorization": `Bearer ${idToken}` } : {})
        },
        body: JSON.stringify({
          messages: payloadMessages,
          model: model,
          webSearch: webSearch,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro na comunicação com o servidor.");
      }

      if (data.requiresConfirmation && data.toolToConfirm) {
        setPendingConfirmation(data.toolToConfirm);
        setIsStreaming(false);
        const textToDisplay = data.text || "O agente precisa de sua autorização para executar uma ferramenta real.";
        await typewriter(textToDisplay, nextMessages.length);
        
        setMessages((prev) => {
          const copy = [...prev];
          if (copy[nextMessages.length]) {
            copy[nextMessages.length] = {
              ...copy[nextMessages.length],
              responseTime: ((performance.now() - apiStartTime) / 1000).toFixed(2),
              providerName: data.providerName,
              modelUsed: data.modelUsed,
              agentSteps: data.agentSteps
            };
          }
          return copy;
        });
        return;
      }

      const finalText = data.text || "(sem resposta)";
      const searchResults = data.sources || [];

      await typewriter(finalText, nextMessages.length);
      if (voiceOn) {
        speak(finalText, nextMessages.length);
      }
      
      const durationSeconds = ((performance.now() - apiStartTime) / 1000).toFixed(2);
      
      setMessages((prev) => {
        const copy = [...prev];
        if (copy[nextMessages.length]) {
          copy[nextMessages.length] = { 
            ...copy[nextMessages.length], 
            sources: searchResults,
            responseTime: durationSeconds,
            providerName: data.providerName,
            modelUsed: data.modelUsed,
            usage: data.usage,
            latencyMs: data.latencyMs,
            estimatedCostUsd: data.estimatedCostUsd,
            cached: data.cached,
            fallbackChain: data.fallbackChain,
            agentSteps: data.agentSteps
          };
        }
        return copy;
      });
      fetchMetrics();
    } catch (err: any) {
      const errText = err?.message || "Erro ao consultar o modelo de IA no backend. Tente novamente em alguns instantes.";
      await typewriter(errText, nextMessages.length);
      
      const durationSeconds = ((performance.now() - apiStartTime) / 1000).toFixed(2);
      
      setMessages((prev) => {
        const copy = [...prev];
        if (copy[nextMessages.length]) {
          copy[nextMessages.length] = { 
            ...copy[nextMessages.length],
            responseTime: durationSeconds
          };
        }
        return copy;
      });
    } finally {
      setIsStreaming(false);
    }
  }

  function clearChat() {
    setMessages([]);
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSessionId ? { ...s, title: "Nova Conversa" } : s))
    );
  }

  return (
    <div
      id="clone-ai-root"
      className="flex flex-col h-screen font-sans antialiased overflow-hidden"
      style={{ backgroundColor: COLORS.bg, color: COLORS.textPrimary }}
    >
      <AnimatePresence mode="wait">
        {showSplashScreen && (
          <motion.div
            key="splash"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeInOut" }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0B1020]"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="flex flex-col items-center gap-5 px-6 text-center select-none"
            >
              <Logo className="w-24 h-24 drop-shadow-[0_4px_20px_rgba(88,199,179,0.15)] animate-pulse" />
              <div className="space-y-1.5 mt-2">
                <h1 className="text-3xl font-semibold tracking-tight text-[#F8FAFC]">
                  Clone<span style={{ color: COLORS.sand }}>AI</span>
                </h1>
                <p className="text-[10px] tracking-widest text-[#94A3B8] uppercase font-medium">
                  Powered by Multimodal Intelligence
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header
        id="clone-ai-header"
        className="flex items-center justify-between px-5 py-3.5 border-b shrink-0"
        style={{ backgroundColor: COLORS.bgHeader, borderColor: COLORS.borderSoft }}
      >
        <div className="flex items-center gap-3.5" id="header-branding-container">
          {!isReadingMode && (
            <button
              id="toggle-sidebar-btn"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 rounded-xl hover:bg-[#58C7B3]/10 text-[#58C7B3] border border-[#58C7B3]/25 cursor-pointer transition-all duration-200 active:scale-95"
              title={isSidebarOpen ? "Recolher painel" : "Expandir painel"}
            >
              <Menu size={16} />
            </button>
          )}
          <div className="flex items-center gap-2.5" id="header-branding">
            <Logo className="w-6 h-6 shrink-0" id="header-icon" />
            <span className="font-semibold tracking-tight text-sm md:text-base text-white">
              Clone <span style={{ color: "#D8B07A" }}>AI</span>
            </span>
            {isOffline && (
              <span className="text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/25 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider animate-pulse flex items-center gap-1.5 shadow-[0_0_8px_rgba(245,158,11,0.15)]" title="Você está navegando em modo offline. O salvamento em nuvem e a pesquisa web foram desativados.">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block animate-ping" />
                Offline (Modo Local)
              </span>
            )}
            {isReadingMode && (
              <span className="text-[10px] bg-[#58C7B3]/15 text-[#58C7B3] border border-[#58C7B3]/25 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider animate-pulse flex items-center gap-1.5 shadow-[0_0_8px_rgba(88,199,179,0.15)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#58C7B3] inline-block animate-ping" />
                Modo Leitura
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {/* Botão Modo Leitura */}
          <button
            id="reading-mode-btn"
            onClick={() => {
              setIsReadingMode(!isReadingMode);
              if (!isReadingMode) {
                toast.success("Modo Leitura ativado! Foco total, sem distrações.");
              } else {
                toast.success("Modo Leitura desativado!");
              }
            }}
            className={`p-2 rounded-xl border cursor-pointer transition-all duration-200 active:scale-95 ${
              isReadingMode
                ? "bg-[#58C7B3]/20 border-[#58C7B3] text-[#58C7B3] shadow-[0_0_12px_rgba(88,199,179,0.15)]"
                : "border-[#243248] text-[#94A3B8] hover:text-[#58C7B3] hover:border-[#58C7B3]/25 hover:bg-[#58C7B3]/5"
            }`}
            title={isReadingMode ? "Desativar Modo Leitura" : "Ativar Modo Leitura"}
          >
            <BookOpen size={16} className={isReadingMode ? "animate-pulse" : ""} />
          </button>

          <button
            id="clear-chat-btn"
            onClick={() => setIsConfirmModalOpen(true)}
            disabled={messages.length === 0}
            className="p-2 rounded-xl hover:bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/25 disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer transition-all duration-200 active:scale-95"
            title="Limpar terminal"
          >
            <Trash2 size={16} />
          </button>

          {/* User Auth Widget */}
          {isAuthLoading ? (
            <div className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1 px-3 py-2 border border-slate-800 rounded-xl">
              <RefreshCw size={12} className="animate-spin text-[#58C7B3]" />
              <span>Conectando...</span>
            </div>
          ) : user ? (
            <div className="flex items-center gap-2 bg-[#111827]/80 border border-emerald-500/30 px-3 py-1.5 rounded-xl text-xs" title="Sessão sincronizada com o PostgreSQL">
              <div className="flex items-center gap-1.5">
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || "Avatar"} className="w-5.5 h-5.5 rounded-full border border-emerald-400" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-5.5 h-5.5 rounded-full bg-emerald-500/10 border border-emerald-400/30 text-emerald-400 flex items-center justify-center font-bold text-[10px] uppercase">
                    {(user.displayName || user.email || "U")[0]}
                  </div>
                )}
                <div className="hidden sm:flex flex-col text-left">
                  <span className="text-[10px] font-bold text-slate-200 leading-none max-w-[100px] truncate">{user.displayName || user.email?.split("@")[0]}</span>
                  <span className="text-[8px] text-emerald-400 font-mono leading-none flex items-center gap-0.5 mt-0.5">
                    <ShieldCheck size={8} /> Cloud SQL
                  </span>
                </div>
              </div>
              <button
                id="sign-out-btn"
                onClick={handleSignOut}
                className="ml-1 p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer transition-colors"
                title="Desconectar"
              >
                <LogOut size={13} />
              </button>
            </div>
          ) : (
            <button
              id="sign-in-btn"
              onClick={handleSignIn}
              className="bg-[#111827] border border-[#58C7B3]/40 hover:border-[#58C7B3] hover:bg-[#58C7B3]/5 text-[#58C7B3] transition-all flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer active:scale-95 shadow-[0_0_8px_rgba(88,199,179,0.05)]"
              title="Entrar com o Google para salvar sessões no banco de dados Cloud SQL"
            >
              <LogIn size={13} />
              <span className="hidden sm:inline">Nuvem SQL</span>
              <span className="sm:hidden">Entrar</span>
            </button>
          )}
        </div>
      </header>

      {/* Main layout container splitting sidebar and chat */}
      <div className="flex-1 flex overflow-hidden relative" id="main-layout-split">
        {/* Sidebar Panel */}
        {isSidebarOpen && !isReadingMode && (
          <aside
            id="sidebar-panel"
            className="w-72 border-r flex flex-col shrink-0 z-20 absolute md:relative h-full md:h-auto animate-fade-in"
            style={{ backgroundColor: COLORS.bgHeader, borderColor: COLORS.borderSoft }}
          >
            {/* Sidebar Title */}
            <div className="px-5 py-5 border-b flex items-center justify-between shrink-0" style={{ borderColor: COLORS.borderSoft }}>
              <div className="flex items-center gap-2.5">
                <Logo className="w-6 h-6 shrink-0" />
                <span className="font-semibold tracking-tight text-sm text-white">
                  Clone<span style={{ color: COLORS.sand }}>AI</span>
                </span>
              </div>
              <button
                id="close-sidebar-mobile-btn"
                onClick={() => setIsSidebarOpen(false)}
                className="md:hidden p-1.5 rounded-xl hover:bg-[#243248]/50 text-[#94A3B8] cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            {/* Sidebar Content */}
            <div className="flex-1 overflow-y-auto flex flex-col divide-y divide-[#1a2745]" id="sidebar-content">
              {/* Seção de Conversas */}
              <div className="p-5 flex flex-col gap-3 shrink-0" id="sidebar-sessions-section">
                <button
                  id="new-chat-btn"
                  onClick={createNewSession}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-dashed border-[#58C7B3]/40 text-[#58C7B3] bg-[#58C7B3]/5 hover:bg-[#58C7B3]/10 hover:border-[#58C7B3] active:scale-[0.98] transition-all text-xs font-semibold cursor-pointer"
                >
                  <Plus size={14} />
                  Nova Conversa
                </button>
                
                <div className="flex flex-col gap-1.5 mt-2" id="sessions-list">
                  <label className="text-[10px] uppercase tracking-wider block font-bold mb-1" style={{ color: COLORS.textMuted }}>
                    &gt; conversas_recentes
                  </label>
                  <div className="flex flex-col gap-1 max-h-[220px] overflow-y-auto pr-1">
                    {sessions.length === 0 ? (
                      <div className="text-[10px] py-2 text-center font-medium" style={{ color: COLORS.textMuted }}>
                        Nenhum histórico
                      </div>
                    ) : (
                      sessions.map((s) => {
                        const isActive = s.id === activeSessionId;
                        const isEditing = s.id === editingSessionId;
                        return (
                          <div
                            key={s.id}
                            onClick={() => {
                              if (!isEditing) {
                                setActiveSessionId(s.id);
                                if (window.innerWidth < 768) {
                                  setIsSidebarOpen(false);
                                }
                              }
                            }}
                            className={`group flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs transition-all cursor-pointer border ${
                              isActive
                                ? "bg-[#58C7B3]/10 border-[#58C7B3]/20 text-[#58C7B3] font-medium"
                                : "border-transparent hover:bg-[#182235] text-[#94A3B8] hover:text-[#F8FAFC]"
                            }`}
                          >
                            {isEditing ? (
                              <input
                                type="text"
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveRename(s.id);
                                  if (e.key === "Escape") setEditingSessionId(null);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                autoFocus
                                className="bg-[#111827] border border-[#58C7B3] text-[#F8FAFC] px-2 py-1 rounded-lg text-xs w-full focus:outline-none"
                              />
                            ) : (
                              <span className="truncate flex-1 pr-2">
                                {s.title || "Conversa Sem Título"}
                              </span>
                            )}
                            
                            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              {isEditing ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    saveRename(s.id);
                                  }}
                                  className="p-1 rounded-md hover:bg-[#243248] text-emerald-500 cursor-pointer"
                                  title="Salvar"
                                >
                                  <Check size={11} />
                                </button>
                              ) : (
                                <>
                                  <button
                                    onClick={(e) => startRenaming(s.id, s.title, e)}
                                    className="p-1 rounded-md hover:bg-[#243248] text-slate-400 hover:text-[#D8B07A] cursor-pointer"
                                    title="Renomear"
                                  >
                                    <Edit2 size={11} />
                                  </button>
                                  <button
                                    onClick={(e) => deleteSession(s.id, e)}
                                    className="p-1 rounded-md hover:bg-[#243248] text-slate-400 hover:text-[#EF4444] cursor-pointer"
                                    title="Excluir"
                                    disabled={sessions.length <= 1 && s.messages.length === 0}
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Seção de Configurações */}
              <div className="p-5 space-y-6" id="sidebar-settings-section">
                {/* Modelo Selecionado */}
                <div className="flex flex-col gap-2" id="sidebar-model-container">
                  <label className="text-[10px] uppercase tracking-wider block font-bold" style={{ color: COLORS.textMuted }}>
                    &gt; modelo_selecionado
                  </label>
                  <select
                    id="model-selector"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full text-xs rounded-xl px-3 py-2.5 border focus:outline-none cursor-pointer transition-all focus:border-[#58C7B3] focus:ring-1 focus:ring-[#58C7B3]"
                    style={{ backgroundColor: COLORS.surface, borderColor: COLORS.border, color: COLORS.textPrimary }}
                  >
                    {MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] opacity-75 leading-normal" style={{ color: COLORS.textMuted }}>
                    Selecione o motor neural para processamento das requisições.
                  </p>
                </div>

                {/* Pesquisa em Tempo Real */}
                <div className="flex flex-col gap-2" id="sidebar-websearch-container">
                  <label className="text-[10px] uppercase tracking-wider block font-bold" style={{ color: COLORS.textMuted }}>
                    &gt; pesquisa_tempo_real
                  </label>
                  <button
                    id="websearch-toggle"
                    disabled={isOffline}
                    onClick={() => {
                      if (isOffline) {
                        toast.error("Pesquisa na web indisponível no modo offline.");
                        return;
                      }
                      setWebSearch((v) => !v);
                    }}
                    className={`w-full flex items-center justify-center gap-2 text-xs rounded-xl px-3.5 py-2.5 border transition-all duration-200 ${
                      isOffline ? "opacity-40 cursor-not-allowed" : "hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
                    }`}
                    style={
                      webSearch && !isOffline
                        ? { backgroundColor: "rgba(88, 199, 179, 0.12)", borderColor: COLORS.teal, color: COLORS.teal, borderStyle: "solid", borderWidth: "1px" }
                        : { backgroundColor: COLORS.surface, borderColor: COLORS.border, color: COLORS.textMuted, borderStyle: "solid", borderWidth: "1px" }
                    }
                    title={isOffline ? "Pesquisa na web indisponível no modo offline" : "Ative para realizar pesquisa real via Google Search"}
                  >
                    <Globe size={13} className={webSearch && !isOffline ? "animate-spin-slow" : ""} />
                    {isOffline ? "pesquisa: INDISPONÍVEL (OFFLINE)" : (webSearch ? "pesquisa: ATIVA" : "pesquisa: DESATIVADA")}
                  </button>
                  <p className="text-[10px] opacity-75 leading-normal" style={{ color: COLORS.textMuted }}>
                    Consulta fontes na web para trazer respostas atualizadas em tempo real.
                  </p>
                </div>

                {/* Configuração de Voz Natural */}
                <div className="flex flex-col gap-3 border-t pt-4 border-[#243248]" id="sidebar-voice-settings-container">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase tracking-wider block font-bold" style={{ color: COLORS.textMuted }}>
                      &gt; sintese_voz_natural
                    </label>
                    <span className="text-[9px] uppercase bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded-full font-semibold">
                      {ttsProvider === "browser" ? "Nativo" : "HD Realista"}
                    </span>
                  </div>

                  {/* Auto-read Toggle Button */}
                  <button
                    id="voice-auto-read-toggle"
                    onClick={() => {
                      const newValue = !voiceOn;
                      setVoiceOn(newValue);
                      if (!newValue && typeof window !== "undefined") {
                        if (window.speechSynthesis) {
                          window.speechSynthesis.cancel();
                        }
                        if (activeAudioRef.current) {
                          activeAudioRef.current.pause();
                          activeAudioRef.current = null;
                        }
                        setIsSpeaking(false);
                        setSpeakingMessageIndex(null);
                      }
                      toast.success(newValue ? "Leitura automática ATIVADA!" : "Leitura automática desativada.");
                    }}
                    className="w-full flex items-center justify-center gap-2 text-xs rounded-xl px-3.5 py-2.5 border transition-all hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
                    style={
                      voiceOn
                        ? { backgroundColor: "rgba(88, 199, 179, 0.12)", borderColor: COLORS.teal, color: COLORS.teal, borderWidth: "1px", borderStyle: "solid" }
                        : { backgroundColor: COLORS.surface, borderColor: COLORS.border, color: COLORS.textMuted, borderWidth: "1px", borderStyle: "solid" }
                    }
                    title="Ative para ler automaticamente as novas mensagens do assistente"
                  >
                    {voiceOn ? <Volume2 size={13} className="animate-pulse" /> : <VolumeX size={13} />}
                    {voiceOn ? "LEITURA AUTO: ATIVA" : "LEITURA AUTO: DESATIVADA"}
                  </button>

                  {/* Provider Selector */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: COLORS.textMuted }}>
                      Provedor de Voz:
                    </span>
                    <div className="grid grid-cols-3 gap-1 bg-[#111827] p-1 rounded-xl border border-[#243248]">
                      <button
                        onClick={() => {
                          setTtsProvider("browser");
                          toast.success("Provedor alterado para Nativo!");
                        }}
                        className={`text-[9.5px] py-1.5 rounded-lg transition-all duration-200 cursor-pointer ${
                          ttsProvider === "browser" ? "bg-[#58C7B3]/15 text-[#58C7B3] border border-[#58C7B3]/20 font-semibold" : "text-slate-400 hover:bg-[#243248]/40"
                        }`}
                      >
                        Nativo
                      </button>
                      <button
                        onClick={() => {
                          setTtsProvider("elevenlabs");
                          toast.success("Provedor alterado para ElevenLabs!");
                        }}
                        className={`text-[9.5px] py-1.5 rounded-lg transition-all duration-200 cursor-pointer flex items-center justify-center gap-1 ${
                          ttsProvider === "elevenlabs" ? "bg-[#58C7B3]/15 text-[#58C7B3] border border-[#58C7B3]/20 font-semibold" : "text-slate-400 hover:bg-[#243248]/40"
                        }`}
                      >
                        ElevenLabs
                        {premiumConfig.elevenlabs?.configured && <span className="w-1 h-1 rounded-full bg-emerald-400 inline-block animate-pulse" />}
                      </button>
                      <button
                        onClick={() => {
                          setTtsProvider("google_cloud");
                          toast.success("Provedor alterado para Google Cloud!");
                        }}
                        className={`text-[9.5px] py-1.5 rounded-lg transition-all duration-200 cursor-pointer flex items-center justify-center gap-1 ${
                          ttsProvider === "google_cloud" ? "bg-[#58C7B3]/15 text-[#58C7B3] border border-[#58C7B3]/20 font-semibold" : "text-slate-400 hover:bg-[#243248]/40"
                        }`}
                      >
                        Google
                        {premiumConfig.google_cloud?.configured && <span className="w-1 h-1 rounded-full bg-emerald-400 inline-block animate-pulse" />}
                      </button>
                    </div>
                  </div>

                  {/* Provider warnings if keys are missing */}
                  {ttsProvider === "elevenlabs" && !premiumConfig.elevenlabs?.configured && (
                    <div className="text-[10px] p-2.5 rounded-xl bg-[#D8B07A]/5 border border-[#D8B07A]/15 text-[#D8B07A] leading-relaxed">
                      ⚠️ <strong className="text-[#D8B07A] font-semibold">ElevenLabs inativo</strong>. Configure <code className="bg-[#0B1020] px-1.5 py-0.5 rounded text-white font-mono font-bold">ELEVENLABS_API_KEY</code> no Painel de Segredos para ativar vozes ultra-realistas.
                    </div>
                  )}

                  {ttsProvider === "google_cloud" && !premiumConfig.google_cloud?.configured && (
                    <div className="text-[10px] p-2.5 rounded-xl bg-[#D8B07A]/5 border border-[#D8B07A]/15 text-[#D8B07A] leading-relaxed">
                      ⚠️ <strong className="text-[#D8B07A] font-semibold">Google TTS inativo</strong>. Configure <code className="bg-[#0B1020] px-1.5 py-0.5 rounded text-white font-mono font-bold">GOOGLE_TTS_API_KEY</code> no Painel de Segredos para ativar vozes neurais de alta fidelidade.
                    </div>
                  )}

                  {/* Dynamic Voice Selector */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMuted }}>
                      Voz de Leitura Selecionada:
                    </span>

                    {ttsProvider === "browser" ? (
                      voices.length === 0 ? (
                        <div className="text-[10px] p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
                          Nenhuma voz nativa detectada no navegador.
                        </div>
                      ) : (
                        <select
                          id="voice-selector"
                          value={selectedVoiceURI}
                          onChange={(e) => {
                            setSelectedVoiceURI(e.target.value);
                            toast.success("Voz nativa selecionada!");
                          }}
                          className="w-full text-[11px] rounded-xl px-3 py-2.5 border focus:outline-none cursor-pointer transition-all focus:border-[#58C7B3] focus:ring-1 focus:ring-[#58C7B3] truncate text-[#F8FAFC]"
                          style={{ backgroundColor: COLORS.surface, borderColor: COLORS.border }}
                        >
                          <option value="">-- Usar Melhor Voz Natural Detectada --</option>
                          {voices.map((v) => {
                            const isNatural = /natural|neural|online|google|premium/i.test(v.name) || /natural|neural|online|google|premium/i.test(v.voiceURI);
                            return (
                              <option key={v.voiceURI} value={v.voiceURI} className="truncate">
                                {isNatural ? "✨ " : "👤 "}
                                {v.name} ({v.lang})
                              </option>
                            );
                          })}
                        </select>
                      )
                    ) : ttsProvider === "elevenlabs" ? (
                      <select
                        id="elevenlabs-voice-selector"
                        value={selectedPremiumVoice}
                        onChange={(e) => {
                          setSelectedPremiumVoice(e.target.value);
                          toast.success("Voz ElevenLabs selecionada!");
                        }}
                        disabled={!premiumConfig.elevenlabs?.configured}
                        className="w-full text-[11px] rounded-xl px-3 py-2.5 border focus:outline-none cursor-pointer transition-all focus:border-[#58C7B3] focus:ring-1 focus:ring-[#58C7B3] truncate text-[#F8FAFC] disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: COLORS.surface, borderColor: COLORS.border }}
                      >
                        <option value="">-- Usar Voz Rachel (Padrão) --</option>
                        {premiumConfig.elevenlabs?.voices?.map((v) => (
                          <option key={v.id} value={v.id} className="truncate">
                            ✨ {v.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <select
                        id="gtts-voice-selector"
                        value={selectedPremiumVoice}
                        onChange={(e) => {
                          setSelectedPremiumVoice(e.target.value);
                          toast.success("Voz Google Cloud selecionada!");
                        }}
                        disabled={!premiumConfig.google_cloud?.configured}
                        className="w-full text-[11px] rounded-xl px-3 py-2.5 border focus:outline-none cursor-pointer transition-all focus:border-[#58C7B3] focus:ring-1 focus:ring-[#58C7B3] truncate text-[#F8FAFC] disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: COLORS.surface, borderColor: COLORS.border }}
                      >
                        <option value="">-- Usar Voz Neural2-C (Padrão) --</option>
                        {premiumConfig.google_cloud?.voices?.map((v) => (
                          <option key={v.id} value={v.id} className="truncate">
                            🤖 {v.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Voice Rate (Speed) Slider */}
                  <div className="flex flex-col gap-1.5 bg-[#111827] p-3 rounded-xl border border-[#243248]">
                    <div className="flex items-center justify-between text-[10px] mb-1 text-slate-400 font-medium">
                      <span className="flex items-center gap-1"><Sliders size={10} /> VELOCIDADE (SPEED)</span>
                      <span className="text-[#58C7B3] font-bold">{voiceRate.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.6"
                      max="1.5"
                      step="0.05"
                      value={voiceRate}
                      onChange={(e) => setVoiceRate(parseFloat(e.target.value))}
                      className="w-full accent-[#58C7B3] cursor-pointer h-1 rounded bg-[#182235]"
                    />
                    <span className="text-[8.5px] opacity-65 text-slate-400 mt-1 leading-normal">
                      Ajuste para deixar a fala mais cadenciada e leve.
                    </span>
                  </div>

                  {/* Voice Pitch Slider */}
                  <div className="flex flex-col gap-1.5 bg-[#111827] p-3 rounded-xl border border-[#243248]">
                    <div className="flex items-center justify-between text-[10px] mb-1 text-slate-400 font-medium">
                      <span className="flex items-center gap-1"><Sliders size={10} /> TOM DA VOZ (PITCH)</span>
                      <span className="text-[#58C7B3] font-bold">{voicePitch.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.7"
                      max="1.3"
                      step="0.05"
                      value={voicePitch}
                      onChange={(e) => setVoicePitch(parseFloat(e.target.value))}
                      className="w-full accent-[#58C7B3] cursor-pointer h-1 rounded bg-[#182235]"
                    />
                    <span className="text-[8.5px] opacity-65 text-slate-400 mt-1 leading-normal">
                      Mais baixo (grave) ou alto (agudo) para uma fala realista.
                    </span>
                  </div>

                  {/* Test voice buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => speak("Olá! Esta é uma demonstração de síntese de voz ultra-realista e humanizada. O que você achou do meu novo tom e ritmo de fala?", -99)}
                      disabled={isTtsLoading}
                      className="flex-1 text-center py-2 text-[10px] uppercase font-bold rounded-xl border bg-[#58C7B3]/5 hover:bg-[#58C7B3]/10 text-[#58C7B3] transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-wait"
                      style={{ borderColor: "rgba(88, 199, 179, 0.3)" }}
                    >
                      {isTtsLoading ? (
                        <>
                          <RefreshCw size={10} className="animate-spin" /> Sintetizando...
                        </>
                      ) : (
                        <>
                          <Play size={10} /> Testar Voz
                        </>
                      )}
                    </button>
                    {isSpeaking && (
                      <button
                        onClick={() => {
                          if (typeof window !== "undefined") {
                            if (window.speechSynthesis) {
                              window.speechSynthesis.cancel();
                            }
                            if (activeAudioRef.current) {
                              activeAudioRef.current.pause();
                              activeAudioRef.current = null;
                            }
                          }
                          setIsSpeaking(false);
                          setSpeakingMessageIndex(null);
                        }}
                        className="px-3.5 py-2 text-[10px] uppercase font-bold rounded-xl border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <Square size={9} fill="currentColor" /> Parar
                      </button>
                    )}
                  </div>
                </div>

                {/* Painel do AI Router */}
                <div className="flex flex-col gap-2 border-t pt-4 border-[#243248]" id="sidebar-router-metrics-container">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase tracking-wider block font-bold" style={{ color: COLORS.textMuted }}>
                      &gt; ai_router_telemetria
                    </label>
                    <button
                      onClick={() => setShowMetricsPanel(!showMetricsPanel)}
                      className="text-[10px] px-2.5 py-1 rounded-lg border hover:bg-[#182235] text-slate-300 transition-colors uppercase cursor-pointer"
                      style={{ borderColor: COLORS.border }}
                    >
                      {showMetricsPanel ? "Ocultar" : "Expandir"}
                    </button>
                  </div>

                  {showMetricsPanel ? (
                    <div className="p-4 rounded-xl border text-xs space-y-3.5 bg-[#111827] animate-fade-in" style={{ borderColor: COLORS.borderSoft }}>
                      <div className="grid grid-cols-2 gap-2 text-center">
                        <div className="bg-[#182235] p-2.5 rounded-xl border border-[#243248]">
                          <div className="text-[9px] text-slate-400 font-medium">REQUISIÇÕES</div>
                          <div className="text-sm font-bold text-[#D8B07A]">{metrics.length}</div>
                        </div>
                        <div className="bg-[#182235] p-2.5 rounded-xl border border-[#243248]">
                          <div className="text-[9px] text-slate-400 font-medium">LATÊNCIA MÉD.</div>
                          <div className="text-sm font-bold text-[#D8B07A]">
                            {metrics.length > 0
                              ? (metrics.reduce((acc, curr) => acc + curr.latencyMs, 0) / metrics.length / 1000).toFixed(2)
                              : "0.00"}s
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5 text-[11px] text-slate-300 font-medium">
                        <div className="flex justify-between">
                          <span>Custo Est. Total:</span>
                          <span className="text-emerald-400 font-bold">
                            ${metrics.reduce((acc, curr) => acc + (curr.estimatedCostUsd || 0), 0).toFixed(6)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Cache Hits (Hits/Tot):</span>
                          <span>
                            {metrics.filter((m) => m.cached).length}/{metrics.length}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Fallbacks Ativos:</span>
                          <span className="text-amber-500 font-bold">
                            {metrics.filter((m) => m.status === "fallback").length}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Falhas Totais:</span>
                          <span className="text-rose-500 font-bold">
                            {metrics.filter((m) => m.status === "failed").length}
                          </span>
                        </div>
                      </div>

                      {/* Circuit Breakers States */}
                      <div className="pt-2.5 border-t border-[#243248] space-y-2">
                        <div className="text-[9.5px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                          <Sliders size={10} className="text-[#58C7B3]" /> Disjuntores de Provedores
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                          {["gemini", "openai", "claude", "llama", "deepseek", "mistral"].map((prov) => {
                            const info = (circuitBreakers[prov] as any) || { state: "CLOSED", failureCount: 0, simulatedFailure: false };
                            
                            let label = "";
                            if (prov === "gemini") label = "Gemini";
                            else if (prov === "openai") label = "OpenAI";
                            else if (prov === "claude") label = "Claude";
                            else if (prov === "llama") label = "Llama";
                            else if (prov === "deepseek") label = "DeepSeek";
                            else if (prov === "mistral") label = "Mistral";

                            const isClosed = info.state === "CLOSED";
                            const isOpen = info.state === "OPEN";
                            const isSimFailing = !!info.simulatedFailure;
                            
                            const stateColor = isOpen 
                              ? "text-rose-400" 
                              : info.state === "HALF_OPEN" 
                                ? "text-amber-400" 
                                : "text-emerald-400";
                                
                            const dotColor = isOpen 
                              ? "bg-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" 
                              : info.state === "HALF_OPEN" 
                                ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" 
                                : "bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]";
                                
                            return (
                              <div 
                                key={prov} 
                                className={`p-2 rounded-lg border flex flex-col gap-1 hover:border-[#58C7B3]/15 transition-all relative ${
                                  isSimFailing 
                                    ? "bg-rose-950/20 border-rose-500/20 shadow-[0_0_8px_rgba(239,68,68,0.05)]" 
                                    : "bg-[#182235]/60 border-[#243248]/45"
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className={`font-semibold ${isSimFailing ? "text-rose-300 animate-pulse" : "text-slate-300"}`}>{label}</span>
                                  <div className="flex items-center gap-1">
                                    <span className={`w-1.5 h-1.5 rounded-full ${dotColor} animate-pulse`} />
                                    <span className={`font-extrabold text-[8.5px] uppercase tracking-wider ${stateColor}`}>
                                      {info.state}
                                    </span>
                                  </div>
                                </div>
                                {info.failureCount > 0 && (
                                  <div className="text-[8.5px] text-slate-400 flex items-center justify-between">
                                    <span>Falhas:</span>
                                    <span className={isOpen ? "text-rose-400 font-bold" : "text-amber-400"}>
                                      {info.failureCount}
                                    </span>
                                  </div>
                                )}
                                
                                <div className="flex items-center justify-between mt-1 pt-1 border-t border-[#243248]/30 text-[9px]">
                                  <span className={`text-[8px] font-mono ${isSimFailing ? "text-rose-400 font-bold animate-pulse" : "text-slate-500"}`}>
                                    {isSimFailing ? "⚠️ SIM. FALHA" : "Saudável"}
                                  </span>
                                  <button
                                    onClick={() => handleToggleSimulatedFailure(prov, isSimFailing)}
                                    className={`p-1 rounded cursor-pointer transition-all ${
                                      isSimFailing 
                                        ? "bg-rose-500/25 text-rose-400 border border-rose-500/35 hover:bg-rose-500/35" 
                                        : "bg-slate-800/60 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent"
                                    }`}
                                    title={isSimFailing ? "Desativar falha simulada" : "Forçar falha simulada de rede neste provedor"}
                                  >
                                    {isSimFailing ? <Zap size={8} /> : <ZapOff size={8} />}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-[#243248] flex gap-2">
                        <button
                          onClick={async () => {
                            try {
                              const res = await fetch("/api/cache/clear", { method: "POST" });
                              if (res.ok) {
                                toast.success("Cache do AI Router limpo com sucesso!");
                                fetchMetrics();
                              }
                            } catch (err) {
                              toast.error("Erro ao limpar cache.");
                            }
                          }}
                          className="w-full text-center py-2 text-[10px] uppercase font-bold rounded-xl border bg-[#58C7B3]/5 hover:bg-[#58C7B3]/10 text-[#58C7B3] transition-all cursor-pointer"
                          style={{ borderColor: "rgba(88, 199, 179, 0.3)" }}
                        >
                          Limpar Cache
                        </button>
                        <button
                          onClick={fetchMetrics}
                          className="text-center px-3 py-2 rounded-xl border hover:bg-[#182235] text-slate-300 transition-all cursor-pointer"
                          style={{ borderColor: COLORS.border }}
                          title="Atualizar Métricas"
                        >
                          <RefreshCw size={10} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowMetricsPanel(true)}
                      className="w-full text-left p-3 rounded-xl border hover:bg-[#182235] text-xs text-slate-400 flex items-center justify-between transition-all"
                      style={{ backgroundColor: COLORS.surface, borderColor: COLORS.border }}
                    >
                      <span>Ver métricas do Router</span>
                      <Sparkles size={10} className="text-[#58C7B3]" />
                    </button>
                  )}
                </div>

                {/* Painel da Base de Conhecimento RAG */}
                <div className="flex flex-col gap-2 border-t pt-4 border-[#243248]" id="sidebar-rag-container">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase tracking-wider block font-bold" style={{ color: COLORS.textMuted }}>
                      &gt; base_de_conhecimento_rag
                    </label>
                    <button
                      onClick={() => setShowRagPanel(!showRagPanel)}
                      className="text-[10px] px-2.5 py-1 rounded-lg border hover:bg-[#182235] text-slate-300 transition-colors uppercase cursor-pointer"
                      style={{ borderColor: COLORS.border }}
                    >
                      {showRagPanel ? "Ocultar" : "Gerenciar"}
                    </button>
                  </div>

                  {showRagPanel ? (
                    <div className="p-4 rounded-xl border text-xs space-y-4 bg-[#111827] animate-fade-in" style={{ borderColor: COLORS.borderSoft }}>
                      {/* Metrics grid */}
                      <div className="grid grid-cols-3 gap-1.5 text-center">
                        <div className="bg-[#182235] p-2 rounded-lg border border-[#243248]/50">
                          <div className="text-[8px] text-slate-400 font-bold">CHUNKS</div>
                          <div className="text-xs font-bold text-[#58C7B3]">{ragMetrics.totalChunks}</div>
                        </div>
                        <div className="bg-[#182235] p-2 rounded-lg border border-[#243248]/50">
                          <div className="text-[8px] text-slate-400 font-bold">DOCS</div>
                          <div className="text-xs font-bold text-[#D8B07A]">{ragMetrics.totalSources}</div>
                        </div>
                        <div className="bg-[#182235] p-2 rounded-lg border border-[#243248]/50">
                          <div className="text-[8px] text-slate-400 font-bold">VETORIZADO</div>
                          <div className="text-xs font-bold text-emerald-400">{ragMetrics.percentageVectorized}%</div>
                        </div>
                      </div>

                      {/* Source list */}
                      {ragMetrics.sources.length > 0 && (
                        <div className="space-y-1 bg-[#182235]/40 p-2.5 rounded-lg border border-[#243248]/30 max-h-[80px] overflow-y-auto">
                          <div className="text-[8.5px] text-slate-400 font-bold uppercase tracking-wider">Documentos Ativos:</div>
                          {ragMetrics.sources.map((src, sIdx) => (
                            <div key={sIdx} className="flex items-center justify-between text-[10px] text-slate-300 group/item">
                              <span className="truncate max-w-[120px]" title={src}>📄 {src}</span>
                              <button
                                onClick={async () => {
                                  try {
                                    const res = await fetch("/api/rag/source", {
                                      method: "DELETE",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ source: src })
                                    });
                                    if (res.ok) {
                                      toast.success(`Documento "${src}" removido!`);
                                      fetchRagMetrics();
                                    }
                                  } catch (err) {
                                    toast.error("Erro ao remover documento.");
                                  }
                                }}
                                className="opacity-0 group-hover/item:opacity-100 hover:text-rose-400 transition-all text-slate-500 cursor-pointer"
                                title="Excluir documento"
                              >
                                <Trash2 size={9} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Folder ingestion trigger */}
                      <div className="space-y-1.5">
                        <button
                          disabled={isIngesting}
                          onClick={async () => {
                            setIsIngesting(true);
                            try {
                              const res = await fetch("/api/rag/ingest-directory", { method: "POST" });
                              const data = await res.json();
                              if (res.ok) {
                                toast.success(data.message || "Documentos importados com sucesso!");
                                fetchRagMetrics();
                              } else {
                                toast.error(data.error || "Erro ao escanear a pasta.");
                              }
                            } catch (err) {
                              toast.error("Erro na comunicação com o backend.");
                            } finally {
                              setIsIngesting(false);
                            }
                          }}
                          className="w-full text-center py-2 text-[10px] uppercase font-bold rounded-xl border bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 border-emerald-500/20 hover:border-emerald-500/45 transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-wait"
                        >
                          <BookOpen size={10} /> Ingerir ./documentos
                        </button>
                        <p className="text-[8.5px] text-slate-500 leading-normal">
                          Lê todos os arquivos <span className="font-semibold font-mono">.txt / .md</span> na pasta de documentos local.
                        </p>
                      </div>

                      {/* Manual Ingestion Accordion */}
                      <div className="border-t border-[#243248]/50 pt-2.5 space-y-2">
                        <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Indexar Texto Manual</div>
                        <input
                          type="text"
                          placeholder="Nome da fonte (ex: nota_estudo.txt)"
                          value={ragManualSource}
                          onChange={(e) => setRagManualSource(e.target.value)}
                          className="w-full text-[10px] bg-[#182235]/60 border border-[#243248]/55 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-[#58C7B3]"
                        />
                        <textarea
                          placeholder="Cole aqui o texto ou nota técnica para indexar na Base de Conhecimento..."
                          value={ragManualText}
                          onChange={(e) => setRagManualText(e.target.value)}
                          rows={3}
                          className="w-full text-[10px] bg-[#182235]/60 border border-[#243248]/55 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-[#58C7B3] resize-none"
                        />
                        <button
                          disabled={isIngesting || !ragManualText.trim()}
                          onClick={async () => {
                            setIsIngesting(true);
                            try {
                              const res = await fetch("/api/rag/ingest", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ text: ragManualText, source: ragManualSource || "input_manual" })
                              });
                              const data = await res.json();
                              if (res.ok) {
                                toast.success("Texto manual indexado com sucesso!");
                                setRagManualText("");
                                setRagManualSource("");
                                fetchRagMetrics();
                              } else {
                                toast.error(data.error || "Erro ao indexar texto.");
                              }
                            } catch (err) {
                              toast.error("Erro ao enviar dados para indexação.");
                            } finally {
                              setIsIngesting(false);
                            }
                          }}
                          className="w-full text-center py-1.5 text-[10px] uppercase font-bold rounded-lg border border-[#243248] hover:border-[#58C7B3]/45 hover:bg-[#58C7B3]/5 text-slate-300 hover:text-white transition-all cursor-pointer disabled:opacity-40"
                        >
                          Indexar Conteúdo
                        </button>
                      </div>

                      {/* Semantic Search Test Accordion */}
                      <div className="border-t border-[#243248]/50 pt-2.5 space-y-2">
                        <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Testar Busca Semântica</div>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            placeholder="Buscar termos na base..."
                            value={ragSearchQuery}
                            onChange={(e) => setRagSearchQuery(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === "Enter" && !isSearchingRag && ragSearchQuery.trim()) {
                                e.preventDefault();
                                const searchBtn = document.getElementById("btn-search-rag");
                                if (searchBtn) searchBtn.click();
                              }
                            }}
                            className="flex-1 text-[10px] bg-[#182235]/60 border border-[#243248]/55 rounded-lg px-2.5 py-1 text-slate-200 focus:outline-none focus:border-[#58C7B3]"
                          />
                          <button
                            id="btn-search-rag"
                            disabled={isSearchingRag || !ragSearchQuery.trim()}
                            onClick={async () => {
                              setIsSearchingRag(true);
                              try {
                                const res = await fetch("/api/rag/search", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ query: ragSearchQuery })
                                });
                                const data = await res.json();
                                if (res.ok) {
                                  setRagSearchResults(data.results || []);
                                  if (data.results?.length === 0) {
                                    toast.info("Nenhum trecho correspondente encontrado.");
                                  }
                                } else {
                                  toast.error("Erro na pesquisa.");
                                }
                              } catch (err) {
                                toast.error("Falha ao pesquisar.");
                              } finally {
                                setIsSearchingRag(false);
                              }
                            }}
                            className="px-2 py-1 text-[9px] uppercase font-bold rounded-lg bg-[#58C7B3]/10 hover:bg-[#58C7B3]/20 text-[#58C7B3] border border-[#58C7B3]/25 cursor-pointer disabled:opacity-50"
                          >
                            Ir
                          </button>
                        </div>

                        {ragSearchResults.length > 0 && (
                          <div className="space-y-2 bg-[#0d131f] p-2 rounded-lg border border-[#243248]/40 max-h-[140px] overflow-y-auto">
                            <div className="flex justify-between items-center border-b border-[#243248]/30 pb-1 mb-1">
                              <span className="text-[8px] text-slate-500 font-bold uppercase">Resultados ({ragSearchResults.length})</span>
                              <button
                                onClick={() => {
                                  setRagSearchResults([]);
                                  setRagSearchQuery("");
                                }}
                                className="text-[8px] text-slate-400 hover:text-white cursor-pointer"
                              >
                                Limpar
                              </button>
                            </div>
                            {ragSearchResults.map((resItem, resIdx) => (
                              <div key={resIdx} className="text-[9.5px] border-b border-[#243248]/20 last:border-0 pb-1.5 mb-1.5 last:pb-0 last:mb-0 space-y-1">
                                <div className="flex justify-between font-bold text-slate-400 text-[8px]">
                                  <span className="truncate max-w-[100px]">📁 {resItem.source}</span>
                                  <span className="text-emerald-400">Score: {resItem.score.toFixed(3)}</span>
                                </div>
                                <div className="text-slate-300 leading-normal italic bg-slate-900/40 p-1.5 rounded border border-[#243248]/20">
                                  "{resItem.text}"
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Clear RAG base */}
                      <div className="pt-2 border-t border-[#243248]/50">
                        <button
                          onClick={async () => {
                            if (window.confirm("Deseja realmente apagar todo o conhecimento indexado na base do RAG? Isso não afeta os arquivos originais na pasta de documentos.")) {
                              try {
                                const res = await fetch("/api/rag/clear", { method: "POST" });
                                if (res.ok) {
                                  toast.success("Base de conhecimento apagada!");
                                  setRagSearchResults([]);
                                  fetchRagMetrics();
                                }
                              } catch (err) {
                                toast.error("Erro ao limpar base de conhecimento.");
                              }
                            }
                          }}
                          className="w-full text-center py-1.5 text-[9px] uppercase font-bold rounded-lg border border-rose-500/20 hover:border-rose-500/40 text-rose-400 hover:bg-rose-500/5 transition-all cursor-pointer"
                        >
                          Limpar Base RAG
                        </button>
                      </div>

                    </div>
                  ) : (
                    <button
                      onClick={() => setShowRagPanel(true)}
                      className="w-full text-left p-3 rounded-xl border hover:bg-[#182235] text-xs text-slate-400 flex items-center justify-between transition-all cursor-pointer"
                      style={{ backgroundColor: COLORS.surface, borderColor: COLORS.border }}
                    >
                      <span>Gerenciar Base RAG</span>
                      <BookOpen size={10} className="text-[#58C7B3]" />
                    </button>
                  )}
                </div>

                {/* Painel de Memória de Longo Prazo do Agente */}
                <div className="flex flex-col gap-2 border-t pt-4 border-[#243248]" id="sidebar-memory-container">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase tracking-wider block font-bold" style={{ color: COLORS.textMuted }}>
                      &gt; memoria_longo_prazo
                    </label>
                    <button
                      onClick={() => setShowMemoryPanel(!showMemoryPanel)}
                      className="text-[10px] px-2.5 py-1 rounded-lg border hover:bg-[#182235] text-slate-300 transition-colors uppercase cursor-pointer"
                      style={{ borderColor: COLORS.border }}
                    >
                      {showMemoryPanel ? "Ocultar" : "Gerenciar"}
                    </button>
                  </div>

                  {showMemoryPanel ? (
                    <div className="p-4 rounded-xl border text-xs space-y-4 bg-[#111827] animate-fade-in" style={{ borderColor: COLORS.borderSoft }}>
                      <div className="grid grid-cols-2 gap-1.5 text-center">
                        <div className="bg-[#182235] p-2 rounded-lg border border-[#243248]/50">
                          <div className="text-[8px] text-slate-400 font-bold">FATOS SALVOS</div>
                          <div className="text-xs font-bold text-[#58C7B3]">{memories.length}</div>
                        </div>
                        <div className="bg-[#182235] p-2 rounded-lg border border-[#243248]/50">
                          <div className="text-[8px] text-slate-400 font-bold">MEMÓRIA ATIVA</div>
                          <div className="text-xs font-bold text-emerald-400">Ativa (100%)</div>
                        </div>
                      </div>

                      {memories.length > 0 ? (
                        <div className="space-y-1.5 bg-[#182235]/40 p-2.5 rounded-lg border border-[#243248]/30 max-h-[120px] overflow-y-auto">
                          <div className="text-[8.5px] text-slate-400 font-bold uppercase tracking-wider mb-1">Fatos na Memória:</div>
                          {memories.map((fact) => {
                            const badgeColors: Record<string, string> = {
                              preferencia: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
                              decisao: "bg-amber-500/10 text-amber-400 border-amber-500/20",
                              contexto_projeto: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
                              correcao: "bg-purple-500/10 text-purple-400 border-purple-500/20",
                              geral: "bg-slate-500/10 text-slate-400 border-slate-500/20",
                            };
                            const badgeClass = badgeColors[fact.category] || badgeColors.geral;

                            return (
                              <div key={fact.id} className="flex flex-col gap-1 p-1.5 rounded bg-slate-900/60 border border-[#243248]/20 group/fact">
                                <div className="flex items-center justify-between">
                                  <span className={`text-[8px] px-1 py-0.2 rounded border font-mono uppercase ${badgeClass}`}>
                                    {fact.category}
                                  </span>
                                  <button
                                    onClick={async () => {
                                      try {
                                        const headers: Record<string, string> = { "Content-Type": "application/json" };
                                        if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
                                        const res = await fetch("/api/memory/fact", {
                                          method: "DELETE",
                                          headers,
                                          body: JSON.stringify({ id: fact.id })
                                        });
                                        if (res.ok) {
                                          toast.success("Memória esquecida pelo agente!");
                                          fetchMemories();
                                        }
                                      } catch (err) {
                                        toast.error("Erro ao esquecer memória.");
                                      }
                                    }}
                                    className="opacity-0 group-hover/fact:opacity-100 hover:text-rose-400 transition-all text-slate-500 cursor-pointer"
                                    title="Esquecer este fato"
                                  >
                                    <Trash2 size={9} />
                                  </button>
                                </div>
                                <div className="text-[9.5px] text-slate-300 leading-normal font-mono break-words">
                                  {fact.text}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-[9.5px] text-slate-500 italic text-center py-2 bg-[#182235]/20 rounded-lg border border-[#243248]/20">
                          Nenhuma preferência ou fato salvo ainda.
                        </div>
                      )}

                      <div className="border-t border-[#243248]/50 pt-2.5 space-y-2">
                        <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Gravar Novo Fato/Preferência</div>
                        <div className="flex gap-1.5">
                          <select
                            value={memoryInputCategory}
                            onChange={(e) => setMemoryInputCategory(e.target.value)}
                            className="text-[9.5px] bg-[#182235] border border-[#243248]/60 rounded-lg px-1.5 py-1 text-slate-300 focus:outline-none focus:border-[#58C7B3] cursor-pointer"
                          >
                            <option value="preferencia">Preferência</option>
                            <option value="decisao">Decisão</option>
                            <option value="contexto_projeto">Projeto</option>
                            <option value="correcao">Correção</option>
                            <option value="geral">Geral</option>
                          </select>
                        </div>
                        <textarea
                          placeholder="Ex: O usuário prefere responder sempre em português técnico. / O banco do projeto é PostgreSQL."
                          value={memoryInputText}
                          onChange={(e) => setMemoryInputText(e.target.value)}
                          rows={2}
                          className="w-full text-[10px] bg-[#182235]/60 border border-[#243248]/55 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-[#58C7B3] resize-none"
                        />
                        <button
                          disabled={isSavingMemory || !memoryInputText.trim()}
                          onClick={async () => {
                            setIsSavingMemory(true);
                            try {
                              const headers: Record<string, string> = { "Content-Type": "application/json" };
                              if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
                              const res = await fetch("/api/memory/save", {
                                method: "POST",
                                headers,
                                body: JSON.stringify({ text: memoryInputText, category: memoryInputCategory })
                              });
                              if (res.ok) {
                                toast.success("Fato gravado na memória de longo prazo!");
                                setMemoryInputText("");
                                fetchMemories();
                              } else {
                                toast.error("Erro ao gravar fato.");
                              }
                            } catch (err) {
                              toast.error("Erro de rede ao salvar memória.");
                            } finally {
                              setIsSavingMemory(false);
                            }
                          }}
                          className="w-full text-center py-1.5 text-[10px] uppercase font-bold rounded-lg border border-[#243248] hover:border-[#58C7B3]/45 hover:bg-[#58C7B3]/5 text-slate-300 hover:text-white transition-all cursor-pointer disabled:opacity-40"
                        >
                          Gravar na Memória
                        </button>
                      </div>

                      <div className="border-t border-[#243248]/50 pt-2.5 space-y-2">
                        <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Testar Busca na Memória</div>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            placeholder="Pesquisar por relevância na memória..."
                            value={memorySearchQuery}
                            onChange={(e) => setMemorySearchQuery(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === "Enter" && !isSearchingMemory && memorySearchQuery.trim()) {
                                e.preventDefault();
                                const searchBtn = document.getElementById("btn-search-mem");
                                if (searchBtn) searchBtn.click();
                              }
                            }}
                            className="flex-1 text-[10px] bg-[#182235]/60 border border-[#243248]/55 rounded-lg px-2.5 py-1 text-slate-200 focus:outline-none focus:border-[#58C7B3]"
                          />
                          <button
                            id="btn-search-mem"
                            disabled={isSearchingMemory || !memorySearchQuery.trim()}
                            onClick={async () => {
                              setIsSearchingMemory(true);
                              try {
                                const headers: Record<string, string> = { "Content-Type": "application/json" };
                                if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
                                const res = await fetch("/api/memory/search", {
                                  method: "POST",
                                  headers,
                                  body: JSON.stringify({ query: memorySearchQuery })
                                });
                                const data = await res.json();
                                if (res.ok) {
                                  setMemorySearchResults(data.results || []);
                                  if (data.results?.length === 0) {
                                    toast.info("Nenhum fato relevante encontrado na memória.");
                                  }
                                } else {
                                  toast.error("Erro na busca de memórias.");
                                }
                              } catch (err) {
                                toast.error("Erro ao buscar memórias.");
                              } finally {
                                setIsSearchingMemory(false);
                              }
                            }}
                            className="px-2 py-1 text-[9px] uppercase font-bold rounded-lg bg-[#58C7B3]/10 hover:bg-[#58C7B3]/20 text-[#58C7B3] border border-[#58C7B3]/25 cursor-pointer disabled:opacity-50"
                          >
                            Ir
                          </button>
                        </div>

                        {memorySearchResults.length > 0 && (
                          <div className="space-y-2 bg-[#0d131f] p-2 rounded-lg border border-[#243248]/40 max-h-[140px] overflow-y-auto">
                            <div className="flex justify-between items-center border-b border-[#243248]/30 pb-1 mb-1">
                              <span className="text-[8px] text-slate-500 font-bold uppercase">Resultados ({memorySearchResults.length})</span>
                              <button
                                onClick={() => {
                                  setMemorySearchResults([]);
                                  setMemorySearchQuery("");
                                }}
                                className="text-[8px] text-slate-400 hover:text-white cursor-pointer"
                              >
                                Limpar
                              </button>
                            </div>
                            {memorySearchResults.map((resItem, resIdx) => (
                              <div key={resIdx} className="text-[9.5px] border-b border-[#243248]/20 last:border-0 pb-1.5 mb-1.5 last:pb-0 last:mb-0 space-y-1">
                                <div className="flex justify-between font-bold text-slate-400 text-[8px]">
                                  <span className="truncate max-w-[100px] uppercase">🏷️ {resItem.category}</span>
                                  <span className="text-emerald-400">Relevância: {resItem.relevance}</span>
                                </div>
                                <div className="text-slate-300 leading-normal italic bg-slate-900/40 p-1.5 rounded border border-[#243248]/20">
                                  "{resItem.text}"
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="pt-2 border-t border-[#243248]/50">
                        <button
                          onClick={async () => {
                            if (window.confirm("Deseja realmente apagar toda a memória de longo prazo do agente? Isso fará o agente esquecer todas as decisões e preferências.")) {
                              try {
                                const headers: Record<string, string> = {};
                                if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
                                const res = await fetch("/api/memory/clear", { 
                                  method: "POST",
                                  headers
                                });
                                if (res.ok) {
                                  toast.success("Toda a memória do agente foi apagada!");
                                  setMemorySearchResults([]);
                                  fetchMemories();
                                }
                              } catch (err) {
                                toast.error("Erro ao limpar memória.");
                              }
                            }
                          }}
                          className="w-full text-center py-1.5 text-[9px] uppercase font-bold rounded-lg border border-rose-500/20 hover:border-rose-500/40 text-rose-400 hover:bg-rose-500/5 transition-all cursor-pointer"
                        >
                          Limpar Memória Agente
                        </button>
                      </div>

                    </div>
                  ) : (
                    <button
                      onClick={() => setShowMemoryPanel(true)}
                      className="w-full text-left p-3 rounded-xl border hover:bg-[#182235] text-xs text-slate-400 flex items-center justify-between transition-all cursor-pointer"
                      style={{ backgroundColor: COLORS.surface, borderColor: COLORS.border }}
                    >
                      <span>Gerenciar Memória Agente</span>
                      <Brain size={10} className="text-[#58C7B3]" />
                    </button>
                  )}
                </div>

                {/* --- SEÇÃO DE AVALIAÇÃO DO AGENTE & DATASET (EVALUATOR) --- */}
                <div className="flex flex-col gap-2 border-t pt-4 border-[#243248]" id="sidebar-evaluation-container">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase tracking-wider block font-bold" style={{ color: COLORS.textMuted }}>
                      &gt; avaliacao_e_dataset
                    </label>
                    <button
                      onClick={() => setShowEvalPanel(!showEvalPanel)}
                      className="text-[10px] px-2.5 py-1 rounded-lg border hover:bg-[#182235] text-slate-300 transition-colors uppercase cursor-pointer"
                      style={{ borderColor: COLORS.border }}
                    >
                      {showEvalPanel ? "Ocultar" : "Expandir"}
                    </button>
                  </div>

                  {showEvalPanel ? (
                    <div className="p-4 rounded-xl border text-xs space-y-4 bg-[#111827] animate-fade-in" style={{ borderColor: COLORS.borderSoft }}>
                      <div className="grid grid-cols-2 gap-1.5 text-center">
                        <div className="bg-[#182235] p-2 rounded-lg border border-[#243248]/50">
                          <div className="text-[8px] text-slate-400 font-bold">AVALIADAS</div>
                          <div className="text-xs font-bold text-[#58C7B3]">
                            {evalMetrics?.total_avaliadas || 0}
                          </div>
                        </div>
                        <div className="bg-[#182235] p-2 rounded-lg border border-[#243248]/50">
                          <div className="text-[8px] text-slate-400 font-bold">APROVAÇÃO</div>
                          <div className={`text-xs font-bold ${
                            (evalMetrics?.taxa_aprovacao || 0) >= 0.85 
                              ? "text-emerald-400" 
                              : (evalMetrics?.taxa_aprovacao || 0) >= 0.7 
                                ? "text-amber-400" 
                                : "text-rose-400"
                          }`}>
                            {evalMetrics?.total_avaliadas > 0 
                              ? `${((evalMetrics?.taxa_aprovacao || 0) * 100).toFixed(1)}%` 
                              : "N/A"}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <button
                          onClick={() => setShowEvalModal(true)}
                          className="w-full text-center py-2 text-[10px] uppercase font-bold rounded-lg bg-[#58C7B3]/10 hover:bg-[#58C7B3]/25 text-[#58C7B3] border border-[#58C7B3]/25 transition-all cursor-pointer"
                        >
                          Ver Histórico ({evalInteractions.length})
                        </button>

                        <button
                          disabled={isExportingDataset || evalInteractions.filter(i => i.aprovado === false).length === 0}
                          onClick={async () => {
                            setIsExportingDataset(true);
                            try {
                              const res = await fetch("/api/eval/export", { method: "POST" });
                              const data = await res.json();
                              if (res.ok) {
                                toast.success(data.message);
                                
                                // Download file directly
                                const contentRes = await fetch("/api/eval/interactions");
                                if (contentRes.ok) {
                                  const interactions = await contentRes.json();
                                  const reproved = interactions.filter((i: any) => i.aprovado === false && i.correcao);
                                  const jsonlLines = reproved.map((i: any) => JSON.stringify({
                                    pergunta: i.pergunta,
                                    resposta_errada: i.resposta,
                                    resposta_corrigida: i.correcao
                                  })).join("\n") + "\n";

                                  const blob = new Blob([jsonlLines], { type: "application/x-jsonlines" });
                                  const url = window.URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  a.href = url;
                                  a.download = "dataset_correcoes.jsonl";
                                  document.body.appendChild(a);
                                  a.click();
                                  document.body.removeChild(a);
                                  window.URL.revokeObjectURL(url);
                                }
                              } else {
                                toast.error("Falha ao exportar dataset.");
                              }
                            } catch (e) {
                              toast.error("Erro de rede ao exportar.");
                            } finally {
                              setIsExportingDataset(false);
                            }
                          }}
                          className="w-full text-center py-2 text-[10px] uppercase font-bold rounded-lg border border-[#243248] hover:border-[#58C7B3]/40 text-slate-300 hover:text-white transition-all cursor-pointer disabled:opacity-40"
                        >
                          {isExportingDataset ? "Exportando..." : "Exportar Dataset (.jsonl)"}
                        </button>
                      </div>

                      {/* Provider and Tool failure breakdowns if we have failure metrics */}
                      {evalMetrics?.total_avaliadas > 0 && (
                        <div className="border-t border-[#243248]/50 pt-2.5 space-y-2">
                          <div className="text-[8.5px] text-slate-400 font-bold uppercase tracking-wider mb-1">Análise de Erros / Falhas:</div>
                          
                          {/* Failure by Provider */}
                          <div className="space-y-1">
                            <div className="text-[8px] text-slate-400 font-bold">FALHAS POR PROVEDOR:</div>
                            {Object.keys(evalMetrics.falhas_por_provedor || {}).length > 0 ? (
                              Object.entries(evalMetrics.falhas_por_provedor).map(([prov, count]) => (
                                <div key={prov} className="flex justify-between text-[9px] bg-slate-950/40 px-2 py-1 rounded">
                                  <span className="capitalize">{prov}</span>
                                  <span className="text-rose-400 font-bold">{count as number} falha(s)</span>
                                </div>
                              ))
                            ) : (
                              <div className="text-[8.5px] text-slate-500 italic">Nenhuma falha de provedor registrada.</div>
                            )}
                          </div>

                          {/* Failure by Tool */}
                          <div className="space-y-1 pt-1.5">
                            <div className="text-[8px] text-slate-400 font-bold">FALHAS POR FERRAMENTA:</div>
                            {Object.keys(evalMetrics.falhas_por_tool || {}).length > 0 ? (
                              Object.entries(evalMetrics.falhas_por_tool).map(([tool, count]) => (
                                <div key={tool} className="flex justify-between text-[9px] bg-slate-950/40 px-2 py-1 rounded font-mono">
                                  <span className="truncate max-w-[120px]">{tool}</span>
                                  <span className="text-rose-400 font-bold">{count as number} falha(s)</span>
                                </div>
                              ))
                            ) : (
                              <div className="text-[8.5px] text-slate-500 italic">Nenhuma falha de ferramenta registrada.</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowEvalPanel(true)}
                      className="w-full text-left p-3 rounded-xl border hover:bg-[#182235] text-xs text-slate-400 flex items-center justify-between transition-all cursor-pointer"
                      style={{ backgroundColor: COLORS.surface, borderColor: COLORS.border }}
                    >
                      <div className="flex items-center gap-1.5">
                        <Sparkles size={10} className="text-[#58C7B3]" />
                        <span>Avaliação & Dataset</span>
                      </div>
                      <span className="text-[8.5px] font-mono px-1 bg-[#182235] border rounded text-emerald-400 font-bold">
                        {evalMetrics?.total_avaliadas || 0} aval.
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar Footer Info */}
            <div className="p-4 border-t shrink-0" style={{ borderColor: COLORS.borderSoft, backgroundColor: "rgba(0,0,0,0.15)" }}>
              <div className="flex items-center justify-between text-[10px] mb-1" style={{ color: COLORS.textMuted }}>
                <span>HISTÓRICO LOCAL:</span>
                <span className="text-[#58C7B3] font-bold">{messages.length} msgs</span>
              </div>
              <div className="text-[9px] leading-normal" style={{ color: COLORS.textMuted }}>
                As vozes dependem da compatibilidade do navegador atual.
              </div>
            </div>
          </aside>
        )}

        {/* Right Area (Chat Container + Inputs) */}
        <div 
          className={`flex-1 flex flex-col h-full overflow-hidden relative transition-colors duration-300 ${
            isReadingMode && readingTheme === 'sepia' ? 'bg-[#F4ECD8]' :
            isReadingMode && readingTheme === 'dark' ? 'bg-[#09090B]' :
            isReadingMode && readingTheme === 'light' ? 'bg-[#FAFAFA]' :
            ''
          }`}
          id="chat-pane-container"
        >


        {isReadingMode && (
          <div 
            className={`px-6 py-3 border-b flex flex-wrap items-center justify-between gap-4 transition-colors duration-300 z-10 sticky top-0 ${
              readingTheme === 'sepia' ? 'bg-[#EDE4CD] border-[#DCD3BC] text-[#433422]' :
              readingTheme === 'dark' ? 'bg-[#121214] border-zinc-800 text-zinc-200' :
              readingTheme === 'light' ? 'bg-zinc-50 border-zinc-200 text-zinc-800' :
              'bg-[#121826] border-slate-800 text-slate-200'
            }`}
          >
            {/* Esquerda: Indicador de Progresso / Título */}
            <div className="flex items-center gap-3">
              <div className={`p-1.5 rounded-lg ${
                readingTheme === 'sepia' ? 'bg-[#433422]/10 text-[#433422]' :
                readingTheme === 'dark' ? 'bg-zinc-800 text-zinc-200' :
                readingTheme === 'light' ? 'bg-zinc-200 text-zinc-800' :
                'bg-slate-800 text-[#58C7B3]'
              }`}>
                <BookOpen size={16} />
              </div>
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider leading-none">Modo Leitura Focada</h4>
                <p className="text-[10px] opacity-70 leading-none mt-1">Ambiente de leitura otimizado e livre de distrações</p>
              </div>
            </div>

            {/* Centro: Controles de Estilo (Fonte, Tamanho, Tema) */}
            <div className="flex flex-wrap items-center gap-4">
              {/* Ajuste de Tamanho */}
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-60 mr-1">Tamanho:</span>
                {(['sm', 'base', 'lg', 'xl'] as const).map((sz) => (
                  <button
                    key={sz}
                    onClick={() => setReadingFontSize(sz)}
                    className={`px-2 py-1 rounded-lg text-xs font-bold transition-all uppercase cursor-pointer ${
                      readingFontSize === sz
                        ? readingTheme === 'sepia' ? 'bg-[#433422] text-[#F4ECD8]' :
                          readingTheme === 'light' ? 'bg-zinc-900 text-white' :
                          readingTheme === 'dark' ? 'bg-zinc-200 text-zinc-950' :
                          'bg-[#58C7B3] text-zinc-950'
                        : readingTheme === 'sepia' ? 'hover:bg-[#433422]/10 text-[#433422]/70' :
                          readingTheme === 'light' ? 'hover:bg-zinc-200 text-zinc-600' :
                          readingTheme === 'dark' ? 'hover:bg-zinc-800 text-zinc-400' :
                          'hover:bg-slate-800 text-slate-400'
                    }`}
                  >
                    {sz === 'sm' ? 'P' : sz === 'base' ? 'M' : sz === 'lg' ? 'G' : 'GG'}
                  </button>
                ))}
              </div>

              {/* Ajuste de Fonte (Serif / Sans) */}
              <div className="flex items-center gap-1 border-l pl-4 border-current/20">
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-60 mr-1">Estilo:</span>
                <button
                  onClick={() => setReadingFontSerif(false)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    !readingFontSerif
                      ? readingTheme === 'sepia' ? 'bg-[#433422] text-[#F4ECD8]' :
                        readingTheme === 'light' ? 'bg-zinc-900 text-white' :
                        readingTheme === 'dark' ? 'bg-zinc-200 text-zinc-950' :
                        'bg-[#58C7B3] text-zinc-950'
                      : readingTheme === 'sepia' ? 'hover:bg-[#433422]/10 text-[#433422]/70' :
                        readingTheme === 'light' ? 'hover:bg-zinc-200 text-zinc-600' :
                        readingTheme === 'dark' ? 'hover:bg-zinc-800 text-zinc-400' :
                        'hover:bg-slate-800 text-slate-400'
                  }`}
                >
                  Moderna
                </button>
                <button
                  onClick={() => setReadingFontSerif(true)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-serif font-bold transition-all cursor-pointer ${
                    readingFontSerif
                      ? readingTheme === 'sepia' ? 'bg-[#433422] text-[#F4ECD8]' :
                        readingTheme === 'light' ? 'bg-zinc-900 text-white' :
                        readingTheme === 'dark' ? 'bg-zinc-200 text-zinc-950' :
                        'bg-[#58C7B3] text-zinc-950'
                      : readingTheme === 'sepia' ? 'hover:bg-[#433422]/10 text-[#433422]/70' :
                        readingTheme === 'light' ? 'hover:bg-zinc-200 text-zinc-600' :
                        readingTheme === 'dark' ? 'hover:bg-zinc-800 text-zinc-400' :
                        'hover:bg-slate-800 text-slate-400'
                  }`}
                >
                  Clássica
                </button>
              </div>

              {/* Ajuste de Tema */}
              <div className="flex items-center gap-1 border-l pl-4 border-current/20">
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-60 mr-1">Fundo:</span>
                {(['navy', 'sepia', 'dark', 'light'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setReadingTheme(t)}
                    title={t === 'navy' ? 'Azul Escuro' : t === 'sepia' ? 'Sépia Vintage' : t === 'dark' ? 'Preto Absoluto' : 'Papel Claro'}
                    className={`w-6 h-6 rounded-full border transition-all cursor-pointer ${
                      t === 'navy' ? 'bg-[#0B1020]' :
                      t === 'sepia' ? 'bg-[#F4ECD8]' :
                      t === 'dark' ? 'bg-[#09090B]' :
                      'bg-[#FAFAFA]'
                    } ${
                      readingTheme === t 
                        ? 'border-[#58C7B3] ring-2 ring-[#58C7B3]/35 scale-110 shadow-md' 
                        : 'border-current/20 hover:scale-105'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Direita: Botão de Sair do Modo Leitura */}
            <button
              onClick={() => {
                setIsReadingMode(false);
                toast.success("Modo Leitura desativado!");
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer ${
                readingTheme === 'sepia' ? 'bg-[#433422] text-[#F4ECD8] hover:bg-[#58452e]' :
                readingTheme === 'light' ? 'bg-zinc-900 text-white hover:bg-zinc-800' :
                readingTheme === 'dark' ? 'bg-zinc-200 text-zinc-950 hover:bg-zinc-100' :
                'bg-[#58C7B3]/20 border border-[#58C7B3] text-[#58C7B3] hover:bg-[#58C7B3]/30'
              }`}
            >
              <X size={13} />
              Sair da Leitura
            </button>
          </div>
        )}

        {isReadingMode && (
          <div className="w-full h-1 bg-current/5 overflow-hidden sticky top-[49px] z-10">
            <div 
              className="h-full transition-all duration-150 animate-pulse"
              style={{ 
                width: `${scrollProgress}%`, 
                backgroundColor: readingTheme === 'sepia' ? '#8A5A1E' :
                                 readingTheme === 'light' ? '#0D9488' :
                                 readingTheme === 'dark' ? '#D4D4D8' :
                                 '#58C7B3'
              }}
            />
          </div>
        )}


      {/* Área de Mensagens */}
      <div
        id="chat-scroller"
        ref={scrollRef}
        className={`flex-1 overflow-y-auto px-5 py-6 transition-colors duration-300 ${
          isReadingMode && readingTheme === 'sepia' ? 'bg-[#F4ECD8]' :
          isReadingMode && readingTheme === 'dark' ? 'bg-[#09090B]' :
          isReadingMode && readingTheme === 'light' ? 'bg-[#FAFAFA]' :
          ''
        }`}
        style={{ scrollbarWidth: "thin" }}
      >
        <motion.div
          key={activeSessionId}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className={`min-h-full flex flex-col justify-start ${
            isReadingMode 
              ? "max-w-3xl mx-auto w-full px-4 md:px-8 py-8 space-y-12" 
              : "space-y-5"
          }`}
        >
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center px-4 py-8 flex-1" id="empty-state">
              <div className="p-5 rounded-full mb-5 bg-[#182235] border border-[#243248] shadow-[0_4px_20px_rgba(88,199,179,0.08)]">
                <Logo className="w-14 h-14" />
              </div>
              <h2 className="text-2xl font-semibold mb-2 text-white tracking-tight">
                Clone<span style={{ color: COLORS.sand }}>AI</span>
              </h2>
              <p className="text-sm max-w-md mb-8 leading-relaxed text-[#94A3B8]">
                Sua IA multimodal. Todos os melhores modelos em um único lugar.
              </p>

              <div className="w-full max-w-lg space-y-2.5 text-left" id="suggestions-container">
                <span className="text-[10px] uppercase tracking-wider block mb-2 font-bold text-slate-500">
                  sugestões de prompts rápidos:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    "Rodar análise de segurança de infraestrutura com Trivy",
                    "Efetuar scan de dependências (SCA)",
                    "Como melhorar a arquitetura das rotas do meu backend?",
                    "Exibir relatório de qualidade das avaliações do agente"
                  ].map((sug, idx) => (
                    <button
                      key={idx}
                      onClick={() => sendMessage(sug)}
                      className="flex items-center gap-2.5 text-left text-xs rounded-xl p-3.5 border transition-all hover:bg-[#182235]/60 hover:border-[#58C7B3]/30 cursor-pointer text-slate-300 hover:text-white group"
                      style={{ backgroundColor: COLORS.surface, borderColor: COLORS.border }}
                    >
                      <Sparkles size={12} className="shrink-0 text-[#58C7B3] group-hover:scale-110 transition-transform" />
                      <span className="truncate">{sug}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              id={`message-row-${i}`}
              className={`w-full ${
                isReadingMode 
                  ? "block" 
                  : `flex ${m.role === "user" ? "justify-end" : "justify-start"}`
              }`}
            >
              <div
                id={`message-bubble-${i}`}
                onMouseDown={() => handleMessageHoldStart(i)}
                onMouseUp={handleMessageHoldEnd}
                onMouseLeave={handleMessageHoldEnd}
                onTouchStart={() => handleMessageHoldStart(i)}
                onTouchEnd={handleMessageHoldEnd}
                onTouchMove={handleTouchMove}
                onTouchCancel={handleMessageHoldEnd}
                onContextMenu={(e) => {
                  e.preventDefault();
                }}
                className={`transition-all duration-300 relative group select-none md:select-text cursor-pointer ${
                  holdingMessageIndex === i ? "scale-[0.98] brightness-90 bg-red-950/10" : ""
                } ${
                  revealedDeleteIndex === i ? "ring-2 ring-red-500/50" : ""
                } ${
                  isReadingMode
                    ? `w-full max-w-none rounded-none border-0 shadow-none py-8 border-b last:border-b-0 ${
                        readingTheme === 'sepia' ? 'border-[#E4DCC8] text-[#3B2C1B]' :
                        readingTheme === 'dark' ? 'border-zinc-800 text-zinc-200' :
                        readingTheme === 'light' ? 'border-zinc-200 text-zinc-800' :
                        'border-slate-800/60 text-slate-100'
                      } ${
                        readingFontSerif ? 'font-serif' : 'font-sans'
                      } ${
                        readingFontSize === 'sm' ? 'text-xs md:text-sm' :
                        readingFontSize === 'base' ? 'text-sm md:text-base' :
                        readingFontSize === 'lg' ? 'text-base md:text-lg leading-relaxed' :
                        'text-lg md:text-xl leading-relaxed'
                      }`
                    : `max-w-[85%] md:max-w-[75%] rounded-2xl px-4 py-3.5 text-sm leading-relaxed border shadow-md ${m.role === "user" ? "whitespace-pre-wrap" : ""}`
                }`}
                style={
                  isReadingMode
                    ? {}
                    : m.role === "user"
                    ? { backgroundColor: "rgba(88, 199, 179, 0.08)", borderColor: m.isPinned ? COLORS.teal : "rgba(88, 199, 179, 0.2)", color: COLORS.textPrimary }
                    : { 
                        backgroundColor: COLORS.surface, 
                        borderColor: m.isPinned ? COLORS.teal : (m.isFavorite ? "rgba(216,176,122,0.4)" : COLORS.border), 
                        color: COLORS.textPrimary 
                      }
                }
              >
                {/* Botões de exclusão de mensagem ao segurar ou passar o mouse (otimizado para mobile e desktop) */}
                {!isReadingMode && (
                  <div 
                    className={`absolute z-30 flex items-center gap-1.5 transition-all duration-200 ${
                      m.role === "user" 
                        ? "-left-4 top-1/2 -translate-y-1/2 md:left-auto md:right-0 md:-right-3 md:-top-3 md:translate-y-0" 
                        : "-right-4 top-1/2 -translate-y-1/2 md:-right-3 md:-top-3 md:translate-y-0"
                    } ${
                      revealedDeleteIndex === i 
                        ? "opacity-100 scale-100" 
                        : "opacity-0 scale-75 pointer-events-none md:group-hover:opacity-100 md:group-hover:scale-100 md:group-hover:pointer-events-auto"
                    }`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteMessage(i);
                      }}
                      className="w-10 h-10 md:w-8 md:h-8 rounded-full bg-red-600 hover:bg-red-500 text-white shadow-lg border border-red-500/30 transition-all duration-200 active:scale-90 cursor-pointer flex items-center justify-center"
                      title="Excluir mensagem"
                    >
                      <Trash2 size={15} className="md:w-3.5 md:h-3.5" />
                    </button>
                    {revealedDeleteIndex === i && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRevealedDeleteIndex(null);
                        }}
                        className="w-10 h-10 md:w-8 md:h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 shadow-lg border border-slate-700 transition-all duration-200 active:scale-90 cursor-pointer flex items-center justify-center"
                        title="Cancelar"
                      >
                        <X size={15} className="md:w-3.5 md:h-3.5" />
                      </button>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  {isReadingMode ? (
                    <span 
                      className={`text-xs font-bold uppercase tracking-widest ${
                        m.role === "user" 
                          ? readingTheme === 'sepia' ? 'text-[#8A5A1E]' :
                            readingTheme === 'light' ? 'text-teal-600 font-bold' :
                            readingTheme === 'dark' ? 'text-teal-400 font-bold' :
                            'text-[#58C7B3] font-bold'
                          : readingTheme === 'sepia' ? 'text-[#433422]/75' :
                            readingTheme === 'light' ? 'text-zinc-500 font-bold' :
                            readingTheme === 'dark' ? 'text-zinc-400 font-bold' :
                            'text-slate-400 font-bold'
                      }`}
                    >
                      {m.role === "user" ? "◆ Pergunta do Usuário" : "◇ Resposta do Assistente"}
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: m.role === "user" ? "rgba(88,199,179,0.15)" : "rgba(111,131,172,0.15)", color: m.role === "user" ? COLORS.teal : COLORS.textMuted }}>
                      {m.role === "user" ? "Usuário" : "Assistente"}
                    </span>
                  )}

                  {!isReadingMode && m.isPinned && (
                    <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center gap-1 font-medium">
                      <Pin size={9} className="rotate-45" /> FIXADO NO TOPO
                    </span>
                  )}
                  {!isReadingMode && m.isFavorite && (
                    <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#D8B07A]/10 text-[#D8B07A] flex items-center gap-1 font-medium">
                      <Star size={9} fill="currentColor" /> FAVORITO
                    </span>
                  )}
                </div>
                {m.role === "assistant" ? (
                  <div className="markdown-body">
                    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {m.content}
                    </Markdown>
                    {((m.isTyping) || (isStreaming && i === messages.length - 1)) && (
                      <span
                        id="cursor-blink"
                        className="inline-block w-[6px] h-[1.15em] ml-1.5 align-middle rounded-[2px] animate-terminal-blink bg-[var(--color-teal)]"
                      />
                    )}
                  </div>
                ) : (
                  <div 
                    className={`whitespace-pre-wrap leading-relaxed ${
                      isReadingMode
                        ? readingFontSize === 'sm' ? 'text-xs md:text-sm' :
                          readingFontSize === 'base' ? 'text-sm md:text-base' :
                          readingFontSize === 'lg' ? 'text-base md:text-lg' :
                          'text-lg md:text-xl'
                        : "text-sm"
                    }`}
                  >
                    {m.content}
                  </div>
                )}

                {m.sources && m.sources.length > 0 && (
                  <div 
                    className={`mt-4 pt-3 border-t space-y-1.5 ${
                      isReadingMode 
                        ? readingTheme === 'sepia' ? 'border-[#E4DCC8]' :
                          readingTheme === 'light' ? 'border-zinc-200' :
                          readingTheme === 'dark' ? 'border-zinc-800' :
                          'border-slate-800/60'
                        : ''
                    }`} 
                    style={isReadingMode ? {} : { borderColor: COLORS.border }}
                  >
                    <p className={`text-[10px] uppercase tracking-wider block font-bold ${isReadingMode ? 'opacity-60' : 'text-slate-500'}`}>
                      Fontes reais consultadas:
                    </p>
                    <div className="flex flex-wrap gap-2" id={`sources-list-${i}`}>
                      {m.sources.map((s, si) => (
                        <a
                          key={si}
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className={`inline-flex items-center gap-1.5 text-[11px] rounded-lg px-2.5 py-1 border transition-all max-w-full font-medium ${
                            isReadingMode
                              ? readingTheme === 'sepia' ? 'bg-[#EDE4CD] border-[#DCD3BC] text-[#8A5A1E] hover:bg-[#E4DCC8]' :
                                readingTheme === 'light' ? 'bg-zinc-100 border-zinc-200 text-teal-600 hover:bg-zinc-200' :
                                readingTheme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-teal-400 hover:bg-zinc-800' :
                                'bg-slate-800/50 border-slate-700 text-[#58C7B3] hover:bg-slate-800'
                              : 'bg-[#58C7B3]/5 hover:bg-[#58C7B3]/10'
                          }`}
                          style={isReadingMode ? {} : { color: COLORS.teal, borderColor: "rgba(88, 199, 179, 0.2)" }}
                        >
                          <Link2 size={11} className="shrink-0" />
                          <span className="truncate max-w-[180px] md:max-w-[280px]">{s.title}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {!isReadingMode && m.agentSteps && m.agentSteps.length > 0 && (
                  <AgentStepsViewer steps={m.agentSteps} />
                )}

                {!isReadingMode && m.role === "assistant" && (m.providerName || m.responseTime) && (
                  <div className="mt-3 pt-2 border-t border-dashed flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] select-none" style={{ borderColor: COLORS.borderSoft }}>
                    {m.providerName && (
                      <span className="flex items-center gap-1 text-[#58C7B3] font-semibold">
                        <Terminal size={10} /> Provedor: {m.providerName} ({m.modelUsed})
                      </span>
                    )}
                    {m.responseTime && (
                      <span className="flex items-center gap-1 font-medium" style={{ color: COLORS.textMuted }}>
                        <RefreshCw size={10} /> Latência: {m.responseTime}s
                      </span>
                    )}
                    {m.usage && m.usage.totalTokens > 0 && (
                      <span className="flex items-center gap-1 font-medium" style={{ color: COLORS.textMuted }}>
                        📊 {m.usage.totalTokens} tokens
                      </span>
                    )}
                    {m.estimatedCostUsd !== undefined && (
                      <span className="flex items-center gap-1 text-emerald-400 font-bold">
                        💰 ${m.estimatedCostUsd.toFixed(6)}
                      </span>
                    )}
                    {m.cached && (
                      <span className="px-1.5 py-0.5 rounded-full bg-[#58C7B3]/10 text-[#58C7B3] border border-[#58C7B3]/20 text-[9px] font-bold uppercase">
                        ⚡ cache
                      </span>
                    )}
                    {m.fallbackChain && m.fallbackChain.length > 1 && (
                      <span className="text-rose-400 flex items-center gap-0.5 font-bold" title={`Cadeia de fallback: ${m.fallbackChain.join(" -> ")}`}>
                        ⚠️ fallback
                      </span>
                    )}
                  </div>
                )}

                {!isReadingMode && m.role === "assistant" && (
                  <MessageActions
                    message={m}
                    messageIndex={i}
                    modelLabel={MODELS.find((mod) => mod.id === model)?.label || "CloneAI Engine"}
                    onFeedbackChange={handleFeedbackChange}
                    onRegenerate={regenerateMessage}
                    onToggleFavorite={handleToggleFavorite}
                    onTogglePin={handleTogglePin}
                    isFavorite={!!m.isFavorite}
                    isPinned={!!m.isPinned}
                    onSpeak={speak}
                    onStopSpeech={() => {
                      if (typeof window !== "undefined") {
                        if (window.speechSynthesis) {
                          window.speechSynthesis.cancel();
                        }
                        if (activeAudioRef.current) {
                          activeAudioRef.current.pause();
                          activeAudioRef.current = null;
                        }
                      }
                      setIsSpeaking(false);
                      setSpeakingMessageIndex(null);
                    }}
                    isSpeakingGlobal={isSpeaking}
                    speakingMessageIndex={speakingMessageIndex}
                    isTtsLoading={isTtsLoading}
                  />
                )}
              </div>
            </div>
          ))}

          {pendingConfirmation && (
            <div
              id="guardrail-confirm-panel"
              className="max-w-[85%] md:max-w-[75%] rounded-2xl p-5 border shadow-xl bg-[#1e293b]/90 border-amber-500/30 text-sm leading-relaxed mx-auto my-4 animate-fade-in flex flex-col gap-4"
              style={{
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                boxShadow: "0 10px 25px -5px rgba(245, 158, 11, 0.15)",
              }}
            >
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 shrink-0 border border-amber-500/20">
                  <AlertTriangle size={18} className="animate-pulse" />
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-white mb-1 flex items-center gap-1.5">
                    🛡️ Guardrail de Segurança do Agente
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    O agente está tentando executar uma ação sensível em ambiente externo (rede/API real). Por motivos de privacidade e conformidade de segurança, esta operação requer sua permissão prévia.
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-slate-900/60 p-3.5 border border-slate-800 text-xs font-mono space-y-1.5 text-slate-200">
                <div className="text-amber-400 font-bold uppercase tracking-wide text-[10px] mb-1">
                  ⚙️ Operação Solicitada:
                </div>
                <div><span className="text-slate-400">Ferramenta:</span> <span className="text-teal-400 font-bold">{pendingConfirmation.name}</span></div>
                {pendingConfirmation.args && (
                  <div>
                    <span className="text-slate-400">Argumentos:</span>{" "}
                    <span className="text-slate-300">
                      {JSON.stringify(pendingConfirmation.args, null, 2)}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2.5">
                <button
                  id="guardrail-deny-btn"
                  onClick={handleDenyTool}
                  disabled={isStreaming}
                  className="px-3.5 py-2 text-xs font-bold rounded-xl border border-rose-500/30 text-rose-400 bg-rose-500/5 hover:bg-rose-500/15 transition-all duration-200 active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  Negar Execução
                </button>
                <button
                  id="guardrail-confirm-btn"
                  onClick={handleConfirmTool}
                  disabled={isStreaming}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-[#58C7B3] hover:bg-[#4cb3a1] text-[#111827] shadow-[0_4px_14px_rgba(88,199,179,0.3)] transition-all duration-200 active:scale-95 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  <Check size={14} /> Autorizar Agente
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </div>

      {/* Input de Mensagem */}
      <div
        id="input-footer"
        className={`p-4 border-t transition-all duration-300 ${isReadingMode ? "hidden h-0 overflow-hidden p-0 border-t-0" : "block"}`}
        style={{ backgroundColor: COLORS.bgHeader, borderColor: COLORS.borderSoft }}
      >
        <div className="max-w-4xl mx-auto">
          {/* Otimizadores de Prompt (Técnicas de Alta Performance) */}
          <div className="mb-3.5" id="prompt-optimization-wrapper">
            <div className="flex items-center justify-between mb-1.5">
              <button
                id="toggle-prompt-helper"
                onClick={() => setShowPromptHelper(!showPromptHelper)}
                className="flex items-center gap-1.5 text-[11px] tracking-wider uppercase py-1.5 px-3 rounded-xl border transition-all hover:opacity-95 select-none cursor-pointer"
                style={{
                  backgroundColor: showPromptHelper ? "rgba(88, 199, 179, 0.12)" : COLORS.surface,
                  borderColor: showPromptHelper ? COLORS.teal : COLORS.border,
                  color: showPromptHelper ? COLORS.teal : COLORS.textMuted
                }}
              >
                <Sparkles size={11} className={showPromptHelper ? "animate-pulse text-[#58C7B3]" : ""} />
                <span>⚙️ Otimizador de Prompt {showPromptHelper ? "[Fechar]" : "[Abrir]"}</span>
              </button>
              
              {chainOfThought && (
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 bg-[rgba(16,185,129,0.1)] px-2.5 py-1 rounded-full border border-[rgba(16,185,129,0.3)] select-none">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                  <span>raciocínio_passo_a_passo: ATIVO</span>
                </div>
              )}
            </div>

            {showPromptHelper && (
              <div
                id="prompt-helper-panel"
                className="rounded-[20px] border p-5 mb-4 shadow-[0_8px_32px_rgba(0,0,0,0.25)] backdrop-blur-sm transition-all text-xs"
                style={{ backgroundColor: COLORS.surface, borderColor: COLORS.border }}
              >
                {/* Abas */}
                <div className="flex flex-wrap gap-1 border-b pb-2.5 mb-3" style={{ borderColor: COLORS.borderSoft }}>
                  {[
                    { id: "persona", label: "1. Papel (Persona) 🎓" },
                    { id: "format", label: "2. Formato & CoT 📊" },
                    { id: "fewshot", label: "3. Exemplos (Few-Shot) 💡" },
                    { id: "context", label: "4. Contexto Detalhado 🚀" }
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveHelperTab(tab.id as any)}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] uppercase transition-all duration-200 cursor-pointer font-medium"
                      style={
                        activeHelperTab === tab.id
                          ? { backgroundColor: "rgba(88, 199, 179, 0.12)", color: COLORS.teal, border: `1px solid rgba(88, 199, 179, 0.2)` }
                          : { backgroundColor: "transparent", color: COLORS.textMuted, border: `1px solid transparent` }
                      }
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Conteúdo das Abas */}
                {activeHelperTab === "persona" && (
                  <div>
                    <p className="text-[11px] mb-2.5" style={{ color: COLORS.textMuted }}>
                      Defina um papel específico para a IA para mudar o tom, o nível técnico e a precisão das respostas:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {PROMPT_PRESETS.personas.map((p, pi) => (
                        <button
                          key={pi}
                          onClick={() => {
                            setInput((prev) => p.text + prev);
                            setShowPromptHelper(false);
                          }}
                          className="p-3 text-left rounded-[16px] border transition-all hover:bg-[#58C7B3]/5 hover:border-[#58C7B3]/25 group cursor-pointer"
                          style={{ backgroundColor: COLORS.bgHeader, borderColor: COLORS.borderSoft }}
                        >
                          <div className="font-semibold group-hover:text-[#58C7B3] transition-colors mb-0.5">{p.name}</div>
                          <div className="text-[10px] leading-relaxed animate-fade-in" style={{ color: COLORS.textMuted }}>{p.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {activeHelperTab === "format" && (
                  <div>
                    <p className="text-[11px] mb-3" style={{ color: COLORS.textMuted }}>
                      Adicione restrições de resposta ou ative o raciocínio encadeado (Chain of Thought):
                    </p>
                    
                    {/* Toggle Chain of Thought */}
                    <div 
                      className="flex items-center justify-between p-3.5 rounded-[16px] mb-3 border transition-colors"
                      style={{ backgroundColor: COLORS.bgHeader, borderColor: chainOfThought ? "rgba(88, 199, 179, 0.3)" : COLORS.borderSoft }}
                    >
                      <div>
                        <div className="font-semibold flex items-center gap-1.5 text-white">
                          <span>🧠 Exigir Raciocínio Passo a Passo (Chain-of-Thought)</span>
                        </div>
                        <p className="text-[10px] mt-1 leading-normal" style={{ color: COLORS.textMuted }}>
                          A IA demonstrará seu raciocínio lógico etapa por etapa antes de dar a resposta final, reduzindo drasticamente erros em tarefas complexas.
                        </p>
                      </div>
                      <button
                        onClick={() => setChainOfThought(!chainOfThought)}
                        className="px-3.5 py-1.5 rounded-lg text-[10px] uppercase transition-all select-none cursor-pointer border font-bold"
                        style={
                          chainOfThought
                            ? { backgroundColor: "rgba(88, 199, 179, 0.12)", borderColor: COLORS.teal, color: COLORS.teal }
                            : { backgroundColor: COLORS.surface, borderColor: COLORS.border, color: COLORS.textMuted }
                        }
                      >
                        {chainOfThought ? "ATIVADO" : "DESATIVADO"}
                      </button>
                    </div>

                    <div className="text-[10px] uppercase mb-1.5 font-bold text-slate-500">Formatos Rápidos:</div>
                    <div className="flex flex-wrap gap-2">
                      {PROMPT_PRESETS.formats.map((f, fi) => (
                        <button
                          key={fi}
                          onClick={() => {
                            setInput((prev) => {
                              const trimmed = prev.trim();
                              return trimmed ? `${trimmed}\n\n${f.text}` : f.text;
                            });
                            setShowPromptHelper(false);
                          }}
                          className="px-3 py-1.5 rounded-lg border text-[11px] transition-all hover:bg-[#58C7B3]/5 hover:text-[#58C7B3] hover:border-[#58C7B3]/25 cursor-pointer font-medium"
                          style={{ backgroundColor: COLORS.bgHeader, borderColor: COLORS.borderSoft, color: COLORS.textPrimary }}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {activeHelperTab === "fewshot" && (
                  <div>
                    <p className="text-[11px] mb-2.5" style={{ color: COLORS.textMuted }}>
                      Ensine à IA padrões exatos através de exemplos práticos (Técnica Few-Shot) para evitar formatação indesejada:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {PROMPT_PRESETS.fewshots.map((fs, fsi) => (
                        <button
                          key={fsi}
                          onClick={() => {
                            setInput(fs.text);
                            setShowPromptHelper(false);
                          }}
                          className="p-3 text-left rounded-[16px] border transition-all hover:bg-[#58C7B3]/5 hover:border-[#58C7B3]/25 group cursor-pointer"
                          style={{ backgroundColor: COLORS.bgHeader, borderColor: COLORS.borderSoft }}
                        >
                          <div className="font-semibold group-hover:text-[#58C7B3] transition-colors mb-0.5">{fs.name}</div>
                          <div className="text-[10px] leading-relaxed animate-fade-in" style={{ color: COLORS.textMuted }}>{fs.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {activeHelperTab === "context" && (
                  <div>
                    <p className="text-[11px] mb-3" style={{ color: COLORS.textMuted }}>
                      Evite respostas vagas fornecendo um contexto estruturado de alta performance:
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="text-[9px] uppercase tracking-wider block mb-1 font-bold text-slate-500">Papel / Especialidade:</label>
                        <input
                          type="text"
                          value={guidedRole}
                          onChange={(e) => setGuidedRole(e.target.value)}
                          className="w-full bg-[#111827] border border-[#243248] rounded-[16px] px-3 py-2 text-xs outline-none focus:border-[#58C7B3] transition-all"
                          style={{ color: COLORS.textPrimary }}
                          placeholder="Ex: consultor sênior de inovação"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] uppercase tracking-wider block mb-1 font-bold text-slate-500">Público-alvo:</label>
                        <input
                          type="text"
                          value={guidedAudience}
                          onChange={(e) => setGuidedAudience(e.target.value)}
                          className="w-full bg-[#111827] border border-[#243248] rounded-[16px] px-3 py-2 text-xs outline-none focus:border-[#58C7B3] transition-all"
                          style={{ color: COLORS.textPrimary }}
                          placeholder="Ex: diretores executivos"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] uppercase tracking-wider block mb-1 font-bold text-slate-500">Objetivo Final:</label>
                        <input
                          type="text"
                          value={guidedObjective}
                          onChange={(e) => setGuidedObjective(e.target.value)}
                          className="w-full bg-[#111827] border border-[#243248] rounded-[16px] px-3 py-2 text-xs outline-none focus:border-[#58C7B3] transition-all"
                          style={{ color: COLORS.textPrimary }}
                          placeholder="Ex: validar 3 ideias lucrativas"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] uppercase tracking-wider block mb-1 font-bold text-slate-500">Restrições / Preferências:</label>
                        <input
                          type="text"
                          value={guidedLimits}
                          onChange={(e) => setGuidedLimits(e.target.value)}
                          className="w-full bg-[#111827] border border-[#243248] rounded-[16px] px-3 py-2 text-xs outline-none focus:border-[#58C7B3] transition-all"
                          style={{ color: COLORS.textPrimary }}
                          placeholder="Ex: tabela comparativa, no máximo 200 palavras"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="text-[9px] uppercase tracking-wider block mb-1 font-bold text-slate-500">Tema Central / Pergunta Principal:</label>
                        <textarea
                          rows={2}
                          value={guidedTopic}
                          onChange={(e) => setGuidedTopic(e.target.value)}
                          className="w-full bg-[#111827] border border-[#243248] rounded-[16px] px-3 py-2 text-xs outline-none focus:border-[#58C7B3] transition-all resize-none"
                          style={{ color: COLORS.textPrimary }}
                          placeholder="Ex: tecnologia sustentável para o mercado brasileiro em 2024"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2.5 border-t" style={{ borderColor: COLORS.borderSoft }}>
                      <span className="text-[10px] text-slate-400 max-w-[70%]" style={{ color: COLORS.textMuted }}>
                        Aperte o botão ao lado para construir e carregar o prompt estruturado no input principal.
                      </span>
                      <button
                        onClick={() => {
                          const compiledPrompt = `Atue como um ${guidedRole}. Meu público-alvo principal é composto de ${guidedAudience} e meu objetivo final com esta resposta é ${guidedObjective}. Por favor, considere as seguintes limitações ou preferências: ${guidedLimits}.\n\nEscreva sobre: ${guidedTopic}`;
                          setInput(compiledPrompt);
                          setShowPromptHelper(false);
                        }}
                        className="px-3.5 py-2 rounded-[16px] text-[10px] uppercase font-bold transition-all hover:scale-[1.02] cursor-pointer bg-[#58C7B3] text-[#0B1020]"
                      >
                        ⚡ Injetar Prompt Refinado
                      </button>
                    </div>
                  </div>
                )}

                {/* Dica de Refinamento Iterativo no rodapé do otimizador */}
                <div 
                  className="mt-3.5 pt-2.5 border-t text-[10px] flex items-start gap-1.5" 
                  style={{ borderColor: COLORS.borderSoft, color: COLORS.textMuted }}
                >
                  <span className="text-[#D8B07A] font-bold shrink-0">DICA:</span>
                  <span className="leading-normal">
                    <strong>Refinamento Iterativo (Diálogo Contínuo):</strong> Caso o resultado inicial não seja perfeito, responda dando feedback direto (ex: <em>"Gostei do ponto 2, mas desenvolva mais o ponto 3 com dados práticos"</em> ou <em>"Simplifique o tom para uma criança de 10 anos"</em>).
                  </span>
                </div>
              </div>
            )}
          </div>

          <div
            id="input-container"
            className="flex items-center gap-3 rounded-[16px] px-4 py-2.5 border transition-all focus-within:ring-1 focus-within:ring-[#58C7B3] focus-within:border-[#58C7B3]"
            style={{ backgroundColor: COLORS.surface, borderColor: COLORS.border }}
          >
            <span className="text-sm font-bold shrink-0" style={{ color: COLORS.teal }}>
              &gt;
            </span>
            <input
              id="message-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder={isListening ? "Ouvindo... Fale agora." : "Pergunte qualquer coisa..."}
              disabled={isStreaming}
              className="flex-1 bg-transparent outline-none text-xs md:text-sm placeholder:text-[#435375]"
              style={{ color: COLORS.textPrimary }}
              autoComplete="off"
            />
            {recognitionSupported && (
              <button
                id="voice-dictation-btn"
                onClick={toggleListening}
                disabled={isStreaming}
                className="w-9 h-9 flex items-center justify-center rounded-[16px] transition-all hover:scale-[1.03] active:scale-[0.98] cursor-pointer shrink-0"
                style={
                  isListening
                    ? { backgroundColor: "rgba(239,68,68,0.2)", border: `1px solid rgba(239,68,68,0.6)`, color: "#ef4444" }
                    : { backgroundColor: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.textMuted }
                }
                title={isListening ? "Parar de ouvir" : "Ditar pergunta por voz"}
              >
                {isListening ? (
                  <Mic size={15} className="animate-pulse" />
                ) : (
                  <Mic size={15} className="hover:text-[#58C7B3]" />
                )}
              </button>
            )}
            <button
              id="send-message-btn"
              onClick={() => sendMessage()}
              disabled={isStreaming || !input.trim()}
              className="w-10 h-10 flex items-center justify-center rounded-[16px] disabled:opacity-25 transition-all hover:scale-[1.03] active:scale-[0.98] cursor-pointer shrink-0"
              style={{ backgroundColor: COLORS.teal }}
            >
              <Send size={15} style={{ color: "#0B1020" }} />
            </button>
          </div>
          {isListening && (
            <p className="text-[11px] mt-2 text-emerald-400 flex items-center gap-1.5 justify-center animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
              Sinal de gravação ativo. Pode ditar sua pergunta agora...
            </p>
          )}
          {recognitionError && (
            <p className="text-[11px] mt-2 text-red-400 text-center">
              {recognitionError}
            </p>
          )}
          <p className="text-[10px] text-center mt-3" style={{ color: COLORS.textMuted }}>
            As vozes de síntese dependem do seu navegador. Ative a caixa de pesquisa para resultados ao vivo na internet.
          </p>
        </div>
      </div>
      </div>
      </div>
      {/* Modal de Confirmação para Limpar o Terminal */}
      {isConfirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" id="confirm-clear-modal-overlay">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md p-6 rounded-[20px] border shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-md text-[#F8FAFC] bg-[#111827]/95"
            style={{ borderColor: COLORS.border }}
            id="confirm-clear-modal"
          >
            <div className="flex items-start gap-4" id="modal-content-wrapper">
              <div className="p-3 rounded-full bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/25 shrink-0" id="modal-icon-container">
                <AlertTriangle size={20} className="animate-pulse" />
              </div>
              <div className="space-y-2 flex-1" id="modal-text-content">
                <h3 className="text-base font-semibold text-white tracking-tight" id="modal-title">
                  Limpar conversa
                </h3>
                <p style={{ color: COLORS.textMuted }} className="text-xs leading-relaxed" id="modal-description">
                  Você está prestes a limpar o terminal e redefinir o histórico da sessão atual. Essa ação é irreversível e apagará todas as mensagens desta conversa.
                </p>
                <div className="bg-[#182235] p-3 rounded-[16px] border border-[#243248] text-[10.5px] leading-relaxed text-[#94A3B8]" id="modal-warning-box">
                  <span className="font-semibold text-[#D8B07A]">Aviso:</span> O título da conversa também será redefinido para "Nova Conversa".
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3" id="modal-actions">
              <button
                id="cancel-clear-btn"
                onClick={() => setIsConfirmModalOpen(false)}
                className="px-4 py-2 text-xs rounded-[16px] border hover:bg-[#182235] text-slate-300 font-semibold uppercase tracking-wider transition-all duration-200 cursor-pointer"
                style={{ borderColor: COLORS.border }}
              >
                Cancelar
              </button>
              <button
                id="confirm-clear-btn"
                onClick={() => {
                  clearChat();
                  setIsConfirmModalOpen(false);
                  toast.success("O terminal foi limpo com sucesso!");
                }}
                className="px-4 py-2 text-xs rounded-[16px] bg-[#EF4444] hover:bg-[#EF4444]/90 text-white font-semibold uppercase tracking-wider transition-all duration-200 cursor-pointer"
              >
                Limpar Terminal
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* 2. Modal do Painel de Avaliações e Dataset */}
      {showEvalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" id="eval-history-modal-overlay">
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 15 }}
            className="w-full max-w-5xl h-[85vh] flex flex-col p-6 rounded-[20px] border shadow-[0_12px_40px_rgba(0,0,0,0.5)] text-[#F8FAFC] bg-[#0d1428] border-[#233256]"
            id="eval-history-modal"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#233256] pb-4 mb-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-[#58C7B3]/10 text-[#58C7B3] border border-[#58C7B3]/25">
                  <Sparkles size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white leading-tight">
                    Painel de Avaliação & Dataset de Fine-Tuning
                  </h3>
                  <p className="text-xs text-slate-400">
                    Sistematização de erros, métricas de qualidade por provedor e exportação orgânica de dados de treino.
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowEvalModal(false)}
                className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Metrics Ribbon */}
            <div className="grid grid-cols-4 gap-4 mb-4 shrink-0">
              <div className="bg-[#101a33]/80 p-3 rounded-xl border border-[#233256]/60">
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">Total de Interações</span>
                <span className="text-xl font-bold text-slate-200">{evalInteractions.length}</span>
              </div>
              <div className="bg-[#101a33]/80 p-3 rounded-xl border border-[#233256]/60">
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">Avaliadas</span>
                <span className="text-xl font-bold text-[#58C7B3]">{evalMetrics?.total_avaliadas || 0}</span>
              </div>
              <div className="bg-[#101a33]/80 p-3 rounded-xl border border-[#233256]/60">
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">Taxa de Aprovação</span>
                <span className={`text-xl font-bold ${(evalMetrics?.taxa_aprovacao || 0) >= 0.85 ? "text-emerald-400" : (evalMetrics?.taxa_aprovacao || 0) >= 0.7 ? "text-amber-400" : "text-rose-400"}`}>
                  {evalMetrics?.total_avaliadas > 0 ? `${((evalMetrics?.taxa_aprovacao || 0) * 100).toFixed(1)}%` : "N/A"}
                </span>
              </div>
              <div className="bg-[#101a33]/80 p-3 rounded-xl border border-[#233256]/60">
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">Dataset (Correções)</span>
                <span className="text-xl font-bold text-purple-400">
                  {evalInteractions.filter(i => i.aprovado === false && i.correcao).length} pares
                </span>
              </div>
            </div>

            {/* List and Details */}
            <div className="flex-1 overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
              {evalInteractions.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-center text-slate-500 italic">
                  <AlertTriangle size={32} className="text-slate-600 mb-2" />
                  Nenhuma interação foi registrada ainda. Inicie um chat para coletar dados automaticamente!
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="overflow-x-auto rounded-xl border border-[#233256]/60">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#101a33]/90 border-b border-[#233256] text-slate-300 font-bold">
                          <th className="p-3">Data / Hora</th>
                          <th className="p-3">Provedor / Latência</th>
                          <th className="p-3">Ferramentas Usadas</th>
                          <th className="p-3">Pergunta / Resposta</th>
                          <th className="p-3 text-center">Status / Feedback</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#233256]/40">
                        {evalInteractions.map((item: any) => {
                          const isApproved = item.aprovado === true;
                          const isReproved = item.aprovado === false;
                          const dateStr = new Date(item.criado_em * 1000).toLocaleString("pt-BR");

                          return (
                            <tr key={item.id} className="hover:bg-[#101a33]/40 bg-[#0d1428]">
                              <td className="p-3 whitespace-nowrap text-slate-400 text-[10px]">
                                {dateStr}
                              </td>
                              <td className="p-3 whitespace-nowrap">
                                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] uppercase font-mono mr-1.5">
                                  {item.provedor}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {item.latencia_s ? `${item.latencia_s.toFixed(2)}s` : "0s"}
                                </span>
                              </td>
                              <td className="p-3">
                                <div className="flex flex-wrap gap-1 max-w-[150px]">
                                  {item.tools_usadas && item.tools_usadas.length > 0 ? (
                                    item.tools_usadas.map((t: string) => (
                                      <span key={t} className="px-1 py-0.2 rounded border border-[#233256] bg-[#101a33] text-slate-300 text-[8px] font-mono">
                                        {t}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-slate-600 text-[10px] italic">Nenhuma</span>
                                  )}
                                </div>
                              </td>
                              <td className="p-3 space-y-1.5 max-w-md">
                                <div className="text-slate-300 font-bold truncate" title={item.pergunta}>
                                  P: {item.pergunta}
                                </div>
                                <div className="text-slate-400 truncate text-[11px]" title={item.resposta}>
                                  R: {item.resposta}
                                </div>

                                {/* Dynamic Correction Edit Section */}
                                {isReproved && (
                                  <div className="bg-purple-950/20 border border-purple-900/30 rounded p-2 mt-1 space-y-1">
                                    <div className="text-[9px] text-purple-400 font-bold uppercase">CORREÇÃO DE MEMÓRIA:</div>
                                    <p className="text-[10.5px] font-mono text-purple-300 bg-purple-950/40 p-1.5 rounded border border-purple-800/20">
                                      {item.correcao || "(Sem correção registrada)"}
                                    </p>
                                  </div>
                                )}
                              </td>
                              <td className="p-3 text-center whitespace-nowrap">
                                <div className="flex items-center justify-center gap-1.5">
                                  {/* Approve button */}
                                  <button
                                    onClick={async () => {
                                      try {
                                        const res = await fetch("/api/eval/feedback", {
                                          method: "POST",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ evalId: item.id, approved: true })
                                        });
                                        if (res.ok) {
                                          toast.success("Interação aprovada!");
                                          fetchEvalData();
                                        }
                                      } catch (err) {
                                        toast.error("Erro de rede.");
                                      }
                                    }}
                                    className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                                      isApproved 
                                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" 
                                        : "bg-slate-900/60 text-slate-500 border-slate-800 hover:text-slate-300"
                                    }`}
                                    title="Marcar como aprovada"
                                  >
                                    <ThumbsUp size={12} />
                                  </button>

                                  {/* Reprove / Correction button */}
                                  <button
                                    onClick={async () => {
                                      const correctionText = window.prompt("O que o modelo deveria ter respondido? (Isso vira dado de dataset e memória):", item.correcao || "");
                                      if (correctionText === null) return;
                                      if (!correctionText.trim()) {
                                        toast.error("Por favor, preencha o texto de correção.");
                                        return;
                                      }
                                      try {
                                        const res = await fetch("/api/eval/feedback", {
                                          method: "POST",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ evalId: item.id, approved: false, correction: correctionText })
                                        });
                                        if (res.ok) {
                                          toast.success("Feedback de correção salvo!");
                                          fetchEvalData();
                                          fetchMemories();
                                        }
                                      } catch (err) {
                                        toast.error("Erro de rede.");
                                      }
                                    }}
                                    className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                                      isReproved 
                                        ? "bg-rose-500/10 text-rose-400 border-rose-500/30" 
                                        : "bg-slate-900/60 text-slate-500 border-slate-800 hover:text-slate-300"
                                    }`}
                                    title="Reprovar e ajustar correção"
                                  >
                                    <ThumbsDown size={12} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="mt-4 pt-3 border-t border-[#233256] flex justify-between items-center shrink-0">
              <span className="text-[10px] text-slate-500">
                O dataset exportado no menu lateral gera arquivos .jsonl perfeitos para processamento e fine-tuning do modelo.
              </span>
              <button
                onClick={() => setShowEvalModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl cursor-pointer transition-colors"
              >
                Fechar Painel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <Toaster richColors position="top-right" theme="dark" />
    </div>
  );
}
