export interface AIMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ProviderRequest {
  messages: AIMessage[];
  webSearch?: boolean;
  systemInstruction?: string;
  temperature?: number;
  confirmedTools?: string[];
  deniedTools?: string[];
}

export interface ProviderResponse {
  text: string;
  sources?: Array<{ title: string; url: string }>;
  providerName: string;
  modelUsed: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  estimatedCostUsd: number;
  agentSteps?: Array<{
    iteration: number;
    toolName: string;
    args: any;
    result: any;
    durationMs?: number;
  }>;
  requiresConfirmation?: boolean;
  toolToConfirm?: {
    name: string;
    args: any;
  };
}

export interface AIProvider {
  id: string;
  name: string;
  models: string[];
  defaultModel: string;
  
  generateResponse(
    model: string,
    request: ProviderRequest
  ): Promise<ProviderResponse>;
  
  calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number
  ): number;
}
