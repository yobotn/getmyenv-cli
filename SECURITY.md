# Security

## Reporting a vulnerability

Email **security@getmyenv.com**. Please include steps to reproduce and the impact. Do not post exploit details in a public issue.

You can also use GitHub's private vulnerability reporting on this repository (Security tab, then Report a vulnerability).

## What runs on your machine

- Your account has a key pair. The private key is encrypted with your Vault password (Argon2id, AES-256-GCM). The server stores that encrypted blob and the public key.
- Each context has its own random key, sealed to the public key of each holder: your account, each member you shared it with, and each server token for it.
- Each value is encrypted with AES-256-GCM under its context key, bound to its variable name.
- The server stores ciphertext and encrypted keys only. Never your Vault password or readable values.

The code for this is in [`packages/crypto`](packages/crypto). How the CLI stores keys and tokens on your machine, and what the service does, is described at [getmyenv.com/docs/security](https://getmyenv.com/docs/security).

## Supported versions

Only the latest `getmyenv` release on npm gets fixes. Run `npx getmyenv@latest`.
