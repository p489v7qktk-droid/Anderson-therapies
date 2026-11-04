import { requiredEnv } from "./http.ts";

const supabaseUrl = () => requiredEnv("SUPABASE_URL").replace(/\/+$/, "");
const serviceKey = () => requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

export async function rpc<T>(name: string, values: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${supabaseUrl()}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
            apikey: serviceKey(),
            Authorization: `Bearer ${serviceKey()}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Database request failed (${response.status}): ${body}`);
    return body ? JSON.parse(body) as T : null as T;
}

export async function restPatch<T = unknown>(path: string, values: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
        method: "PATCH",
        headers: {
            apikey: serviceKey(),
            Authorization: `Bearer ${serviceKey()}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
        },
        body: JSON.stringify(values),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Database request failed (${response.status}): ${body}`);
    return JSON.parse(body) as T;
}

export async function rest<T>(path: string): Promise<T> {
    const response = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
        headers: {
            apikey: serviceKey(),
            Authorization: `Bearer ${serviceKey()}`,
        },
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Database request failed (${response.status}): ${body}`);
    return JSON.parse(body) as T;
}

export async function authenticatedUser(accessToken: string): Promise<{ email: string; id: string }> {
    const tokenParts = accessToken.split(".");
    if (tokenParts.length !== 3) throw new Error("Sign in again to continue.");

    let claims: { aal?: string; sub?: string };
    try {
        const payload = tokenParts[1].replace(/-/g, "+").replace(/_/g, "/");
        claims = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    } catch {
        throw new Error("Sign in again to continue.");
    }

    const response = await fetch(`${supabaseUrl()}/auth/v1/user`, {
        headers: {
            apikey: requiredEnv("SUPABASE_ANON_KEY"),
            Authorization: `Bearer ${accessToken}`,
        },
    });
    if (!response.ok) throw new Error("Sign in again to continue.");

    const user = await response.json();
    if (!user?.id || !user?.email || !user?.email_confirmed_at || claims.sub !== user.id) {
        throw new Error("A verified administrator account is required.");
    }
    if (claims.aal !== "aal2") {
        throw new Error("Complete authenticator verification before managing bookings.");
    }
    return { id: user.id, email: user.email };
}

export async function sendEmail(options: {
    to: string;
    subject: string;
    html: string;
    text: string;
    idempotencyKey: string;
}): Promise<string> {
    const tenantId = requiredEnv("MICROSOFT_TENANT_ID");
    const clientId = requiredEnv("MICROSOFT_CLIENT_ID");
    const clientSecret = requiredEnv("MICROSOFT_CLIENT_SECRET");
    const senderUpn = requiredEnv("MICROSOFT_SENDER_UPN");

    const tokenResponse = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
            scope: "https://graph.microsoft.com/.default",
        }).toString(),
    });
    const tokenBody = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || typeof tokenBody.access_token !== "string") {
        throw new Error(`Microsoft token request failed (${tokenResponse.status}): ${JSON.stringify(tokenBody)}`);
    }

    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderUpn)}/sendMail`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${tokenBody.access_token}`,
            "Content-Type": "application/json",
            "client-request-id": options.idempotencyKey,
            "return-client-request-id": "true",
        },
        body: JSON.stringify({
            message: {
                subject: options.subject,
                body: {
                    contentType: "HTML",
                    content: options.html,
                },
                toRecipients: [
                    {
                        emailAddress: {
                            address: options.to,
                        },
                    },
                ],
            },
            saveToSentItems: true,
        }),
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Microsoft Graph rejected the message (${response.status}): ${body}`);
    }
    return `graph:${options.idempotencyKey}`;
}
