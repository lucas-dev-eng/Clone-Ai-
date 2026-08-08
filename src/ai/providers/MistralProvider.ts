import { AIProvider, ProviderRequest, ProviderResponse } from "../types/AIProvider";

export class MistralProvider implements AIProvider {
  id = "mistral";
  name = "Mistral AI";
  models = ["mistral-large-latest", "mistral-small-latest", "open-mixtral-8x22b"];
  defaultModel = "mistral-small-latest";

  async generateResponse(
    model: string,
    request: ProviderRequest
  ): Promise<ProviderResponse> {
    const startTime = Date.now();
    const apiKey = process.env.MISTRAL_API_KEY;

    if (!apiKey) {
      throw new Error("MISTRAL_API_KEY não configurada no ambiente.");
    }

    const selectedModel = this.models.includes(model) ? model : this.defaultModel;

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

    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
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
      throw new Error(`Erro na API Mistral (${response.status}): ${errBody}`);
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
    let inputPrice = 0.20; // mistral-small
    let outputPrice = 0.60;

    if (model.includes("large")) {
      inputPrice = 2.00;
      outputPrice = 6.00;
    } else if (model.includes("8x22b")) {
      inputPrice = 0.90;
      outputPrice = 2.70;
    }

    const costInput = (promptTokens / 1_000_000) * inputPrice;
    const costOutput = (completionTokens / 1_000_000) * outputPrice;

    return Number((costInput + costOutput).toFixed(8));
  }
}
