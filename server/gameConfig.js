// =====================================================================
// W.O.R.L.D. 게임 밸런스 설정 파일
// 이 파일 하나만 수정하면 계급/스킬/아이템/뽑기확률/레벨업 보상을 전부 바꿀 수 있습니다.
// 서버 코드(다른 server/*.js 파일)는 건드릴 필요 없습니다.
// 이미지·이펙트 경로는 public/assets/icons, public/assets/effects 기준 상대경로입니다.
// =====================================================================

// ---- 레벨 / 계급 ----
const MAX_LEVEL = 720;
const GOD_LEVEL = 999999999; // THE GOD의 레벨은 MAX_LEVEL과 무관하게 항상 이 값으로 고정

const RANK_THRESHOLDS = [
  { rank: "E",   min: 1,  max: 90 },
  { rank: "D",   min: 91, max: 180 },
  { rank: "C",   min: 181, max: 270 },
  { rank: "B",   min: 271, max: 360 },
  { rank: "A",   min: 361, max: 450 },
  { rank: "S",   min: 451, max: 540 },
  { rank: "SS",  min: 541, max: 630 },
  { rank: "SSS", min: 631, max: 720 },
];
// "THE GOD"은 여기 포함하지 않습니다 - 관리자 전용 고정 계급 (엔진이 자동으로 최상위에 추가)

const STARTING_MONEY = {
  E: 100, D: 200, C: 400, B: 800, A: 1500,
  S: 3000, SS: 6000, SSS: 12000, "THE GOD": 999999999999999999,
};

// ---- 뽑기(가챠) - 스킬만 대상, 숫자가 클수록 잘 나옴 ----
const GACHA_WEIGHTS = { E: 50, D: 20, C: 15, B: 7, A: 5, S: 2, SS: 0.99998199982, SSS: 0.00001800018 };
const GACHA_COST = 500;

// ---- 전투 승리 보상 (레벨업 / 계급승급) ----
const LEVEL_GAIN_PER_WIN = 77;        // 승리 시 기본 레벨 상승폭
const LEVEL_GAIN_RANK_BONUS = 77777;     // 나보다 높은 계급을 이길 때, 계급 차이 1단계당 추가 레벨
const RANKUP_BONUS_MONEY_RATIO = 0.07; // 승급 축하금 = 새 계급 시작자금 * 이 비율

// ---- 스킬/아이템 판매 가격 ----
// 계급(rankTier)별 기본 판매가. 특정 스킬/아이템만 다른 가격을 주고 싶으면
// 그 객체에 sellPrice 필드를 직접 추가하세요 (예: { id: "s_judgement", ..., sellPrice: 2000 }).
// sellPrice가 있으면 그 값이 우선 적용되고, 없으면 아래 계급별 기본값이 적용됩니다.
const SELL_PRICE_BY_RANK = {
  E: 100, D: 150, C: 200, B: 500, A: 1000, S: 5000, SS: 500000, SSS: 500000000,
};

// ---- 발동 조건(condition) 종류 ----
// { type: "cooldown", ms }            → 재사용 대기시간
// { type: "hpFull" }                  → HP가 최대일 때만
// { type: "hpBelow", percent }        → HP가 최대치의 percent% 이하일 때만
// { type: "hpAtLeast", percent }      → HP가 최대치의 percent% 이상일 때만
// { type: "rankAtLeast", rank }       → 계급이 그 이상일 때만
// { type: "usesPerMatch", max }       → 한 전투에서 최대 max번만 (필살기용)

// ---- 이펙트(effect) - 생략 가능 ----
// { type: "spritesheet", src, frameWidth, frameHeight, frameCount, fps }
// { type: "video", src }

