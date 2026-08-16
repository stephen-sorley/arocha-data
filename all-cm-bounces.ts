#!/usr/bin/env node

import { cmGetSubs } from "./lib/utils.ts"

const start = performance.now();
const emailToSubsMap = await cmGetSubs("Bounced");
console.error(`\nRetreived ${emailToSubsMap.size} bounced CM subscribers in ${(performance.now() - start)/1000}s`);

console.log(JSON.stringify([...emailToSubsMap.keys()].sort(), null, 2));
