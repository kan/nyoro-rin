// Makes a VAPID key pair for the daily notice's Web Push
// (src/worker/push.ts), one per environment, as TAKO-SEN's script does.
//
//   node scripts/generate-vapid-keys.ts
//
// The public key goes in wrangler.jsonc (VAPID_PUBLIC_KEY of the
// environment); the private key is a secret (docs/DEPLOY.md):
//   npx wrangler secret put VAPID_PRIVATE_KEY --env <dev|production>
// Locally, give both to `npm run dev:roji` (or dev:all) as environment
// variables; scripts/dev.mjs passes them on.
// Do not paste the private key into a chat, an issue or a commit.
import { generateVapidKeys } from "./vapid-keys.ts";

const { publicKey, privateKey } = await generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
