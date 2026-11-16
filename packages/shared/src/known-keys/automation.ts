import { inCategory } from "./types.js";

const QSTASH = "https://upstash.com/docs/qstash/howto/signature";
const INNGEST = "https://www.inngest.com/docs/platform/signing-keys";

export const AUTOMATION_KEYS = inCategory("automation", [
  { name: "ZAPIER_WEBHOOK_URL", provider: "Zapier", description: "Catch hook URL from a Zapier Webhooks trigger.", docsUrl: "https://help.zapier.com/hc/en-us/articles/8496288690317", valueHint: "https://hooks.zapier.com/hooks/catch/...", valuePattern: /^https:\/\/hooks\.zapier\.com\/hooks\/catch\/\S+$/, source: "convention" },
  { name: "MAKE_WEBHOOK_URL", provider: "Make", description: "Custom webhook URL from a Make scenario.", docsUrl: "https://www.make.com/en/help/tools/webhooks", valueHint: "https://hook.<region>.make.com/...", valuePattern: /^https:\/\/hook\.[a-z0-9]+\.make\.com\/\S+$/, source: "convention" },
  { name: "N8N_WEBHOOK_URL", provider: "n8n", description: "Production URL of an n8n Webhook node.", docsUrl: "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/", valueHint: "An https URL with /webhook/", source: "convention" },
  { name: "N8N_API_KEY", provider: "n8n", description: "n8n public API key.", docsUrl: "https://docs.n8n.io/api/authentication/", source: "convention" },
  { name: "INNGEST_EVENT_KEY", provider: "Inngest", description: "Inngest event key, read by the Inngest SDK.", docsUrl: "https://www.inngest.com/docs/events/creating-an-event-key", pair: ["INNGEST_SIGNING_KEY"], source: "sdk" },
  { name: "INNGEST_SIGNING_KEY", provider: "Inngest", description: "Inngest signing key, read by the Inngest SDK.", docsUrl: INNGEST, valueHint: "Starts with signkey-", valuePattern: /^signkey-(prod|test|branch)-[a-f0-9]{32,}$/, pair: ["INNGEST_EVENT_KEY"], source: "sdk" },
  { name: "TRIGGER_SECRET_KEY", provider: "Trigger.dev", description: "Trigger.dev secret key, read by the Trigger.dev SDK.", docsUrl: "https://trigger.dev/docs/apikeys", valueHint: "Starts with tr_dev_, tr_stg_ or tr_prod_", valuePattern: /^tr_(dev|stg|prod)_[A-Za-z0-9]{16,}$/, source: "sdk" },
  { name: "QSTASH_TOKEN", provider: "Upstash", description: "QStash token, read by the QStash SDK.", docsUrl: "https://upstash.com/docs/qstash/overall/getstarted", source: "sdk" },
  { name: "QSTASH_CURRENT_SIGNING_KEY", provider: "Upstash", description: "Verifies QStash requests, read by the QStash receiver.", docsUrl: QSTASH, valueHint: "Starts with sig_", valuePattern: /^sig_[A-Za-z0-9]{20,}$/, pair: ["QSTASH_NEXT_SIGNING_KEY"], source: "sdk" },
  { name: "QSTASH_NEXT_SIGNING_KEY", provider: "Upstash", description: "Next QStash signing key, used after a key rotation.", docsUrl: QSTASH, valueHint: "Starts with sig_", pair: ["QSTASH_CURRENT_SIGNING_KEY"], source: "sdk" },
]);
