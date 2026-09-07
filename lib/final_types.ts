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

export type Address = {
  street?: string,
  city?: string,
  state?: string,
  zip?: string,
  country?: string,
  type?: "home" | "work" | "alt",
};

export type Organization = {
  id: string,
  name: string,
  primaryContact?: Individual["id"],
  address?: Address,
  phone?: string,
  website?: string,
  type?: "church" | "nonprofit" | "foundation" | "corporate" | "school" | "government" | "daf",
  created: string, //ISO timestamp
  description?: string,
};

export type Household = {
  id: string,
  name: string,
  primaryContact: Individual["id"],
  created: string, //ISO timestamp
};

export type Affiliation = {
  id: string,
  person: Individual["id"],
  org: Organization["id"],
  status: "current" | "former",
  role?: string,
  started?: string, //ISO timestamp
  ended?: string,  //ISO timestamp
}

export type Individual = {
  id: string,
  salutation?: string,
  firstName?: string,
  lastName?: string,
  title?: string,
  parent?: Household["id"] | Organization["id"],
  primaryAffiliation?: Organization["id"], //aka "employer"
  primaryAddress?: Address,
  secondaryAddress?: Address,
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
    preferred?: "home" | "mobile" | "work" | "alt",
  },
  doNotCall?: boolean,
  doNotMail?: boolean,
  created: string, //ISO timestamp
  description?: string,
};


export type Fund = {
  id: string,
  name: string,
};

export type Gift = {
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

export type SoftCredit = {
  id: string,
  amount: number,
  gift: Gift["id"],
  donor: Individual["id"],
  type: "daf" | "match" | "other",
}

export type Commitment = {
  id: string,
  amount: number,
  intervalMonths: 1 | 3 | 12,
  since: string, //ISO timestamp
  donor: Individual["id"] | Organization["id"],
  processor?: "stripe" | "paypal" | "cnp",
  reference?: string,
}

export type MarketingSubscription = {
  subscriber: Individual["id"],
  /**
   * ARUSA: main newsletter, every contact will have this
   * CSUSA: climate stewards
   * LYP: LoveYourPlace (Mighty Networks Memebers)
   * CP: Church Partners
   */
  interest: "ARUSA" | "CSUSA" | "LYP" | "CP",
  email: string,
  joined: string, //ISO timestamp
  status: "subscribed" | "unsubscribed",
}