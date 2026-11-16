/**
 * The files the CLI writes in `.getmyenv/`. The docs folder tree renders this
 * list. README.md and packages/cli/README.md type the same tree by hand.
 */
export type GetmyenvFile = {
  name: string;
  kind: "committed" | "gitignored";
  /** Only in guest projects. */
  guestOnly?: boolean;
  what: string;
  when: string;
};

export const FOLDER_DIR = ".getmyenv";

export const FOLDER_FILES: readonly GetmyenvFile[] = [
  {
    name: "project.json",
    kind: "committed",
    what: "Project id, name and the folder's default context.",
    when: "Written by setup, guest or sign-in.",
  },
  {
    name: "template.json",
    kind: "committed",
    what: "Variable names, never values.",
    when: "Written once the project has a variable name.",
  },
  {
    name: "token.json",
    kind: "gitignored",
    what: "The folder token.",
    when: "Written by sign-in or guest. Not used with GETMYENV_TOKEN.",
  },
  {
    name: "claim.json",
    kind: "gitignored",
    guestOnly: true,
    what: "Claim code and guest passphrase. Keep it private.",
    when: "Written by guest. Deleted by claim.",
  },
];
