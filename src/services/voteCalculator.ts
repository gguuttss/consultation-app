/**
 * Vote Calculator Service
 *
 * Calculates vote results for temperature checks and proposals by:
 * 1. Reading votes from the governance component KVS
 * 2. Fetching LSU holdings for each voter at snapshot time
 * 3. Converting LSU to XRD voting power via validator redemption rates
 * 4. Storing results in the database
 */

import BigNumber from "bignumber.js";
import { db } from "@/db";
import {
  temperatureChecks,
  proposals,
  tcResults,
  rfpResults,
  voterPower,
  type NewTcResult,
  type NewRfpResult,
  type NewVoterPower,
} from "@/db/schema";
import {
  getAllKeyValueStoreKeys,
  getKeyValueStoreData,
  getAccountFungibleBalances,
  getLsuRedemptionRate,
  getCurrentLedgerState,
  type AtLedgerState,
} from "@/radix/gateway";
import {
  TemperatureCheckVote,
  ProposalVoteOptionId,
} from "@/radix/schemas";
import { fetchGovernanceState, fetchTemperatureCheck, fetchProposal } from "./governance";
import { eq, and } from "drizzle-orm";
import { s } from "@rippy/gateway-ez-mode";
import type { ProgrammaticScryptoSborValue } from "@radixdlt/babylon-gateway-api-sdk";

// =============================================================================
// Types
// =============================================================================

type VoteEntry = {
  accountAddress: string;
  vote: "For" | "Against" | number[]; // TC uses For/Against, RFP uses option IDs
};

type VoterWithPower = {
  accountAddress: string;
  vote: "For" | "Against" | number[];
  lsuHoldings: Record<string, string>;
  votingPower: BigNumber;
};

// =============================================================================
// LSU Detection
// =============================================================================

/**
 * Check if a resource address is an LSU (Liquid Stake Unit)
 * LSUs on Radix follow a specific pattern
 */
const isLsuAddress = (resourceAddress: string): boolean => {
  // LSU resource addresses contain "lsu" in their bech32 encoding
  // or we can detect by checking the native resource details
  // For now, we'll check all validator LSU addresses by querying their details
  return true; // We'll filter by checking redemption rate availability
};

// =============================================================================
// Parse Votes from KVS
// =============================================================================

/**
 * Parse an account address from a KVS key
 */
const parseAccountAddress = (key: ProgrammaticScryptoSborValue): string => {
  // The key should be a Reference type containing the account address
  if (key.kind === "Reference") {
    return key.value;
  }
  throw new Error(`Expected Reference key, got ${key.kind}`);
};

/**
 * Parse a TemperatureCheckVote from SBOR
 */
const parseTemperatureCheckVote = (
  value: ProgrammaticScryptoSborValue
): "For" | "Against" => {
  const parsed = TemperatureCheckVote.safeParse(value);
  if (parsed.isErr()) {
    throw new Error(`Failed to parse TC vote: ${parsed.error}`);
  }
  return parsed.value.variant;
};

/**
 * Parse proposal votes (array of option IDs) from SBOR
 */
const parseProposalVotes = (value: ProgrammaticScryptoSborValue): number[] => {
  if (value.kind !== "Array") {
    throw new Error(`Expected Array, got ${value.kind}`);
  }

  return value.elements.map((element) => {
    const parsed = ProposalVoteOptionId.safeParse(element);
    if (parsed.isErr()) {
      throw new Error(`Failed to parse vote option ID: ${parsed.error}`);
    }
    return parsed.value[0];
  });
};

// =============================================================================
// Fetch All Votes
// =============================================================================

/**
 * Fetch all votes for a temperature check from the blockchain
 */
export const fetchTcVotes = async (
  votesKvsAddress: string,
  atLedgerState: AtLedgerState
): Promise<VoteEntry[]> => {
  // Get all keys (voter accounts) from the votes KVS
  const keys = await getAllKeyValueStoreKeys(votesKvsAddress, atLedgerState);

  if (keys.length === 0) {
    return [];
  }

  // Get all vote data
  const voteData = await getKeyValueStoreData(votesKvsAddress, keys, atLedgerState);

  // Parse votes
  return voteData.map((entry) => ({
    accountAddress: parseAccountAddress(entry.key),
    vote: parseTemperatureCheckVote(entry.value),
  }));
};

/**
 * Fetch all votes for a proposal from the blockchain
 */
export const fetchProposalVotes = async (
  votesKvsAddress: string,
  atLedgerState: AtLedgerState
): Promise<VoteEntry[]> => {
  const keys = await getAllKeyValueStoreKeys(votesKvsAddress, atLedgerState);

  if (keys.length === 0) {
    return [];
  }

  const voteData = await getKeyValueStoreData(votesKvsAddress, keys, atLedgerState);

  return voteData.map((entry) => ({
    accountAddress: parseAccountAddress(entry.key),
    vote: parseProposalVotes(entry.value),
  }));
};

