import * as dotenv from "dotenv";
import crypto from "node:crypto";
import { setTimeout } from 'node:timers/promises';

import Stripe from "stripe";
import {
  Client,
  Environment,
  SubscriptionsController
} from '@paypal/paypal-server-sdk';
import { Connection } from "jsforce";

import des from "../designation-override.json" with {type: "json"};

/** Where to get API keys (stick in a file in project root named .env):
 * 
 * # Stripe: https://dashboard.stripe.com/acct_1EwwrmKnX7EKttkA/apikeys
 * STRIPE_KEY= Restricted Keys -> "Legacy Subscription Manager" -> Token
 * 
 * # PayPal: https://developer.paypal.com/dashboard/applications/live
 * PAYPAL_ID= "Legacy Subscriptions" -> Client ID
 * PAYPAL_KEY= "Legacy Subscriptions" -> Secret Key 1
 * 
 * # Salesforce: https://arochausa.my.salesforce.com/ecapp/externalClientAppManageConsumer.apexp?ecAppId=0xIVI0000000Wsj&retURL=https%3A%2F%2Farochausa.my.salesforce-setup.com%2Faura%3Fr%3D77%26ui-identity-components-aura-controllers.ExternalClientAppDetail.getAllApexClasses%3D1%26ui-identity-components-aura-controllers.ExternalClientAppDetail.getAllCustomAttributes%3D1%26ui-identity-components-aura-controllers.ExternalClientAppDetail.getAllOAuthCustomScopes%3D1%26ui-identity-components-aura-controllers.ExternalClientAppDetail.getAllPermissionSets%3D1%26ui-identity-components-aura-controllers.ExternalClientAppDetail.getAllProfiles%3D1%26ui-identity-components-aura-controllers.ExternalClientAppDetail.getExternalClientApp%3D1%26ui-identity-components-aura-controllers.ExternalClientAppDetail.getLogoUrl%3D1%26ui-identity-components-aura-controllers.ExternalClientAppDetail.getStandardUsers%3D1
 * SF_ID= Consumer Key
 * SF_KEY= Consumer Secret
 * 
 * # Campaign Monitor: https://arochaus.createsend.com/account/apiandintegrations
 * CM_ID= API Client ID
 * CM_KEY= API Key
 * 
 * # A Rocha Email Key: finance bitwarden => search for "email key"
 * EMAIL_KEY= 
 */

let initialized = false;

const init = () => {
  if (initialized) {
    return;
  }

  dotenv.config({quiet: true});
  initialized = true;
}

const fromEnv = (name: string) => {
  const val: string | undefined = process.env[name];
  if (!val) {
    throw new Error(`${name} missing from environemnt, add it to .env?`);
  }
  return val;
};


export type RecurringSub = {
  id: string, // processor subscription ID: "sub_" for stripe, "I-" for paypal
  since: string, // ISO time string
  lead: "GiveWP" | "LYP" | "CnP",
  email?: string,
  designation: string, //match salesforce campaign names
  firstName?: string,
  lastName?: string,
  amount: number,
  frequency: "Month" | "Quarter" | "Year",
}


// -----------------------------------
// Email encryption/decryption for URL's

let EMAIL_KEY: Buffer<ArrayBuffer> | undefined;

const initEmail = () => {
  init();
  if (!EMAIL_KEY) {
    EMAIL_KEY = Buffer.from(fromEnv("EMAIL_KEY"));
  }
}

export const emailNorm = (email?: string) => {
  return email?.trim().toLowerCase();
}

export const emailEncrypt = (email?: string) => {
  initEmail();
  const nemail = emailNorm(email);
  if (!nemail || !EMAIL_KEY) {
    return undefined;
  }
  const enc = crypto.createCipheriv("aes-128-ecb", EMAIL_KEY, null);
  return enc.update(nemail, "utf8", "base64url") + enc.final("base64url");
}

export const emailDecrypt = (encEmail?: string) => {
  initEmail();
  if (!encEmail || !EMAIL_KEY) {
    return undefined;
  }
  const dec = crypto.createDecipheriv("aes-128-ecb", EMAIL_KEY, null)
  return dec.update(encEmail, 'base64url', "utf8") + dec.final("utf8");
}


// -----------------------------------
// PayPal

