import type { ObjectiveId } from "@interests/rules";
import type {
  PursueFinaleCommandPayload,
  SetFocusCommandPayload,
} from "@interests/shared";
import type { WirePlayerCommand } from "../src/game/playerCommand";

/**
 * Fixed witnessed ordinary matches, not synthetic eligibility or a balance policy.
 * Reconstruct first-offered rival objectives, player-1 round starts and rotating
 * rival/default passes; retain only the winning seat's authored decisions here.
 * Quotes and investment cents are recorded production inputs, never injected facts.
 * These witnesses establish reachability for fixed seeds, not success probability.
 */
export interface OrdinaryObjectivePlan {
  readonly objectiveId: ObjectiveId;
  readonly seed: string;
  readonly winnerId: string;
  readonly profileId: string;
  readonly initialFocus: SetFocusCommandPayload["focus"];
  readonly winningQuarter: number;
  readonly acceptedCommandCount: number;
  /** Only the winning seat's nonroutine commands, in their accepted order. */
  readonly actions: readonly {
    readonly quarter: number;
    readonly commands: readonly WirePlayerCommand[];
  }[];
  /** Standing offers may close only inside an explicit finale. */
  readonly standingFinaleOffer?: true;
  /** Stored as the nested economic action, so replay must explicitly request its finale. */
  readonly finalAction: Exclude<
    PursueFinaleCommandPayload["action"],
    { readonly type: "CONFIRM_INDEPENDENCE" }
  >;
}

