import { inCategory } from "./types.js";

const OPENAI = "https://platform.openai.com/api-keys";
const AZURE_OPENAI = "https://learn.microsoft.com/azure/ai-services/openai/quickstart";

export const AI_KEYS = inCategory("ai", [
  { name: "OPENAI_API_KEY", provider: "OpenAI", description: "OpenAI API key.", docsUrl: OPENAI, valueHint: "Starts with sk-", valuePattern: /^sk-(?!ant-|or-)(proj-|svcacct-)?[A-Za-z0-9_-]{20,}$/, source: "sdk" },
  { name: "OPENAI_ORG_ID", provider: "OpenAI", description: "OpenAI organization id.", docsUrl: "https://platform.openai.com/settings/organization/general", valueHint: "Starts with org-", valuePattern: /^org-[A-Za-z0-9]{10,}$/, source: "sdk" },
  { name: "OPENAI_BASE_URL", provider: "OpenAI", description: "Custom API base URL for OpenAI-compatible servers.", docsUrl: "https://platform.openai.com/docs/api-reference", valueHint: "An https URL", source: "sdk" },
  { name: "AZURE_OPENAI_API_KEY", provider: "Azure OpenAI", description: "Azure OpenAI resource key, read by the OpenAI SDK's Azure client.", docsUrl: AZURE_OPENAI, pair: ["AZURE_OPENAI_ENDPOINT"], source: "sdk" },
  { name: "AZURE_OPENAI_ENDPOINT", provider: "Azure OpenAI", description: "Azure OpenAI resource endpoint.", docsUrl: AZURE_OPENAI, valueHint: "https://<resource>.openai.azure.com", pair: ["AZURE_OPENAI_API_KEY"], source: "sdk" },
  { name: "ANTHROPIC_API_KEY", provider: "Anthropic", description: "Anthropic API key for Claude.", docsUrl: "https://console.anthropic.com/settings/keys", valueHint: "Starts with sk-ant-", valuePattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/, source: "sdk" },
  { name: "GEMINI_API_KEY", provider: "Google Gemini", description: "Gemini API key from Google AI Studio.", docsUrl: "https://aistudio.google.com/app/apikey", valueHint: "Starts with AIza", valuePattern: /^AIza[A-Za-z0-9_-]{35}$/, source: "sdk" },
  { name: "MISTRAL_API_KEY", provider: "Mistral", description: "Mistral API key.", docsUrl: "https://console.mistral.ai/api-keys", source: "sdk" },
  { name: "GROQ_API_KEY", provider: "Groq", description: "Groq API key.", docsUrl: "https://console.groq.com/keys", valueHint: "Starts with gsk_", valuePattern: /^gsk_[A-Za-z0-9]{20,}$/, source: "sdk" },
  { name: "XAI_API_KEY", provider: "xAI", description: "xAI API key for Grok.", docsUrl: "https://console.x.ai", valueHint: "Starts with xai-", valuePattern: /^xai-[A-Za-z0-9]{20,}$/, source: "sdk" },
  { name: "OPENROUTER_API_KEY", provider: "OpenRouter", description: "OpenRouter API key.", docsUrl: "https://openrouter.ai/keys", valueHint: "Starts with sk-or-", valuePattern: /^sk-or-[A-Za-z0-9_-]{20,}$/, source: "convention" },
  { name: "DEEPSEEK_API_KEY", provider: "DeepSeek", description: "DeepSeek API key.", docsUrl: "https://platform.deepseek.com/api_keys", source: "convention" },
  { name: "PERPLEXITY_API_KEY", provider: "Perplexity", description: "Perplexity API key.", docsUrl: "https://www.perplexity.ai/settings/api", valueHint: "Starts with pplx-", valuePattern: /^pplx-[A-Za-z0-9]{30,}$/, source: "convention" },
  { name: "COHERE_API_KEY", provider: "Cohere", description: "Cohere API key.", docsUrl: "https://dashboard.cohere.com/api-keys", source: "convention" },
  { name: "TOGETHER_API_KEY", provider: "Together AI", description: "Together AI API key.", docsUrl: "https://api.together.ai/settings/api-keys", source: "convention" },
  { name: "HF_TOKEN", provider: "Hugging Face", description: "Hugging Face access token, read by huggingface_hub.", docsUrl: "https://huggingface.co/settings/tokens", valueHint: "Starts with hf_", valuePattern: /^hf_[A-Za-z0-9]{30,}$/, source: "sdk", iconSlug: "huggingface" },
  { name: "REPLICATE_API_TOKEN", provider: "Replicate", description: "Replicate API token, read by the Replicate client.", docsUrl: "https://replicate.com/account/api-tokens", valueHint: "Starts with r8_", valuePattern: /^r8_[A-Za-z0-9]{30,}$/, source: "sdk", iconSlug: "replicate" },
  { name: "PINECONE_API_KEY", provider: "Pinecone", description: "Pinecone API key, read by the Pinecone SDK.", docsUrl: "https://app.pinecone.io", source: "sdk" },
  { name: "ELEVENLABS_API_KEY", provider: "ElevenLabs", description: "ElevenLabs API key.", docsUrl: "https://elevenlabs.io/app/settings/api-keys", source: "convention" },
]);
