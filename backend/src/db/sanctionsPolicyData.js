export const SANCTION_ACTION_SEEDS = [
  { code: 'WARNING', description: 'Issue a formal warning to the student.' },
  { code: 'REMINDER', description: 'Give a reminder about expected conduct.' },
  { code: 'CONFISCATION', description: 'Confiscate prohibited or disruptive item(s).' },
  { code: 'PARENT_NOTIFICATION', description: 'Notify parent or guardian about the incident.' },
  { code: 'PARENT_CONFERENCE', description: 'Require a parent or guardian conference.' },
  { code: 'COUNSELING', description: 'Assign guidance counseling intervention.' },
  { code: 'INTERVENTION_PROGRAM', description: 'Enroll in a behavior intervention program.' },
  { code: 'SUSPENSION', description: 'Apply suspension based on policy and due process.' },
  { code: 'EXPULSION', description: 'Initiate expulsion process under school policy.' },
  { code: 'DISCIPLINARY_PROBATION', description: 'Place student under disciplinary probation.' },
  { code: 'PAYMENT_REQUIRED', description: 'Require payment for damage, loss, or liability.' },
  { code: 'REPLACEMENT_REQUIRED', description: 'Require replacement of damaged or lost property.' },
  { code: 'CLEANING_DUTY', description: 'Assign supervised cleaning duty.' },
  { code: 'REFERRAL_MADAC', description: 'Refer student to MADAC or equivalent program.' },
  { code: 'LEGAL_LIABILITY', description: 'Escalate case for legal liability handling.' },
  { code: 'NON_ISSUANCE_GOOD_MORAL', description: 'Flag non-issuance of good moral certificate.' }
];

