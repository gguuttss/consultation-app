import {
  bigint,
  boolean,
  decimal,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

// =============================================================================
// File reference type (matches Scrypto File struct)
// =============================================================================
export type FileRef = {
  kvs_address: string;
  component_address: string;
  file_hash: string;
};

// =============================================================================
// Vote option type (matches Scrypto ProposalVoteOption)
// =============================================================================
export type VoteOption = {
  id: number;
  label: string;
};

// =============================================================================
// Temperature Checks - Cached from blockchain
// =============================================================================
export const temperatureChecks = pgTable("temperature_checks", {
  // On-chain ID
  id: bigint("id", { mode: "number" }).primaryKey(),

  // Basic info
  title: text("title").notNull(),
  description: text("description").notNull(),
  rfcUrl: text("rfc_url").notNull(),

  // Vote options for the eventual RFP (stored in TC)
  voteOptions: jsonb("vote_options").$type<VoteOption[]>().notNull(),
  maxSelections: integer("max_selections"), // null = single choice

  // Attachments (file references)
  attachments: jsonb("attachments").$type<FileRef[]>().default([]),

  // Governance parameters at time of creation
  quorum: decimal("quorum", { precision: 38, scale: 18 }).notNull(),
  approvalThreshold: decimal("approval_threshold", {
    precision: 38,
    scale: 18,
  }).notNull(),

  // Voting period
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  deadline: timestamp("deadline", { withTimezone: true }).notNull(),

  // Link to promoted RFP (if any)
  elevatedProposalId: bigint("elevated_proposal_id", { mode: "number" }),

  // Sync metadata
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  syncedAtStateVersion: bigint("synced_at_state_version", { mode: "number" }),
});

export type TemperatureCheck = typeof temperatureChecks.$inferSelect;
export type NewTemperatureCheck = typeof temperatureChecks.$inferInsert;

// =============================================================================
// Proposals (RFPs) - Cached from blockchain
// =============================================================================
export const proposals = pgTable("proposals", {
  // On-chain ID
  id: bigint("id", { mode: "number" }).primaryKey(),

  // Link to originating TC
  temperatureCheckId: bigint("temperature_check_id", { mode: "number" })
    .notNull()
    .references(() => temperatureChecks.id),

  // Basic info (inherited from TC)
  title: text("title").notNull(),
  description: text("description").notNull(),
  rfcUrl: text("rfc_url").notNull(),

  // Vote options
  voteOptions: jsonb("vote_options").$type<VoteOption[]>().notNull(),
  maxSelections: integer("max_selections"), // null = single choice

  // Attachments
  attachments: jsonb("attachments").$type<FileRef[]>().default([]),

  // Governance parameters at time of creation
  quorum: decimal("quorum", { precision: 38, scale: 18 }).notNull(),
  approvalThreshold: decimal("approval_threshold", {
    precision: 38,
    scale: 18,
  }).notNull(),

  // Voting period
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  deadline: timestamp("deadline", { withTimezone: true }).notNull(),

  // Sync metadata
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  syncedAtStateVersion: bigint("synced_at_state_version", { mode: "number" }),
});

export type Proposal = typeof proposals.$inferSelect;
export type NewProposal = typeof proposals.$inferInsert;

// =============================================================================
// TC Results - Calculated voting results for temperature checks
// =============================================================================
export const tcResults = pgTable("tc_results", {
  id: serial("id").primaryKey(),
  temperatureCheckId: bigint("temperature_check_id", { mode: "number" })
    .notNull()
    .references(() => temperatureChecks.id)
    .unique(),

  // Vote counts (number of accounts)
  votesFor: integer("votes_for").default(0).notNull(),
  votesAgainst: integer("votes_against").default(0).notNull(),

  // Voting power totals (XRD equivalent)
  totalPowerFor: decimal("total_power_for", {
    precision: 38,
    scale: 18,
  }).notNull(),
  totalPowerAgainst: decimal("total_power_against", {
    precision: 38,
    scale: 18,
  }).notNull(),
  totalPower: decimal("total_power", { precision: 38, scale: 18 }).notNull(),

  // Status
  quorumMet: boolean("quorum_met").default(false).notNull(),
  passed: boolean("passed").default(false).notNull(),

  // Calculation metadata
  calculatedAt: timestamp("calculated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  calculatedAtStateVersion: bigint("calculated_at_state_version", {
    mode: "number",
  }),
});

