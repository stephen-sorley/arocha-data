/**
 * What counts as a billable contact in various CRM's?
 * 
 * Virtuous: (cheaper)
 *  - Organization: 1 contact
 *  - Household: 1 contact
 *  - Individuals within households or organizations are free
 *
 * Bloomerang: (more expensive)
 *  - Organization: 1 contact
 *  - Individuals within organization: 1 contact per individual
 *  - Household: 1 contact
 *  - Individuals within households are free
 */

type Address = {
  line1?: string,
  line2?: string,
  city?: string,
  state?: string,
  zip?: string,
  country?: string,
};

type Organization = {
  id: string,
  primaryContact?: Individual["id"],
  address?: Address,
  phone?: string,
  website?: string,
  type: "church" | "nonprofit" | "foundation" | "corporate" | "school" | "government" | "daf",
  created: string, //ISO timestamp
  description?: string,
};

type Household = {
  id: string,
  name: string,
  primaryContact: Individual["id"],
  created: string, //ISO timestamp
};

type Affiliation = {
  id: string,
  person: Individual["id"],
  org: Organization["id"],
  status: "current" | "former",
  role?: string,
  started?: string, //ISO timestamp
  ended?: string,  //ISO timestamp
}

type Individual = {
  id: string,
  parent?: Household["id"] | Organization["id"],
  primaryAffiliation?: Organization["id"], //aka "employer"
  address: {
    home?: Address,
    work?: Address,
    alt?: Address,
    preferred?: "home" | "work" | "alt",
  },
  email: {
    home?: string,
    work?: string,
    alt?: string,
    preferred?: "home" | "work" | "alt",
  },
  phone: {
    home?: string,
    mobile?: string,
    work?: string,
    alt?: string,
    preferred?: "home" | "work" | "alt",
  },
  doNotCall?: boolean,
  doNotMail?: boolean,
  created: string, //ISO timestamp
  description?: string,
};


type Fund = {
  id: string,
  name: string,
};

type Gift = {
  id: string,
  donor: Individual["id"] | Organization["id"];
  giveDate: string, //ISO timestamp
  gross: number,
  fee: number,
  donorFeeCover: number,
  refunded: boolean,

  designation1: {
    fund: Fund["id"],
    amount: number,
  }
  designation2: {
    fund: Fund["id"],
    amount: number,
  }

  method?: "card" | "ach" | "paypal" | "cash" | "check",
  processor?: "stripe" | "paypal" | "cnp",
  reference?: string, // check number, charge unique ID, etc
}

type SoftCredit = {
  id: string,
  amount: number,
  gift: Gift["id"],
  donor: Individual["id"],
  type: "daf" | "match" | "other",
}

type Commitment = {
  id: string,
  amount: number,
  intervalMonths: 1 | 3 | 12,
  since: string, //ISO timestamp
  donor: Individual["id"] | Organization["id"],
  processor?: "stripe" | "paypal" | "cnp",
  reference?: string,
}

type MarketingSubscription = {
  subscriber: Individual["id"],
  /**
   * ARUSA: main newsletter, every contact will have this
   * CSUSA: climate stewards
   * LYP: LoveYourPlace (Might Networks Memebers)
   * CP: Church Partners
   */
  interest: "ARUSA" | "CSUSA" | "LYP" | "CP",
  email: string,
  joined: string, //ISO timestamp
  status: "subscribed" | "unsubscribed",
}