export const VIOLATION_POLICY_SEEDS = [
  {
    key: 'A1',
    category: 'A',
    name: 'Use of cellphone during class',
    severity: 'MINOR',
    isEscalatable: true,
    rules: {
      1: ['WARNING'],
      2: ['CONFISCATION', 'PARENT_NOTIFICATION'],
      3: ['COUNSELING']
    }
  },
  {
    key: 'A2',
    category: 'A',
    name: 'Use of a gadget that creates noise during class',
    severity: 'MINOR',
    isEscalatable: true,
    rules: {
      1: ['WARNING'],
      2: ['CONFISCATION', 'PARENT_NOTIFICATION'],
      3: ['COUNSELING']
    }
  },
  {
    key: 'A3',
    category: 'A',
    name: 'Habitual absence of more than one week without explanation',
    severity: 'MODERATE',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE'],
      2: ['INTERVENTION_PROGRAM', 'COUNSELING'],
      3: ['DISCIPLINARY_PROBATION']
    }
  },
  {
    key: 'A4',
    category: 'A',
    name: 'Habitual tardiness reaching one week',
    severity: 'MODERATE',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE'],
      2: ['INTERVENTION_PROGRAM', 'COUNSELING'],
      3: ['DISCIPLINARY_PROBATION']
    }
  },
  {
    key: 'A5',
    category: 'A',
    name: 'Frequent cutting of classes',
    severity: 'MODERATE',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE'],
      2: ['INTERVENTION_PROGRAM', 'COUNSELING'],
      3: ['DISCIPLINARY_PROBATION']
    }
  },
  {
    key: 'A6',
    category: 'A',
    name: 'Leaving the classroom without permission and showing disrespect',
    severity: 'MINOR',
    isEscalatable: true,
    rules: {
      1: ['REMINDER'],
      2: ['PARENT_CONFERENCE'],
      3: ['DISCIPLINARY_PROBATION']
    }
  },
  {
    key: 'A7',
    category: 'A',
    name: 'Escaping through the school gate without permission',
    severity: 'MAJOR',
    isEscalatable: true,
    rules: {
      1: ['REMINDER'],
      2: ['PARENT_CONFERENCE'],
      3: ['DISCIPLINARY_PROBATION']
    }
  },
  {
    key: 'A8',
    category: 'A',
    name: 'Failure to return or loss of school equipment',
    severity: 'MODERATE',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE', 'PAYMENT_REQUIRED'],
      2: ['PAYMENT_REQUIRED'],
      3: ['NON_ISSUANCE_GOOD_MORAL']
    }
  },

  {
    key: 'B1',
    category: 'B',
    name: 'Not wearing proper uniform',
    severity: 'MINOR',
    isEscalatable: true,
    rules: {
      1: ['WARNING'],
      2: ['PARENT_CONFERENCE'],
      3: ['COUNSELING']
    }
  },
  {
    key: 'B2',
    category: 'B',
    name: 'Not wearing ID',
    severity: 'MINOR',
    isEscalatable: true,
    rules: {
      1: ['WARNING'],
      2: ['PARENT_CONFERENCE'],
      3: ['COUNSELING']
    }
  },
  {
    key: 'B3',
    category: 'B',
    name: 'Wearing earrings/body piercing (improper)',
    severity: 'MINOR',
    isEscalatable: true,
    rules: {
      1: ['WARNING', 'CONFISCATION'],
      2: ['PARENT_CONFERENCE'],
      3: ['COUNSELING']
    }
  },
  {
    key: 'B4',
    category: 'B',
    name: 'Wearing dangerous accessories (spikes, metal buckles)',
    severity: 'MAJOR',
    isEscalatable: true,
    violationType: 'DIRECT_MAJOR',
    rules: {
      3: ['SUSPENSION']
    }
  },
  {
    key: 'B5',
    category: 'B',
    name: 'Bringing explosive materials',
    severity: 'MAJOR',
    isEscalatable: true,
    violationType: 'DIRECT_MAJOR',
    rules: {
      1: ['CONFISCATION', 'PARENT_NOTIFICATION', 'COUNSELING'],
      2: ['SUSPENSION', 'COUNSELING'],
      3: ['LEGAL_LIABILITY']
    }
  },
  {
    key: 'B6',
    category: 'B',
    name: 'Vandalism',
    severity: 'MODERATE',
    isEscalatable: true,
    rules: {
      1: ['CLEANING_DUTY', 'PARENT_CONFERENCE'],
      2: ['PARENT_CONFERENCE', 'COUNSELING'],
      3: ['EXPULSION', 'NON_ISSUANCE_GOOD_MORAL']
    }
  },
  {
    key: 'B7',
    category: 'B',
    name: 'Spitting anywhere',
    severity: 'MINOR',
    isEscalatable: true,
    rules: {
      1: ['REMINDER'],
      2: ['PARENT_CONFERENCE'],
      3: ['COUNSELING']
    }
  },
  {
    key: 'B8',
    category: 'B',
    name: 'Leaving CR dirty',
    severity: 'MINOR',
    isEscalatable: true,
    rules: {
      1: ['REMINDER'],
      2: ['PARENT_CONFERENCE'],
      3: ['COUNSELING']
    }
  },
  {
    key: 'B9',
    category: 'B',
    name: 'Smoking inside school',
    severity: 'MODERATE',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE', 'REFERRAL_MADAC'],
      2: ['COUNSELING'],
      3: ['SUSPENSION']
    }
  },
  {
    key: 'B10',
    category: 'B',
    name: 'Intentional destruction of school property',
    severity: 'MODERATE',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE', 'PAYMENT_REQUIRED'],
      2: ['SUSPENSION', 'COUNSELING'],
      3: ['DISCIPLINARY_PROBATION']
    }
  },
  {
    key: 'B11',
    category: 'B',
    name: 'Drinking alcohol / entering drunk',
    severity: 'MAJOR',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE', 'COUNSELING'],
      2: ['SUSPENSION', 'COUNSELING'],
      3: ['LEGAL_LIABILITY']
    }
  },
  {
    key: 'B12',
    category: 'B',
    name: 'Drug use or possession',
    severity: 'MAJOR',
    isEscalatable: true,
    rules: {
      1: ['SUSPENSION', 'COUNSELING'],
      2: ['EXPULSION', 'NON_ISSUANCE_GOOD_MORAL'],
      3: ['LEGAL_LIABILITY']
    }
  },
  {
    key: 'B13',
    category: 'B',
    name: 'Gambling',
    severity: 'MODERATE',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE', 'COUNSELING'],
      2: ['SUSPENSION', 'COUNSELING'],
      3: ['DISCIPLINARY_PROBATION']
    }
  },
  {
    key: 'B14',
    category: 'B',
    name: 'Obscene behavior',
    severity: 'MODERATE',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE', 'COUNSELING'],
      2: ['SUSPENSION', 'COUNSELING'],
      3: ['DISCIPLINARY_PROBATION']
    }
  },
  {
    key: 'B15',
    category: 'B',
    name: 'Damaging ID',
    severity: 'MODERATE',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE'],
      2: ['COUNSELING'],
      3: ['SUSPENSION']
    }
  },
  {
    key: 'B16',
    category: 'B',
    name: 'Using another ID',
    severity: 'MAJOR',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE'],
      2: ['COUNSELING'],
      3: ['SUSPENSION']
    }
  },
  {
    key: 'B17',
    category: 'B',
    name: 'Lending ID',
    severity: 'MAJOR',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE'],
      2: ['COUNSELING'],
      3: ['SUSPENSION']
    }
  },
  {
    key: 'B18',
    category: 'B',
    name: 'Failure to return borrowed materials',
    severity: 'MODERATE',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE'],
      2: ['REPLACEMENT_REQUIRED'],
      3: ['SUSPENSION']
    }
  },
  {
    key: 'B19',
    category: 'B',
    name: 'Loss of school property',
    severity: 'MODERATE',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE', 'PAYMENT_REQUIRED'],
      2: ['SUSPENSION', 'COUNSELING'],
      3: ['EXPULSION', 'NON_ISSUANCE_GOOD_MORAL', 'LEGAL_LIABILITY']
    }
  },
  {
    key: 'B20',
    category: 'B',
    name: 'Fraud / falsification of records',
    severity: 'MAJOR',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE'],
      2: ['SUSPENSION'],
      3: ['EXPULSION']
    }
  },
  {
    key: 'B21',
    category: 'B',
    name: 'Forging signature',
    severity: 'MODERATE',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE'],
      2: ['COUNSELING'],
      3: ['SUSPENSION']
    }
  },
  {
    key: 'B22',
    category: 'B',
    name: 'Cheating',
    severity: 'MODERATE',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE'],
      2: ['COUNSELING', 'SUSPENSION'],
      3: ['DISCIPLINARY_PROBATION']
    }
  },
  {
    key: 'B23',
    category: 'B',
    name: 'Bringing obscene materials',
    severity: 'MODERATE',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE'],
      2: ['COUNSELING'],
      3: ['SUSPENSION', 'DISCIPLINARY_PROBATION']
    }
  },
  {
    key: 'B24',
    category: 'B',
    name: 'Creating noise',
    severity: 'MINOR',
    isEscalatable: true,
    rules: {
      1: ['REMINDER'],
      2: ['COUNSELING'],
      3: ['DISCIPLINARY_PROBATION']
    }
  },
  {
    key: 'B25',
    category: 'B',
    name: 'Loitering',
    severity: 'MINOR',
    isEscalatable: true,
    rules: {
      1: ['REMINDER'],
      2: ['COUNSELING'],
      3: ['DISCIPLINARY_PROBATION']
    }
  },
  {
    key: 'B26',
    category: 'B',
    name: 'Throwing garbage',
    severity: 'MINOR',
    isEscalatable: true,
    rules: {
      1: ['REMINDER', 'CLEANING_DUTY'],
      2: ['COUNSELING'],
      3: ['DISCIPLINARY_PROBATION']
    }
  },
  {
    key: 'B27',
    category: 'B',
    name: 'Disrespect',
    severity: 'MINOR',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE'],
      2: ['COUNSELING'],
      3: ['DISCIPLINARY_PROBATION']
    }
  },

  {
    key: 'C1',
    category: 'C',
    name: 'Challenging to fight',
    severity: 'MAJOR',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE'],
      2: ['SUSPENSION', 'COUNSELING'],
      3: ['DISCIPLINARY_PROBATION']
    }
  },
  {
    key: 'C2',
    category: 'C',
    name: 'Bullying',
    severity: 'MAJOR',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE'],
      2: ['SUSPENSION', 'COUNSELING', 'PAYMENT_REQUIRED'],
      3: ['EXPULSION', 'NON_ISSUANCE_GOOD_MORAL', 'LEGAL_LIABILITY']
    }
  },
  {
    key: 'C3',
    category: 'C',
    name: 'Vulgar speech',
    severity: 'MAJOR',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE', 'COUNSELING'],
      2: ['SUSPENSION'],
      3: ['EXPULSION']
    }
  },
  {
    key: 'C4',
    category: 'C',
    name: 'Sexual harassment',
    severity: 'MAJOR',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE', 'COUNSELING', 'PAYMENT_REQUIRED'],
      2: ['SUSPENSION', 'COUNSELING'],
      3: ['EXPULSION', 'LEGAL_LIABILITY']
    }
  },
  {
    key: 'C5',
    category: 'C',
    name: 'Physical harm',
    severity: 'MAJOR',
    isEscalatable: true,
    rules: {
      1: ['PARENT_CONFERENCE'],
      2: ['SUSPENSION'],
      3: ['EXPULSION']
    }
  },

  {
    key: 'D1',
    category: 'D',
    name: 'Unauthorized solicitation',
    severity: 'MINOR',
    isEscalatable: true,
    rules: {
      1: ['REMINDER', 'PARENT_NOTIFICATION'],
      2: ['COUNSELING'],
      3: ['SUSPENSION', 'DISCIPLINARY_PROBATION']
    }
  },
  {
    key: 'D2',
    category: 'D',
    name: 'Misleading parents',
    severity: 'MINOR',
    isEscalatable: true,
    rules: {
      1: ['REMINDER', 'PARENT_NOTIFICATION'],
      2: ['COUNSELING'],
      3: ['SUSPENSION']
    }
  },
  {
    key: 'D3',
    category: 'D',
    name: 'Selling tickets without approval',
    severity: 'MINOR',
    isEscalatable: true,
    rules: {
      1: ['REMINDER', 'PARENT_NOTIFICATION'],
      2: ['COUNSELING'],
      3: ['SUSPENSION']
    }
  },
  {
    key: 'D4',
    category: 'D',
    name: 'Forging signatures for misconduct',
    severity: 'MODERATE',
    isEscalatable: true,
    rules: {
      1: ['COUNSELING'],
      2: ['SUSPENSION'],
      3: ['DISCIPLINARY_PROBATION']
    }
  },
  {
    key: 'D5',
    category: 'D',
    name: 'Using school name for deceit',
    severity: 'MODERATE',
    isEscalatable: true,
    rules: {
      1: ['COUNSELING'],
      2: ['SUSPENSION'],
      3: ['DISCIPLINARY_PROBATION']
    }
  }
];
