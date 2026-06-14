import { config, isAzureOpenAIConfigured } from './config.js';

export interface NarrationRequest {
  system: string;
  user: string;
  /** Lower = more grounded/consistent, higher = more inventive. */
  temperature?: number;
  maxTokens?: number;
}

/**
 * Narration model wrapper. Uses Azure OpenAI when configured; otherwise returns
 * `null` so the caller can fall back to the deterministic procedural narrator.
 * Keeping the network call dependency-free (fetch) reduces failure surface.
 */
export async function narrate(req: NarrationRequest): Promise<string | null> {
  if (!isAzureOpenAIConfigured()) return null;
  const { endpoint, apiKey, deployment, apiVersion } = config.azureOpenAI;
  const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        temperature: req.temperature ?? 0.8,
        max_tokens: req.maxTokens ?? 700,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any = await res.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    return content?.trim() ?? null;
  } catch (err) {
    console.warn('[narrate] Azure OpenAI failed, falling back:', (err as Error).message);
    return null;
  }
}
