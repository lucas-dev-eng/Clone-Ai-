import { AIProvider, ProviderRequest, ProviderResponse } from "../types/AIProvider";

export class DeepSeekProvider implements AIProvider {
  id = "deepseek";
  name = "DeepSeek";
  models = ["deepseek-chat", "deepseek-reasoner"];
  defaultModel = "deepseek-chat";

  async generateResponse(
    model: string,
    request: ProviderRequest
  ): Promise<ProviderResponse> {
    const startTime = Date.now();
    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (!apiKey) {
      throw new Error("DEEPSEEK_API_KEY não configurada no ambiente.");
    }

    const selectedModel = this.models.includes(model) ? model : this.defaultModel;

    const messages = [];

    if (request.systemInstruction && selectedModel !== "deepseek-reasoner") {
      // Note: deepseek-reasoner (R1) does not support system instructions in some versions,
      // but if we do, we can pass it as a system message.
      messages.push({
        role: "system",
        content: request.systemInstruction,
      });
    } else if (request.systemInstruction) {
      // Append instruction to first user message for reasoner to be safe
      messages.push({
        role: "user",
        content: `[System Instruction: ${request.systemInstruction}]\n\nHello!`,
      });
    }

    request.messages.forEach((m) => {
      messages.push({
        role: m.role,
        content: m.content,
      });
    });

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages,
        temperature: selectedModel === "deepseek-reasoner" ? 1.0 : (request.temperature ?? 0.7), // R1 recommends temp=1.0 or 1.3
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Erro na API DeepSeek (${response.status}): ${errBody}`);
    }

    const data = await response.json();
    let text = data.choices?.[0]?.message?.content || "(sem resposta)";
    
    // For deepseek-reasoner, R1 outputs reasoning_content as well! Let's display it elegantly if present
    const reasoningContent = data.choices?.[0]?.message?.reasoning_content;
    if (reasoningContent) {
      text = `> **Raciocínio Interno (DeepSeek R1):**\n> ${reasoningContent.replace(/\n/g, "\n> ")}\n\n${text}`;
    }

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
    let inputPrice = 0.14; // deepseek-chat input per 1M tokens (cache hit/miss average)
    let outputPrice = 0.28;

    if (model === "deepseek-reasoner") {
      inputPrice = 0.55;
      outputPrice = 2.19;
    }

    const costInput = (promptTokens / 1_000_000) * inputPrice;
    const costOutput = (completionTokens / 1_000_000) * outputPrice;

    return Number((costInput + costOutput).toFixed(8));
  }
}