// =============================================================================
// Calculate Voting Power
// =============================================================================

/**
 * Calculate voting power for a list of voters at a given snapshot time
 */
export const calculateVotingPower = async (
  votes: VoteEntry[],
  atLedgerState: AtLedgerState
): Promise<VoterWithPower[]> => {
  const results: VoterWithPower[] = [];

  // Cache for LSU redemption rates (keyed by LSU resource address)
  const redemptionRates = new Map<string, BigNumber>();

  for (const vote of votes) {
    // Fetch account's fungible balances at snapshot time
    const balances = await getAccountFungibleBalances(
      vote.accountAddress,
      atLedgerState
    );

    const lsuHoldings: Record<string, string> = {};
    let totalVotingPower = new BigNumber(0);

    // Check each balance for LSU resources
    for (const [resourceAddress, amount] of balances) {
      // Try to get redemption rate (if it's an LSU, this will succeed)
      let redemptionRate = redemptionRates.get(resourceAddress);

      if (redemptionRate === undefined) {
        const rateInfo = await getLsuRedemptionRate(resourceAddress, atLedgerState);
        if (rateInfo) {
          redemptionRate = new BigNumber(rateInfo.redemptionRate);
          redemptionRates.set(resourceAddress, redemptionRate);
        }
      }

      // If this is an LSU, add to voting power
      if (redemptionRate) {
        const lsuAmount = new BigNumber(amount);
        const xrdEquivalent = lsuAmount.multipliedBy(redemptionRate);

        lsuHoldings[resourceAddress] = amount;
        totalVotingPower = totalVotingPower.plus(xrdEquivalent);
      }
    }

    results.push({
      accountAddress: vote.accountAddress,
      vote: vote.vote,
      lsuHoldings,
      votingPower: totalVotingPower,
    });
  }

  return results;
};

// =============================================================================
// Calculate and Store TC Results
// =============================================================================

/**
 * Calculate and store results for a temperature check
 */
export const calculateTcResults = async (
  tcId: number
): Promise<NewTcResult> => {
  // Get the TC from the database to find the snapshot time
  const tc = await db.query.temperatureChecks.findFirst({
    where: eq(temperatureChecks.id, tcId),
  });

  if (!tc) {
    throw new Error(`Temperature check ${tcId} not found in database`);
  }

  // Use the TC start time as the snapshot
  const atLedgerState: AtLedgerState = { timestamp: tc.startTime };

  // Fetch governance state to get the votes KVS address
  const govState = await fetchGovernanceState(atLedgerState);

  // Fetch the TC to get the votes KVS address
  const tcData = await fetchTemperatureCheck(
    tcId,
    govState.temperatureChecksKvsAddress,
    atLedgerState
  );

  if (!tcData) {
    throw new Error(`Temperature check ${tcId} not found on chain`);
  }

  // Fetch all votes
  const votes = await fetchTcVotes(tcData.votes, atLedgerState);

  // Calculate voting power for each voter
  const votersWithPower = await calculateVotingPower(votes, atLedgerState);

  // Get current ledger state for storage
  const currentState = await getCurrentLedgerState();

  // Delete existing voter power records for this TC
  await db
    .delete(voterPower)
    .where(eq(voterPower.temperatureCheckId, tcId));

  // Calculate totals and store individual voter records
  let votesFor = 0;
  let votesAgainst = 0;
  let totalPowerFor = new BigNumber(0);
  let totalPowerAgainst = new BigNumber(0);

  for (const voter of votersWithPower) {
    // Store individual voter record
    const voterRecord: NewVoterPower = {
      temperatureCheckId: tcId,
      proposalId: null,
      accountAddress: voter.accountAddress,
      voteChoice: voter.vote as string,
      lsuHoldings: voter.lsuHoldings,
      votingPower: voter.votingPower.toString(),
      calculatedAt: new Date(),
    };
    await db.insert(voterPower).values(voterRecord);

    // Add to totals
    if (voter.vote === "For") {
      votesFor++;
      totalPowerFor = totalPowerFor.plus(voter.votingPower);
    } else {
      votesAgainst++;
      totalPowerAgainst = totalPowerAgainst.plus(voter.votingPower);
    }
  }

  const totalPower = totalPowerFor.plus(totalPowerAgainst);

  // Calculate if quorum was met and if it passed
  const quorum = new BigNumber(tc.quorum);
  const approvalThreshold = new BigNumber(tc.approvalThreshold);

  const quorumMet = totalPower.isGreaterThanOrEqualTo(quorum);

  // Passed if quorum met AND more than approval_threshold voted "For"
  const forPercentage = totalPower.isZero()
    ? new BigNumber(0)
    : totalPowerFor.dividedBy(totalPower);
  const passed = quorumMet && forPercentage.isGreaterThan(approvalThreshold);

  // Store or update TC results
  const resultRecord: NewTcResult = {
    temperatureCheckId: tcId,
    votesFor,
    votesAgainst,
    totalPowerFor: totalPowerFor.toString(),
    totalPowerAgainst: totalPowerAgainst.toString(),
    totalPower: totalPower.toString(),
    quorumMet,
    passed,
    calculatedAt: new Date(),
    calculatedAtStateVersion: currentState.state_version,
  };

  // Upsert
  await db
    .delete(tcResults)
    .where(eq(tcResults.temperatureCheckId, tcId));
  await db.insert(tcResults).values(resultRecord);

  return resultRecord;
};

