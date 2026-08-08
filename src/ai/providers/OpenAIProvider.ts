import { AIProvider, ProviderRequest, ProviderResponse } from "../types/AIProvider";

export class OpenAIProvider implements AIProvider {
  id = "openai";
  name = "OpenAI GPT";
  models = ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"];
  defaultModel = "gpt-4o-mini";

  async generateResponse(
    model: string,
    request: ProviderRequest
  ): Promise<ProviderResponse> {
    const startTime = Date.now();
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("OPENAI_API_KEY não configurada no ambiente.");
    }

    const selectedModel = this.models.includes(model) ? model : this.defaultModel;

    // Standard OpenAI API request body
    const messages = [];

    if (request.systemInstruction) {
      messages.push({
        role: "system",
        content: request.systemInstruction,
      });
    }

    // Map roles
    request.messages.forEach((m) => {
      messages.push({
        role: m.role,
        content: m.content,
      });
    });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages,
        temperature: request.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Erro na API OpenAI (${response.status}): ${errBody}`);
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
    let inputPrice = 0.150; // default to gpt-4o-mini per 1M tokens
    let outputPrice = 0.600;

    if (model === "gpt-4o") {
      inputPrice = 2.50;
      outputPrice = 10.00;
    } else if (model === "gpt-3.5-turbo") {
      inputPrice = 0.50;
      outputPrice = 1.50;
    }

    const costInput = (promptTokens / 1_000_000) * inputPrice;
    const costOutput = (completionTokens / 1_000_000) * outputPrice;

    return Number((costInput + costOutput).toFixed(8));
  }
}
