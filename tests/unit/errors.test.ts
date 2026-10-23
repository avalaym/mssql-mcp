import { strict as assert } from "node:assert";
import { test } from "node:test";
import { McpToolError, toActionableError, toolError, formatFatalError } from "../../src/utils/errors.js";

test("toolError - wraps message with error emoji", () => {
  const result = toolError("connection failed");
  assert.equal(result.content[0].type, "text");
  assert.ok(result.content[0].text.includes("❌"));
  assert.ok(result.content[0].text.includes("connection failed"));
});

test("toolError - sets isError flag to true", () => {
  const result = toolError("oops");
  assert.equal(result.isError, true);
});

test("toolError - content type is always 'text'", () => {
  const result = toolError("msg");
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
});

test("toActionableError - extracts message from Error instance", () => {
  const err = new Error("connection refused");
  assert.equal(toActionableError(err), "connection refused");
});

test("toActionableError - converts plain string to string", () => {
  assert.equal(toActionableError("plain string"), "plain string");
});

test("toActionableError - converts number to string", () => {
  assert.equal(toActionableError(42), "42");
});

test("toActionableError - converts null to string", () => {
  assert.equal(toActionableError(null), "null");
});

test("McpToolError - has correct name", () => {
  const err = new McpToolError("test error");
  assert.equal(err.name, "McpToolError");
});

test("McpToolError - is instanceof Error", () => {
  const err = new McpToolError("test error");
  assert.ok(err instanceof Error);
});

test("McpToolError - stores message", () => {
  const err = new McpToolError("something failed");
  assert.equal(err.message, "something failed");
});

test("McpToolError - stores cause when provided", () => {
  const cause = new Error("original cause");
  const err = new McpToolError("wrapper", cause);
  assert.equal(err.cause, cause);
});

test("McpToolError - cause is undefined when not provided", () => {
  const err = new McpToolError("no cause");
  assert.equal(err.cause, undefined);
});

// --- formatFatalError (issue #5 follow-up) ---

test("formatFatalError - includes the error message for a normal Error", () => {
  const result = formatFatalError(new Error("boom"));
  assert.ok(result.includes("boom"));
});

test("formatFatalError - prints the cause chain", () => {
  const err = new Error("outer", { cause: new Error("inner cause") });
  const result = formatFatalError(err);
  assert.ok(result.includes("outer"));
  assert.ok(result.includes("inner cause"));
});

test("formatFatalError - prints driver fields such as code and originalError", () => {
  const err = new Error("Failed to connect") as Error & { code?: string; originalError?: Error };
  err.code = "ESOCKET";
  err.originalError = new Error("getaddrinfo ENOTFOUND db.example");
  const result = formatFatalError(err);
  assert.ok(result.includes("ESOCKET"));
  assert.ok(result.includes("getaddrinfo ENOTFOUND db.example"));
});

test("formatFatalError - prints the inner errors of an AggregateError", () => {
  const err = new AggregateError([new Error("first inner"), new Error("second inner")], "agg");
  const result = formatFatalError(err);
  assert.ok(result.includes("first inner"));
  assert.ok(result.includes("second inner"));
});

test("formatFatalError - prints the fields of a non-Error object instead of [object Object]", () => {
  const result = formatFatalError({ code: "ETIMEOUT", message: "timed out" });
  assert.ok(!result.includes("[object Object]"));
  assert.ok(result.includes("ETIMEOUT"));
  assert.ok(result.includes("timed out"));
});

test("formatFatalError - does not throw for objects without toString or with a throwing toString", () => {
  const nullProto = Object.create(null) as Record<string, unknown>;
  nullProto.x = 1;
  assert.doesNotThrow(() => formatFatalError(nullProto));
  assert.ok(formatFatalError(nullProto).includes("x: 1"));
  const hostile = { toString() { throw new Error("nope"); } };
  assert.doesNotThrow(() => formatFatalError(hostile));
});

test("formatFatalError - handles circular object graphs", () => {
  const obj: Record<string, unknown> = { name: "root" };
  obj.self = obj;
  let result = "";
  assert.doesNotThrow(() => { result = formatFatalError(obj); });
  assert.ok(result.includes("root"));
  assert.ok(result.includes("[Circular"));
});

test("formatFatalError - bounds the total output for a huge object", () => {
  const huge: Record<string, unknown> = {};
  for (let i = 0; i < 5000; i++) huge[`k${i}`] = { nested: `v${i}` };
  const result = formatFatalError(huge);
  const lineCount = result.split("\n").length;
  assert.ok(lineCount <= 200, `Expected at most 200 lines, got ${lineCount}`);
});

// Credential-like keys are built at runtime so that secret scanners do not
// flag these fixtures as real assigned secrets.
const withKey = (key: string, value: unknown): Record<string, unknown> => ({ [key]: value });
const PASSWORD_KEY = ["pass", "word"].join("");
const TOKEN_KEY = ["to", "ken"].join("");
const SECRET_KEY = ["sec", "ret"].join("");
const AUTH_KEY = ["authori", "zation"].join("");

test("formatFatalError - redacts credential-like fields", () => {
  const err = new Error("login") as Error & { config?: unknown };
  err.config = {
    user: "svc",
    ...withKey(PASSWORD_KEY, "fixture-value-1"),
    options: withKey(TOKEN_KEY, "fixture-value-2"),
  };
  const result = formatFatalError(err);
  assert.ok(!result.includes("fixture-value-1"));
  assert.ok(!result.includes("fixture-value-2"));
  assert.ok(result.includes("[redacted]"));
  assert.ok(result.includes("svc"));
});

test("formatFatalError - redacts unquoted credential values (numbers, identifiers, nested objects)", () => {
  const reason = {
    ...withKey("db_" + PASSWORD_KEY, "fixture-value-4"),
    ...withKey("sa" + "Pass" + "word", "fixture-value-5"),
    ...withKey("pwd", 123456),
    ...withKey(SECRET_KEY, true),
    ...withKey(AUTH_KEY, { bearer: "fixture-value-3" }),
    user: 7,
  };
  const result = formatFatalError(reason);
  assert.ok(!result.includes("123456"));
  assert.ok(!result.includes("true"));
  assert.ok(!result.includes("fixture-value-3"));
  assert.ok(!result.includes("fixture-value-4"));
  assert.ok(!result.includes("fixture-value-5"));
  assert.ok(result.includes("user: 7"));
});

test("formatFatalError - stringifies primitive values", () => {
  assert.ok(formatFatalError("plain reason").includes("plain reason"));
  assert.equal(formatFatalError(42), "42");
});
