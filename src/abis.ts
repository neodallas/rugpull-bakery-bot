export const BOOST_MANAGER_READ_ABI = [
  {
    type: "function",
    name: "getEffectiveMultiplier",
    stateMutability: "view",
    inputs: [{ name: "clanId", type: "uint256" }],
    outputs: [{ name: "bps", type: "uint256" }],
  },
  {
    type: "function",
    name: "getActiveDebuffs",
    stateMutability: "view",
    inputs: [{ name: "clanId", type: "uint256" }],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "boostTypeId", type: "uint256" },
          { name: "endTimeUnix", type: "uint256" },
          { name: "severityBps", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getVrfFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "wei", type: "uint256" }],
  },
] as const;

export const PLAYER_REGISTRY_READ_ABI = [
  {
    type: "function",
    name: "lastBakeBlock",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "block", type: "uint256" }],
  },
] as const;

export const PLAYER_SKILLS_READ_ABI = [
  {
    type: "function",
    name: "getPlayerSkill",
    stateMutability: "view",
    inputs: [
      { name: "player", type: "address" },
      { name: "seasonId", type: "uint256" },
    ],
    outputs: [{ name: "skillId", type: "uint8" }],
  },
  {
    type: "function",
    name: "getSweeperFreeReadyAt",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "unix", type: "uint256" }],
  },
] as const;

export const SKILL_ID_TO_NAME = [
  "None",
  "Lucky",
  "Evil",
  "Booster",
  "Saboteur",
  "Sweeper",
  "Perfectionist",
  "Trailblazer",
  "Guardian",
] as const;
