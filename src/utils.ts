export function getNestedField(obj: unknown, path: string): unknown {
    return path.split(".").reduce<unknown>(
        (curr, key) =>
            curr != null && typeof curr === "object"
                ? (curr as Record<string, unknown>)[key]
                : undefined,
        obj,
    )
}