export type PaypalConnection = ReturnType<typeof paypalConnect>;

export const paypalConnect = () => {
  init();

  return new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: fromEnv("PAYPAL_ID"),
      oAuthClientSecret: fromEnv("PAYPAL_KEY"),
    },
    timeout: 0,
    environment: Environment.Production,
  });
}

export const paypalCondensedSubs = async (paypal: PaypalConnection) => {
  const pps = new SubscriptionsController(paypal);
  const CHUNK = 20;

  const subIds: NonNullable<Awaited<ReturnType<typeof pps.listSubscriptions>>["result"]["subscriptions"]> = [];
  let page = 1;
  while (true) {
    const resp = (await pps.listSubscriptions({
      pageSize: CHUNK,
      page: page,
      statuses: "ACTIVE"
    })).result.subscriptions;

    if (resp) {
      subIds.push(...resp);
    }
    if (!resp || resp.length < CHUNK) {
      break;
    }
  }

  const subs: RecurringSub[] = [];

  for (let i=0; i<subIds?.length; i+=CHUNK) {
    await Promise.all(subIds.slice(i, i+CHUNK).map(({id}) => {
      if (id) {
        return pps.getSubscription({id: id, fields: "plan,product"}).then(({result: sub}) => {
          const plan = sub.plan?.billingCycles?.[0];
          if (!sub.id || !sub.startTime || !plan) {
            return;
          }

          let freq: "Month" | "Quarter" | "Year" | undefined;
          const unit = plan.frequency.intervalUnit.toLocaleUpperCase();
          const count = plan.frequency.intervalCount;
          if (unit === "MONTH") {
            if (count === 1) {
              freq = "Month";
            } else if (count === 3) {
              freq = "Quarter";
            } else if (count === 12) {
              freq = "Year";
            }
          } else if (unit === "YEAR" && count === 1) {
            freq = "Year";
          }
          if (!freq) {
            throw new Error(`${sub.id}: unknown frequency (${count}, ${unit})`);
          }

          subs.push({
            id: sub.id,
            since: sub.startTime,
            lead: "GiveWP",
            email: sub.subscriber?.emailAddress,
            designation: (des as any)[sub.id] ?? "UNKNOWN",
            firstName: sub.subscriber?.name?.givenName,
            lastName: sub.subscriber?.name?.surname,
            amount: Number(plan.pricingScheme?.fixedPrice?.value),
            frequency: freq,
          });
        });
      }
    }));
  }

  return subs;
}




// -----------------------------------
// Stripe

export type StripeConnection = ReturnType<typeof stripeConnect>;

export const stripeConnect = () => {
  // API keys here: https://dashboard.stripe.com/acct_1EwwrmKnX7EKttkA/apikeys
  init();

  return new Stripe(fromEnv("STRIPE_KEY"), {
    telemetry: false,
  });
}

export const stripeGetSubs = async (stripe: StripeConnection, ids: string[], params?: Stripe.SubscriptionRetrieveParams) => {
  const CHUNK = 12;
  const subs: Stripe.Subscription[] = [];

  for (let i=0; i<ids.length; i+=CHUNK) {
    if (i > 0) {
      await setTimeout(100);
    }
    const temp = await(Promise.all(ids.slice(i,i+CHUNK).map(id =>
      stripe.subscriptions.retrieve(id, params)
    )));
    subs.push(...temp);
  }

  return subs;
};

