/**
 * Governance Service
 *
 * Provides higher-level operations for fetching governance data from the blockchain
 * and syncing it to the database cache.
 */

import { db } from "@/db";
import {
  temperatureChecks,
  proposals,
  governanceParameters,
  type NewTemperatureCheck,
  type NewProposal,
  type NewGovernanceParameter,
} from "@/db/schema";
import {
  getComponentState,
  getKeyValueStoreEntry,
  getCurrentLedgerState,
  type AtLedgerState,
} from "@/radix/gateway";
import {
  Governance,
  TemperatureCheck as TCSchema,
  Proposal as ProposalSchema,
  type GovernanceType,
  type TemperatureCheckType,
  type ProposalType,
} from "@/radix/schemas";
import { getConfig } from "@/config";
import { eq } from "drizzle-orm";
import { s } from "@rippy/gateway-ez-mode";

// =============================================================================
// Types
// =============================================================================

export type GovernanceState = {
  governanceParameters: GovernanceType["governance_parameters"];
  temperatureCheckCount: number;
  proposalCount: number;
  temperatureChecksKvsAddress: string;
  proposalsKvsAddress: string;
};

// =============================================================================
// Fetch Governance Component State
// =============================================================================

/**
 * Fetch the current governance component state from the blockchain
 */
export const fetchGovernanceState = async (
  atLedgerState?: AtLedgerState
): Promise<GovernanceState> => {
  const config = getConfig();

  const result = await getComponentState(
    config.governanceComponentAddress,
    Governance,
    atLedgerState
  );

  return {
    governanceParameters: result.state.governance_parameters,
    temperatureCheckCount: result.state.temperature_check_count,
    proposalCount: result.state.proposal_count,
    temperatureChecksKvsAddress: result.state.temperature_checks,
    proposalsKvsAddress: result.state.proposals,
  };
};

// =============================================================================
// Fetch Temperature Check
// =============================================================================

/**
 * Create a KVS key for a u64 ID
 */
const createU64Key = (id: number) => ({
  kind: "U64" as const,
  value: id.toString(),
});

/**
 * Fetch a single temperature check from the blockchain
 */
export const fetchTemperatureCheck = async (
  id: number,
  kvsAddress: string,
  atLedgerState?: AtLedgerState
): Promise<TemperatureCheckType | null> => {
  const key = createU64Key(id);

  const result = await getKeyValueStoreEntry(
    kvsAddress,
    key,
    TCSchema,
    atLedgerState
  );

  return result;
};

/**
 * Fetch a single proposal from the blockchain
 */
export const fetchProposal = async (
  id: number,
  kvsAddress: string,
  atLedgerState?: AtLedgerState
): Promise<ProposalType | null> => {
  const key = createU64Key(id);

  const result = await getKeyValueStoreEntry(
    kvsAddress,
    key,
    ProposalSchema,
    atLedgerState
  );

  return result;
};

// =============================================================================
// Sync to Database
// =============================================================================

/**
 * Convert an Instant (seconds since Unix epoch) to a Date
 */
const instantToDate = (instant: { seconds_since_unix_epoch: number }): Date => {
  return new Date(instant.seconds_since_unix_epoch * 1000);
};

/**
 * Sync governance parameters to the database
 */
export const syncGovernanceParameters = async (
  params: GovernanceType["governance_parameters"],
  stateVersion: number
): Promise<void> => {
  const record: NewGovernanceParameter = {
    temperatureCheckDays: params.temperature_check_days,
    temperatureCheckQuorum: params.temperature_check_quorum,
    temperatureCheckApprovalThreshold: params.temperature_check_approval_threshold,
    proposalLengthDays: params.proposal_length_days,
    proposalQuorum: params.proposal_quorum,
    proposalApprovalThreshold: params.proposal_approval_threshold,
    syncedAtStateVersion: stateVersion,
    lastSyncedAt: new Date(),
  };

  // Upsert: delete existing and insert new
  await db.delete(governanceParameters);
  await db.insert(governanceParameters).values(record);
};

/**
 * Sync a temperature check to the database
 */
export const syncTemperatureCheck = async (
  id: number,
  tc: TemperatureCheckType,
  stateVersion: number
): Promise<void> => {
  const record: NewTemperatureCheck = {
    id,
    title: tc.title,
    description: tc.description,
    rfcUrl: tc.rfc_url,
    voteOptions: tc.vote_options.map((opt) => ({
      id: opt.id[0],
      label: opt.label,
    })),
    maxSelections: tc.max_selections ?? null,
    attachments: tc.attachments.map((att) => ({
      kvs_address: att.kvs_address,
      component_address: att.component_address,
      file_hash: att.file_hash,
    })),
    quorum: tc.quorum,
    approvalThreshold: tc.approval_threshold,
    startTime: instantToDate(tc.start),
    deadline: instantToDate(tc.deadline),
    elevatedProposalId: tc.elevated_proposal_id ?? null,
    syncedAtStateVersion: stateVersion,
    lastSyncedAt: new Date(),
  };

  // Upsert using ON CONFLICT
  await db
    .insert(temperatureChecks)
    .values(record)
    .onConflictDoUpdate({
      target: temperatureChecks.id,
      set: {
        title: record.title,
        description: record.description,
        rfcUrl: record.rfcUrl,
        voteOptions: record.voteOptions,
        maxSelections: record.maxSelections,
        attachments: record.attachments,
        quorum: record.quorum,
        approvalThreshold: record.approvalThreshold,
        startTime: record.startTime,
        deadline: record.deadline,
        elevatedProposalId: record.elevatedProposalId,
        syncedAtStateVersion: record.syncedAtStateVersion,
        lastSyncedAt: record.lastSyncedAt,
      },
    });
};

