import { inCategory } from "./types.js";

const TWILIO = "https://console.twilio.com";
const SLACK_APPS = "https://api.slack.com/apps";
const DISCORD_APPS = "https://discord.com/developers/applications";

export const MESSAGING_KEYS = inCategory("messaging", [
  { name: "TWILIO_ACCOUNT_SID", provider: "Twilio", description: "Twilio account SID.", docsUrl: TWILIO, valueHint: "Starts with AC", valuePattern: /^AC[a-f0-9]{32}$/, pair: ["TWILIO_AUTH_TOKEN"], source: "sdk" },
  { name: "TWILIO_AUTH_TOKEN", provider: "Twilio", description: "Twilio auth token.", docsUrl: TWILIO, pair: ["TWILIO_ACCOUNT_SID"], source: "sdk" },
  { name: "SLACK_BOT_TOKEN", provider: "Slack", description: "Slack bot token.", docsUrl: SLACK_APPS, valueHint: "Starts with xoxb-", valuePattern: /^xoxb-[A-Za-z0-9-]{20,}$/, pair: ["SLACK_SIGNING_SECRET"], source: "convention" },
  { name: "SLACK_SIGNING_SECRET", provider: "Slack", description: "Verifies requests from Slack.", docsUrl: SLACK_APPS, pair: ["SLACK_BOT_TOKEN"], source: "convention" },
  { name: "SLACK_WEBHOOK_URL", provider: "Slack", description: "Incoming webhook URL.", docsUrl: "https://api.slack.com/messaging/webhooks", valueHint: "https://hooks.slack.com/...", valuePattern: /^https:\/\/hooks\.slack\.com\/\S+$/, source: "convention" },
  { name: "DISCORD_BOT_TOKEN", provider: "Discord", description: "Discord bot token.", docsUrl: DISCORD_APPS, source: "convention" },
  { name: "DISCORD_WEBHOOK_URL", provider: "Discord", description: "Discord channel webhook URL.", docsUrl: "https://support.discord.com/hc/en-us/articles/228383668", valueHint: "https://discord.com/api/webhooks/...", valuePattern: /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/, source: "convention" },
  { name: "DISCORD_CLIENT_ID", provider: "Discord", description: "Discord application client id.", docsUrl: DISCORD_APPS, pair: ["DISCORD_CLIENT_SECRET"], source: "convention" },
  { name: "DISCORD_CLIENT_SECRET", provider: "Discord", description: "Discord OAuth client secret.", docsUrl: DISCORD_APPS, pair: ["DISCORD_CLIENT_ID"], source: "convention" },
  { name: "TELEGRAM_BOT_TOKEN", provider: "Telegram", description: "Telegram bot token from BotFather.", docsUrl: "https://core.telegram.org/bots/tutorial#obtain-your-bot-token", valueHint: "<bot id>:<35 characters>", valuePattern: /^\d{6,12}:[A-Za-z0-9_-]{35}$/, source: "convention" },
  { name: "ABLY_API_KEY", provider: "Ably", description: "Ably API key.", docsUrl: "https://ably.com/docs/auth/basic", source: "convention" },
]);