export const stripeCondenseSub = (sub: Stripe.Subscription) : RecurringSub => {
  const customer = sub.customer as Stripe.Customer;
  const plan = sub.items.data[0].plan;

  // Figure out designation.
  let designation: string | undefined;

  const prodName = (sub.items.data[0].price.product as Stripe.Product)?.name;
  const desTo = sub.metadata?.["Designate to"] || sub.metadata?.["Designated to"];
  const intlProj = sub.metadata?.["International Projects"];
  const usProj = sub.metadata?.["US Projects"];
  const other = sub.metadata?.["Other Designation"];
  const all = [designation, prodName, desTo, intlProj, usProj, other];

  const checkAll = (name: string) => all.some(des => {
    return des && des.toLocaleLowerCase().includes(name.toLocaleLowerCase());
  });

  const usNames = [
    "Brown",
    "Chuang",
    "Guthrie",
    "Henderson",
    "Huska",
    "Lamb",
    "Michalski",
    "Sluka",
    "Walton",
  ];
  for (const name of usNames) {
    if (checkAll(name)) {
      designation = `USA-(${name})`;
      break;
    }
  }

  const canadaNames = [
    "Anderson",
    "Faw",
    "Kostamo",
    "Richmond"
  ];
  for (const name of canadaNames) {
    if (checkAll(name)) {
      designation = `Canada-${name}`;
      break;
    }
  }

  if (!designation && checkAll("Social Media and Content Coordinator")) {
    designation = "Social Media and Content Coordinator (Autumn Ayers)";
  }

  if (!designation && checkAll("Global Conservation Fund")) {
    designation = "Global Conservation Fund(GCF)-ARI";
  }

  if (!designation && checkAll("Costa Rica")) {
    designation = "Casa Adobe/Costa Rica";
  }

  if (!designation && checkAll("Church Engagement")) {
    designation = "USA-Church Engagement";
  }
  if (!designation && checkAll("Conservation Internships")) {
    designation = "USA-Conservation Interns";
  }
  if (!designation && checkAll("Florida Conservation Project")) {
    designation = "USA-Florida Conservation Project";
  }
  if (!designation && checkAll("Tennessee Conservation Project")) {
    designation = "USA-Tennessee Conservation Project";
  }
  if (!designation && checkAll("Texas Conservation Project")) {
    designation = "USA-Texas Conservation Project";
  }

  if (!designation) {
    const exactNames = [
      "Climate Stewards",
      "Canada",
      "Kenya"
    ];
    for (const name of exactNames) {
      if (checkAll(name)) {
        designation = name;
        break;
      }
    }
  }

  if (!designation && checkAll("International")) {
    designation = "ARI";
  }

  if (!designation) {
    designation = "USA";
  }

  let frequency: RecurringSub["frequency"] | undefined;
  if (plan.interval === "month") {
    if (plan.interval_count === 1) {
      frequency = "Month";
    } else if (plan.interval_count === 3) {
      frequency = "Quarter";
    }
  } else if (plan.interval === "year" && plan.interval_count === 1) {
    frequency = "Year";
  }
  if (!frequency) {
    throw new Error(`${sub.id}: unsupported recurring frequency: every ${plan.interval_count} ${plan.interval}`);
  }
  
  let firstName = customer.metadata?.first_name?.trim() || customer.name?.split(" ")[0];
  let lastName = customer.metadata?.last_name?.trim() || customer.name?.split(" ").slice(1).join(" ");

  if (!customer.email) {
    throw new Error(`${sub.id}: missing customer email`);
  }

  return {
    id: sub.id,
    since: Temporal.Instant.fromEpochMilliseconds(sub.created*1000).toString(),
    lead: customer.description?.includes("GiveWP")? "GiveWP" : "LYP",
    email: emailNorm(customer.email),
    designation: designation,
    firstName: firstName,
    lastName: lastName,
    amount: (plan.amount ?? NaN) / 100,
    frequency: frequency,
  }
}




// -----------------------------------
// Salesforce

export type SalesforceConnection = Awaited<ReturnType<typeof sfConnect>>;

export const sfConnect = async () => {
  init();

  const sf = new Connection({
    loginUrl: 'https://arochausa.my.salesforce.com',
    oauth2: {
      clientId: fromEnv("SF_ID"),
      clientSecret: fromEnv("SF_KEY"),
    },
    refreshFn: async (connection, callback) => {
      try {
        await connection.authorize({ grant_type: 'client_credentials' });
        callback(null, connection.accessToken || undefined);
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));;
      }
    }
  });
  await sf.authorize({ grant_type: 'client_credentials' });

  return sf;
}

export type SfContactRecord = {
  id: string,
  first?: string,
  last?: string,
  emails: string[],
}

export const sfEmailFields = [
  "npe01__HomeEmail__c",
  "npe01__WorkEmail__c",
  "npe01__AlternateEmail__c"
];

