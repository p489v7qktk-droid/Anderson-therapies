import Stripe from "npm:stripe@23";
import { rest, rpc, sendEmail } from "../_shared/backend.ts";
import { adminNotificationEmail, confirmationEmail, type Booking, type BookingDetails } from "../_shared/emails.ts";
import { requiredEnv } from "../_shared/http.ts";
import { stripeClient } from "../_shared/stripe.ts";

type ClaimResult = {
    ok: boolean;
    send?: boolean;
    reason?: string;
    error?: string;
    email_id?: string;
    idempotency_key?: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function sendConfirmation(booking: Booking): Promise<void> {
    const claim = await rpc<ClaimResult>("claim_parent_space_email", {
        p_booking_id: booking.id,
        p_kind: "confirmation",
        p_request_id: booking.id,
    });
    if (!claim.ok) throw new Error(claim.error ?? "Unable to prepare the confirmation email.");
    if (!claim.send) return;
    if (!claim.email_id || !claim.idempotency_key) throw new Error("Email delivery record is incomplete.");

    try {
        const providerId = await sendEmail({
            to: booking.email,
            ...confirmationEmail(booking),
            idempotencyKey: claim.idempotency_key,
        });
        await rpc("finish_parent_space_email", {
            p_email_id: claim.email_id,
            p_status: "sent",
            p_provider_id: providerId,
            p_error_message: null,
        });
    } catch (error) {
        await rpc("finish_parent_space_email", {
            p_email_id: claim.email_id,
            p_status: "failed",
            p_provider_id: null,
            p_error_message: error instanceof Error ? error.message : "Email delivery failed.",
        });
        throw error;
    }
}

Deno.serve(async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return new Response("Use POST.", { status: 405 });

    const signature = request.headers.get("stripe-signature");
    if (!signature) return new Response("Missing signature.", { status: 400 });

    const stripe = stripeClient();
    let event: Stripe.Event;
    try {
        event = await stripe.webhooks.constructEventAsync(
            await request.text(),
            signature,
            requiredEnv("STRIPE_WEBHOOK_SECRET"),
            undefined,
            Stripe.createSubtleCryptoProvider(),
        );
    } catch (error) {
        console.error("Stripe webhook signature verification failed.", error);
        return new Response("Invalid signature.", { status: 400 });
    }

    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
        return new Response("Ignored.", { status: 200 });
    }

    try {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.payment_status !== "paid") return new Response("Not paid yet.", { status: 200 });

        const bookingId = session.client_reference_id ?? "";
        if (!uuidPattern.test(bookingId)) return new Response("No booking reference.", { status: 200 });

        const result = await rpc<{ ok: boolean; error?: string; booking?: Booking }>(
            "admin_mark_parent_space_booking_paid",
            { p_booking_id: bookingId, p_amount_paid_pence: session.amount_total },
        );
        if (!result.ok || !result.booking) {
            // The booking is flagged for review in the admin page; Stripe should not retry.
            console.error("Stripe payment needs manual review.", bookingId, result.error);
            return new Response("Flagged for review.", { status: 200 });
        }

        const rows = await rest<BookingDetails[]>(
            `parent_space_bookings?select=id,booking_reference,full_name,email,telephone,access_needs,photo_consent,attendee_type,age_groups,heard_about,marketing_opt_in,amount_due_pence,amount_paid_pence,payment_url,status&id=eq.${bookingId}&limit=1`,
        );
        if (rows[0]?.status === "paid") {
            await sendConfirmation(rows[0]);
            if (!(result as { already_paid?: boolean }).already_paid) {
                try {
                    await sendEmail({
                        to: requiredEnv("ADMIN_EMAIL"),
                        ...adminNotificationEmail("paid", rows[0]),
                        idempotencyKey: crypto.randomUUID(),
                    });
                } catch (error) {
                    console.error("Admin payment notification could not be sent.", error);
                }
            }
        }
        return new Response("OK.", { status: 200 });
    } catch (error) {
        // A non-2xx response makes Stripe retry, so a failed email or database call is not lost.
        console.error("Stripe webhook processing failed.", error);
        return new Response("Processing failed.", { status: 500 });
    }
});
