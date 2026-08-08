import { AIProvider, ProviderRequest, ProviderResponse, AIMessage } from "../types/AIProvider";
import { GeminiProvider } from "../providers/GeminiProvider";
import { OpenAIProvider } from "../providers/OpenAIProvider";
import { ClaudeProvider } from "../providers/ClaudeProvider";
import { LlamaProvider } from "../providers/LlamaProvider";
import { DeepSeekProvider } from "../providers/DeepSeekProvider";
import { MistralProvider } from "../providers/MistralProvider";
import { sharedMemoryBase } from "../rag/MemoryBase";

// Memory cache entry format
interface CacheEntry {
  response: ProviderResponse;
  expiresAt: number;
}

// Circuit Breaker State Type and Class
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class ProviderCircuitBreaker {
  public state: CircuitState = "CLOSED";
  public failureCount = 0;
  public lastFailureTime = 0;
  private successThreshold = 2; // Number of consecutive successes to close circuit in HALF_OPEN
  private consecutiveSuccessCount = 0;

  // Settings
  private failureThreshold = 2; // Trip circuit after 2 failures (consecutive or within window)
  private resetTimeoutMs = 30000; // Reset cool-down period of 30 seconds before attempting HALF_OPEN

  constructor(public providerId: string) {}

  public recordSuccess() {
    if (this.state === "HALF_OPEN") {
      this.consecutiveSuccessCount++;
      if (this.consecutiveSuccessCount >= this.successThreshold) {
        this.state = "CLOSED";
        this.failureCount = 0;
        this.consecutiveSuccessCount = 0;
        console.log(`[CircuitBreaker] Circuit CLOSED for provider ${this.providerId}`);
      }
    } else if (this.state === "CLOSED") {
      this.failureCount = 0;
    }
  }

  public recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.consecutiveSuccessCount = 0;

    if (this.state === "CLOSED" && this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      console.log(`[CircuitBreaker] Circuit TRIPPED to OPEN for provider ${this.providerId}`);
    } else if (this.state === "HALF_OPEN") {
      this.state = "OPEN";
      console.log(`[CircuitBreaker] Circuit TRIPPED back to OPEN for provider ${this.providerId} after HALF_OPEN failure`);
    }
  }

  public allowRequest(): boolean {
    const now = Date.now();
    if (this.state === "OPEN") {
      if (now - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = "HALF_OPEN";
        this.consecutiveSuccessCount = 0;
        console.log(`[CircuitBreaker] Circuit transitioned to HALF_OPEN for provider ${this.providerId}`);
        return true;
      }
      return false;
    }
    return true;
  }
}

// Telemetry Metric tracking
export interface UsageMetric {
  timestamp: string;
  requestedModel: string;
  routedProvider: string;
  routedModel: string;
  status: "success" | "fallback" | "failed";
  latencyMs: number;
  estimatedCostUsd: number;
  promptTokens: number;
  completionTokens: number;
  error?: string;
  cached: boolean;
}

export class AIRouter {
  private providers: Map<string, AIProvider> = new Map();
  private cache: Map<string, CacheEntry> = new Map();
  private metrics: UsageMetric[] = [];
  private circuitBreakers: Map<string, ProviderCircuitBreaker> = new Map();
  private simulatedFailures: Set<string> = new Set();
  
  // Rate limiting map: ClientIP -> Array of request timestamps
  private rateLimits: Map<string, number[]> = new Map();
  private maxRequestsPerWindow = 10;
  private windowSizeMs = 60 * 1000; // 10 requests per minute

  constructor() {
    this.registerProvider(new GeminiProvider());
    this.registerProvider(new OpenAIProvider());
    this.registerProvider(new ClaudeProvider());
    this.registerProvider(new LlamaProvider());
    this.registerProvider(new DeepSeekProvider());
    this.registerProvider(new MistralProvider());
  }

  private registerProvider(provider: AIProvider) {
    this.providers.set(provider.id, provider);
  }

  /**
   * Toggles simulated failure mode for a provider
   */
  public toggleSimulatedFailure(providerId: string, active: boolean) {
    if (active) {
      this.simulatedFailures.add(providerId);
    } else {
      this.simulatedFailures.delete(providerId);
    }
  }

  /**
   * Checks if simulated failure is active for a provider
   */
  public isSimulatedFailure(providerId: string): boolean {
    return this.simulatedFailures.has(providerId);
  }