export const sfEmailsToContacts = async (sf: SalesforceConnection, emails: string[]) => {
  const sfChunk = 50;
  const normEmails = emails.map(email => emailNorm(email));
  const uniqueEmails = [...new Set(normEmails.filter(email => !!email))];
 
  const emailToContactMap = new Map<string, SfContactRecord>();

  for (let i = 0; i < uniqueEmails.length; i += sfChunk) {
    // Query SF for contacts that have the given emails.
    const emailStr = "(" + uniqueEmails.slice(i, i + sfChunk).map(email => `'${email}'`).join(",") + ")";
    const soql = `
      SELECT Id, ${sfEmailFields.join(", ")}, FirstName, LastName
      FROM Contact
      WHERE ${sfEmailFields.map(efield => efield + " IN " + emailStr).join(" OR ")}
      LIMIT 2000
    `;
    const res = await sf.query(soql);

    // Build mapping from emails to Salesforce contacts.
    res.records.forEach(record => {
      for(const efield of sfEmailFields) {
        const nemail = emailNorm(record[efield]);
        if (nemail && record.Id) {
          emailToContactMap.set(nemail, {
            id: record.Id,
            first: record.FirstName,
            last: record.LastName,
            emails: sfEmailFields.map(efield => emailNorm(record[efield])).filter(nemail => !!nemail) as string[],
          });
        }
      }
    });
  }

  return normEmails.map(nemail => emailToContactMap.get(nemail || ""));
}



// -----------------------------------
// Campaign Monitor

let CM_ID = "";
let CM_HEADERS: Record<string,string> = {};
const CM_BASE_URL = "https://api.createsend.com/api/v3.3";

const initCM = () => {
  init();
  if (!CM_ID) {
    CM_ID = fromEnv("CM_ID");
    CM_HEADERS = {
      'Authorization': `Basic ${Buffer.from(fromEnv("CM_KEY")+":").toString("base64")}`,
      'Content-Type': 'application/json'
    };
  }
}

export type CMList = {
  ListID: string,
  Name: string
};
export const cmGetLists = async () => {
  initCM();

  const url = new URL(`${CM_BASE_URL}/clients/${CM_ID}/lists.json`);

  const resp = await fetch(url, {
    method: "GET",
    headers: CM_HEADERS
  });
  
  if (!resp.ok) {
    throw new Error(`Failed to fetch CM mailing lists: ${resp.status}`);
  }
  return resp.json() as Promise<CMList[]>;
}

