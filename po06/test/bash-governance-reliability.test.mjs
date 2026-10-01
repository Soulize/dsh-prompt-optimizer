import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync, writeSync, readdirSync, fstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGoverned } from "../lib/bash/process-governance.mjs";
import { createFallbackJobPort, createWin32JobPort, readOutputWindow } from "../lib/bash/pg-jobport.mjs";

const temporary = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "governance-reliability-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
function fakeHandle(overrides = {}) {
  const calls = [];
  const handle = {
    pid: 17, scope: "job", done: Promise.resolve({ exitCode: 0, signal: null }),
    output: () => ({ stdoutBytes: Buffer.from("ok"), stderrBytes: Buffer.alloc(0) }),
    terminate: () => { calls.push("terminate"); },
    waitForExit: async (ms) => { calls.push(["wait", ms]); return true; },
    release: () => { calls.push("release"); }, ...overrides
  };
  return { calls, handle, ports: { graceMs: 5, spawn: async () => handle } };
}

test("normal completion preserves top-level contract and releases", async () => {
  const { calls, ports } = fakeHandle();
  const result = await runGoverned({ timeoutMs: 50 }, ports);
  assert.deepEqual(Object.keys(result).sort(), ["governanceVersion", "ok", "pid", "outcome", "streams", "timeoutMs", "timerArmed", "reason", "spawnError", "diagnostics"].sort());
  assert.equal(result.reason, "exit");
  assert.equal(result.diagnostics.orphanCheck.status, "not-required");
  assert.deepEqual(result.outcome, { exitCode: 0, signal: null });
  assert.equal(result.streams.stdout.text, "ok");
  assert.equal(result.streams.stdout.truncated, false);
  assert.equal(result.streams.stdout.encoding.status, "clean");
  assert.equal(result.diagnostics.cleanup.released, true);
  assert.equal(calls.at(-1), "release");
  assert.equal(typeof result.diagnostics.timings.totalMs, "number");
});

test("already cancelled never launches a process", async () => {
  const controller = new AbortController(); controller.abort();
  let spawned = false;
  const result = await runGoverned({ signal: controller.signal }, { spawn: () => { spawned = true; } });
  assert.equal(spawned, false);
  assert.equal(result.reason, "cancelled");
});

test("upstream cancellation terminates, waits, releases and removes listener", async () => {
  const controller = new AbortController();
  let added = 0; let removed = 0;
  const signal = { aborted: false, addEventListener(...args) { added++; controller.signal.addEventListener(...args); }, removeEventListener(...args) { removed++; controller.signal.removeEventListener(...args); }, get reason() { return controller.signal.reason; } };
  let resolve;
  const { calls, handle, ports } = fakeHandle({ done: new Promise((r) => { resolve = r; }) });
  handle.terminate = () => { calls.push("terminate"); resolve({ exitCode: 1, signal: null }); };
  ports.spawn = async () => { queueMicrotask(() => controller.abort(new Error("stop"))); return handle; };
  const result = await runGoverned({ signal, timeoutMs: 100 }, ports);
  assert.equal(result.reason, "cancelled");
  assert.equal(result.diagnostics.cleanup.waitForExit, true);
  assert.deepEqual(calls, ["terminate", ["wait", 5], "release"]);
  assert.equal(added, removed);
});

test("timeout cleans up even if root outcome never arrives", async () => {
  const { calls, ports } = fakeHandle({ done: new Promise(() => {}) });
  const result = await runGoverned({ timeoutMs: 1 }, ports);
  assert.equal(result.reason, "timeout");
  assert.equal(result.diagnostics.termination.settledKind, "still-running");
  assert.equal(calls.at(-1), "release");
});

test("spawn rejection and error outcomes are spawn-error", async () => {
  const thrown = await runGoverned({}, { spawn: async () => { throw new Error("ENOENT"); } });
  assert.equal(thrown.reason, "spawn-error");
  const { calls, ports } = fakeHandle({ done: Promise.resolve({ error: "ENOENT", signal: null }) });
  const outcome = await runGoverned({}, ports);
  assert.equal(outcome.reason, "spawn-error");
  assert.equal(outcome.spawnError, "ENOENT");
  assert.equal(calls.at(-1), "release");
});