export const ORDINARY_OBJECTIVE_PLANS: readonly OrdinaryObjectivePlan[] = [
  {
    objectiveId: "executive-owner",
    seed: "m7-acceptance-executive-owner-0",
    winnerId: "player-1",
    profileId: "self-employed-operator",
    initialFocus: "business",
    winningQuarter: 16,
    acceptedCommandCount: 83,
    actions: [
      {
        quarter: 1,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:1:major:8400000:owner-work",
          },
        ],
      },
      {
        quarter: 3,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:3:major:10080000:employment",
          },
        ],
      },
      {
        quarter: 5,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:5:major:12096000:employment",
          },
        ],
      },
      {
        quarter: 7,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:7:major:14515200:employment",
          },
        ],
      },
      {
        quarter: 8,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:8:executive:17418240:employment",
          },
        ],
      },
      {
        quarter: 9,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:9:major:23514624:employment",
          },
        ],
      },
      {
        quarter: 12,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:12:executive:28217548:employment",
          },
        ],
      },
      {
        quarter: 13,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "income-defensive-fund",
                buyCents: 6122645,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 14,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:14:executive:38093688:employment",
          },
        ],
      },
      {
        quarter: 15,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "broad-market-fund",
                buyCents: 7500000,
                sellCents: 0,
              },
            ],
          },
        ],
      },
    ],
    finalAction: {
      type: "ACCEPT_CAREER_OFFER",
      offerId: "career:16:executive:51426480:employment",
    },
  },
  {
    objectiveId: "independent",
    seed: "m7-acceptance-independent-0",
    winnerId: "player-1",
    profileId: "disciplined-saver",
    initialFocus: "business",
    winningQuarter: 25,
    acceptedCommandCount: 128,
    actions: [
      {
        quarter: 1,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:1:major:7200000:employment",
          },
        ],
      },
      {
        quarter: 3,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:3:major:8640000:employment",
          },
        ],
      },
      {
        quarter: 5,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:5:major:10368000:employment",
          },
        ],
      },
      {
        quarter: 6,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-21",
            quoteId:
              "opportunity-21:bank-fixed:9824000:196480:3929600:825:186149:6277029:1097276",
          },
        ],
      },
      {
        quarter: 7,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:7:major:12441600:employment",
          },
        ],
      },
      {
        quarter: 9,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:9:major:14929920:employment",
          },
        ],
      },
      {
        quarter: 10,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "income-defensive-fund",
                buyCents: 8034139,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 12,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 7940000,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 14,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "broad-market-fund",
                buyCents: 7961557,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 16,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-61",
            quoteId:
              "opportunity-61:bank-fixed:65045500:1300910:53600000:625:991822:13738232:1139496",
          },
        ],
      },
      {
        quarter: 18,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-69",
            quoteId:
              "opportunity-69:bank-fixed:10104000:202080:6062400:725:277997:4521677:1150919",
          },
        ],
      },
      {
        quarter: 19,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-73",
            quoteId:
              "opportunity-73:bank-fixed:10243000:204860:6145800:725:281822:4583882:1156674",
          },
        ],
      },
      {
        quarter: 20,
        commands: [
          {
            type: "SET_FOCUS",
            focus: "property",
          },
        ],
      },
      {
        quarter: 21,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 6326933,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 22,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "broad-market-fund",
                buyCents: 5031868,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 23,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "income-defensive-fund",
                buyCents: 5107921,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 24,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "income-defensive-fund",
                buyCents: 5157210,
                sellCents: 0,
              },
            ],
          },
        ],
      },
    ],
    finalAction: {
      type: "RESIGN_LABOR",
    },
  },
  {
    objectiveId: "capital-allocator",
    seed: "m7-acceptance-capital-allocator-1",
    winnerId: "player-4",
    profileId: "disciplined-saver",
    initialFocus: "business",
    winningQuarter: 26,
    acceptedCommandCount: 134,
    actions: [
      {
        quarter: 1,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:1:major:7200000:employment",
          },
        ],
      },
      {
        quarter: 3,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:3:major:8640000:employment",
          },
        ],
      },
      {
        quarter: 4,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-16",
            quoteId:
              "opportunity-16:bank-fixed:14680500:293610:9929252:775:213750:5258608:1089409",
          },
        ],
      },
      {
        quarter: 5,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:5:major:10368000:employment",
          },
        ],
      },
      {
        quarter: 7,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:7:major:12441600:employment",
          },
        ],
      },
      {
        quarter: 9,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:9:major:14929920:employment",
          },
        ],
      },
      {
        quarter: 10,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "income-defensive-fund",
                buyCents: 7979582,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 11,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-44",
            quoteId:
              "opportunity-44:bank-fixed:9873000:197460:4936500:775:230091:5364051:1152310",
          },
        ],
      },
      {
        quarter: 13,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 5734269,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 15,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "broad-market-fund",
                buyCents: 8149291,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 17,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 6224375,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 20,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-80",
            quoteId:
              "opportunity-80:bank-fixed:10092000:201840:4036800:925:197454:6454494:1188721",
          },
        ],
      },
      {
        quarter: 24,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-96",
            quoteId:
              "opportunity-96:bank-fixed:39756000:795120:9939000:775:463257:31075377:1227797",
          },
        ],
      },
    ],
    finalAction: {
      type: "TRADE_PUBLIC_MARKETS",
      trades: [
        {
          instrumentId: "income-defensive-fund",
          buyCents: 15000000,
          sellCents: 0,
        },
      ],
    },
  },
  {
    objectiveId: "wealth-architect",
    seed: "m7-acceptance-wealth-architect-0",
    winnerId: "player-1",
    profileId: "self-employed-operator",
    initialFocus: "business",
    winningQuarter: 27,
    acceptedCommandCount: 139,
    actions: [
      {
        quarter: 1,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:1:major:8400000:owner-work",
          },
        ],
      },
      {
        quarter: 3,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:3:major:10080000:employment",
          },
        ],
      },
      {
        quarter: 5,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:5:major:12096000:employment",
          },
        ],
      },
      {
        quarter: 7,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:7:major:14515200:employment",
          },
        ],
      },
      {
        quarter: 9,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:9:major:17418240:employment",
          },
        ],
      },
      {
        quarter: 10,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "income-defensive-fund",
                buyCents: 10734807,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 12,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "broad-market-fund",
                buyCents: 8458201,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 14,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 8494838,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 19,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-73",
            quoteId:
              "opportunity-73:bank-fixed:14961000:299220:10075000:675:196378:5381598:1473839",
          },
        ],
      },
      {
        quarter: 20,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-77",
            quoteId:
              "opportunity-77:bank-fixed:111584000:2231680:89600000:625:1657971:25873651:1477524",
          },
        ],
      },
    ],
    finalAction: {
      type: "TRADE_PUBLIC_MARKETS",
      trades: [
        {
          instrumentId: "income-defensive-fund",
          buyCents: 20000000,
          sellCents: 0,
        },
      ],
    },
  },
  {
    objectiveId: "property-magnate",
    seed: "m7-acceptance-property-magnate-5",
    winnerId: "player-1",
    profileId: "high-income-professional",
    initialFocus: "property",
    winningQuarter: 31,
    acceptedCommandCount: 159,
    actions: [
      {
        quarter: 1,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:1:major:15000000:employment",
          },
        ],
      },
      {
        quarter: 3,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:3:major:18000000:employment",
          },
        ],
      },
      {
        quarter: 5,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:5:major:21600000:employment",
          },
        ],
      },
      {
        quarter: 7,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:7:major:25920000:employment",
          },
        ],
      },
      {
        quarter: 9,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:9:major:31104000:employment",
          },
        ],
      },
      {
        quarter: 14,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-53",
            quoteId:
              "opportunity-53:bank-fixed:107822000:2156440:70514967:775:1518000:40981473:2385224",
          },
        ],
      },
      {
        quarter: 19,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-73",
            quoteId:
              "opportunity-73:bank-fixed:110066000:2201320:89600000:625:1657971:24325291:2471765",
          },
        ],
      },
      {
        quarter: 21,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-81",
            quoteId:
              "opportunity-81:bank-fixed:110275000:2205500:84000000:675:1637295:30117795:2496773",
          },
        ],
      },
    ],
    finalAction: {
      type: "ACQUIRE_RECURRING_OPPORTUNITY",
      opportunityId: "opportunity-121",
      quoteId: "opportunity-121:cash:66326000:1326520:0:625:0:67652520:2412586",
    },
  },
  {
    objectiveId: "deal-maker",
    seed: "deal-maker-production-3",
    winnerId: "player-3",
    profileId: "early-stage-entrepreneur",
    initialFocus: "business",
    winningQuarter: 30,
    acceptedCommandCount: 153,
    actions: [
      {
        quarter: 1,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:1:major:3600000:owner-work",
          },
        ],
      },
      {
        quarter: 3,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:3:major:4320000:employment",
          },
        ],
      },
      {
        quarter: 5,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:5:major:5184000:employment",
          },
        ],
      },
      {
        quarter: 7,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:7:major:6220800:employment",
          },
        ],
      },
      {
        quarter: 8,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 3535009,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 9,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:9:major:7464960:employment",
          },
        ],
      },
      {
        quarter: 11,
        commands: [
          {
            type: "BUY_PROPERTY",
            catalogueId: "residential-duplex",
            rateKind: "variable",
            principalCents: 7000000,
          },
        ],
      },
      {
        quarter: 12,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 3552587,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 14,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 4113115,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 16,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 4129322,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 18,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 4203283,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 20,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 4238633,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 22,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 4009428,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 24,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 3922771,
                sellCents: 0,
              },
            ],
          },
        ],
      },
      {
        quarter: 25,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 0,
                sellCents: 10000000,
              },
            ],
          },
        ],
      },
      {
        quarter: 26,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 0,
                sellCents: 10000000,
              },
            ],
          },
        ],
      },
      {
        quarter: 27,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 0,
                sellCents: 20898021,
              },
            ],
          },
        ],
      },
      {
        quarter: 29,
        commands: [
          {
            type: "SELL_RECURRING_BUSINESS",
            opportunityId: "opportunity-115",
            quoteId:
              "opportunity-115:exit:148:asset-3:26400313:6580586:989427:0:0:31991472",
          },
        ],
      },
    ],
    finalAction: {
      type: "TRADE_PUBLIC_MARKETS",
      trades: [
        {
          instrumentId: "income-defensive-fund",
          buyCents: 40000000,
          sellCents: 0,
        },
      ],
    },
  },
  {
    objectiveId: "founder",
    seed: "m7-founder-proof-148",
    winnerId: "player-4",
    profileId: "small-business-owner",
    initialFocus: "business",
    winningQuarter: 31,
    acceptedCommandCount: 158,
    actions: [
      {
        quarter: 1,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 2100000,
            ownerContributionCents: 600000,
          },
        ],
      },
      {
        quarter: 2,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:2:steady:2400000:owner-work",
          },
        ],
      },
      {
        quarter: 3,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 2224464,
            ownerContributionCents: 1511236,
          },
        ],
      },
      {
        quarter: 4,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 1326156,
            ownerContributionCents: 935390,
          },
        ],
      },
      {
        quarter: 5,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 1488604,
            ownerContributionCents: 1062969,
          },
        ],
      },
      {
        quarter: 6,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 1671248,
            ownerContributionCents: 1207752,
          },
        ],
      },
      {
        quarter: 7,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 1699900,
            ownerContributionCents: 1229357,
          },
        ],
      },
      {
        quarter: 8,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 1914636,
            ownerContributionCents: 1398072,
          },
        ],
      },
      {
        quarter: 9,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 2093068,
            ownerContributionCents: 1539276,
          },
        ],
      },
      {
        quarter: 10,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 2080348,
            ownerContributionCents: 1527430,
          },
        ],
      },
      {
        quarter: 11,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 2031824,
            ownerContributionCents: 1488227,
          },
        ],
      },
      {
        quarter: 12,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 1873516,
            ownerContributionCents: 1358585,
          },
        ],
      },
      {
        quarter: 13,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 2190016,
            ownerContributionCents: 1610339,
          },
        ],
      },
      {
        quarter: 14,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 2491984,
            ownerContributionCents: 1850939,
          },
        ],
      },
      {
        quarter: 15,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 2840616,
            ownerContributionCents: 2129311,
          },
        ],
      },
      {
        quarter: 16,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 2970456,
            ownerContributionCents: 2230533,
          },
        ],
      },
      {
        quarter: 17,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 3323308,
            ownerContributionCents: 2517046,
          },
        ],
      },
      {
        quarter: 18,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 3398928,
            ownerContributionCents: 2586022,
          },
        ],
      },
      {
        quarter: 19,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 3491256,
            ownerContributionCents: 2658002,
          },
        ],
      },
      {
        quarter: 20,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 3566588,
            ownerContributionCents: 2715682,
          },
        ],
      },
      {
        quarter: 21,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 3803040,
            ownerContributionCents: 2902588,
          },
        ],
      },
      {
        quarter: 22,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 3986712,
            ownerContributionCents: 3047796,
          },
        ],
      },
      {
        quarter: 23,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 4290844,
            ownerContributionCents: 3290615,
          },
        ],
      },
      {
        quarter: 24,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 4411628,
            ownerContributionCents: 3383994,
          },
        ],
      },
      {
        quarter: 25,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 4874564,
            ownerContributionCents: 3753065,
          },
        ],
      },
      {
        quarter: 26,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 5085260,
            ownerContributionCents: 3920681,
          },
        ],
      },
      {
        quarter: 27,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 5531816,
            ownerContributionCents: 4276727,
          },
        ],
      },
      {
        quarter: 28,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 6065900,
            ownerContributionCents: 4704092,
          },
        ],
      },
      {
        quarter: 29,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 6379884,
            ownerContributionCents: 4954141,
          },
        ],
      },
      {
        quarter: 30,
        commands: [
          {
            type: "EXPAND_BUSINESS",
            assetId: "asset-3",
            investmentCents: 7194580,
            ownerContributionCents: 5604483,
          },
        ],
      },
    ],
    finalAction: {
      type: "SELL_RECURRING_BUSINESS",
      opportunityId: "opportunity-124",
      quoteId:
        "opportunity-124:exit:157:asset-3:121861538:1646842:3705251:0:0:119803129",
    },
  },
  {
    objectiveId: "financier",
    seed: "m7-acceptance-financier-7",
    winnerId: "player-2",
    profileId: "high-income-professional",
    initialFocus: "financing",
    winningQuarter: 26,
    acceptedCommandCount: 132,
    actions: [
      {
        quarter: 1,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:1:major:15000000:employment",
          },
        ],
      },
      {
        quarter: 3,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:3:major:18000000:employment",
          },
        ],
      },
      {
        quarter: 5,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:5:major:21600000:employment",
          },
        ],
      },
      {
        quarter: 6,
        commands: [
          {
            type: "FUND_RECURRING_LOAN",
            opportunityId: "opportunity-22",
          },
        ],
      },
      {
        quarter: 7,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:7:major:25920000:employment",
          },
        ],
      },
      {
        quarter: 8,
        commands: [
          {
            type: "FUND_RECURRING_LOAN",
            opportunityId: "opportunity-30",
          },
        ],
      },
      {
        quarter: 9,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:9:major:31104000:employment",
          },
        ],
      },
      {
        quarter: 13,
        commands: [
          {
            type: "FUND_RECURRING_LOAN",
            opportunityId: "opportunity-50",
          },
        ],
      },
      {
        quarter: 14,
        commands: [
          {
            type: "FUND_RECURRING_LOAN",
            opportunityId: "opportunity-54",
          },
        ],
      },
      {
        quarter: 20,
        commands: [
          {
            type: "FUND_RECURRING_LOAN",
            opportunityId: "opportunity-78",
          },
        ],
      },
      {
        quarter: 21,
        commands: [
          {
            type: "FUND_RECURRING_LOAN",
            opportunityId: "opportunity-82",
          },
        ],
      },
      {
        quarter: 25,
        commands: [
          {
            type: "FUND_RECURRING_LOAN",
            opportunityId: "opportunity-98",
          },
        ],
      },
    ],
    standingFinaleOffer: true,
    finalAction: {
      type: "FUND_RECURRING_LOAN",
      opportunityId: "opportunity-105",
    },
  },
];
