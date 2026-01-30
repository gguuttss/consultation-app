/**
 * Environment configuration for the Consultation dApp
 * Loads and validates required environment variables
 */

export type RadixNetwork = "stokenet" | "mainnet";

export type Config = {
  network: RadixNetwork;
  gatewayUrl: string;
  governanceComponentAddress: string;
  databaseUrl: string;
};

const GATEWAY_URLS: Record<RadixNetwork, string> = {
  stokenet: "https://stokenet.radixdlt.com",
  mainnet: "https://mainnet.radixdlt.com",
};

const NETWORK_IDS: Record<RadixNetwork, number> = {
  stokenet: 2,
  mainnet: 1,
};

/**
 * Get environment variable or throw if not set
 */
const getEnvOrThrow = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

/**
 * Get environment variable with a default value
 */
const getEnvWithDefault = (key: string, defaultValue: string): string => {
  return process.env[key] ?? defaultValue;
};

/**
 * Load and validate configuration from environment variables
 */
export const loadConfig = (): Config => {
  const network = getEnvWithDefault("RADIX_NETWORK", "stokenet") as RadixNetwork;

  if (network !== "stokenet" && network !== "mainnet") {
    throw new Error(`Invalid RADIX_NETWORK: ${network}. Must be "stokenet" or "mainnet"`);
  }

  const gatewayUrl = getEnvWithDefault("RADIX_GATEWAY_URL", GATEWAY_URLS[network]);
  const governanceComponentAddress = getEnvOrThrow("GOVERNANCE_COMPONENT_ADDRESS");
  const databaseUrl = getEnvOrThrow("DATABASE_URL");

  return {
    network,
    gatewayUrl,
    governanceComponentAddress,
    databaseUrl,
  };
};

/**
 * Get the network ID for the configured network
 */
export const getNetworkId = (network: RadixNetwork): number => {
  return NETWORK_IDS[network];
};

/**
 * Lazy-loaded config singleton
 */
let configInstance: Config | null = null;

export const getConfig = (): Config => {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
};
