#!/usr/bin/env node

import { parseArgs } from "node:util";
import { emailHash } from "./lib/email.ts";

const {positionals} = parseArgs({allowPositionals: true});

for (const str of positionals) {
  console.log(`${str}: ${emailHash(str)}`);
}