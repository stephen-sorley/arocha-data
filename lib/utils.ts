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

import * as dotenv from "dotenv";

let initialized = false;

export const init = () => {
  if (initialized) {
    return;
  }

  const isCloudflareWorker = typeof globalThis !== 'undefined' && 'WebSocketPair' in globalThis;
  if (!isCloudflareWorker) {
    // Not dotenv support in cloudflare workers - but the env variables are already
    // loaded anyway in that case, so it's all good.
    dotenv.config({quiet: true});
  }
  initialized = true;
}

export const fromEnv = (name: string) => {
  const val: string | undefined = process.env[name];
  if (!val) {
    throw new Error(`${name} missing from environemnt, add it to .env?`);
  }
  return val;
};


// Standard data format for a recurring donation subscription record.
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
