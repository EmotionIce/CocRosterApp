import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const loadCodec = () => {
  const calls = { encode: 0, decode: 0 };
  const context = {
    FIREBASE_KEY_ENCODING_PREFIX: "__FB64__",
    errorMessage_: (error) => error.message,
    Utilities: {
      newBlob: (value) => {
        const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
        return { getBytes: () => [...bytes], getDataAsString: () => bytes.toString("utf8") };
      },
      base64EncodeWebSafe: (bytes) => { calls.encode++; return Buffer.from(bytes).toString("base64url"); },
      base64DecodeWebSafe: (value) => { calls.decode++; return [...Buffer.from(value, "base64url")]; },
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL("../script/firebaseStore.js", import.meta.url), "utf8"), context);
  return { context, calls };
};

test("Firebase key conversion preserves the stored format and decodes exactly one layer", () => {
  const { context } = loadCodec();
  const keys = ["#PLAYER", "a.b", "x/y", "[x]", "$", "\u0000", "__FB64__I1BMQVlFUg", "#🐢ä"];
  const original = { plain: keys.map((key) => ({ [key]: { value: key, nested: [null, false, 7] } })) };
  const encoded = context.encodeFirebaseObjectKeysRecursive_(original);
  for (let i = 0; i < keys.length; i++) {
    assert.deepEqual(Object.keys(encoded.plain[i]), ["__FB64__" + Buffer.from(keys[i], "utf8").toString("base64url")]);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(context.decodeFirebaseObjectKeysRecursive_(encoded))), original);
  assert.deepEqual(original.plain.map((entry) => Object.keys(entry)[0]), keys);
});

test("repeated historical player keys use one Utilities conversion per distinct key per call", () => {
  const { context, calls } = loadCodec();
  const snapshot = Array.from({ length: 500 }, () => ({ byTag: { "#PLAYER": { attacks: { "#OPPONENT": 3 } } } }));
  const encoded = context.encodeFirebaseObjectKeysRecursive_(snapshot);
  assert.equal(calls.encode, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(context.decodeFirebaseObjectKeysRecursive_(encoded))), snapshot);
  assert.equal(calls.decode, 2);
  context.encodeFirebaseObjectKeysRecursive_(snapshot);
  context.decodeFirebaseObjectKeysRecursive_(encoded);
  assert.deepEqual(calls, { encode: 4, decode: 4 }, "the memo must not survive a traversal");
});

test("key conversion still rejects malformed keys and decoding collisions", () => {
  const { context } = loadCodec();
  assert.deepEqual(JSON.parse(JSON.stringify(context.encodeFirebaseObjectKeysRecursive_({ "": true }))), { __FB64__: true });
  assert.throws(() => context.decodeFirebaseObjectKeysRecursive_({ __FB64__: true }), /empty payload/);
  assert.throws(() => context.decodeFirebaseObjectKeysRecursive_({ __FB64__A: true }), /Invalid base64url payload length/);
  assert.throws(() => context.decodeFirebaseObjectKeysRecursive_({ "#PLAYER": 1, __FB64__I1BMQVlFUg: 2 }), /decoding collision/);
});
