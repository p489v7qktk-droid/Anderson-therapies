import { authenticatedUser, rest, rpc, sendEmail } from "../_shared/backend.ts";
import { confirmationEmail, type Booking } from "../_shared/emails.ts";
import { jsonResponse, originIsAllowed, preflightResponse, readJson, requiredEnv } from "../_shared/http.ts";

type ClaimResult = {
    ok: boolean;
    send?: boolean;
    reason?: string;
    error?: string;
    email_id?: string;
    idempotency_key?: string;
    booking?: Booking;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function sendConfirmation(booking: Booking, requestId: string): Promise<boolean> {
    const claim = await rpc<ClaimResult>("claim_parent_space_email", {
        p_booking_id: booking.id,
        p_kind: "confirmation",
        p_request_id: requestId,
    });

    if (!claim.ok) throw new Error(claim.error ?? "Unable to prepare the confirmation email.");
    if (!claim.send) return claim.reason === "sent";
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
        return true;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Email delivery failed.";
        await rpc("finish_parent_space_email", {
            p_email_id: claim.email_id,
            p_status: "failed",
            p_provider_id: null,
            p_error_message: errorMessage,
        });
        throw error;
    }
}

Deno.serve(async (request: Request): Promise<Response> => {
    if (!originIsAllowed(request)) return jsonResponse(request, { error: "This website origin is not allowed." }, 403);
    if (request.method === "OPTIONS") return preflightResponse(request);
    if (request.method !== "POST") return jsonResponse(request, { error: "Use POST for this endpoint." }, 405);

    try {
        const authorization = request.headers.get("Authorization") ?? "";
        const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
        if (!accessToken) return jsonResponse(request, { error: "Sign in to manage bookings." }, 401);

        let user: { email: string; id: string };
        try {
            user = await authenticatedUser(accessToken);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Sign in again to continue.";
            return jsonResponse(request, { error: message }, 401);
        }
        if (user.email?.toLowerCase() !== requiredEnv("ADMIN_EMAIL").toLowerCase()) {
            return jsonResponse(request, { error: "This account is not authorised to manage bookings." }, 403);
        }

        const body = await readJson(request);
        if (body.action === "list") {
            const bookings = await rest<Booking[]>(
                "parent_space_bookings?select=id,booking_reference,full_name,email,telephone,access_needs,photo_consent,attendee_type,age_groups,heard_about,marketing_opt_in,amount_due_pence,amount_paid_pence,payment_url,status,created_at,expires_at,paid_at&order=created_at.desc&limit=100",
            );
            const settings = await rpc("parent_space_config", {});
            return jsonResponse(request, { ok: true, bookings, settings });
        }

        if (body.action === "set-standard-link") {
            const paymentUrl = typeof body.payment_url === "string" ? body.payment_url.trim() : "";
            if (!/^https:\/\/pay\.tide\.co\/[A-Za-z0-9-]+\/?$/.test(paymentUrl)) {
                return jsonResponse(request, { error: "Enter the valid £30 Tide payment link." }, 422);
            }
            await rpc("admin_set_parent_space_standard_link", { p_payment_url: paymentUrl });
            return jsonResponse(request, { ok: true });
        }

        if (body.action === "mark-paid") {
            const bookingId = typeof body.booking_id === "string" ? body.booking_id : "";
            const amount = body.amount_paid_pence;
            if (!uuidPattern.test(bookingId) || !Number.isInteger(amount) || (amount !== 2000 && amount !== 3000)) {
                return jsonResponse(request, { error: "Select a booking and enter the amount received in Tide." }, 422);
            }

            const result = await rpc<{
                ok: boolean;
                already_paid?: boolean;
                error?: string;
                booking?: Booking;
            }>("admin_mark_parent_space_booking_paid", {
                p_booking_id: bookingId,
                p_amount_paid_pence: amount,
            });
            if (!result.ok || !result.booking) {
                return jsonResponse(request, { error: result.error ?? "The booking could not be marked as paid." }, 409);
            }

            try {
                const sent = await sendConfirmation(result.booking, result.booking.id);
                return jsonResponse(request, {
                    ok: true,
                    booking: result.booking,
                    confirmation_email_sent: sent,
                });
            } catch (error) {
                console.error("Parent Space confirmation email could not be sent.", error);
                return jsonResponse(request, {
                    ok: true,
                    booking: result.booking,
                    confirmation_email_sent: false,
                    warning: "Payment was recorded as verified, but the confirmation email failed. Retry it from the booking list.",
                });
            }
        }

        if (body.action === "resend-confirmation") {
            const bookingId = typeof body.booking_id === "string" ? body.booking_id : "";
            const requestId = typeof body.request_id === "string" ? body.request_id : "";
            if (!uuidPattern.test(bookingId) || !uuidPattern.test(requestId)) {
                return jsonResponse(request, { error: "Invalid resend request." }, 422);
            }

            const rows = await rest<Booking[]>(
                `parent_space_bookings?select=id,booking_reference,full_name,email,telephone,amount_due_pence,amount_paid_pence,payment_url,status&id=eq.${bookingId}&limit=1`,
            );
            const booking = rows[0];
            if (!booking || booking.status !== "paid") {
                return jsonResponse(request, { error: "A confirmation can only be sent for a paid booking." }, 409);
            }

            const sent = await sendConfirmation(booking, requestId);
            return jsonResponse(request, { ok: true, confirmation_email_sent: sent });
        }

        return jsonResponse(request, { error: "Unknown admin action." }, 400);
    } catch (error) {
        console.error("Parent Space admin request failed.", error);
        return jsonResponse(request, { error: "The admin request failed. Please sign in again or try once more." }, 500);
    }
});
