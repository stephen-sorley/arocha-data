#!/usr/bin/env node

/**
 * Utility that lists all subscriber data with a particular status.
 * 
 * Options:
 *  Active (default)
 *  Unsubscribed
 *  Bounced
 * 
 * Useful interest names to restrict the output to:
 *  (This list contains all the email list subscribers we've actually sent
 *   campaigns to in the past couple years)
 *  "Master List"
 * 
 *  (Useful interest tracking under Master List:)
 *  "Climate Stewards"       -> CSUSA Newsletter
 *  "Church Partners"        -> Church Partners Newsletter
 *  "Mighty Network Members" -> LYP Monthly Digest
 * 
 * ./cm-list.ts -f -r "Master List" -r "Climate Stewards" -r "Church Partners" -r "Mighty Network Members" > cm-active.jsonc
 */

import { parseArgs } from "node:util";
import { cmGetSubs } from "./lib/utils.ts"

import type { CMSubscriber } from "./lib/utils.ts";

const {values} = parseArgs({
  allowPositionals: false,
  options: {
    help: {type: "boolean", short: "h"},
    state: {type: "string", multiple: true, short: "s"},
    full: {type: "boolean", short: "f"},
    restrict: {type: "string", multiple: true, short: "r"},
  }
});
if (values.help) {
  console.log(`
Usage: ./cm-list.ts > output.json
Options:
  -h, --help      Show this help message

  -s, --state     Specify a state to include: active, unsubscribed, bounced
                    (default: active) (can include multiple times)

  -f, --full      Include segment data in addition to basic list membership
                    (default: off)

  -r, --restrict  Only include lists/segments that match the given name
                    (default: no restriction) (can include multiple times)
` );
  process.exit(1);
}

let states: ("Active" | "Unsubscribed" | "Bounced")[] = [];
if (values.state && values.state.length > 0) {
  states = values.state.map(state => {
    const stateLower = state.toLocaleLowerCase();
    if (stateLower === "active") {
      return "Active";
    }
    if (stateLower === "unsubscribed") {
      return "Unsubscribed";
    }
    if(stateLower === "bounced") {
      return "Bounced";
    }
    console.error(`invalid state "${values.state}", pick one of: {active, unsubscribed, bounced}`);
    process.exit(1);
  })
} else {
  states = ["Active"];
}

let emailToSubsMap: Awaited<ReturnType<typeof cmGetSubs>> | undefined;

const start = performance.now();
await Promise.all(states.map(state =>
  cmGetSubs({
    state: state,
    includeSegments: !!values.full,
    restrict: values.restrict
  }).then(map => {

    if (!emailToSubsMap) {
      emailToSubsMap = map;
    } else {
      //Merge into existing map, if we're processing more than one state.
      for (const [email, data] of map) {
        const arr = emailToSubsMap.get(email) ?? [];
        if (arr.length === 0) {
          emailToSubsMap.set(email, arr);
        }
        arr.push(...data);
      }
    }
  })
));
if (!emailToSubsMap) {
  console.error("Error - no map found, something went wrong.");
  process.exit(1);
} else {
  console.error(`\nFound ${emailToSubsMap?.size} CM subscribers in ${(performance.now() - start)/1000}s`);
}

type Subscription = {
  id: string,
  name: string,
  joinedAs: string,
  joinedOn: string,
}
type Subscriber = {
  email: string,
  subs: Subscription[],
}

const getName = (sub: CMSubscriber) => {
  let name = sub.Name;
  if (sub.CustomFields) {
    let first : string | undefined, last : string | undefined;
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
        name = (first || "[Not Provided]") + " " + (last || "[Not Provided]");
      }
    } else if (first && last && name.length < first.length + last.length + 1) {
      name = first + " " + last;
    } else if (!first && last && !name.trim().includes(" ")) {
      name = name.trim() + " " + last;
    }
  }
  return name || "[Not Provided]";
};

const subscribers: Subscriber[] = [];
for (const [email, subs] of emailToSubsMap) {
  const subscriptions = subs.map(sub => ({
    id: sub.interest.id,
    name: sub.interest.name,
    joinedAs: sub.sub.Name || "[Not Provided]",
    joinedOn: sub.sub.ListJoinedDate
  }));

  subscribers.push({
    email: email,
    subs: subscriptions,
  });
}

console.log(JSON.stringify(subscribers.sort(({email: a},{email: b}) => a.localeCompare(b)), null, 2));
