// Runs the end-to-end browser tests: npm run test:e2e
//
// Each run gets a new directory under test-results/e2e/ (git-ignored). The local database and file
// store live there, so the developer's own .wrangler state is never read or changed, and no earlier
// run is touched. The script applies every migration to that new database, starts the Worker with
// `wrangler dev`, runs Playwright against it and stops the Worker again, also when a test fails.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOST = "127.0.0.1";
const DEFAULT_PORT = 8863;
const DATABASE = "komon-portal";
const START_TIMEOUT_MS = 180_000;
const STOP_TIMEOUT_MS = 20_000;
const POLL_MS = 500;
const LOG_TAIL_LINES = 40;

/**
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function portFrom(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${name} must be a port number between 1024 and 65535, got "${raw}"`);
  }
  return port;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * Whether something accepts connections on the port.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isListening(port) {
  return new Promise((done) => {
    const socket = connect({ host: HOST, port });
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("error", () => done(false));
  });
}

/**
 * The entry file of an installed command-line tool, so that it runs under this Node without a shell.
 * @param {string} packageName
 * @param {string} command
 * @returns {string}
 */
function binOf(packageName, command) {
  const manifestPath = require.resolve(`${packageName}/package.json`);
  /** @type {{ bin?: Record<string, string> }} */
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const relative = manifest.bin?.[command];
  if (relative === undefined) {
    throw new Error(`${packageName} does not provide the command "${command}"`);
  }
  return join(dirname(manifestPath), relative);
}

/** A new directory for this run. Creating it fails when it already exists, so two runs never share one. */
function createRunDirectory() {
  const parent = join(ROOT, "test-results", "e2e");
  mkdirSync(parent, { recursive: true });
  const directory = join(parent, `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${process.pid}`);
  mkdirSync(directory);
  return directory;
}

/**
 * @param {string} logPath
 * @returns {string}
 */
function tailOf(logPath) {
  return readFileSync(logPath, "utf8").split("\n").slice(-LOG_TAIL_LINES).join("\n");
}

/**
 * Waits until the Worker serves the sign-in page.
 * @param {string} baseUrl
 * @param {import("node:child_process").ChildProcess} worker
 * @returns {Promise<void>}
 */
async function waitUntilServing(baseUrl, worker) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null || worker.signalCode !== null) {
      throw new Error("the local Worker stopped before it answered");
    }
    try {
      const response = await fetch(`${baseUrl}/api/session`, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet: ask again until the deadline.
    }
    await sleep(POLL_MS);
  }
  throw new Error(`the local Worker did not answer within ${START_TIMEOUT_MS / 1000} seconds`);
}

/**
 * Sends a signal to the Worker and everything it started. It runs in its own process group.
 * @param {import("node:child_process").ChildProcess} worker
 * @param {NodeJS.Signals} signal
 */
function signalGroup(worker, signal) {
  if (worker.pid === undefined) {
    throw new Error("the local Worker was never started");
  }
  try {
    process.kill(-worker.pid, signal);
  } catch (error) {
    // ESRCH: the group has already gone, which is what stopping wants.
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
      throw error;
    }
  }
}

/**
 * Whether any process of the Worker's group is still alive.
 * @param {import("node:child_process").ChildProcess} worker
 * @returns {boolean}
 */
function groupAlive(worker) {
  if (worker.pid === undefined) {
    return false;
  }
  try {
    process.kill(-worker.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stops the Worker and waits until its processes are gone and the port is free.
 * @param {import("node:child_process").ChildProcess} worker
 * @param {number} port
 * @returns {Promise<void>}
 */
async function stopWorker(worker, port) {
  signalGroup(worker, "SIGTERM");
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (groupAlive(worker) && Date.now() < deadline) {
    await sleep(POLL_MS / 5);
  }
  if (groupAlive(worker)) {
    signalGroup(worker, "SIGKILL");
    while (groupAlive(worker) && Date.now() < deadline + STOP_TIMEOUT_MS) {
      await sleep(POLL_MS / 5);
    }
  }
  if (groupAlive(worker) || (await isListening(port))) {
    throw new Error(`the local Worker on port ${port} could not be stopped`);
  }
}

/** @returns {Promise<number>} The exit code of the test run. */
async function main() {
  const port = portFrom("E2E_PORT", DEFAULT_PORT);
  const inspectorPort = portFrom("E2E_INSPECTOR_PORT", port + 1000);
  const baseUrl = `http://${HOST}:${port}`;
  if (await isListening(port)) {
    throw new Error(`port ${port} is already in use. Stop what listens there or set E2E_PORT to a free port.`);
  }

  const runDirectory = createRunDirectory();
  const stateDirectory = join(runDirectory, "state");
  const logPath = join(runDirectory, "worker.log");
  // The only setting the run needs. With --env-file, wrangler does not read the developer's .dev.vars.
  const envFile = join(runDirectory, "worker.env");
  writeFileSync(envFile, "ENVIRONMENT=development\n");
  console.info(`End-to-end run directory: ${runDirectory}`);

  const wrangler = binOf("wrangler", "wrangler");
  const migrated = spawnSync(process.execPath, [wrangler, "d1", "migrations", "apply", DATABASE, "--local", "--persist-to", stateDirectory], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  });
  writeFileSync(join(runDirectory, "migrations.log"), `${migrated.stdout ?? ""}${migrated.stderr ?? ""}`);
  if (migrated.status !== 0) {
    throw new Error(`applying the migrations failed:\n${migrated.stdout ?? ""}${migrated.stderr ?? ""}`);
  }

  const log = openSync(logPath, "a");
  const worker = spawn(
    process.execPath,
    [wrangler, "dev", "--port", String(port), "--ip", HOST, "--inspector-port", String(inspectorPort), "--persist-to", stateDirectory, "--env-file", envFile, "--show-interactive-dev-session=false"],
    { cwd: ROOT, detached: true, stdio: ["ignore", log, log] },
  );
  closeSync(log);

  /** @type {import("node:child_process").ChildProcess | null} */
  let tests = null;
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    tests?.kill("SIGTERM");
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);

  try {
    await waitUntilServing(baseUrl, worker);
    if (interrupted) {
      return 130;
    }
    const playwright = binOf("@playwright/test", "playwright");
    const running = spawn(process.execPath, [playwright, "test", "--config", join(ROOT, "test", "e2e", "playwright.config.mjs"), ...process.argv.slice(2)], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, E2E_BASE_URL: baseUrl, E2E_OUTPUT_DIR: join(runDirectory, "output") },
    });
    tests = running;
    /** @type {number} */
    const code = await new Promise((done, fail) => {
      running.once("error", fail);
      running.once("exit", (exitCode) => done(exitCode ?? 1));
    });
    return interrupted ? 130 : code;
  } catch (error) {
    console.error(`Last lines of ${logPath}:\n${tailOf(logPath)}`);
    throw error;
  } finally {
    await stopWorker(worker, port);
    console.info("The local Worker has stopped.");
  }
}

process.exitCode = await main();