test("normal root exit clears surviving job children", async () => {
  let empty = false;
  const { handle, calls, ports } = fakeHandle({ waitForExit: async () => empty });
  handle.terminate = () => { calls.push("terminate"); empty = true; };
  const result = await runGoverned({}, ports);
  assert.equal(result.reason, "exit");
  assert.equal(result.diagnostics.cleanup.terminateCalled, true);
  assert.equal(result.diagnostics.cleanup.waitForExit, true);
  assert.equal(result.ok, true);
});

test("uncleared range is explicitly a failure", async () => {
  const { ports } = fakeHandle({ waitForExit: async () => false });
  const result = await runGoverned({}, ports);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.orphanCheck.status, "survivors-detected");
});

test("exception in output still releases and clears upstream listener", async () => {
  const { calls, ports } = fakeHandle({ output: () => { throw new Error("read failure"); } });
  await assert.rejects(runGoverned({}, ports), /read failure/);
  assert.equal(calls.at(-1), "release");
});

test("cleanup and release errors remain diagnostics", async () => {
  const { ports } = fakeHandle({ waitForExit: async () => false, terminate: () => { throw new Error("kill failure"); }, release: () => { throw new Error("close failure"); } });
  const result = await runGoverned({}, ports);
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.cleanup.terminateError, /kill failure/);
  assert.match(result.diagnostics.cleanup.releaseError, /close failure/);
});

test("bounded reader reports real bytes and respects UTF8 boundary", (t) => {
  const dir = temporary(t); const file = join(dir, "utf8");
  const data = Buffer.from("prefix-" + String.fromCodePoint(0x1f600) + "tail");
  writeFileSync(file, data);
  for (const max of [0, 1, 5, 6, 7, 8, 4096]) {
    const result = readOutputWindow(file, max);
    assert.ok(result.bytes.length <= max);
    assert.equal(result.totalBytes, data.length);
    assert.equal(result.truncated, data.length > max);
    assert.doesNotThrow(() => new TextDecoder("utf-8", { fatal: true }).decode(result.bytes));
    assert.deepEqual(result.bytes, data.subarray(result.windowOffset));
    if (result.truncated) assert.equal(result.spillPath, file);
  }
  writeFileSync(file, Buffer.from([0x61, 0xff, 0x80, 0x62]));
  assert.deepEqual([...readOutputWindow(file, 2).bytes], [0x80, 0x62]);
  assert.throws(() => readOutputWindow(file, -1), /output limit/);
});

test("large file window stays bounded", (t) => {
  const file = join(temporary(t), "large");
  writeFileSync(file, Buffer.alloc(2 * 1024 * 1024, 0x61));
  const result = readOutputWindow(file, 31);
  assert.equal(result.bytes.length, 31);
  assert.equal(result.totalBytes, 2 * 1024 * 1024);
});

test("fake win32 job closes process and job even when first close fails", async (t) => {
  const closed = []; const descriptors = [];
  const bindings = {
    spawnCurrentTokenJobProcess(api, request) { descriptors.push(...Object.values(request.stdio)); return { pid: 12, process: "process", job: "job" }; },
    pollProcessExit: () => 0, isJobEmpty: () => true,
    closeHandleChecked(api, handle) { closed.push(handle); if (handle === "process") throw new Error("close process"); }
  };
  const port = createWin32JobPort({ cwd: temporary(t), bindings, api: {} });
  const result = await runGoverned({ command: "fake" }, port);
  assert.deepEqual(closed, ["process", "job"]);
  assert.match(result.diagnostics.cleanup.releaseError, /failed to release/);
  for (const fd of descriptors) assert.throws(() => fstatSync(fd), /EBADF/);
});

test("fake win32 poll failure releases both handles", async (t) => {
  const closed = [];
  const bindings = {
    spawnCurrentTokenJobProcess: () => ({ pid: 12, process: "process", job: "job" }),
    pollProcessExit() { throw new Error("poll failed"); },
    terminateJob() {}, isJobEmpty: () => true,
    closeHandleChecked(api, handle) { closed.push(handle); }
  };
  const result = await runGoverned({ command: "fake" }, createWin32JobPort({ cwd: temporary(t), bindings, api: {} }));
  assert.equal(result.reason, "spawn-error");
  assert.deepEqual(closed, ["process", "job"]);
});

