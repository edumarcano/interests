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
    seed: "m7-acceptance-independent-2",
    winnerId: "player-2",
    profileId: "market-investor",
    initialFocus: "business",
    winningQuarter: 27,
    acceptedCommandCount: 141,
    actions: [
      {
        quarter: 1,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:1:major:7600000:employment",
          },
        ],
      },
      {
        quarter: 3,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:3:major:9120000:employment",
          },
        ],
      },
      {
        quarter: 5,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:5:major:10944000:employment",
          },
        ],
      },
      {
        quarter: 7,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:7:major:13132800:employment",
          },
        ],
      },
      {
        quarter: 9,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:9:major:15759360:employment",
          },
        ],
      },
      {
        quarter: 11,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "income-defensive-fund",
                buyCents: 7297154,
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
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-46",
            quoteId:
              "opportunity-46:bank-fixed:9753000:195060:5851800:725:268340:4364600:1356894",
          },
        ],
      },
      {
        quarter: 13,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-50",
            quoteId:
              "opportunity-50:bank-fixed:9839000:196780:3935600:775:183439:6283619:1363303",
          },
        ],
      },
      {
        quarter: 14,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-54",
            quoteId:
              "opportunity-54:bank-fixed:9823000:196460:3929200:825:186130:6276390:1372965",
          },
        ],
      },
      {
        quarter: 15,
        commands: [
          {
            type: "SET_FOCUS",
            focus: "property",
          },
        ],
      },
      {
        quarter: 16,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-62",
            quoteId:
              "opportunity-62:bank-fixed:10188000:203760:2547000:775:118716:7963476:1367348",
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
                buyCents: 5310241,
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
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 5157953,
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
                instrumentId: "income-defensive-fund",
                buyCents: 5220900,
                sellCents: 0,
              },
            ],
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
                instrumentId: "broad-market-fund",
                buyCents: 5338030,
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
                buyCents: 5414179,
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
                buyCents: 5448727,
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
                instrumentId: "broad-market-fund",
                buyCents: 5481418,
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
                buyCents: 5543514,
                sellCents: 0,
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
                instrumentId: "income-defensive-fund",
                buyCents: 5545054,
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
    seed: "m7-acceptance-capital-allocator-0",
    winnerId: "player-4",
    profileId: "high-income-professional",
    initialFocus: "business",
    winningQuarter: 23,
    acceptedCommandCount: 118,
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
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-24",
            quoteId:
              "opportunity-24:bank-fixed:15367500:307350:11625000:675:226590:4276440:2276700",
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
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "income-defensive-fund",
                buyCents: 7120701,
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
            offerId: "career:9:major:31104000:employment",
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
                instrumentId: "growth-fund",
                buyCents: 10853569,
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
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "broad-market-fund",
                buyCents: 7261200,
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
                instrumentId: "income-defensive-fund",
                buyCents: 5063791,
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
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-60",
            quoteId:
              "opportunity-60:bank-fixed:15153000:303060:11625000:675:226590:4057650:2393305",
          },
        ],
      },
      {
        quarter: 22,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-88",
            quoteId:
              "opportunity-88:bank-fixed:40332000:806640:16132800:825:764227:25770067:2524907",
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
    winningQuarter: 24,
    acceptedCommandCount: 123,
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
        quarter: 15,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-57",
            quoteId:
              "opportunity-57:bank-fixed:9836000:196720:3934400:825:186376:6284696:1485135",
          },
        ],
      },
      {
        quarter: 23,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-89",
            quoteId:
              "opportunity-89:cash:14685000:293700:0:675:0:14978700:1503532",
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
    seed: "m7-acceptance-property-magnate-2",
    winnerId: "player-3",
    profileId: "corporate-climber",
    initialFocus: "property",
    winningQuarter: 32,
    acceptedCommandCount: 165,
    actions: [
      {
        quarter: 1,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:1:major:10000000:employment",
          },
        ],
      },
      {
        quarter: 3,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:3:major:12000000:employment",
          },
        ],
      },
      {
        quarter: 5,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:5:major:14400000:employment",
          },
        ],
      },
      {
        quarter: 7,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:7:major:17280000:employment",
          },
        ],
      },
      {
        quarter: 9,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:9:major:20736000:employment",
          },
        ],
      },
      {
        quarter: 11,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-43",
            quoteId:
              "opportunity-43:cash:15003000:300060:0:675:0:15303060:1633125",
          },
        ],
      },
      {
        quarter: 12,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-47",
            quoteId:
              "opportunity-47:bank-fixed:15259500:305190:11625000:675:226590:4166280:1642488",
          },
        ],
      },
      {
        quarter: 20,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-79",
            quoteId:
              "opportunity-79:cash:14746500:294930:0:675:0:15041430:1584534",
          },
        ],
      },
      {
        quarter: 21,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-83",
            quoteId:
              "opportunity-83:cash:14836500:296730:0:675:0:15133230:1594437",
          },
        ],
      },
      {
        quarter: 27,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-107",
            quoteId:
              "opportunity-107:bank-fixed:107822000:2156440:67247684:825:1518000:44248756:1679966",
          },
        ],
      },
      {
        quarter: 30,
        commands: [
          {
            type: "ACQUIRE_RECURRING_OPPORTUNITY",
            opportunityId: "opportunity-119",
            quoteId:
              "opportunity-119:cash:14893500:297870:0:775:0:15191370:1737305",
          },
        ],
      },
    ],
    standingFinaleOffer: true,
    finalAction: {
      type: "ACQUIRE_RECURRING_OPPORTUNITY",
      opportunityId: "opportunity-129",
      quoteId:
        "opportunity-129:bank-fixed:65000000:1300000:40731803:675:793928:26362125:1763463",
    },
  },
  {
    objectiveId: "deal-maker",
    seed: "deal-maker-production-9",
    winnerId: "player-1",
    profileId: "self-employed-operator",
    initialFocus: "business",
    winningQuarter: 30,
    acceptedCommandCount: 155,
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
        quarter: 4,
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
        quarter: 5,
        commands: [
          {
            type: "ACCEPT_CAREER_OFFER",
            offerId: "career:5:major:12096000:employment",
          },
        ],
      },
      {
        quarter: 6,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 5162563,
                sellCents: 0,
              },
            ],
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
            type: "SELL_RECURRING_BUSINESS",
            opportunityId: "opportunity-29",
            quoteId:
              "opportunity-29:exit:42:asset-1:8669174:1675769:310348:0:0:8403917:loan-2:1598704:31974",
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
                instrumentId: "growth-fund",
                buyCents: 19180509,
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
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 3949591,
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
                buyCents: 3912757,
                sellCents: 0,
              },
            ],
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
                buyCents: 3912820,
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
                buyCents: 3914142,
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
                instrumentId: "growth-fund",
                buyCents: 3915892,
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
                buyCents: 3905455,
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
                buyCents: 3919689,
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
                buyCents: 3965589,
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
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 3951606,
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
                buyCents: 3953029,
                sellCents: 0,
              },
            ],
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
                buyCents: 0,
                sellCents: 10000000,
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
                buyCents: 0,
                sellCents: 10000000,
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
                instrumentId: "growth-fund",
                buyCents: 0,
                sellCents: 10000000,
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
                buyCents: 46032260,
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
                sellCents: 25000000,
              },
            ],
          },
        ],
      },
      {
        quarter: 28,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 0,
                sellCents: 25000000,
              },
            ],
          },
        ],
      },
      {
        quarter: 29,
        commands: [
          {
            type: "TRADE_PUBLIC_MARKETS",
            trades: [
              {
                instrumentId: "growth-fund",
                buyCents: 0,
                sellCents: 25000000,
              },
            ],
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
    winningQuarter: 30,
    acceptedCommandCount: 154,
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
    ],
    finalAction: {
      type: "SELL_RECURRING_BUSINESS",
      opportunityId: "opportunity-120",
      quoteId:
        "opportunity-120:exit:153:asset-3:114877628:1590097:3494032:0:0:112973693",
    },
  },
  {
    objectiveId: "financier",
    seed: "m7-acceptance-financier-7",
    winnerId: "player-2",
    profileId: "high-income-professional",
    initialFocus: "financing",
    winningQuarter: 29,
    acceptedCommandCount: 148,
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
        quarter: 4,
        commands: [
          {
            type: "FUND_RECURRING_LOAN",
            opportunityId: "opportunity-14",
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
        quarter: 10,
        commands: [
          {
            type: "FUND_RECURRING_LOAN",
            opportunityId: "opportunity-38",
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
        quarter: 19,
        commands: [
          {
            type: "FUND_RECURRING_LOAN",
            opportunityId: "opportunity-74",
          },
        ],
      },
      {
        quarter: 24,
        commands: [
          {
            type: "FUND_RECURRING_LOAN",
            opportunityId: "opportunity-94",
          },
        ],
      },
      {
        quarter: 27,
        commands: [
          {
            type: "FUND_RECURRING_LOAN",
            opportunityId: "opportunity-106",
          },
        ],
      },
      {
        quarter: 28,
        commands: [
          {
            type: "FUND_RECURRING_LOAN",
            opportunityId: "opportunity-110",
          },
        ],
      },
    ],
    standingFinaleOffer: true,
    finalAction: {
      type: "FUND_RECURRING_LOAN",
      opportunityId: "opportunity-117",
    },
  },
];
