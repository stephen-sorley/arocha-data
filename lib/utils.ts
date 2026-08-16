import * as dotenv from "dotenv";
import Stripe from "stripe";
import { setTimeout } from 'node:timers/promises';
import { Connection } from "jsforce";

/** Where to get API keys (stick in a file in project root named .env):
 * 
 * # Stripe: https://dashboard.stripe.com/acct_1EwwrmKnX7EKttkA/apikeys
 * STRIPE_KEY= Restricted Keys -> "Legacy Subscription Manager" -> Token
 * 
 * # Salesforce: https://arochausa.my.salesforce.com/ecapp/externalClientAppManageConsumer.apexp?ecAppId=0xIVI0000000Wsj&retURL=https%3A%2F%2Farochausa.my.salesforce-setup.com%2Faura%3Fr%3D77%26ui-identity-components-aura-controllers.ExternalClientAppDetail.getAllApexClasses%3D1%26ui-identity-components-aura-controllers.ExternalClientAppDetail.getAllCustomAttributes%3D1%26ui-identity-components-aura-controllers.ExternalClientAppDetail.getAllOAuthCustomScopes%3D1%26ui-identity-components-aura-controllers.ExternalClientAppDetail.getAllPermissionSets%3D1%26ui-identity-components-aura-controllers.ExternalClientAppDetail.getAllProfiles%3D1%26ui-identity-components-aura-controllers.ExternalClientAppDetail.getExternalClientApp%3D1%26ui-identity-components-aura-controllers.ExternalClientAppDetail.getLogoUrl%3D1%26ui-identity-components-aura-controllers.ExternalClientAppDetail.getStandardUsers%3D1
 * SF_ID= Consumer Key
 * SF_KEY= Consumer Secret
 * 
 * # Campaign Monitor: https://arochaus.createsend.com/account/apiandintegrations
 * CM_ID= API Client ID
 * CM_KEY= API Key
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




// -----------------------------------
// Stripe

export type StripeConnection = ReturnType<typeof connectStripe>;

export const connectStripe = () => {
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




// -----------------------------------
// Salesforce

export type SalesforceConnection = Awaited<ReturnType<typeof connectSalesforce>>;

export const connectSalesforce = async () => {
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

export const sfEmailsToContacts = async (sf: SalesforceConnection, emails: string[]) => {
  const sfChunk = 50;
  const uniqueEmails = [...new Set(emails.filter(email => !!email))];
 
  const fields = [
    "Email",
    "npe01__HomeEmail__c",
    "npe01__WorkEmail__c",
    "npe01__AlternateEmail__c"
  ];

  const emailToContactMap = new Map<string,string>();

  for (let i = 0; i < uniqueEmails.length; i += sfChunk) {
    // Query SF for contacts that have the given emails.
    const emailStr = uniqueEmails.slice(i, i + sfChunk).map(email => `'${email}'`).join(",");
    const soql = `
      SELECT Id, ${fields.join(", ")}
      FROM Contact
      WHERE ${fields.map(field => field + " IN " + emailStr).join(" OR ")}
      LIMIT 2000
    `;
    console.log(soql); //DEBUG_161
    const res = await sf.query(soql);

    // Build mapping from emails to Salesforce contacts.
    res.records.forEach(record => {
      for(const field of fields) {
        if (record[field] && record.Id) {
          emailToContactMap.set(record[field].toLocaleLowerCase(), record.Id);
        }
      }
    });
  }

  return emails.map(email =>
    (email && emailToContactMap.get(email.toLocaleLowerCase())) || "UNKNOWN"
  );
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
  Name: string,
  [key: string]: unknown
};
export const cmGetAllLists = async () => {
  initCM();

  const url = new URL(`${CM_BASE_URL}/clients/${CM_ID}/lists.json`);
  console.error(`Fetching url: ${url}\nWith headers: ${JSON.stringify(CM_HEADERS)}`);

  const resp = await fetch(url, {
    method: 'GET',
    headers: CM_HEADERS
  });
  
  if (!resp.ok) throw new Error(`Failed to fetch CM mailing lists: ${resp.status}`);
  return (await resp.json()) as CMList[]; // Returns array of lists containing ListID
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
  "ConsentToSendSms"?: "Yes" | "No"
  [key: string]: unknown
};
export const cmGetActiveSubsForList = async (listId: string) => {
  initCM();

  const url = new URL(`${CM_BASE_URL}/lists/${listId}/active.json`);

  const subs: CMSubscriber[] = [];
  let page = 0;
  let npages;
  do {
    page++;
    url.search = new URLSearchParams({page: String(page)}).toString();
    const resp = await fetch(url, {
      method: 'GET',
      headers: CM_HEADERS
    });

    if (!resp.ok) throw new Error(`Failed to fetch CM mailing lists: ${resp.status}`);

    const data = (await resp.json()) as any;

    subs.push(...(data.Results));
    npages = data.NumberOfPages || 1;
  } while(page < npages);

  return subs;
}

type CMSubInfo = {
  list: CMList;
  sub: CMSubscriber;
};
export const cmGetActiveSubs = async () => {
  const emailToSubsMap = new Map<string, CMSubInfo[]>;
  
  // Get all mailing lists.
  const lists = await cmGetAllLists();

  // Get active subs from each mailing list, concurrently.
  const subsPerList = await Promise.all(lists.map(async (list) => {
    const subs = await cmGetActiveSubsForList(list.ListID);
    
    // Add each record to subscriber's list of subscriptions.
    for(const sub of subs) {
      const arr = emailToSubsMap.get(sub.EmailAddress) ?? [];
      if (arr.length == 0) {
        emailToSubsMap.set(sub.EmailAddress, arr);
      }
      
      arr.push({
        list: list,
        sub: sub
      });
    }
  }));

  return emailToSubsMap;
}