import { AIProvider, ProviderRequest, ProviderResponse } from "../types/AIProvider";

export class LlamaProvider implements AIProvider {
  id = "llama";
  name = "Meta Llama";
  models = ["llama-3.3-70b", "llama-3.1-8b", "llama-3-70b", "llama-3-8b"];
  defaultModel = "llama-3.3-70b";

  async generateResponse(
    model: string,
    request: ProviderRequest
  ): Promise<ProviderResponse> {
    const startTime = Date.now();
    
    // Support various standard API keys for Llama
    const apiKey = process.env.LLAMA_API_KEY || process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY;
    let endpoint = "https://api.groq.com/openai/v1/chat/completions";
    let selectedModel = "llama-3.3-70b-versatile"; // Groq standard model for llama-3.3-70b

    if (!apiKey) {
      throw new Error("Nenhuma chave de API configurada para Llama (LLAMA_API_KEY, GROQ_API_KEY ou OPENROUTER_API_KEY).");
    }

    if (process.env.OPENROUTER_API_KEY) {
      endpoint = "https://openrouter.ai/api/v1/chat/completions";
      if (model.includes("3.3-70b")) selectedModel = "meta-llama/llama-3.3-70b-instruct";
      else if (model.includes("3.1-8b")) selectedModel = "meta-llama/llama-3.1-8b-instruct";
      else selectedModel = "meta-llama/llama-3.3-70b-instruct";
    } else {
      // Groq format mapping
      if (model.includes("3.1-8b")) selectedModel = "llama-3.1-8b-instant";
      else if (model.includes("3-8b")) selectedModel = "llama3-8b-8192";
      else if (model.includes("3-70b")) selectedModel = "llama3-70b-8192";
    }

    const messages = [];

    if (request.systemInstruction) {
      messages.push({
        role: "system",
        content: request.systemInstruction,
      });
    }

    request.messages.forEach((m) => {
      messages.push({
        role: m.role,
        content: m.content,
      });
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    };

    if (process.env.OPENROUTER_API_KEY) {
      headers["HTTP-Referer"] = "https://ai.studio/build";
      headers["X-Title"] = "CloneAI Multimodal";
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: selectedModel,
        messages,
        temperature: request.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Erro na API Llama/Groq (${response.status}): ${errBody}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "(sem resposta)";
    const latencyMs = Date.now() - startTime;

    const promptTokens = data.usage?.prompt_tokens || 0;
    const completionTokens = data.usage?.completion_tokens || 0;

    const estimatedCostUsd = this.calculateCost(selectedModel, promptTokens, completionTokens);

    return {
      text,
      providerName: this.name,
      modelUsed: selectedModel,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      latencyMs,
      estimatedCostUsd,
    };
  }

  calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number
  ): number {
    // Standard cost for Groq/OpenRouter Llama models per 1M tokens
    let inputPrice = 0.20; // llama 70b
    let outputPrice = 0.79;

    if (model.includes("8b")) {
      inputPrice = 0.05;
      outputPrice = 0.10;
    }

    const costInput = (promptTokens / 1_000_000) * inputPrice;
    const costOutput = (completionTokens / 1_000_000) * outputPrice;

    return Number((costInput + costOutput).toFixed(8));
  }
}
