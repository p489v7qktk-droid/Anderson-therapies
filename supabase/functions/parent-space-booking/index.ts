import { rpc, restPatch, sendEmail } from "../_shared/backend.ts";
import { adminNotificationEmail, type Booking } from "../_shared/emails.ts";
import { createCheckoutUrl, stripeConfigured } from "../_shared/stripe.ts";
import { hmacHex, jsonResponse, originIsAllowed, preflightResponse, readJson, requiredEnv } from "../_shared/http.ts";

Deno.serve(async (request: Request): Promise<Response> => {
    if (!originIsAllowed(request)) return jsonResponse(request, { error: "This website origin is not allowed." }, 403);
    if (request.method === "OPTIONS") return preflightResponse(request);

    try {
        if (request.method === "GET") {
            const config = await rpc("parent_space_config", {});
            return jsonResponse(request, config);
        }

        if (request.method !== "POST") {
            return jsonResponse(request, { error: "Use GET or POST for this endpoint." }, 405);
        }

        const body = await readJson(request);
        if (typeof body.website === "string" && body.website.trim()) {
            return jsonResponse(request, { error: "Unable to process this booking. Please check the details and try again." }, 422);
        }

        const name = typeof body.name === "string" ? body.name.trim() : "";
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const telephone = typeof body.telephone === "string" ? body.telephone.trim() : "";
        const accessNeeds = typeof body.access_needs === "string" ? body.access_needs.trim() : "";
        const photoConsent = typeof body.photo_consent === "boolean" ? body.photo_consent : null;
        const marketingOptIn = body.marketing_opt_in === true;
        const attendeeTypes = ["Parent or carer", "Professional working with children and young people", "Both", "Other"];
        const ageGroupOptions = ["0–4 years", "5–10 years", "11–16 years", "17+ years"];
        const heardOptions = ["Instagram", "LinkedIn", "WhatsApp", "Friend or colleague", "Oak House", "Other"];
        const attendeeType = typeof body.attendee_type === "string" ? body.attendee_type : "";
        const ageGroups = Array.isArray(body.age_groups) ? body.age_groups : [];
        const heardAbout = typeof body.heard_about === "string" ? body.heard_about : "";
        if (
            !attendeeTypes.includes(attendeeType) ||
            !ageGroups.every((group: unknown) => typeof group === "string" && ageGroupOptions.includes(group)) ||
            (heardAbout && !heardOptions.includes(heardAbout))
        ) {
            return jsonResponse(request, { error: "Please check your answers and try again." }, 422);
        }
        const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : "";
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

        if (
            !name || name.length > 120 ||
            !emailPattern.test(email) || email.length > 254 ||
            telephone.length < 3 || telephone.length > 40 ||
            accessNeeds.length > 1200 ||
            !uuidPattern.test(idempotencyKey)
        ) {
            return jsonResponse(request, { error: "Please check your name, email, telephone number and optional access information." }, 422);
        }

        const forwardedIp = request.headers.get("cf-connecting-ip") ??
            request.headers.get("x-real-ip") ??
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
        const rateLimit = await rpc<{ ok: boolean; allowed: boolean }>(
            "consume_parent_space_booking_rate_limit",
            {
                p_ip_hash: forwardedIp ? await hmacHex(`ip:${forwardedIp}`) : null,
                p_email_hash: await hmacHex(`email:${email}`),
            },
        );
        if (!rateLimit.ok || !rateLimit.allowed) {
            return jsonResponse(request, { error: "Too many booking attempts. Please wait before trying again." }, 429);
        }

        const result = await rpc<{
            ok: boolean;
            error?: string;
            booking?: Booking;
        }>("create_parent_space_booking", {
            p_idempotency_key: idempotencyKey,
            p_full_name: name,
            p_email: email,
            p_telephone: telephone,
            p_photo_consent: photoConsent,
            p_access_needs: accessNeeds,
        });

        if (!result.ok || !result.booking) {
            return jsonResponse(request, { error: result.error ?? "Unable to create the booking." }, 409);
        }

        if (result.booking.status !== "pending_payment") {
            const existingMessage = result.booking.status === "paid"
                ? `This attendee already has a paid booking (${result.booking.booking_reference}).`
                : result.booking.status === "payment_review"
                    ? `This attendee already has a booking under review (${result.booking.booking_reference}). Please contact Anderson Therapies.`
                    : `This booking request is no longer active (${result.booking.booking_reference}). Please submit the form again to request a new place.`;
            return jsonResponse(request, {
                error: existingMessage,
            }, 409);
        }

        let paymentUrl = result.booking.payment_url;
        try {
            await restPatch(`parent_space_bookings?id=eq.${result.booking.id}`, {
                attendee_type: attendeeType,
                age_groups: ageGroups.length ? ageGroups : null,
                heard_about: heardAbout || null,
                marketing_opt_in: marketingOptIn,
            });
        } catch (error) {
            console.error("Extra booking answers could not be saved.", error);
        }
        let paymentProvider: "stripe" | "tide" = "tide";
        let clientSecret: string | null = null;
        if (stripeConfigured()) {
            try {
                const checkout = await createCheckoutUrl(result.booking);
                if (checkout.url) paymentUrl = checkout.url;
                else paymentUrl = "";
                clientSecret = checkout.clientSecret;
                paymentProvider = "stripe";
            } catch (error) {
                console.error("Stripe Checkout could not be created; falling back to Tide.", error);
            }
        }
        const booking = { ...result.booking, payment_url: paymentUrl };

        try {
            await sendEmail({
                to: requiredEnv("ADMIN_EMAIL"),
                ...adminNotificationEmail("booked", {
                    ...booking,
                    telephone,
                    access_needs: accessNeeds,
                    photo_consent: photoConsent,
                    attendee_type: attendeeType,
                    age_groups: ageGroups,
                    heard_about: heardAbout,
                    marketing_opt_in: marketingOptIn,
                }),
                idempotencyKey: crypto.randomUUID(),
            });
        } catch (error) {
            console.error("Admin booking notification could not be sent.", error);
        }

        return jsonResponse(request, {
            ok: true,
            booking_reference: result.booking.booking_reference,
            amount_due_pence: result.booking.amount_due_pence,
            payment_url: paymentUrl,
            payment_provider: paymentProvider,
            stripe_client_secret: clientSecret,
            stripe_publishable_key: clientSecret ? Deno.env.get("STRIPE_PUBLISHABLE_KEY") : null,
            payment_status: "pending_payment",
        }, 201);
    } catch (error) {
        console.error("Parent Space booking request failed.", error);
        const message = error instanceof Error && error.message.startsWith("Send booking details")
            ? error.message
            : "We couldn't process your booking just now. Please try again or contact Anderson Therapies.";
        return jsonResponse(request, { error: message }, 500);
    }
});
