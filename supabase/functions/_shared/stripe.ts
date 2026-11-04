import Stripe from "npm:stripe@23";
import type { Booking } from "./emails.ts";

export const stripeConfigured = (): boolean => Boolean(Deno.env.get("STRIPE_SECRET_KEY"));

export function stripeClient(): Stripe {
    return new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "");
}

export async function createCheckoutUrl(booking: Booking): Promise<{ url: string | null; clientSecret: string | null }> {
    const siteUrl = (Deno.env.get("SITE_URL") ?? "https://www.andersontherapies.co.uk").replace(/\/+$/, "");
    const embedded = Boolean(Deno.env.get("STRIPE_PUBLISHABLE_KEY"));
    const returnUrl = `${siteUrl}/events/index.html?paid=1&ref=${encodeURIComponent(booking.booking_reference)}`;
    const session = await stripeClient().checkout.sessions.create({
        ui_mode: embedded ? "embedded_page" : "hosted_page",
        billing_address_collection: "auto",
        phone_number_collection: { enabled: false },
        automatic_tax: { enabled: false },
        allow_promotion_codes: false,
        submit_type: "auto",
        integration_identifier: "hosted_web_0001",
        origin_context: "web",
        mode: "payment",
        client_reference_id: booking.id,
        customer_email: booking.email,
        metadata: { booking_id: booking.id, booking_reference: booking.booking_reference },
        payment_intent_data: { metadata: { booking_id: booking.id, booking_reference: booking.booking_reference } },
        // Stripe requires at least 30 minutes, matching the booking hold plus a minute.
        expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
        ...(embedded
            ? { return_url: returnUrl, redirect_on_completion: "if_required" }
            : { success_url: returnUrl, cancel_url: `${siteUrl}/events/index.html?cancelled=1` }),
        line_items: [{
            quantity: 1,
            price_data: {
                currency: "gbp",
                unit_amount: booking.amount_due_pence,
                product_data: { name: `The Parent Space - ${booking.booking_reference}` },
            },
        }],
    });
    return { url: embedded ? null : session.url, clientSecret: embedded ? session.client_secret : null };
}
