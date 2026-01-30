# Consultation / Governance Scrypto Bluepints

Governance working will happen in a 3-part governance procedure:
1. Request for Comment (RFC): A draft proposal, can be posted anywhere, such as [RadixTalk](https://radixtalk.com/c/governance/radix-community-dao/52) (not on-chain)
2. Temperature Check: Pushing all proposal details to chain, and voting on whether the proposal has enough merit to be officially voted on.
3. Request for Proposal (RFP): A passed temperature check is elevated to an RFP, which can be voted on by the community.

Temperature checks and RFP votes are counted off-chain. The voting power of a user depends on their LSU holdings converted to XRD at the **start of the vote**!

Users can appoints delegatees that can vote in their stead.
# Components
We will split data into two components:
1. Governance component: holds all Temperature Check and RFP data. Is used to vote.
2. VoteDelegation component: holds all info on delegators and delegatees.

The seperation is useful, because then we can upgrade the Governance component without delegators having to assign their delegation to a delegatee again. Modularity allows for upgrading only one part.
## Governance component
### Key Structs

```rust
// We can use https://github.com/thereturnofyo/radix-file-storage to store files like PDFs or .md files, which uses a struct like this to access files:
pub struct File {
  pub kvs_address: String,
  pub component_address: ComponentAddress,
  pub file_hash: String,
}

pub enum TemperatureCheckVote {
  For,
  Against,
}

// struct used to hold submitted temperature check data
pub struct TemperatureCheck {
  pub title: String,
  pub description: String, // short description
  pub vote_options: Vec<VoteOption>, // vote options for the proposed proposal (not for the temp check)
  pub attachments: Vec<File>,
  pub rfc_url: Url, // url pointing to RFC (which may go down, attachments are a backup)
  pub quorum: Decimal,
  pub votes: KeyValueStore<Global<Account>, TemperatureCheckVote>,
  pub approval_threshold: Decimal, // fraction of votes needed to be "for", for vote to pass
  pub start: Instant,
  pub deadline: Instant,
  pub elevated_proposal_id: Option<u64>,
}

// struct to use to submit a temperature check (passed to `make_temperature_check`)
pub struct TemperatureCheckDraft {
  pub title: String,
  pub description: String, // short description
  pub vote_options: Vec<ProposalVoteOption>, // vote options for the proposed proposal (not for the temp check)
  pub attachments: Vec<File>, // put a max on this to avoid state explosion
  pub rfc_url: Url, // url pointing to RFC (which may go down, attachments are a backup)
}

pub struct ProposalVoteOptionId(u32);

pub struct ProposalVoteOption {
  pub id: ProposalVoteOptionId,
  pub label: String, // "For", "Against", "Abstain"
}

pub struct Proposal {
  pub title: String,
  pub description: String, // short description
  pub vote_options: Vec<ProposalVoteOption>, // possible state explosion, will have max length
  pub attachments: Vec<File>, // put a max on this to avoid state explosion
  pub rfc_url: Url, // url pointing to RFC (which may go down, attachments are a backup)
  pub quorum: Decimal, // amount of XRD needed for proposal result to be valid
  pub votes: KeyValueStore<Global<Account>, ProposalVoteOptionId>
  pub approval_threshold: Decimal, // fraction of votes needed to be "for", for vote to pass
  pub start: Instant,
  pub deadline: Instant,
  pub temperature_check_id: u64,
}

pub struct GovernanceParameters {
  pub temperature_check_days: u16,
  pub temperature_check_quorum: Decimal,
  pub temperature_check_approval_threshold: Decimal,
  pub temperature_check_propose_threshold: Decimal, // XRD one must hold to do a temp check
  pub proposal_length_days: u16,
  pub proposal_quorum: Decimal,
  pub proposal_approval_threshold: Decimal,
  // no proposal_propose_threshold, elevation from temp check to rfp done by multi-sig member
}

// struct holding component state
pub struct Governance {
  pub governance_parameters: GovernanceParameters,
  pub temperature_checks: KeyValueStore<u64, TemperatureCheck>,
  pub temperature_check_count: u64,
  pub proposals: KeyValueStore<u64, Proposal>,
  pub proposal_count: u64,
}
```

### Auth Roles
1. OWNER: requires owner badge (could potentially be in possession of a multi-sig controlled account)
2. PUBLIC

### API

| Method | Access/Auth | Input | Output | Description |
| ---| ---| ---| ---| --- |
| `instantiate()` | PUBLIC | owner\_badge: `ResourceAddress`<br>metadata\_init: `MetadataInit` | component: `Global<Governance>` | Instantiates the governance component with passed owner\_badge as the owner role. |
| `make_temperature_check()` | PUBLIC | temperature\_check: `TemperatureCheckDraft` | id: `u64` | Create a temperature check with passed `TemperatureCheck` data, this is basically a proposal you think will pass (and doesn't need changes). This is only done after completing the RFC phase (which happens off-ledger).<br><br>People vote on whether they want this temperature check to be elevated to a "real" proposal (RFP) |
| `make_proposal()` | OWNER | temperature\_check\_id: `u64` | id: `u64` | Elevate a temperature check to a "real" proposal (RFP). This needs admin power as to not spam the "real proposal" section.<br><br>People vote on the outcome of the proposal. |
| `vote_on_temperature_check()` | PUBLIC<br>(checks passed account is present) | account: `Global<Account>`<br>temperature\_check\_id: `u64`<br>vote: `TemperatureCheckVote` | \- | Vote on whether you want a temp check to be elevated to an RFP.<br><br>You cannot change your vote midway. |
| `vote_on_proposal()` | PUBLIC<br>(checks passed account is present) | account: `Global<Account>`<br>proposal\_id: `u64`<br>vote: `ProposalVoteOptionId` | \- | Vote on an RFP.<br><br>You cannot change your vote midway. |

## VoteDelegation component
### Key Structs

```rust
pub struct Delegation {
  pub delegatee: Global<Account>,
  pub fraction: Decimal,
  pub valid_until: Instant, // if a delegation is valid at the start of a vote, it is used for the vote
}

// component struct that holds state about delegatees and delegators
pub struct VoteDelegation {
  // key: delegatee (person allowed to vote for others)
  // value: KVS of delegators using this delegatee, and the fraction of their power allocated
  pub delegatees: KeyValueStore<Global<Account>, KeyValueStore<Global<Account>, Decimal>>,

  // key: delegator (person that has delegated their voting power to another)
  // value: Delegation struct, holds all the users delegations
  pub delegators: KeyValueStore<Global<Account>, Vec<Delegation>>
}
```

### Auth Roles
1. OWNER: requires owner badge (could potentially be in possession of a multi-sig controlled account), only used for stuff like metadata updates on the component.
2. PUBLIC

### API

| Method | Auth/Access | Input | Output | Description |
| ---| ---| ---| ---| --- |
| `make_delegation()` | PUBLIC<br>(checks passed delegator is present) | delegator: `Global<Account>`<br>delegatee: `Global<Account>`<br>fraction: `Decimal`<br>valid\_until: `Instant` (do we want this? or is this set in stone) | \- | Delegate your vote to another member (delegator gives power to delegatee). |
| `remove_delegation()` | PUBLIC<br>(checks passed delegator is present) | delegator: `Global<Account>`<br>delegatee: `Global<Account>` | \- | Remove a delegation to another member (delegator removes power from delegatee). |

# Counting votes (off-chain)
To count votes, using an instantiated version of this blueprint, we need to:
1. Query the `TemperatureCheck`'s / `Proposal`'s `votes` KVS, which gives a list of accounts that have voted, and their vote. We set their `voting_power_fraction` to 1.
2. Query the VoteDelegation component's `delegatees` KVS for all accounts that have voted: we check whether voted accounts also had the power to vote for others. We set the `voting_power_fraction` of these child accounts to whatever we find in the KVS.
3. Query the VoteDelegation component's `delegators` KVS for all accounts that have voted (including children of delegatees): we check which of the accounts that have voted were delegating (a part of) their vote at the state version corresponding with the start of the vote. We modify the `voting_power_fraction` of these accounts (subtract delegated power).
4. Query the LSU holdings of all participating accounts (all voters + their delegators).
5. Calculate the votes for every option using the collected data.

**Note:** an attentive reader might comment that the `delegatees` and `delegators` KVSs could grow HUGE. This might be a problem when wanting to read the entire KVSs. However, we never need to read the entire KVSs, since we only need data for accounts that voted (and their children).

The amount of votes on a proposal should remain limited and managable. If a malicious actor starts voting like crazy, we need to somehow add sybil protection to the voting part.