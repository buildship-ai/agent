import { describe, it, expect } from "vitest";
import { cleanSchema, tryParseJSON } from "../src/react/utils/schema";

describe("tryParseJSON", () => {
  it("parses a valid JSON string", () => {
    expect(tryParseJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns original string for invalid JSON", () => {
    expect(tryParseJSON("not json")).toBe("not json");
  });

  it("passes through non-string values", () => {
    expect(tryParseJSON(42)).toBe(42);
    expect(tryParseJSON(null)).toBe(null);
    expect(tryParseJSON(undefined)).toBe(undefined);
    const obj = { a: 1 };
    expect(tryParseJSON(obj)).toBe(obj);
  });

  it("parses JSON arrays", () => {
    expect(tryParseJSON("[1,2,3]")).toEqual([1, 2, 3]);
  });
});

describe("cleanSchema", () => {
  it("removes $schema key", () => {
    const result = cleanSchema({ $schema: "http://json-schema.org/draft-07", type: "object" });
    expect(result).not.toHaveProperty("$schema");
  });

  it("removes propertyNames key", () => {
    const result = cleanSchema({
      type: "object",
      propertyNames: { pattern: "^[a-z]" },
      properties: { name: { type: "string" } },
    });
    expect(result).not.toHaveProperty("propertyNames");
  });

  it("sets additionalProperties: false on objects when undefined", () => {
    const result = cleanSchema({
      type: "object",
      properties: { name: { type: "string" } },
    }) as Record<string, any>;

    expect(result.additionalProperties).toBe(false);
  });

  it("sets additionalProperties: false on objects when empty object", () => {
    const result = cleanSchema({
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: {},
    }) as Record<string, any>;

    expect(result.additionalProperties).toBe(false);
  });

  it("preserves additionalProperties: true", () => {
    const result = cleanSchema({
      type: "object",
      additionalProperties: true,
    }) as Record<string, any>;

    expect(result.additionalProperties).toBe(true);
  });

  it("adds required array with all property keys when additionalProperties is false", () => {
    const result = cleanSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
    }) as Record<string, any>;

    expect(result.required).toEqual(["name", "age"]);
  });

  it("processes nested objects recursively", () => {
    const result = cleanSchema({
      type: "object",
      properties: {
        address: {
          type: "object",
          properties: {
            street: { type: "string" },
          },
        },
      },
    }) as Record<string, any>;

    expect(result.additionalProperties).toBe(false);
    expect(result.properties.address.additionalProperties).toBe(false);
    expect(result.properties.address.required).toEqual(["street"]);
  });

  it("processes arrays recursively", () => {
    const result = cleanSchema([
      { type: "object", properties: { a: { type: "string" } } },
      { type: "string" },
    ]) as any[];

    expect(result[0].additionalProperties).toBe(false);
    expect(result[0].required).toEqual(["a"]);
  });

  it("passes through primitive values", () => {
    expect(cleanSchema("hello")).toBe("hello");
    expect(cleanSchema(42)).toBe(42);
    expect(cleanSchema(null)).toBe(null);
    expect(cleanSchema(true)).toBe(true);
  });
});