  /**
   * Retrieves or creates a Circuit Breaker for a given provider
   */
  public getCircuitBreaker(providerId: string): ProviderCircuitBreaker {
    let cb = this.circuitBreakers.get(providerId);
    if (!cb) {
      cb = new ProviderCircuitBreaker(providerId);
      this.circuitBreakers.set(providerId, cb);
    }
    return cb;
  }

  /**
   * Retrieves all circuit breaker states for external/UI diagnostics
   */
  public getCircuitBreakerStates(): Record<string, { state: string; failureCount: number; lastFailureTime: number; simulatedFailure: boolean }> {
    const states: Record<string, any> = {};
    const defaultProviders = ["gemini", "openai", "claude", "llama", "deepseek", "mistral"];
    
    // Ensure all known providers have an entry
    for (const pId of defaultProviders) {
      const cb = this.getCircuitBreaker(pId);
      states[pId] = {
        state: cb.state,
        failureCount: cb.failureCount,
        lastFailureTime: cb.lastFailureTime,
        simulatedFailure: this.isSimulatedFailure(pId)
      };
    }
    
    return states;
  }

  /**
   * Generates a stable cache key based on the request parameters
   */
  private generateCacheKey(model: string, request: ProviderRequest): string {
    const serializedMessages = request.messages
      .map((m) => `${m.role}:${m.content}`)
      .join("|");
    const webSearchStr = request.webSearch ? "search:true" : "search:false";
    const systemInstruction = request.systemInstruction || "";
    const temperature = request.temperature ?? 0.7;
    
    return `${model}#${serializedMessages}#${webSearchStr}#${systemInstruction}#${temperature}`;
  }

  /**
   * Basic Rate Limiting
   */
  private checkRateLimit(clientId: string): boolean {
    const now = Date.now();
    const timestamps = this.rateLimits.get(clientId) || [];
    
    // Filter timestamps within current window
    const activeTimestamps = timestamps.filter((t) => now - t < this.windowSizeMs);
    
    if (activeTimestamps.length >= this.maxRequestsPerWindow) {
      return false;
    }
    
    activeTimestamps.push(now);
    this.rateLimits.set(clientId, activeTimestamps);
    return true;
  }