test("fake fallback taskkill is asynchronous, bounded and idempotent", async (t) => {
  const dir = temporary(t);
  const child = new EventEmitter(); child.pid = 123; child.kill = () => child.emit("exit", 1, null); child.unref = () => {};
  const killer = new EventEmitter(); let killed = 0; killer.kill = () => { killed++; }; killer.unref = () => {};
  let spawned = 0;
  const spawn = (command) => { spawned++; return command === "taskkill" ? killer : child; };
  const handle = await createFallbackJobPort({ cwd: dir, spawn, platform: "win32", killTimeoutMs: 5 }).spawn({ command: "fake" });
  const promise = handle.terminate();
  assert.equal(handle.terminate(), promise);
  let eventLoopRan = false; queueMicrotask(() => { eventLoopRan = true; });
  await assert.rejects(promise, /taskkill timed out/);
  assert.equal(eventLoopRan, true); assert.equal(killed, 1); assert.equal(spawned, 2);
  assert.equal(await handle.waitForExit(0), true);
  handle.release();
});

test("fallback ports isolate outputs in the same directory", async (t) => {
  const dir = temporary(t);
  const spawn = (command, args, options) => {
    writeSync(options.stdio[1], command); writeSync(options.stdio[2], "error-" + command);
    const child = new EventEmitter(); child.pid = 1; child.unref = () => {};
    queueMicrotask(() => child.emit("exit", 0, null)); return child;
  };
  const makePaths = () => ({ stdout: join(dir, "same"), stderr: join(dir, "same") });
  const ports = [createFallbackJobPort({ cwd: dir, makePaths, spawn }), createFallbackJobPort({ cwd: dir, makePaths, spawn })];
  const results = await Promise.all(ports.map((port, i) => runGoverned({ command: "value" + i, stdoutMaxBytes: 2 }, port)));
  assert.notEqual(results[0].streams.stdout.spillPath, results[1].streams.stdout.spillPath);
  assert.equal(results[0].streams.stdout.text, "e0"); assert.equal(results[1].streams.stdout.text, "e1");
  assert.equal(results[0].streams.stdout.bytes, 6);
  assert.equal(results[0].diagnostics.orphanCheck.status, "not-evaluated");
  assert.equal(readdirSync(dir).length, 4);
});

test("spawn exceptions close all acquired descriptors", async (t) => {
  const descriptors = [];
  const spawn = (command, args, options) => { descriptors.push(...options.stdio.slice(1)); throw new Error("spawn failure"); };
  const result = await runGoverned({ command: "fake" }, createFallbackJobPort({ cwd: temporary(t), spawn }));
  assert.equal(result.reason, "spawn-error");
  for (const fd of descriptors) assert.throws(() => fstatSync(fd), /EBADF/);
});

test("cancellation while spawn is pending cleans the eventual handle", async () => {
  const controller = new AbortController();
  const { handle, calls, ports } = fakeHandle();
  ports.spawn = async () => { controller.abort(); return handle; };
  const result = await runGoverned({ signal: controller.signal }, ports);
  assert.equal(result.reason, "cancelled");
  assert.equal(calls.at(-1), "release");
  assert.equal(result.diagnostics.cleanup.terminateCalled, true);
});

test("native release stops pending poll and is idempotent", async (t) => {
  const closed = [];
  const bindings = {
    spawnCurrentTokenJobProcess: () => ({ pid: 12, process: "process", job: "job" }),
    pollProcessExit: () => undefined,
    closeHandleChecked(api, handle) { closed.push(handle); }
  };
  const handle = await createWin32JobPort({ cwd: temporary(t), bindings, api: {} }).spawn({ command: "fake" });
  handle.release(); handle.release();
  assert.deepEqual(closed, ["process", "job"]);
  await handle.done;
});

test("lightweight real Node ENOENT and output smoke", async (t) => {
  const dir = temporary(t);
  const missing = await runGoverned({ command: join(dir, "does-not-exist"), timeoutMs: 2000 }, createFallbackJobPort({ cwd: dir }));
  assert.equal(missing.reason, "spawn-error");
  const result = await runGoverned({ command: process.execPath, args: ["-e", "process.stdout.write('abcdefgh'); process.stderr.write('err')"], timeoutMs: 2000, stdoutMaxBytes: 3 }, createFallbackJobPort({ cwd: dir }));
  assert.equal(result.reason, "exit"); assert.equal(result.streams.stdout.text, "fgh");
  assert.equal(result.streams.stdout.bytes, 8); assert.equal(result.streams.stderr.text, "err");
});
