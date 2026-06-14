import 'dotenv/config';

/** Centralized, validated runtime configuration. */
export const config = {
  port: Number(process.env.PORT ?? 4317),

  foundryIQ: {
    endpoint: process.env.FOUNDRY_IQ_SEARCH_ENDPOINT?.trim() ?? '',
    knowledgeBase: process.env.FOUNDRY_IQ_KNOWLEDGE_BASE?.trim() ?? '',
    apiKey: process.env.FOUNDRY_IQ_API_KEY?.trim() ?? '',
    apiVersion: process.env.FOUNDRY_IQ_API_VERSION?.trim() || '2025-08-01-preview',
  },

  azureOpenAI: {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT?.trim() ?? '',
    apiKey: process.env.AZURE_OPENAI_API_KEY?.trim() ?? '',
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT?.trim() || 'gpt-4o',
    apiVersion: process.env.AZURE_OPENAI_API_VERSION?.trim() || '2024-10-21',
  },
} as const;

/** True when live Foundry IQ agentic retrieval can be called. */
export function isFoundryIQConfigured(): boolean {
  const f = config.foundryIQ;
  return Boolean(f.endpoint && f.knowledgeBase && f.apiKey);
}

/** True when live Azure OpenAI narration can be called. */
export function isAzureOpenAIConfigured(): boolean {
  const a = config.azureOpenAI;
  return Boolean(a.endpoint && a.apiKey && a.deployment);
}