  /**
   * Structured logger helper
   */
  private logStructured(event: string, data: Record<string, any>) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      component: "AIRouter",
      event,
      ...data
    }, null, 2));
  }

  /**
   * Main route function
   */
  async route(
    requestedModelString: string,
    request: ProviderRequest,
    clientId = "default-client",
    userId?: string
  ): Promise<ProviderResponse & { metrics: UsageMetric; fallbackChain?: string[] }> {
    
    // 1. Check Rate Limit
    if (!this.checkRateLimit(clientId)) {
      this.logStructured("RATE_LIMIT_EXCEEDED", { clientId });
      throw new Error("Muitas requisições em curto espaço de tempo. Limite de taxa excedido. Por favor, aguarde 1 minuto.");
    }

    // Automatic Long Term Memory Injection
    const lastUserMsg = [...request.messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg && lastUserMsg.content) {
      try {
        const baseSystemInstruction = request.systemInstruction || "Você é o CloneAI, um copiloto de segurança cibernética inteligente.";
        const enrichedPrompt = await sharedMemoryBase.formatSystemPromptWithMemory(baseSystemInstruction, lastUserMsg.content, userId);
        request.systemInstruction = enrichedPrompt;
      } catch (err) {
        console.error("Erro ao injetar memórias no system instruction do AIRouter:", err);
      }
    }

    const startTime = Date.now();
    let modelString = requestedModelString;

    // 2. Resolve "Auto" mode to best primary provider
    // In "Auto" mode, we check which provider is configured. Since Gemini is typically configured
    // and supports advanced capabilities (webSearch grounding), we default Auto to gemini-2.5-flash,
    // unless OpenAI is requested, configured, and webSearch is false.
    if (modelString.toLowerCase() === "auto") {
      if (request.webSearch && this.isProviderConfigured("gemini")) {
        modelString = "gemini:gemini-2.5-flash";
      } else if (this.isProviderConfigured("openai") && !request.webSearch) {
        modelString = "openai:gpt-4o-mini";
      } else if (this.isProviderConfigured("gemini")) {
        modelString = "gemini:gemini-2.5-flash";
      } else {
        // Fallback options in case the main ones aren't configured
        const options = [
          { id: "gemini:gemini-2.5-flash", provider: "gemini" },
          { id: "openai:gpt-4o-mini", provider: "openai" },
          { id: "claude:claude-3-5-haiku-latest", provider: "claude" },
          { id: "llama:llama-3.1-8b", provider: "llama" },
          { id: "deepseek:deepseek-chat", provider: "deepseek" },
          { id: "mistral:mistral-small-latest", provider: "mistral" }
        ];
        const found = options.find(opt => this.isProviderConfigured(opt.provider));
        modelString = found ? found.id : "gemini:gemini-2.5-flash";
      }
    }

    // Parse provider and model from "provider:model" format
    let [providerId, modelId] = modelString.split(":");
    if (!modelId) {
      // Fallback parser if format is simple model name
      modelId = providerId;
      providerId = this.detectProviderFromModel(modelId);
    }

    // 3. Response Cache Lookup
    const cacheKey = this.generateCacheKey(`${providerId}:${modelId}`, request);
    const cachedEntry = this.cache.get(cacheKey);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      this.logStructured("CACHE_HIT", { providerId, modelId });
      
      const metric: UsageMetric = {
        timestamp: new Date().toISOString(),
        requestedModel: requestedModelString,
        routedProvider: providerId,
        routedModel: modelId,
        status: "success",
        latencyMs: Date.now() - startTime,
        estimatedCostUsd: 0, // Cached responses are free
        promptTokens: cachedEntry.response.usage?.promptTokens || 0,
        completionTokens: cachedEntry.response.usage?.completionTokens || 0,
        cached: true
      };
      
      this.metrics.push(metric);
      return {
        ...cachedEntry.response,
        metrics: metric
      };
    }

    // 4. Fallback execution list
    // If the selected model fails, we try these alternatives in order.
    // We only include models whose providers are actually configured, so we don't fail silently or log spam.
    const fallbackChain: string[] = [`${providerId}:${modelId}`];

    // Candidate fallback models
    const fallbackCandidates = [
      "gemini:gemini-2.5-flash",
      "gemini:gemini-3.5-flash",
      "openai:gpt-4o-mini",
      "claude:claude-3-5-haiku-latest",
      "llama:llama-3.1-8b",
      "deepseek:deepseek-chat",
      "mistral:mistral-small-latest"
    ];

    for (const candidate of fallbackCandidates) {
      const [candProvider] = candidate.split(":");
      if (this.isProviderConfigured(candProvider)) {
        fallbackChain.push(candidate);
      }
    }

    // Ensure we have at least one fallback option in case nothing is configured
    if (fallbackChain.length === 1) {
      fallbackChain.push("gemini:gemini-2.5-flash");
    }

    // Remove duplicates from chain while keeping original first
    const uniqueChain = Array.from(new Set(fallbackChain));

    // FILTER out options whose circuit breakers are OPEN, unless ALL options are OPEN
    let filteredChain = uniqueChain.filter((option) => {
      const [currentProviderId] = option.split(":");
      const cb = this.getCircuitBreaker(currentProviderId);
      return cb.allowRequest();
    });

    if (filteredChain.length === 0) {
      filteredChain = uniqueChain;
      this.logStructured("ALL_CIRCUITS_OPEN_FALLBACK", {
        message: "Todos os provedores estão em estado de disjuntor ABERTO. Tentando todos os modelos do chain como último recurso."
      });
    } else if (filteredChain.length < uniqueChain.length) {
      const bypassed = uniqueChain.filter(opt => !filteredChain.includes(opt));
      this.logStructured("CIRCUITS_BYPASSED_DUE_TO_OPEN_STATE", {
        bypassedCount: bypassed.length,
        bypassedOptions: bypassed
      });
    }

    let lastError: Error | null = null;
    let fallbackCount = 0;

    for (const option of filteredChain) {
      const [currentProviderId, currentModelId] = option.split(":");
      const provider = this.providers.get(currentProviderId);

      if (!provider) {
        lastError = new Error(`Provedor desconhecido: ${currentProviderId}`);
        continue;
      }

      const cb = this.getCircuitBreaker(currentProviderId);

      try {
        this.logStructured("ATTEMPTING_PROVIDER", { 
          requestedModelString, 
          routedProvider: currentProviderId, 
          routedModel: currentModelId,
          isFallback: fallbackCount > 0,
          circuitBreakerState: cb.state
        });

        // Injetar erro de rede/API simulado para testes de resiliência e circuit breaker
        if (this.isSimulatedFailure(currentProviderId)) {
          throw new Error(`[SIMULADO] Erro de conexão de rede ou indisponibilidade temporária de API injetado no provedor ${currentProviderId}.`);
        }

        // Retry with backoff (3 attempts: initial + 2 retries) and wrapped with 12s timeout
        const response = await this.executeWithTimeout(async () => {
          return await this.executeWithRetry(async () => {
            return await provider.generateResponse(currentModelId, request);
          });
        }, 12000, currentProviderId);

        // Success!
        cb.recordSuccess();

        const latencyMs = Date.now() - startTime;
        const status = fallbackCount === 0 ? "success" : "fallback";

        const metric: UsageMetric = {
          timestamp: new Date().toISOString(),
          requestedModel: requestedModelString,
          routedProvider: currentProviderId,
          routedModel: currentModelId,
          status,
          latencyMs,
          estimatedCostUsd: response.estimatedCostUsd,
          promptTokens: response.usage?.promptTokens || 0,
          completionTokens: response.usage?.completionTokens || 0,
          cached: false
        };

        this.metrics.push(metric);
        this.logStructured("PROVIDER_SUCCESS", { 
          model: option, 
          latencyMs, 
          costUsd: response.estimatedCostUsd, 
          status,
          circuitBreakerState: cb.state
        });

        // Save to cache (valid for 5 minutes)
        this.cache.set(cacheKey, {
          response,
          expiresAt: Date.now() + 5 * 60 * 1000
        });

        return {
          ...response,
          metrics: metric,
          fallbackChain: fallbackCount > 0 ? filteredChain.slice(0, fallbackCount + 1) : undefined
        };

      } catch (err: any) {
        // Record failure in the Circuit Breaker
        cb.recordFailure();

        this.logStructured("PROVIDER_FAILED", { 
          model: option, 
          error: err.message || err,
          circuitBreakerState: cb.state,
          failureCount: cb.failureCount
        });
        lastError = err;
        fallbackCount++;
        // Continue to the next fallback option in the chain
      }
    }

    // 5. If all options failed
    const failedLatency = Date.now() - startTime;
    const failedMetric: UsageMetric = {
      timestamp: new Date().toISOString(),
      requestedModel: requestedModelString,
      routedProvider: "none",
      routedModel: "none",
      status: "failed",
      latencyMs: failedLatency,
      estimatedCostUsd: 0,
      promptTokens: 0,
      completionTokens: 0,
      error: lastError?.message || "Todos os provedores falharam.",
      cached: false
    };
    this.metrics.push(failedMetric);

    throw lastError || new Error("Falha total: Todos os modelos e fallbacks estão indisponíveis.");
  }

  /**
   * Simple Retry with Backoff
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    retries = 1,
    delayMs = 400
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (retries <= 0) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return this.executeWithRetry(fn, retries - 1, delayMs * 1.5);
    }
  }

  /**
   * Enforces a hard timeout on the execution of an async function
   */
  private async executeWithTimeout<T>(
    promiseFn: () => Promise<T>,
    timeoutMs: number,
    providerId: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Erro: Tempo limite da API (${timeoutMs / 1000}s) excedido para o provedor ${providerId}`));
      }, timeoutMs);

      promiseFn()
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Detects the provider ID based on a standalone model ID
   */
  private detectProviderFromModel(modelId: string): string {
    const lower = modelId.toLowerCase();
    if (lower.startsWith("gpt") || lower.includes("openai")) return "openai";
    if (lower.startsWith("claude") || lower.includes("anthropic")) return "claude";
    if (lower.startsWith("gemini") || lower.includes("google")) return "gemini";
    if (lower.startsWith("llama") || lower.includes("meta")) return "llama";
    if (lower.startsWith("deepseek")) return "deepseek";
    if (lower.startsWith("mistral") || lower.includes("mixtral")) return "mistral";
    return "gemini"; // default safe fallback
  }

  /**
   * Checks if the API key for a provider is configured in the environment
   */
  private isProviderConfigured(providerId: string): boolean {
    switch (providerId) {
      case "gemini":
        return !!process.env.GEMINI_API_KEY;
      case "openai":
        return !!process.env.OPENAI_API_KEY;
      case "claude":
        return !!process.env.ANTHROPIC_API_KEY;
      case "llama":
        return !!(process.env.LLAMA_API_KEY || process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY);
      case "deepseek":
        return !!process.env.DEEPSEEK_API_KEY;
      case "mistral":
        return !!process.env.MISTRAL_API_KEY;
      default:
        return false;
    }
  }

  /**
   * Retrieves all metric logs
   */
  getMetrics(): UsageMetric[] {
    return this.metrics;
  }

  /**
   * Clears response cache
   */
  clearCache() {
    this.cache.clear();
    this.logStructured("CACHE_CLEARED", {});
  }
}