export type TcResult = typeof tcResults.$inferSelect;
export type NewTcResult = typeof tcResults.$inferInsert;

// =============================================================================
// RFP Results - Calculated voting results for proposals
// =============================================================================
export const rfpResults = pgTable("rfp_results", {
  id: serial("id").primaryKey(),
  proposalId: bigint("proposal_id", { mode: "number" })
    .notNull()
    .references(() => proposals.id)
    .unique(),

  // Vote tallies per option: { optionId: { count: number, power: string } }
  optionTallies: jsonb("option_tallies")
    .$type<Record<number, { count: number; power: string }>>()
    .notNull(),

  // Totals
  totalVotes: integer("total_votes").default(0).notNull(),
  totalPower: decimal("total_power", { precision: 38, scale: 18 }).notNull(),

  // Winning option (if quorum met)
  winningOptionId: integer("winning_option_id"),

  // Status
  quorumMet: boolean("quorum_met").default(false).notNull(),

  // Calculation metadata
  calculatedAt: timestamp("calculated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  calculatedAtStateVersion: bigint("calculated_at_state_version", {
    mode: "number",
  }),
});

export type RfpResult = typeof rfpResults.$inferSelect;
export type NewRfpResult = typeof rfpResults.$inferInsert;

// =============================================================================
// Voter Power - Individual voter records for transparency
// =============================================================================
export const voterPower = pgTable("voter_power", {
  id: serial("id").primaryKey(),

  // What they voted on (one of these will be set)
  temperatureCheckId: bigint("temperature_check_id", { mode: "number" }),
  proposalId: bigint("proposal_id", { mode: "number" }),

  // Voter info
  accountAddress: varchar("account_address", { length: 66 }).notNull(),

  // Vote details
  // For TC: "For" or "Against"
  // For RFP: JSON array of option IDs
  voteChoice: text("vote_choice").notNull(),

  // LSU holdings and voting power at snapshot
  lsuHoldings: jsonb("lsu_holdings")
    .$type<Record<string, string>>()
    .default({}),
  votingPower: decimal("voting_power", { precision: 38, scale: 18 }).notNull(),

  // Calculation metadata
  calculatedAt: timestamp("calculated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type VoterPower = typeof voterPower.$inferSelect;
export type NewVoterPower = typeof voterPower.$inferInsert;

// =============================================================================
// Governance Parameters - Cached from blockchain
// =============================================================================
export const governanceParameters = pgTable("governance_parameters", {
  id: serial("id").primaryKey(),

  temperatureCheckDays: integer("temperature_check_days").notNull(),
  temperatureCheckQuorum: decimal("temperature_check_quorum", {
    precision: 38,
    scale: 18,
  }).notNull(),
  temperatureCheckApprovalThreshold: decimal(
    "temperature_check_approval_threshold",
    { precision: 38, scale: 18 }
  ).notNull(),

  proposalLengthDays: integer("proposal_length_days").notNull(),
  proposalQuorum: decimal("proposal_quorum", {
    precision: 38,
    scale: 18,
  }).notNull(),
  proposalApprovalThreshold: decimal("proposal_approval_threshold", {
    precision: 38,
    scale: 18,
  }).notNull(),

  // Sync metadata
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  syncedAtStateVersion: bigint("synced_at_state_version", { mode: "number" }),
});

export type GovernanceParameter = typeof governanceParameters.$inferSelect;
export type NewGovernanceParameter = typeof governanceParameters.$inferInsert;
