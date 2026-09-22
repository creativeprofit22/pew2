import { describe, expect, test } from "bun:test";
import { CONTROL_VERSION, encodeResponse, FrameDecoder, MAX_FRAME_BYTES, parseRequest, validatePairing } from "./protocol.js";
import { validateDesktopMode } from "./transport.js";

const frame = { v: CONTROL_VERSION, id: "1", command: "hello", instance: "owned-instance" } as const;

describe("private desktop framing", () => {
  test("handles split UTF-8 and multiple frames", () => {
    const decoder = new FrameDecoder();
    const bytes = Buffer.from('"é"\n{}\n');
    expect(decoder.push(bytes.subarray(0, 2))).toEqual([]);
    expect(decoder.push(bytes.subarray(2))).toEqual(['"é"', "{}"]);
    decoder.end();
  });
  test("enforces exact byte boundary including across chunks", () => {
    const decoder = new FrameDecoder();
    expect(decoder.push(Buffer.alloc(MAX_FRAME_BYTES, 32))).toEqual([]);
    expect(() => decoder.push(Buffer.from("x"))).toThrow("invalid_frame");
    const exact = new FrameDecoder();
    expect(exact.push(Buffer.from(`${" ".repeat(MAX_FRAME_BYTES)}\n`))[0]?.length).toBe(MAX_FRAME_BYTES);
  });
  test("rejects malformed UTF-8 and incomplete EOF", () => {
    expect(() => new FrameDecoder().push(new Uint8Array([255, 10]))).toThrow("invalid_frame");
    const decoder = new FrameDecoder();
    decoder.push(Buffer.from("{"));
    expect(() => decoder.end()).toThrow("invalid_frame");
  });
  test("allows only the complete current request schema", () => {
    expect(parseRequest(JSON.stringify(frame))).toEqual(frame);
    for (const bad of [null, [], {}, { ...frame, extra: true }, { ...frame, command: "exec" }, { ...frame, id: "a\nb" }]) {
      expect(() => parseRequest(JSON.stringify(bad))).toThrow();
    }
    expect(() => parseRequest(JSON.stringify({ ...frame, v: 1 }))).toThrow("protocol_mismatch");
    expect(() => parseRequest("{" )).toThrow("invalid_frame");
  });
  test("validates QR shape and LAN-only link", () => {
    const pairing = { link: `ws://192.168.1.2:8787/?token=${"a".repeat(32)}#k=${"b".repeat(43)}`, modules: Array.from({ length: 21 }, () => Array<boolean>(21).fill(false)) };
    expect(validatePairing(pairing)).toBe(pairing);
    expect(() => validatePairing({ ...pairing, link: "https://example.com" })).toThrow();
    expect(() => validatePairing({ ...pairing, modules: [[true]] })).toThrow();
    expect(() => validatePairing({ ...pairing, modules: pairing.modules.map(row => row.slice(1)) })).toThrow();
  });
  test("every supported QR dimension fits the unchanged private frame limit", () => {
    for (let size = 21; size <= 177; size += 4) {
      const pairing = {
        link: `ws://192.168.255.255:65535/?token=${"a".repeat(1024)}#k=${"b".repeat(43)}`,
        modules: Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => (x + y) % 2 === 0)),
      };
      const encoded = encodeResponse({ v: CONTROL_VERSION, id: "9".repeat(16), instance: "i".repeat(64), type: "pairing", pairing });
      expect(Buffer.byteLength(encoded) - 1).toBeLessThanOrEqual(MAX_FRAME_BYTES);
      const rows = JSON.parse(encoded).pairing.modules as string[];
      expect(rows.every(row => row.length === size && /^[01]+$/.test(row))).toBe(true);
      expect(rows.map(row => [...row].map(cell => cell === "1"))).toEqual(pairing.modules);
    }
  });
  test("all accepted token lengths generate bounded QR responses", async () => {
    const { toQR } = await import("toqr");
    for (let length = 32; length <= 1024; length++) {
      const link = `ws://192.168.255.255:65535/?token=${"a".repeat(length)}#k=${"b".repeat(43)}`;
      const flat = toQR(link);
      const size = Math.sqrt(flat.length);
      const modules = Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => Boolean(flat[y * size + x])));
      const encoded = encodeResponse({ v: CONTROL_VERSION, id: "1", instance: "test", type: "pairing", pairing: { link, modules } });
      expect(Buffer.byteLength(encoded) - 1).toBeLessThanOrEqual(MAX_FRAME_BYTES);
    }
  }, 30_000);
  test("desktop mode requires explicit noninteractive serve arguments", () => {
    expect(() => validateDesktopMode(["serve", "--desktop-control"], false, false)).not.toThrow();
    for (const args of [[], ["serve"], ["run", "--desktop-control"], ["serve", "--desktop-control", "--extra"]]) {
      expect(() => validateDesktopMode(args, false, false)).toThrow();
    }
    expect(() => validateDesktopMode(["serve", "--desktop-control"], true, false)).toThrow();
    expect(() => validateDesktopMode(["serve", "--desktop-control"], false, true)).toThrow();
  });
});
