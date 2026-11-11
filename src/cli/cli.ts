import { Command, InvalidArgumentError } from "commander";
import { listProfiles } from "../core/config.js";
import { maskError, toJson } from "../core/json.js";
import { find, findOne, count, aggregate, distinct, listCollections, collStats, parseDocument, DEFAULT_LIMIT, MAX_LIMIT } from "../core/read.js";

function print(value: unknown): void {
  process.stdout.write(`${toJson(value)}\n`);
}

function addProfile(command: Command): Command {
  return command.requiredOption("--profile <profile>");
}

function addProfileAndCollection(command: Command): Command {
  return addProfile(command).requiredOption("-c, --collection <collection>");
}

function integer(value: string): number {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed)) throw new InvalidArgumentError("expected a nonnegative integer");
  return parsed;
}

function addLimit(command: Command): Command {
  return command.option("--limit <n>", `result limit (1–${MAX_LIMIT}, default ${DEFAULT_LIMIT})`, integer);
}

function addQueryOptions(command: Command): Command {
  return command
    .option("-q, --query <json>", "query JSON", "{}")
    .option("--sort <json>")
    .option("--projection <json>");
}

function readOptions(options: Record<string, unknown>) {
  return {
    limit: options.limit as number | undefined,
    skip: options.skip as number | undefined,
    sort: options.sort ? parseDocument(options.sort) : undefined,
    projection: options.projection ? parseDocument(options.projection) : undefined,
  };
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = new Command();
  program.name("mongo-readonly-mcp").description("Read-only access to named MongoDB connections").showHelpAfterError();

  program.command("serve").description("start the MCP stdio server").action(async () => {
    const { startServer } = await import("../mcp/server.js");
    await startServer();
  });
  program.command("profiles").description("list configured hosts, ports, and databases").action(() => print(listProfiles()));
  addProfile(program.command("collections")).description("list collections").action(async (options) => {
    print(await listCollections(options.profile));
  });
  addProfileAndCollection(program.command("stats")).description("read collection statistics").action(async (options) => {
    print(await collStats(options.profile, options.collection));
  });
  addLimit(addQueryOptions(addProfileAndCollection(program.command("find"))))
    .option("--skip <n>", "skip documents", integer)
    .action(async (options) => {
      print(await find(options.profile, options.collection, options.query, readOptions(options)));
    });
  addQueryOptions(addProfileAndCollection(program.command("find-one"))).action(async (options) => {
    print(await findOne(options.profile, options.collection, options.query, readOptions(options)));
  });
  addProfileAndCollection(program.command("count")).option("-q, --query <json>", "query JSON", "{}").action(async (options) => {
    print(await count(options.profile, options.collection, options.query));
  });
  addLimit(addProfileAndCollection(program.command("aggregate"))).requiredOption("--pipeline <json>").action(async (options) => {
    print(await aggregate(options.profile, options.collection, options.pipeline, { limit: options.limit }));
  });
  addProfileAndCollection(program.command("distinct"))
    .requiredOption("--field <field>")
    .option("-q, --query <json>", "query JSON", "{}")
    .action(async (options) => {
      print(await distinct(options.profile, options.collection, options.field, options.query));
    });

  try {
    await program.parseAsync(argv);
  } catch (error) {
    process.stderr.write(`${maskError(error)}\n`);
    process.exitCode = 1;
  }
}
