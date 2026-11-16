import { PUSH_PROVIDERS, PUSH_PROVIDER_TITLES } from "./push.js";

/**
 * What the homepage lists. Push targets are the platforms `push` writes to.
 * "Works with" are tools that read ordinary environment variables from `run`.
 * Every entry links to a docs page or guide that shows how.
 */
export type Integration = {
  name: string;
  /** Key in the web app's provider icons. */
  icon: string;
  href: string;
};

export const PUSH_TARGETS: readonly Integration[] = PUSH_PROVIDERS.map((p) => ({
  name: PUSH_PROVIDER_TITLES[p],
  icon: PUSH_PROVIDER_TITLES[p],
  href: "/docs/deploy-platforms",
}));

export const WORKS_WITH: readonly Integration[] = [
  { name: "Next.js", icon: "Next.js", href: "/docs/languages#frameworks" },
  { name: "Vite", icon: "Vite", href: "/docs/languages#frameworks" },
  { name: "Node.js", icon: "Node.js", href: "/docs/languages#node" },
  { name: "Python", icon: "Python", href: "/docs/languages#python" },
  { name: "Docker Compose", icon: "Docker", href: "/guides/docker-compose-encrypted-environment-variables" },
  { name: "Laravel", icon: "Laravel", href: "/docs/languages#frameworks" },
  { name: "Rails and Kamal", icon: "Rails", href: "/docs/languages#frameworks" },
  { name: "Prisma", icon: "Prisma", href: "/docs/languages#frameworks" },
  { name: "Turborepo", icon: "Turborepo", href: "/docs/languages#frameworks" },
  { name: "PM2 and systemd", icon: "PM2", href: "/docs/languages#frameworks" },
];
