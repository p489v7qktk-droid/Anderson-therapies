export function responseHeaders(request: Request): Headers {
    const origin = request.headers.get("Origin");
    const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ??
        "https://andersontherapies.co.uk,https://www.andersontherapies.co.uk")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    const headers = new Headers({
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Vary": "Origin",
    });

    if (origin && allowedOrigins.includes(origin)) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type");
        headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }

    return headers;
}

export function originIsAllowed(request: Request): boolean {
    const origin = request.headers.get("Origin");
    if (!origin) return true;

    const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ??
        "https://andersontherapies.co.uk,https://www.andersontherapies.co.uk")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

    return allowedOrigins.includes(origin);
}

export function jsonResponse(request: Request, body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: responseHeaders(request),
    });
}

export function preflightResponse(request: Request): Response {
    return new Response(null, {
        status: originIsAllowed(request) ? 204 : 403,
        headers: responseHeaders(request),
    });
}

export function requiredEnv(name: string): string {
    const value = Deno.env.get(name);
    if (!value) throw new Error(`Missing server configuration: ${name}`);
    return value;
}

export async function hmacHex(value: string): Promise<string> {
    const secret = requiredEnv("RATE_LIMIT_SECRET");
    if (secret.length < 32) throw new Error("RATE_LIMIT_SECRET must contain at least 32 characters.");
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
    return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
    const contentType = request.headers.get("Content-Type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
        throw new Error("Send booking details as JSON.");
    }

    const raw = await request.text();
    if (raw.length > 10_000) throw new Error("The request is too large.");

    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("The request body must be an object.");
    }
    return value as Record<string, unknown>;
}
