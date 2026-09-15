import { KalshiClient, type KalshiEnv } from 'trading-core';
import { attachKalshiWsFillOverride } from './kalshiWsFills';

/** Cloud place path: REST orders, optional fill-WS confirm when Admin flag is On. */
export function cloudKalshi(keyId: string, pem: string, env: KalshiEnv = 'production'): KalshiClient {
  return attachKalshiWsFillOverride(new KalshiClient(keyId, pem, env));
}
