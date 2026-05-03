// ══════════════════════════════════════════════════════
// AI Context capture questions
// Stored at users/{uid}.aiContextCapture.{domain}.{id} = { answer, updatedAt }
// Question IDs are stable — referenced by compilation prompts.
// ══════════════════════════════════════════════════════

export const TRAINING_QUESTIONS = [
  {
    section: 'Sport setup',
    sectionDesc: 'These drive how Claude reasons about your plan.',
    items: [
      {
        id: 'sports',
        prompt: 'Which sports do you train in?',
        placeholder: 'e.g. Cycling, Running, Strength/Gym, Swimming, Kayaking, Hiking, Yoga',
      },
      {
        id: 'primaryFocus',
        prompt: 'Which sport(s) are your current primary focus?',
        placeholder: 'e.g. Cycling primary, run/strength supporting',
      },
      {
        id: 'currentTarget',
        prompt: 'What are you training for right now?',
        placeholder: 'A race, event, goal — or just "general fitness"',
      },
      {
        id: 'timeBudget',
        prompt: 'Weekly time budget — realistic vs ideal',
        placeholder: 'e.g. realistic 8h, ideal 12h',
      },
    ],
  },
  {
    section: 'Identity',
    sectionDesc: 'Durable, slow-changing.',
    items: [
      {
        id: 'whySport',
        prompt: "What's your relationship with sport — why do you do this?",
        placeholder: 'Mental health, competition, social, identity, performance, escape...',
      },
      {
        id: 'responsePatterns',
        prompt: 'How do you respond to training?',
        placeholder: 'e.g. "I adapt well to threshold work, flatten quickly on too much VO2"',
      },
      {
        id: 'bestSelf',
        prompt: 'What kind of athlete are you at your best?',
        placeholder: 'Consistent, gritty, fast, durable, fun-loving, methodical...',
      },
      {
        id: 'longArcGoals',
        prompt: 'Long-arc goals — where are you trying to get to over 2-3 years?',
        placeholder: 'Specific events, FTP target, stay healthy, etc.',
      },
    ],
  },
  {
    section: 'Constraints',
    sectionDesc: 'Life context that shapes what is realistic.',
    items: [
      {
        id: 'lifePatterns',
        prompt: 'What life patterns affect your training windows?',
        placeholder: 'e.g. solo-parent two days a week, school runs, work travel, evening calls',
      },
      {
        id: 'equipmentTerrain',
        prompt: 'Equipment + terrain you have access to',
        placeholder: 'Bikes, trainer, gym membership, pool, local terrain (hilly/flat/trails)',
      },
      {
        id: 'workArounds',
        prompt: 'Anything to work around?',
        placeholder: 'Past injuries, time-of-day limits, recovery sensitivities, dietary',
      },
    ],
  },
  {
    section: 'For the AI',
    items: [
      {
        id: 'aiContext',
        prompt: 'What context, if always provided, would make AI training advice immediately useful versus generic?',
        placeholder: 'e.g. always remember I am over 40, always assume time-constrained, etc.',
      },
    ],
  },
];

export const HEALTH_QUESTIONS = [
  {
    section: 'Baselines',
    sectionDesc: 'Durable, slow-changing.',
    items: [
      {
        id: 'goodSleep',
        prompt: 'What does good sleep look like for you?',
        placeholder: 'Typical bed/wake times, hours, quality signals (deep, REM, no waking)',
      },
      {
        id: 'sleepResponse',
        prompt: 'How do you respond to poor sleep?',
        placeholder: 'e.g. "one bad night fine, three accumulating wrecks me; takes 2 nights to bounce back"',
      },
      {
        id: 'recoveryFactors',
        prompt: 'What affects your recovery — what helps, what hurts?',
        placeholder: 'Alcohol, late meals, stress, daylight, mobility work, etc.',
      },
      {
        id: 'longArcHealth',
        prompt: 'Long-arc health priorities',
        placeholder: 'Metabolic health, longevity, weight management, mental health, etc.',
      },
    ],
  },
  {
    section: 'Current',
    sectionDesc: 'Volatile, current state.',
    items: [
      {
        id: 'sleepSituation',
        prompt: 'Current sleep situation',
        placeholder: 'Environment, partner sleep, kids waking, anything specific right now',
      },
      {
        id: 'healthHistory',
        prompt: 'Health history relevant to training/recovery decisions',
        placeholder: 'Chronic conditions, past injuries, allergies, medications affecting recovery',
      },
      {
        id: 'activeConcerns',
        prompt: 'Active concerns or experiments',
        placeholder: 'Anything you are testing right now (CGM, fasting, supplement, sleep change)',
      },
    ],
  },
  {
    section: 'For the AI',
    items: [
      {
        id: 'aiContext',
        prompt: 'What context, if always provided, would make AI health advice immediately useful?',
        placeholder: 'Hard rules, things never to suggest, framing preferences',
      },
    ],
  },
];

export function flattenQuestions(sections) {
  return sections.flatMap(s => s.items);
}

export function countAnswered(sections, capture) {
  const all = flattenQuestions(sections);
  let answered = 0;
  for (const q of all) {
    if (capture?.[q.id]?.answer?.trim?.()) answered += 1;
  }
  return { answered, total: all.length };
}
