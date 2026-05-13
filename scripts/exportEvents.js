#!/usr/bin/env node

// simple utility to materialize the current events array as JSON
// so that external systems (or the scraping process described by the
// user) can easily consume the full set of training data without
// having to parse TypeScript.

// install ts-node/register to allow importing TS modules with path aliases
import "ts-node/register";
import fs from "fs";
import path from "path";

// we need to load the compiled JS version; easiest is to use
// ts-node or run via node --loader ts-node/esm, but we can also
// require the .ts file by transpiling on the fly. For simplicity
// we'll use dynamic import with ts-node/register-like approach.

// since this repo already uses ES modules, we'll just import directly
// from the TS source. Node 18+ can handle this with `--experimental-specifier-resolution=node`

async function main() {
  const eventsModule = await import(path.resolve("src/data/events.ts"));
  const events = eventsModule.events;
  const dest = path.resolve("src/data/events.export.json");
  fs.writeFileSync(dest, JSON.stringify(events, null, 2));
  console.log(`wrote ${events.length} events to ${dest}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
