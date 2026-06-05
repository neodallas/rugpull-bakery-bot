export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export type SkillId =
  | "None"
  | "Lucky"
  | "Evil"
  | "Booster"
  | "Saboteur"
  | "Sweeper"
  | "Perfectionist"
  | "Trailblazer"
  | "Guardian";

export type Debuff = {
  boostTypeId: number;
  endTimeUnix: number;
  severityBps: number;
};

export type State = {
  ethWei: bigint;
  blockNumber: bigint;
  lastBakeBlock: bigint;
  effectiveMultiplierBps: number;
  activeRugs: Debuff[];
  playerSkill: SkillId;
  sweeperFreeReady: boolean;
  bakeCooldownBlocks: number;
  vrfFeeWei: bigint;
  cleanupCrewBoostTypeId: number | null;
};

export type Action =
  | { kind: "bake" }
  | { kind: "cleanup" }
  | { kind: "sleep"; reason: string };

export type Config = {
  clanId: number;
  minMultiplierBps: number;
  pollIntervalMs: number;
  bakeCooldownBlocks: number;
  minEthReserveWei: bigint;
  maxGasPerDayWei: bigint;
  maxVrfPerDayWei: bigint;
  maxBakesPerHour: number;
  maxFailedTxConsecutive: number;
  telegram: { chatId: string; botToken: string };
  rpcUrl: string;
  sessionKeyPrivateKey: Hex;
  agwOwnerAddress: Address;
};

export type SafetyState = {
  dateUtc: string;
  gasSpentWei: bigint;
  vrfSpentWei: bigint;
  bakeCountToday: number;
  bakeCountThisHour: number;
  hourBucket: number;
  consecutiveFailedTx: number;
  killSwitchUntil: number | null;
  killSwitchReason: string | null;
};

export type TxResult =
  | { ok: true; txHash: Hex; gasUsedWei: bigint; vrfPaidWei: bigint }
  | { ok: false; reason: string; expected: boolean };
