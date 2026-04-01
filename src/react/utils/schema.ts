/**
 * Helper to clean JSON Schema for LLM compatibility.
 * Replaces modern Draft 2020-12 features with older, more compatible alternatives.
 * Specifically handles OpenAI's 'Strict Mode' requirements.
 */
export function cleanSchema(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(cleanSchema);
  } else if (obj !== null && typeof obj === "object") {
    const newObj: Record<string, unknown> = {};
    const currentObj = obj as Record<string, any>;

    for (const key in currentObj) {
      // Remove keys that are not supported by most LLMs
      if (key === "propertyNames" || key === "$schema") {
        continue;
      }
      newObj[key] = cleanSchema(currentObj[key]);
    }

    // OpenAI and some other LLMs require additionalProperties: false for all objects in strict mode
    // AND every property must be explicitly listed in the 'required' array
    if (newObj.type === "object") {
      if (
        newObj.additionalProperties === undefined ||
        (newObj.additionalProperties &&
          typeof newObj.additionalProperties === "object" &&
          Object.keys(newObj.additionalProperties).length === 0)
      ) {
        newObj.additionalProperties = false;
      }

      if (newObj.additionalProperties === false && newObj.properties) {
        newObj.required = Object.keys(newObj.properties as object);
      }
    }

    return newObj;
  }
  return obj;
}

/**
 * Safely attempts to parse a value as JSON if it's a string.
 */
export function tryParseJSON(value: unknown): any {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}
