# getmyenv CLI

Source of [`getmyenv`](https://www.npmjs.com/package/getmyenv), the command line tool for [getmyenv.com](https://getmyenv.com), and the two libraries it uses. MIT licensed.

getmyenv is an encrypted store for environment variables. Values are encrypted on your machine before upload, and the server stores ciphertext only. This repository is the code that does that on your machine, so you can read and check it.

```bash
npx getmyenv                       # set up this folder
npx getmyenv import                # encrypt and upload your .env
npx getmyenv run -- npm run dev    # start your app with the values
```

Full guide: [getmyenv.com/docs](https://getmyenv.com/docs).

## What is here

| Folder | npm package | What it does |
| --- | --- | --- |
| [`packages/cli`](packages/cli) | [`getmyenv`](https://www.npmjs.com/package/getmyenv) | The CLI and its local MCP server for AI agents |
| [`packages/crypto`](packages/crypto) | [`@getmyenv/crypto`](https://www.npmjs.com/package/@getmyenv/crypto) | Key derivation, key sealing and value encryption |
| [`packages/shared`](packages/shared) | [`@getmyenv/shared`](https://www.npmjs.com/package/@getmyenv/shared) | Commands, flags and limits shared by the CLI and the site |

The encryption model is described in [SECURITY.md](SECURITY.md) and at [getmyenv.com/docs/security](https://getmyenv.com/docs/security).

## Build and test

Needs Node 24 or newer and pnpm (`corepack enable`).

```bash
pnpm install
pnpm check    # build, unit tests, and a smoke test of the packed CLI
```

## How this repository works

This is a read-only copy. The CLI is developed together with the getmyenv service in a private repository, and every change to these packages is copied here automatically. Each npm release is built from the same code.

Issues are welcome here. For a pull request, open an issue first: accepted changes are applied in the main repository and then appear here.

Security problems: please do not open an issue. See [SECURITY.md](SECURITY.md).