/**
 * Sync a proposal to the database
 */
export const syncProposal = async (
  id: number,
  proposal: ProposalType,
  stateVersion: number
): Promise<void> => {
  const record: NewProposal = {
    id,
    temperatureCheckId: proposal.temperature_check_id,
    title: proposal.title,
    description: proposal.description,
    rfcUrl: proposal.rfc_url,
    voteOptions: proposal.vote_options.map((opt) => ({
      id: opt.id[0],
      label: opt.label,
    })),
    maxSelections: proposal.max_selections ?? null,
    attachments: proposal.attachments.map((att) => ({
      kvs_address: att.kvs_address,
      component_address: att.component_address,
      file_hash: att.file_hash,
    })),
    quorum: proposal.quorum,
    approvalThreshold: proposal.approval_threshold,
    startTime: instantToDate(proposal.start),
    deadline: instantToDate(proposal.deadline),
    syncedAtStateVersion: stateVersion,
    lastSyncedAt: new Date(),
  };

  await db
    .insert(proposals)
    .values(record)
    .onConflictDoUpdate({
      target: proposals.id,
      set: {
        title: record.title,
        description: record.description,
        rfcUrl: record.rfcUrl,
        voteOptions: record.voteOptions,
        maxSelections: record.maxSelections,
        attachments: record.attachments,
        quorum: record.quorum,
        approvalThreshold: record.approvalThreshold,
        startTime: record.startTime,
        deadline: record.deadline,
        syncedAtStateVersion: record.syncedAtStateVersion,
        lastSyncedAt: record.lastSyncedAt,
      },
    });
};

// =============================================================================
// Full Sync Operations
// =============================================================================

/**
 * Sync all governance data from the blockchain to the database
 * This is useful for initial population or full refresh
 */
export const syncAllGovernanceData = async (): Promise<{
  temperatureChecksSynced: number;
  proposalsSynced: number;
}> => {
  // Get current ledger state
  const ledgerState = await getCurrentLedgerState();
  const atLedgerState = { state_version: ledgerState.state_version };

  // Fetch governance component state
  const govState = await fetchGovernanceState(atLedgerState);

  // Sync governance parameters
  await syncGovernanceParameters(govState.governanceParameters, ledgerState.state_version);

  // Sync all temperature checks
  let temperatureChecksSynced = 0;
  for (let i = 0; i < govState.temperatureCheckCount; i++) {
    const tc = await fetchTemperatureCheck(
      i,
      govState.temperatureChecksKvsAddress,
      atLedgerState
    );
    if (tc) {
      await syncTemperatureCheck(i, tc, ledgerState.state_version);
      temperatureChecksSynced++;
    }
  }

  // Sync all proposals
  let proposalsSynced = 0;
  for (let i = 0; i < govState.proposalCount; i++) {
    const proposal = await fetchProposal(
      i,
      govState.proposalsKvsAddress,
      atLedgerState
    );
    if (proposal) {
      await syncProposal(i, proposal, ledgerState.state_version);
      proposalsSynced++;
    }
  }

  return { temperatureChecksSynced, proposalsSynced };
};

/**
 * Sync a single temperature check (used for refresh button)
 */
export const syncSingleTemperatureCheck = async (id: number): Promise<void> => {
  const ledgerState = await getCurrentLedgerState();
  const atLedgerState = { state_version: ledgerState.state_version };

  const govState = await fetchGovernanceState(atLedgerState);

  const tc = await fetchTemperatureCheck(
    id,
    govState.temperatureChecksKvsAddress,
    atLedgerState
  );

  if (tc) {
    await syncTemperatureCheck(id, tc, ledgerState.state_version);
  } else {
    throw new Error(`Temperature check ${id} not found`);
  }
};

/**
 * Sync a single proposal (used for refresh button)
 */
export const syncSingleProposal = async (id: number): Promise<void> => {
  const ledgerState = await getCurrentLedgerState();
  const atLedgerState = { state_version: ledgerState.state_version };

  const govState = await fetchGovernanceState(atLedgerState);

  const proposal = await fetchProposal(
    id,
    govState.proposalsKvsAddress,
    atLedgerState
  );

  if (proposal) {
    await syncProposal(id, proposal, ledgerState.state_version);
  } else {
    throw new Error(`Proposal ${id} not found`);
  }
};