// =============================================================================
// Calculate and Store RFP Results
// =============================================================================

/**
 * Calculate and store results for a proposal (RFP)
 */
export const calculateRfpResults = async (
  rfpId: number
): Promise<NewRfpResult> => {
  // Get the proposal from the database
  const rfp = await db.query.proposals.findFirst({
    where: eq(proposals.id, rfpId),
  });

  if (!rfp) {
    throw new Error(`Proposal ${rfpId} not found in database`);
  }

  // Use the proposal start time as the snapshot
  const atLedgerState: AtLedgerState = { timestamp: rfp.startTime };

  // Fetch governance state
  const govState = await fetchGovernanceState(atLedgerState);

  // Fetch the proposal to get the votes KVS address
  const proposalData = await fetchProposal(
    rfpId,
    govState.proposalsKvsAddress,
    atLedgerState
  );

  if (!proposalData) {
    throw new Error(`Proposal ${rfpId} not found on chain`);
  }

  // Fetch all votes
  const votes = await fetchProposalVotes(proposalData.votes, atLedgerState);

  // Calculate voting power for each voter
  const votersWithPower = await calculateVotingPower(votes, atLedgerState);

  // Get current ledger state
  const currentState = await getCurrentLedgerState();

  // Delete existing voter power records for this RFP
  await db
    .delete(voterPower)
    .where(eq(voterPower.proposalId, rfpId));

  // Initialize tallies for each option
  const optionTallies: Record<number, { count: number; power: BigNumber }> = {};
  for (const opt of rfp.voteOptions) {
    optionTallies[opt.id] = { count: 0, power: new BigNumber(0) };
  }

  let totalVotes = 0;
  let totalPower = new BigNumber(0);

  for (const voter of votersWithPower) {
    const selectedOptions = voter.vote as number[];

    // Store individual voter record
    const voterRecord: NewVoterPower = {
      temperatureCheckId: null,
      proposalId: rfpId,
      accountAddress: voter.accountAddress,
      voteChoice: JSON.stringify(selectedOptions),
      lsuHoldings: voter.lsuHoldings,
      votingPower: voter.votingPower.toString(),
      calculatedAt: new Date(),
    };
    await db.insert(voterPower).values(voterRecord);

    totalVotes++;
    totalPower = totalPower.plus(voter.votingPower);

    // Add voting power to each selected option
    // For multi-select, the voting power is split equally among selections
    const powerPerSelection = voter.votingPower.dividedBy(selectedOptions.length);

    for (const optionId of selectedOptions) {
      if (optionTallies[optionId]) {
        optionTallies[optionId].count++;
        optionTallies[optionId].power = optionTallies[optionId].power.plus(
          powerPerSelection
        );
      }
    }
  }

  // Calculate quorum
  const quorum = new BigNumber(rfp.quorum);
  const quorumMet = totalPower.isGreaterThanOrEqualTo(quorum);

  // Find winning option (highest voting power)
  let winningOptionId: number | null = null;
  let highestPower = new BigNumber(0);

  if (quorumMet) {
    for (const [optionId, tally] of Object.entries(optionTallies)) {
      if (tally.power.isGreaterThan(highestPower)) {
        highestPower = tally.power;
        winningOptionId = parseInt(optionId);
      }
    }
  }

  // Convert tallies to storage format
  const talliesForStorage: Record<number, { count: number; power: string }> = {};
  for (const [optionId, tally] of Object.entries(optionTallies)) {
    talliesForStorage[parseInt(optionId)] = {
      count: tally.count,
      power: tally.power.toString(),
    };
  }

  // Store results
  const resultRecord: NewRfpResult = {
    proposalId: rfpId,
    optionTallies: talliesForStorage,
    totalVotes,
    totalPower: totalPower.toString(),
    winningOptionId,
    quorumMet,
    calculatedAt: new Date(),
    calculatedAtStateVersion: currentState.state_version,
  };

  // Upsert
  await db
    .delete(rfpResults)
    .where(eq(rfpResults.proposalId, rfpId));
  await db.insert(rfpResults).values(resultRecord);

  return resultRecord;
};