const SKILL_POOL = [
  { id: "e_jab", name: "잽", rankTier: "E", power: 5, element: "hit",
    conditions: [{ type: "cooldown", ms: 1500 }],
    description: "가벼운 일격. 쿨타임 1.5초.", icon: null, effect: null },
  { id: "d_kick", name: "돌려차기", rankTier: "D", power: 9, element: "hit",
    conditions: [{ type: "cooldown", ms: 2500 }],
    description: "쿨타임 2.5초의 발차기.", icon: null, effect: null },
  { id: "c_focus_strike", name: "집중 일격", rankTier: "C", power: 14, element: "hit",
    conditions: [{ type: "cooldown", ms: 4000 }, { type: "hpFull" }],
    description: "HP 최대일 때만, 쿨타임 4초.", icon: null, effect: null },
  { id: "b_counter", name: "카운터", rankTier: "B", power: 18, element: "hit",
    conditions: [{ type: "cooldown", ms: 5000 }, { type: "hpBelow", percent: 50 }],
    description: "HP 50% 이하일 때만. 쿨타임 5초.", icon: null, effect: null },
  { id: "a_burst", name: "버스트 슬래시", rankTier: "A", power: 24, element: "sharp",
    conditions: [{ type: "cooldown", ms: 4000 }, { type: "rankAtLeast", rank: "A" }],
    description: "계급 A 이상. 쿨타임 4초.", icon: null,
    effect: null },
  { id: "s_judgement", name: "심판의 일격", rankTier: "S", power: 32, element: "light",
    conditions: [{ type: "cooldown", ms: 6000 }, { type: "rankAtLeast", rank: "S" }],
    description: "계급 S 이상. 쿨타임 6초.", icon: null,
    effect: null },
  { id: "ss_obliterate", name: "말살", rankTier: "SS", power: 42, element: "dark",
    conditions: [{ type: "cooldown", ms: 8000 }, { type: "hpFull" }, { type: "rankAtLeast", rank: "SS" }],
    description: "계급 SS 이상, HP 최대일 때만. 쿨타임 8초.", icon: null,
    effect: null },
  { id: "sss_apocalypse", name: "종말", rankTier: "SSS", power: 60, element: "dark",
    conditions: [{ type: "cooldown", ms: 10000 }, { type: "rankAtLeast", rank: "SSS" }],
    description: "계급 SSS 전용. 쿨타임 10초.", icon: null,
    effect: null },
];

// ---- 아이템 풀 (뽑기 불가 - 계급승급/전투 승리로만 획득. 패시브 + 액티브 내장) ----
// passive에 넣을 수 있는 효과 종류 (지금 엔진이 실제로 계산해주는 것들):
//   maxHpBonus: 30            → 최대 HP가 이 수치만큼 늘어남 (기본 HP는 100)
//   damageReduction: 0.1      → 받는 모든 피해를 이 비율만큼 감소 (0.1 = 10% 감소, 여러 아이템 합산되며 최대 60%까지)
//   immuneElements: ["water"] → 이 속성(element)의 스킬로는 피해를 아예 받지 않음 (배열이라 여러 속성 동시 지정 가능)
// 세 가지는 자유롭게 조합 가능하고, 안 쓰는 항목은 아예 안 적어도 됩니다 (예: passive: { maxHpBonus: 10 } 만 있어도 OK).
// 이 세 가지 외의 새로운 효과(반격 확률, 체력흡수, 쿨타임 감소 등)를 추가하고 싶으면
// 이 파일 수정만으로는 안 되고 server/combat.js의 데미지 계산 로직도 같이 손봐야 합니다.
// (파일 맨 아래에 "새 패시브 효과 추가하는 법" 예시를 적어뒀습니다)
const ITEM_POOL = [
  { id: "e_wooden_sword", name: "낡은 목검", rankTier: "E", icon: null,
    passive: { maxHpBonus: 10 },
    active: { id: "wooden_bash", name: "목검 내려찍기", power: 6, element: "hit",
      conditions: [{ type: "cooldown", ms: 3000 }], description: "쿨타임 3초.",
      icon: null, effect: null } },
  { id: "c_iron_shield", name: "철제 방패", rankTier: "C", icon: null,
    passive: { damageReduction: 0.1 },
    active: { id: "shield_bash", name: "방패 밀치기", power: 10, element: "hit",
      conditions: [{ type: "cooldown", ms: 3500 }], description: "쿨타임 3.5초.",
      icon: null, effect: null } },
  { id: "a_flame_gauntlet", name: "화염 건틀렛", rankTier: "A", icon: null,
    passive: { maxHpBonus: 30, immuneElements: ["ice"] },
    active: { id: "flame_punch", name: "화염탄", power: 26, element: "fire",
      conditions: [{ type: "cooldown", ms: 5000 }, { type: "hpAtLeast", percent: 50 }],
      description: "HP가 50% 이상일 때만. 쿨타임 5초. 화속성.", icon: null,
      effect: null } },
  {
    id: "ss_poseidon_trident", name: "포세이돈의 삼지창", rankTier: "SS", icon: null,
    passive: { immuneElements: ["water"] },
    active: { id: "trident_stab", name: "찌르기", power: 20, element: "sharp",
      conditions: [{ type: "cooldown", ms: 1000 }], description: "쿨타임 1초의 기본 찌르기.",
      icon: null,
      effect: null },
    activeExtra: [
      { id: "sea_dragon_finale", name: "해룡의 화룡점정", power: 55, element: "water",
        conditions: [{ type: "rankAtLeast", rank: "SS" }, { type: "usesPerMatch", max: 1 }],
        description: "계급 SS 이상, 한 전투에서 딱 한 번만 사용 가능.",
        icon: null,
        effect: null },
    ],
  },
  { id: "sss_world_ender", name: "세계종말자", rankTier: "SSS", icon: null,
    passive: { maxHpBonus: 100, damageReduction: 0.15 },
    active: { id: "world_end", name: "세계의 끝", power: 80, element: "dark",
      conditions: [{ type: "cooldown", ms: 12000 }, { type: "rankAtLeast", rank: "SSS" }],
      description: "계급 SSS 전용. 쿨타임 12초.", icon: null,
      effect: null } },
  { id: "mbdr", name: "MBDR", rankTier: "THE GOD", icon: "icons/mbdr.png",
    passive: { maxHpBonus: 999999999, damageReduction: 0.999999999, immuneElements: ["hit", "sharp", "fire", "nature", "water", "electricity", "dark", "light"]},
    active: { id: "ewmbdr_a_ewbebdr", name: "Made And End", power: 999999999, element: "THE GOD",
      conditions: [{ type: "cooldown", ms: 0.000000009 }, { type: "rankAtLeast", rank: "THE GOD" }],
      description: "Everything was Made By Dwina Rayst. And everything will be Ended By Dwina Rayst.", icon: null,
      effect: { type: "video", src: "effects/ewmbdr_a_ewbebdr.mp4" } } },
];