export type CMSegment = {
  ListID: string,
  SegmentID: string,
  Title: string
}
export const cmGetSegmentsForList = async (listId: string) => {
  initCM();

  const url = new URL(`${CM_BASE_URL}/lists/${listId}/segments.json`);

  const resp = await fetch(url, {
    method: "GET",
    headers: CM_HEADERS,
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch segments for CM list ${listId}: ${resp.status}`);
  }
  return resp.json() as Promise<CMSegment[]>;
}

export type CMSubscriber = {
  "EmailAddress": string,
  "Name"?: string,
  "MobileNumber"?: string,
  "ListJoinedDate": string,
  "Date": string,
  "State": "Active" | "Unconfirmed" | "Unsubscribed" | "Bounced" | "Deleted",
  "CustomFields"?: [ { "Key": string, "Value": string } ],
  "ReadsEmailWith"?: string,
  "ConsentToTrack"?: "Yes" | "No",
  "ConsentToSendSms"?: "Yes" | "No",
};
const getSubsHelper = async (path: string, msg: string) => {
  const url = new URL(path);
  const getPage = async (page: number) => {
    url.search = new URLSearchParams({page: String(page)}).toString();
    const resp = await fetch(url, {
      method: 'GET',
      headers: CM_HEADERS
    });
    if (!resp.ok) {
      throw new Error(`${msg}: ${resp.status}`);
    }
    return (resp.json() as Promise<any>).then(page => {
      for (const sub of page.Results as CMSubscriber[]) {
        // Normalize emails before returning the data.
        sub.EmailAddress = emailNorm(sub.EmailAddress) as string;

        // Try to fix up names before returning the data.
        let name = sub.Name;
        if (sub.CustomFields) {
          let first: string | undefined;
          let last: string | undefined;
          for (const {Key, Value} of sub.CustomFields) {
            if (Key === "[FirstName1]") {
              first = Value;
            }
            if (Key === "[LastName1]") {
              last = Value;
            }
          }
          if (!name || name.includes("[Not Provided]")) {
            if (first || last) {
              name = (first||"") + " " + (last||"");
            }
          } else if (first && last && name.length < first.length + last.length + 1) {
            name = first + " " + last;
          } else if (!first && last && !name.trim().includes(" ")) {
            name = name.trim() + " " + last;
          }
        }
        sub.Name = name?.trim();
      }
      return page;
    });
  };

  return getPage(1).then(page => {
    const subs: CMSubscriber[] = page.Results;

    if (page.NumberOfPages > 1) {
      const pagePromises: Promise<any>[] = [];
      for (let i=2; i<=page.NumberOfPages; i++) {
        pagePromises.push(getPage(i));
      }

      return Promise.all(pagePromises).then((data) => {
        const subArrays = data.map(arr => arr.Results as CMSubscriber[]).flat();
        return [...subs, ...subArrays];
      });
    }
    return subs;
  });
}

export const cmGetSubsForList = async (listId: string, state: CMSubscriber["State"] = "Active") => {
  initCM();
  return getSubsHelper(
    `${CM_BASE_URL}/lists/${listId}/${state.toLocaleLowerCase()}.json`,
    `Failed to fetch ${state.toLocaleLowerCase()} subscriptions for CM list ${listId}`
  );
}

export const cmGetSubsForSegment = async (segId: string, state: CMSubscriber["State"] = "Active") => {
  initCM();
  return getSubsHelper(
    `${CM_BASE_URL}/segments/${segId}/${state.toLocaleLowerCase()}.json`,
    `Failed to fetch ${state.toLocaleLowerCase()} subscriptions for CM segment ${segId}`
  );
}

type CMInterest = {
  id: string,
  name: string,
  type: "list" | "segment",
}
type CMSubInfo = {
  interest: CMInterest,
  sub: CMSubscriber,
};
type CMGetSubsParams = {
  /**
   * What subscriber state to query.
   * @default "Active"
   */
  state?: CMSubscriber["State"],
  /**
   * Include data on segments?
   * @default false
   */
  includeSegments?: boolean,
  /**
   * If provided, will restrict the query to lists and segments that
   * match one of the names in the list. Not case-sensitive.
   * 
   * @default no restrictions, query everything
   */
  restrict?: string[],
};
export const cmGetSubs = async (params?: CMGetSubsParams) => {
  // Set defaults for arguments.
  params ??= {};
  params.state ??= "Active";
  params.includeSegments ??= false;

  let restrictSet: Set<string> | undefined;
  if (params.restrict && params.restrict.length > 0) {
    restrictSet = new Set<string>();
    for (const name of params.restrict) {
      restrictSet.add(name.trim().toLocaleLowerCase());
    }
  }

  const emailToSubsMap = new Map<string, CMSubInfo[]>;

  // Get all mailing lists.
  const lists = (await cmGetLists()).map(list => ({
    id: list.ListID,
    name: list.Name,
    type: "list"
  } as CMInterest));

  return Promise.all(lists.map(async list => {
    // The list itself is always an interest.
    let interests = [list];

    // Get segments for list, add to the list of interests to check.
    // Note: only active subscribers can be retreived from segment records.
    if (params.includeSegments && params.state === "Active") {
      const segs = (await cmGetSegmentsForList(list.id)).map(seg => ({
        id: seg.SegmentID,
        name: seg.Title,
        type: "segment"
      } as CMInterest));
      interests.push(...segs);
    }

    if (restrictSet) {
      interests = interests.filter(
        interest => restrictSet.has(interest.name.trim().toLocaleLowerCase())
      );
    }

    // Retrieve subscribers for each interest concurrently, and
    // add them to the subscriber info map.
    return Promise.all(interests.map(async (interest, idx) => {
      const subs = await (idx === 0 ?
        cmGetSubsForList(interest.id, params.state)
        :
        cmGetSubsForSegment(interest.id, params.state)
      );
      // Add each record to subscriber's list of subscriptions.
      for (const sub of subs) {
        const nemail = emailNorm(sub.EmailAddress) as string;
        const arr = emailToSubsMap.get(nemail) ?? [];
        if (arr.length === 0) {
          emailToSubsMap.set(nemail, arr);
        }

        arr.push({
          interest: interest,
          sub: sub
        });
      }
    }));
  })).then(() => emailToSubsMap);
}