import type { IdRpc } from "./id-rpc";

/**
 * The ID platform's RPC through the ID binding (kan/game docs/ID_DESIGN.md
 * 「ゲームとの RPC」). The binding is typed as a plain Fetcher by
 * `wrangler types`, and IdRpc imports nothing, so it is typed here instead.
 */
export function idPlatform(env: Pick<Env, "ID">): IdRpc {
  return env.ID as unknown as IdRpc;
}
