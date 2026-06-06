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
    name: "getActiveBoosts",
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
] as const;

export const BAKERY_READ_ABI = [
  {
    type: "function",
    name: "lastBake",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "value", type: "uint256" }],
  },
] as const;

export const BAKERY_WRITE_ABI = [
  ...BAKERY_READ_ABI,
  {
    type: "function",
    name: "bake",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;
