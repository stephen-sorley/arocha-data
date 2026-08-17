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
      // Try to fix up names before returning the data.
      for (const sub of page.Results as CMSubscriber[]) {
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
        const normEmail = sub.EmailAddress.toLocaleLowerCase();
        const arr = emailToSubsMap.get(normEmail) ?? [];
        if (arr.length === 0) {
          emailToSubsMap.set(normEmail, arr);
        }

        arr.push({
          interest: interest,
          sub: sub
        });
      }
    }));
  })).then(() => emailToSubsMap);
}