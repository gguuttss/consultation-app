import { GatewayApiClient } from "@radixdlt/babylon-gateway-api-sdk";
import type {
  ProgrammaticScryptoSborValue,
  StateEntityDetailsResponseComponentDetails,
  StateEntityDetailsVaultResponseItem,
} from "@radixdlt/babylon-gateway-api-sdk";
import type { StructSchema, StructDefinition, ParsedType } from "@rippy/gateway-ez-mode";
import { getConfig, getNetworkId } from "@/config";

// =============================================================================
// Types
// =============================================================================

export type AtLedgerState =
  | { state_version: number }
  | { timestamp: Date };

export type ParsedComponentState<T extends StructDefinition> = {
  address: string;
  state: {
    [K in keyof T]: ParsedType<T[K]>;
  };
  details: StateEntityDetailsVaultResponseItem;
};

// =============================================================================
// Gateway Client Singleton
// =============================================================================

let gatewayClient: GatewayApiClient | null = null;

/**
 * Get or create the Gateway API client singleton
 */
export const getGatewayClient = (): GatewayApiClient => {
  if (!gatewayClient) {
    const config = getConfig();
    gatewayClient = GatewayApiClient.initialize({
      networkId: getNetworkId(config.network),
      basePath: config.gatewayUrl,
      applicationName: "consultation-dapp",
    });
  }
  return gatewayClient;
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert AtLedgerState to the format expected by the Gateway API
 */
const toLedgerStateSelector = (atLedgerState: AtLedgerState) => {
  if ("state_version" in atLedgerState) {
    return { state_version: atLedgerState.state_version };
  }
  return { timestamp: atLedgerState.timestamp.toISOString() };
};

// =============================================================================
// Gateway API Wrappers
// =============================================================================

/**
 * Get the current ledger state (current state version)
 */
export const getCurrentLedgerState = async () => {
  const client = getGatewayClient();
  const status = await client.status.getCurrent();
  return {
    state_version: status.ledger_state.state_version,
    epoch: status.ledger_state.epoch,
    round: status.ledger_state.round,
  };
};

/**
 * Get entity details for one or more addresses
 */
export const getEntityDetails = async (
  addresses: string[],
  atLedgerState?: AtLedgerState
) => {
  const client = getGatewayClient();
  return client.state.getEntityDetailsVaultAggregated(
    addresses,
    undefined,
    atLedgerState ? toLedgerStateSelector(atLedgerState) : undefined
  );
};

/**
 * Get component state and parse it using the provided schema
 */
export const getComponentState = async <
  T extends StructDefinition,
  R extends boolean
>(
  address: string,
  schema: StructSchema<T, R>,
  atLedgerState?: AtLedgerState
): Promise<ParsedComponentState<T>> => {
  const details = await getEntityDetails([address], atLedgerState);

  if (details.length === 0) {
    throw new Error(`Component not found: ${address}`);
  }

  const item = details[0];

  if (item.details?.type !== "Component") {
    throw new Error(`Expected Component, got ${item.details?.type}`);
  }

  const componentState = (item.details as StateEntityDetailsResponseComponentDetails)
    .state as ProgrammaticScryptoSborValue;

  const parsed = schema.safeParse(componentState);

  if (parsed.isErr()) {
    throw new Error(`Failed to parse component state: ${parsed.error}`);
  }

  return {
    address: item.address,
    state: parsed.value as { [K in keyof T]: ParsedType<T[K]> },
    details: item,
  };
};

/**
 * Get all keys from a KeyValueStore
 */
export const getKeyValueStoreKeys = async (
  kvsAddress: string,
  atLedgerState?: AtLedgerState,
  cursor?: string
): Promise<{
  items: { key: ProgrammaticScryptoSborValue }[];
  nextCursor: string | null;
}> => {
  const client = getGatewayClient();

  const response = await client.state.innerClient.keyValueStoreKeys({
    stateKeyValueStoreKeysRequest: {
      key_value_store_address: kvsAddress,
      at_ledger_state: atLedgerState
        ? toLedgerStateSelector(atLedgerState)
        : undefined,
      cursor,
    },
  });

  return {
    items: response.items.map((item) => ({
      key: item.key.programmatic_json,
    })),
    nextCursor: response.next_cursor ?? null,
  };
};

/**
 * Get all keys from a KeyValueStore (paginated)
 */
export const getAllKeyValueStoreKeys = async (
  kvsAddress: string,
  atLedgerState?: AtLedgerState
): Promise<ProgrammaticScryptoSborValue[]> => {
  const allKeys: ProgrammaticScryptoSborValue[] = [];
  let cursor: string | undefined;

  do {
    const response = await getKeyValueStoreKeys(kvsAddress, atLedgerState, cursor);
    allKeys.push(...response.items.map((item) => item.key));
    cursor = response.nextCursor ?? undefined;
  } while (cursor);

  return allKeys;
};

/**
 * Get data from a KeyValueStore by keys
 */
export const getKeyValueStoreData = async (
  kvsAddress: string,
  keys: ProgrammaticScryptoSborValue[],
  atLedgerState?: AtLedgerState
): Promise<
  {
    key: ProgrammaticScryptoSborValue;
    value: ProgrammaticScryptoSborValue;
  }[]
> => {
  if (keys.length === 0) {
    return [];
  }

  const client = getGatewayClient();

  const response = await client.state.innerClient.keyValueStoreData({
    stateKeyValueStoreDataRequest: {
      key_value_store_address: kvsAddress,
      keys: keys.map((key) => ({ key_json: key })),
      at_ledger_state: atLedgerState
        ? toLedgerStateSelector(atLedgerState)
        : undefined,
    },
  });

  return response.entries.map((entry) => ({
    key: entry.key.programmatic_json,
    value: entry.value.programmatic_json,
  }));
};

/**
 * Get a single value from a KeyValueStore
 */
export const getKeyValueStoreEntry = async <
  T extends StructDefinition,
  R extends boolean
>(
  kvsAddress: string,
  key: ProgrammaticScryptoSborValue,
  valueSchema: StructSchema<T, R>,
  atLedgerState?: AtLedgerState
): Promise<{ [K in keyof T]: ParsedType<T[K]> } | null> => {
  const data = await getKeyValueStoreData(kvsAddress, [key], atLedgerState);

  if (data.length === 0) {
    return null;
  }

  const parsed = valueSchema.safeParse(data[0].value);

  if (parsed.isErr()) {
    throw new Error(`Failed to parse KVS value: ${parsed.error}`);
  }

  return parsed.value as { [K in keyof T]: ParsedType<T[K]> };
};

/**
 * Get fungible resource balances for an account
 */
export const getAccountFungibleBalances = async (
  accountAddress: string,
  atLedgerState?: AtLedgerState
): Promise<Map<string, string>> => {
  const client = getGatewayClient();
  const balances = new Map<string, string>();

  let cursor: string | undefined;

  do {
    const response = await client.state.innerClient.entityFungiblesPage({
      stateEntityFungiblesPageRequest: {
        address: accountAddress,
        at_ledger_state: atLedgerState
          ? toLedgerStateSelector(atLedgerState)
          : undefined,
        cursor,
      },
    });

    for (const item of response.items) {
      if (item.aggregation_level === "Vault") {
        for (const vault of item.vaults?.items ?? []) {
          const current = balances.get(item.resource_address) ?? "0";
          // Note: For proper addition, we'd need BigNumber here
          // For now, we'll just use the last vault's amount
          balances.set(item.resource_address, vault.amount);
        }
      }
    }

    cursor = response.next_cursor ?? undefined;
  } while (cursor);

  return balances;
};

/**
 * Get LSU resource details to find redemption rate
 */
export const getLsuRedemptionRate = async (
  lsuResourceAddress: string,
  atLedgerState?: AtLedgerState
): Promise<{ validatorAddress: string; redemptionRate: string } | null> => {
  const details = await getEntityDetails([lsuResourceAddress], atLedgerState);

  if (details.length === 0) {
    return null;
  }

  const item = details[0];

  if (item.details?.type !== "FungibleResource") {
    return null;
  }

  const nativeDetails = item.details.native_resource_details;

  if (nativeDetails?.kind !== "ValidatorLiquidStakeUnit") {
    return null;
  }

  const redemptionValue = nativeDetails.unit_redemption_value?.[0];

  if (!redemptionValue) {
    return null;
  }

  return {
    validatorAddress: nativeDetails.validator_address,
    redemptionRate: redemptionValue.amount,
  };
};
