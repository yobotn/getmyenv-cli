import { inCategory } from "./types.js";

const SUPABASE_API = "https://supabase.com/dashboard/project/_/settings/api";
const VERCEL_STORAGE = "https://vercel.com/docs/storage";

export const DATA_KEYS = inCategory("data", [
  { name: "DATABASE_URL", provider: "Postgres", description: "Database connection string, read by Prisma and most ORMs.", docsUrl: "https://www.prisma.io/docs/orm/reference/connection-urls", valueHint: "postgresql://user:password@host:5432/db", valuePattern: /^postgres(ql)?:\/\/\S+$/, source: "convention" },
  { name: "DIRECT_URL", provider: "Prisma", description: "Direct database connection for Prisma migrations, next to a pooled DATABASE_URL.", docsUrl: "https://www.prisma.io/docs/orm/reference/prisma-schema-reference#datasource", pair: ["DATABASE_URL"], source: "convention" },
  { name: "MONGODB_URI", provider: "MongoDB", description: "MongoDB connection string.", docsUrl: "https://www.mongodb.com/docs/manual/reference/connection-string/", valueHint: "mongodb:// or mongodb+srv://", valuePattern: /^mongodb(\+srv)?:\/\/\S+$/, source: "convention", iconSlug: "mongodb" },
  { name: "REDIS_URL", provider: "Redis", description: "Redis connection string.", docsUrl: "https://redis.io/docs/latest/develop/clients/", valueHint: "redis:// or rediss://", valuePattern: /^rediss?:\/\/\S+$/, source: "convention" },
  { name: "UPSTASH_REDIS_REST_URL", provider: "Upstash", description: "Upstash Redis REST URL.", docsUrl: "https://console.upstash.com", valueHint: "An https URL ending in upstash.io", pair: ["UPSTASH_REDIS_REST_TOKEN"], source: "sdk" },
  { name: "UPSTASH_REDIS_REST_TOKEN", provider: "Upstash", description: "Upstash Redis REST token.", docsUrl: "https://console.upstash.com", pair: ["UPSTASH_REDIS_REST_URL"], source: "sdk" },
  { name: "KV_REST_API_URL", provider: "Vercel", description: "Redis REST URL from a Vercel storage integration.", docsUrl: VERCEL_STORAGE, pair: ["KV_REST_API_TOKEN"], source: "sdk" },
  { name: "KV_REST_API_TOKEN", provider: "Vercel", description: "Redis REST token from a Vercel storage integration.", docsUrl: VERCEL_STORAGE, pair: ["KV_REST_API_URL"], source: "sdk" },
  { name: "BLOB_READ_WRITE_TOKEN", provider: "Vercel", description: "Vercel Blob token, read by @vercel/blob.", docsUrl: "https://vercel.com/docs/vercel-blob", source: "sdk" },
  { name: "SUPABASE_URL", provider: "Supabase", description: "Supabase project URL.", docsUrl: SUPABASE_API, valueHint: "https://<project>.supabase.co", valuePattern: /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/, pair: ["SUPABASE_ANON_KEY"], source: "convention" },
  { name: "SUPABASE_ANON_KEY", provider: "Supabase", description: "Supabase anon key. Safe for the browser with row level security.", docsUrl: SUPABASE_API, pair: ["SUPABASE_URL"], source: "convention" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", provider: "Supabase", description: "Supabase service role key. Server only, bypasses row level security.", docsUrl: SUPABASE_API, source: "convention" },
  { name: "NEXT_PUBLIC_SUPABASE_URL", provider: "Supabase", description: "Supabase project URL for Next.js.", docsUrl: SUPABASE_API, pair: ["NEXT_PUBLIC_SUPABASE_ANON_KEY"], source: "convention" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", provider: "Supabase", description: "Supabase anon key for Next.js.", docsUrl: SUPABASE_API, pair: ["NEXT_PUBLIC_SUPABASE_URL"], source: "convention" },
  { name: "TURSO_DATABASE_URL", provider: "Turso", description: "Turso database URL.", docsUrl: "https://docs.turso.tech/sdk/ts/quickstart", valueHint: "libsql://<db>.turso.io", valuePattern: /^libsql:\/\/\S+$/, pair: ["TURSO_AUTH_TOKEN"], source: "convention", iconSlug: "turso" },
  { name: "TURSO_AUTH_TOKEN", provider: "Turso", description: "Turso database token.", docsUrl: "https://docs.turso.tech/sdk/ts/quickstart", pair: ["TURSO_DATABASE_URL"], source: "convention", iconSlug: "turso" },
  { name: "CLOUDINARY_URL", provider: "Cloudinary", description: "Cloudinary credentials, read by the Cloudinary SDK.", docsUrl: "https://console.cloudinary.com/settings/api-keys", valueHint: "cloudinary://key:secret@cloud", valuePattern: /^cloudinary:\/\/\S+$/, source: "sdk", iconSlug: "cloudinary" },
  { name: "UPLOADTHING_TOKEN", provider: "UploadThing", description: "UploadThing token, read by the UploadThing SDK.", docsUrl: "https://uploadthing.com/dashboard", source: "sdk" },
]);
