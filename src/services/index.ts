// Governance service for syncing data from blockchain
export {
  fetchGovernanceState,
  fetchTemperatureCheck,
  fetchProposal,
  syncGovernanceParameters,
  syncTemperatureCheck,
  syncProposal,
  syncAllGovernanceData,
  syncSingleTemperatureCheck,
  syncSingleProposal,
} from "./governance";

export type { GovernanceState } from "./governance";

// Vote calculator for computing voting power and results
export {
  fetchTcVotes,
  fetchProposalVotes,
  calculateVotingPower,
  calculateTcResults,
  calculateRfpResults,
} from "./voteCalculator";