// =====================================================================
// 새 패시브 효과를 추가하는 법 (예시: "생명력 흡수" 패시브 만들기)
// =====================================================================
// 1) 이 파일에서 원하는 아이템의 passive에 새 키를 추가합니다.
//      passive: { lifesteal: 0.2 }   // 자신이 준 피해의 20%만큼 자기 HP 회복
//
// 2) server/gameLogic.js의 getItemPassives 함수에 그 키를 합산하는 코드를 추가합니다.
//      result.lifesteal = 0;
//      ...
//      if (item.passive.lifesteal) result.lifesteal += item.passive.lifesteal;
//    (그리고 함수 맨 위 result 객체 초기값에도 lifesteal: 0을 추가)
//
// 3) server/combat.js의 castSkill 함수에서 데미지를 opponent.hp에 적용하는 부분 바로 아래에
//    실제 효과를 적용하는 코드를 추가합니다.
//      opponent.hp = Math.max(0, opponent.hp - damage);
//      if (player.lifesteal) {                                   // ← 이런 식으로 추가
//        player.hp = Math.min(player.maxHp, player.hp + Math.round(damage * player.lifesteal));
//      }
//    이때 player.lifesteal 값은 buildPlayerState 함수가 getItemPassives 결과를 그대로
//    player 객체에 담아주므로, 2)에서 이름을 맞춰 추가했다면 자동으로 들어옵니다.
//
// 즉, "이 파일(밸런스 수치)"과 "server/combat.js(그 수치를 실제로 어떻게 계산할지)"는
// 항상 한 쌍으로 같이 고쳐야 합니다. 이 파일만 고쳐서는 새로운 종류의 효과가 생기지 않고,
// 기존에 이미 지원되는 세 가지(maxHpBonus, damageReduction, immuneElements)의 숫자만 바꾸는 것은
// 이 파일 수정만으로 충분합니다.

module.exports = {
  MAX_LEVEL, GOD_LEVEL, RANK_THRESHOLDS, STARTING_MONEY, GACHA_WEIGHTS, GACHA_COST,
  LEVEL_GAIN_PER_WIN, LEVEL_GAIN_RANK_BONUS, RANKUP_BONUS_MONEY_RATIO, SELL_PRICE_BY_RANK,
  SKILL_POOL, ITEM_POOL,
};
