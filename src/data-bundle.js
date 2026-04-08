'use strict';

/**
 * Data Bundle ? all game data bundled for browser use.
 *
 * This file contains all JSON configuration data inline,
 * generated from assets/data/*.json files.
 */
export const DATA = {
  "abilities": [
    {
      "id": "face_change",
      "name": "换面",
      "type": "consumable",
      "cost": 2,
      "effectType": "set_dice_value",
      "params": {
        "min": 1,
        "max": 6
      },
      "description": "将一个骰子变为任意指定点数(1-6)",
      "tags": [
        "universal"
      ]
    },
    {
      "id": "loaded_shot",
      "name": "加料",
      "type": "consumable",
      "cost": 2,
      "effectType": "reroll_min",
      "params": {
        "minValue": 4
      },
      "description": "重掷一个骰子，保证结果≥4",
      "tags": [
        "targeted"
      ]
    },
    {
      "id": "insight",
      "name": "透视",
      "type": "consumable",
      "cost": 1,
      "effectType": "reveal_weakness",
      "params": {
        "bonusFlat": 10
      },
      "description": "查看本场弱点分类（该分类+10分）",
      "tags": [
        "information"
      ]
    },
    {
      "id": "double_roll",
      "name": "双投",
      "type": "consumable",
      "cost": 3,
      "effectType": "extra_roll",
      "params": {},
      "description": "额外获得一次完整投掷机会",
      "tags": [
        "reroll"
      ]
    },
    {
      "id": "swap_lowest",
      "name": "偷梁换柱",
      "type": "consumable",
      "cost": 3,
      "effectType": "replace_lowest",
      "params": {
        "value": 6
      },
      "description": "将最低点数的骰子替换为6",
      "tags": [
        "targeted"
      ]
    },
    {
      "id": "swap_dice",
      "name": "换位",
      "type": "consumable",
      "cost": 1,
      "effectType": "swap_values",
      "params": {},
      "description": "交换两个骰子的值",
      "tags": [
        "targeted_dual"
      ]
    },
    {
      "id": "gamble",
      "name": "赌博",
      "type": "consumable",
      "cost": 1,
      "effectType": "gamble_reroll",
      "params": {
        "goodValue": 6,
        "badValue": 1,
        "chance": 0.5
      },
      "description": "50%概率全骰变6，50%概率全骰变1",
      "tags": [
        "risk"
      ]
    },
    {
      "id": "freeze_die",
      "name": "冻结",
      "type": "consumable",
      "cost": 2,
      "effectType": "freeze_die",
      "params": {},
      "description": "冻结一个骰子，下轮保留其值",
      "tags": [
        "persistent",
        "targeted"
      ]
    },
    {
      "id": "invert_dice",
      "name": "反转",
      "type": "consumable",
      "cost": 2,
      "effectType": "invert_value",
      "params": {
        "sumValue": 7
      },
      "description": "骰子值变为 (7-原值)，如1→6, 3→4",
      "tags": [
        "targeted"
      ]
    },
    {
      "id": "loaded_dice",
      "name": "铅骰",
      "type": "passive",
      "cost": 4,
      "effectType": "dice_floor",
      "params": {
        "minValue": 2
      },
      "description": "所有骰子最低点数为2",
      "tags": [
        "dice_modify"
      ]
    },
    {
      "id": "clone_dice",
      "name": "分身术",
      "type": "passive",
      "cost": 5,
      "effectType": "clone_dice",
      "params": {
        "count": 1
      },
      "description": "每次投掷时临时复制1个随机骰子（仅当次有效）",
      "tags": [
        "dice_modify"
      ]
    },
    {
      "id": "chain_link",
      "name": "连横术",
      "type": "passive",
      "cost": 4,
      "effectType": "excess_bonus",
      "params": {
        "perExcess": 5
      },
      "description": "超出分类最低要求的每颗匹配骰子+5固定加成",
      "tags": [
        "scoring"
      ]
    },
    {
      "id": "straight_eye",
      "name": "顺子眼",
      "type": "passive",
      "cost": 4,
      "effectType": "loose_consecutive",
      "params": {
        "maxGap": 1
      },
      "description": "顺子允许间隔1（如1-3-4-5算小顺）",
      "tags": [
        "category_modify"
      ]
    },
    {
      "id": "greed",
      "name": "贪欲",
      "type": "passive",
      "cost": 3,
      "effectType": "score_multiplier",
      "params": {
        "multiplier": 2
      },
      "description": "最终分数×2.0（翻倍！）",
      "tags": [
        "multiplier"
      ]
    },
    {
      "id": "pattern_master",
      "name": "牌型大师",
      "type": "passive",
      "cost": 4,
      "effectType": "category_bonus",
      "params": {
        "categories": [
          "full_house",
          "yahtzee",
          "three_of_a_kind"
        ],
        "bonus": 20
      },
      "description": "满堂红、豹子和三条分类+20固定加成",
      "tags": [
        "scoring"
      ]
    },
    {
      "id": "decree_override",
      "name": "强夺令",
      "type": "passive",
      "cost": 5,
      "effectType": "category_override",
      "params": {
        "forceCategory": "three_of_a_kind",
        "minDice": 2
      },
      "description": "强制将骰子匹配为指定分类，无视实际点数",
      "tags": [
        "category_modify",
        "rule_break"
      ]
    },
    {
      "id": "heaven_dice",
      "name": "天降骰",
      "type": "passive",
      "cost": 5,
      "effectType": "flat_bonus",
      "params": {
        "bonus": 15
      },
      "description": "基础分数+15，且此被动无法被封印",
      "tags": [
        "scoring",
        "unsealable",
        "rule_break"
      ],
      "unsealable": true
    },
    {
      "id": "judgment_flip",
      "name": "反转审判",
      "type": "passive",
      "cost": 4,
      "effectType": "victory_reverse",
      "params": {
        "threshold": 0.85
      },
      "description": "达到目标分数的85%即可获胜",
      "tags": [
        "victory_condition",
        "rule_break"
      ]
    },
    {
      "id": "spare_dice",
      "name": "备用骰",
      "type": "dice_expansion",
      "cost": 4,
      "effectType": "add_dice",
      "params": {
        "count": 1,
        "initialValue": "random"
      },
      "description": "骰子池永久+1",
      "tags": [
        "expansion"
      ]
    },
    {
      "id": "king_dice",
      "name": "千王骰",
      "type": "dice_expansion",
      "cost": 6,
      "effectType": "add_dice",
      "params": {
        "count": 1,
        "initialValue": 6
      },
      "description": "骰子池永久+1，新骰子初始固定为6（仅首次）",
      "tags": [
        "expansion"
      ]
    }
  ],
  "economy": {
    "tokenRewards": [
      5,
      5,
      6,
      6,
      7,
      7,
      8,
      9
    ],
    "shop": {
      "itemsPerRefresh": 3,
      "refreshCost": 1
    },
    "diceExpansion": {
      "bonusRounds": [
        1,
        2,
        3
      ],
      "bonusWeight": 2
    }
  },
  "enemies": [
    {
      "id": "thug",
      "round": 1,
      "name": "街头混混",
      "targetScore": 8,
      "rules": []
    },
    {
      "id": "hustler",
      "round": 2,
      "name": "地痞赌徒",
      "targetScore": 14,
      "rules": []
    },
    {
      "id": "dealer",
      "round": 3,
      "name": "地下庄家",
      "targetScore": 22,
      "rules": [
        "block_pair"
      ]
    },
    {
      "id": "croupier",
      "round": 4,
      "name": "赌场荷官",
      "targetScore": 35,
      "rules": [
        "zero_lowest"
      ]
    },
    {
      "id": "swindler",
      "round": 5,
      "name": "老千同行",
      "targetScore": 50,
      "rules": [
        "swap_dice"
      ]
    },
    {
      "id": "manager",
      "round": 6,
      "name": "赌场经理",
      "targetScore": 68,
      "rules": [
        "seal_passive"
      ]
    },
    {
      "id": "underground_king",
      "round": 7,
      "name": "地下赌王",
      "targetScore": 88,
      "rules": [
        "suppress_all"
      ]
    },
    {
      "id": "king_of_cheats",
      "round": 8,
      "name": "千王之王",
      "targetScore": 110,
      "rules": [],
      "bossRule": {
        "pool": "all",
        "count": 2
      }
    }
  ],
  "enemyRules": [
    {
      "id": "block_pair",
      "name": "封锁对子",
      "description": "对子分类无法匹配",
      "targetCategory": "pair",
      "effectType": "block_category"
    },
    {
      "id": "zero_lowest",
      "name": "最低点归零",
      "description": "最低点骰子计分时视为0",
      "effectType": "zero_lowest_dice",
      "params": {
        "count": 1
      }
    },
    {
      "id": "swap_dice",
      "name": "狸猫换子",
      "description": "敌人重掷你1颗骰子",
      "effectType": "reroll_random",
      "params": {
        "count": 1,
        "phase": "post_roll"
      }
    },
    {
      "id": "seal_passive",
      "name": "封印被动",
      "description": "最贵的被动本轮不生效",
      "effectType": "seal_most_expensive_passive"
    },
    {
      "id": "suppress_all",
      "name": "全面压制",
      "description": "所有骰子点数-1（最低为1）",
      "effectType": "dice_decrease",
      "params": {
        "amount": 1,
        "minValue": 1
      }
    }
  ],
  "scoringCategories": [
    {
      "id": "yahtzee",
      "name": "豹子",
      "priority": 1,
      "minDice": 3,
      "matchType": "all_same",
      "bonusType": "multiplier",
      "bonusValue": 3
    },
    {
      "id": "full_house",
      "name": "满堂红",
      "priority": 2,
      "minDice": 5,
      "matchType": "full_house",
      "bonusType": "flat",
      "bonusValue": 15
    },
    {
      "id": "large_straight",
      "name": "大顺",
      "priority": 3,
      "minDice": 5,
      "matchType": "consecutive",
      "consecutiveCount": 5,
      "bonusType": "flat",
      "bonusValue": 20
    },
    {
      "id": "small_straight",
      "name": "小顺",
      "priority": 4,
      "minDice": 4,
      "matchType": "consecutive",
      "consecutiveCount": 4,
      "bonusType": "flat",
      "bonusValue": 10
    },
    {
      "id": "three_of_a_kind",
      "name": "三条",
      "priority": 5,
      "minDice": 3,
      "matchType": "same_value",
      "matchCount": 3,
      "bonusType": "flat",
      "bonusValue": 5
    },
    {
      "id": "pair",
      "name": "对子",
      "priority": 6,
      "minDice": 2,
      "matchType": "same_value",
      "matchCount": 2,
      "bonusType": "flat",
      "bonusValue": 0
    },
    {
      "id": "bust",
      "name": "散牌",
      "priority": 7,
      "minDice": 0,
      "matchType": "fallback",
      "bonusType": "flat",
      "bonusValue": 0
    }
  ],
  "globalConfig": {
    "dice": {
      "initialCount": 4,
      "maxCount": 7,
      "sides": 6,
      "minValue": 1,
      "maxValue": 6
    },
    "battle": {
      "consumablesPerRound": 2,
      "rollsPerRound": 1
    },
    "startingItems": {
      "freeConsumable": "face_change"
    },
    "rounds": {
      "total": 8
    }
  }
};
