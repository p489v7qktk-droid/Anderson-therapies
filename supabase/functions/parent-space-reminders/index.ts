import { rest, restPatch, sendEmail } from "../_shared/backend.ts";
import { type Booking, unpaidReminderEmail } from "../_shared/emails.ts";
import { requiredEnv } from "../_shared/http.ts";

const TABLE = "parent_space_bookings";

Deno.serve(async (request: Request): Promise<Response> => {
    const expected = requiredEnv("REMINDER_SECRET");
    const supplied = request.headers.get("x-reminder-secret") ?? "";
    if (request.method !== "POST" || supplied.length !== expected.length || supplied !== expected) {
        return new Response("Not allowed.", { status: 403 });
    }

    const now = Date.now();
    const expiredBefore = new Date(now - 2 * 60 * 1000).toISOString();
    const createdAfter = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    try {
        const due = await rest<Booking[]>(
            `${TABLE}?select=id,booking_reference,full_name,email,telephone,amount_due_pence,amount_paid_pence,payment_url,status` +
                `&status=in.(pending_payment,expired)&reminder_sent_at=is.null` +
                `&expires_at=lt.${encodeURIComponent(expiredBefore)}&created_at=gt.${encodeURIComponent(createdAfter)}&limit=20`,
        );

        for (const booking of due) {
            try {
                const claimed = await restPatch<{ id: string }[]>(
                    `${TABLE}?id=eq.${booking.id}&reminder_sent_at=is.null&status=in.(pending_payment,expired)`,
                    { reminder_sent_at: new Date().toISOString() },
                );
                if (!claimed.length) continue;

                // Someone who went on to pay under another booking doesn't need the reminder.
                const paid = await rest<{ id: string }[]>(
                    `${TABLE}?select=id&status=eq.paid&email=eq.${encodeURIComponent(booking.email)}&limit=1`,
                );
                if (paid.length) {
                    skipped++;
                    continue;
                }

                try {
                    await sendEmail({
                        to: booking.email,
                        ...unpaidReminderEmail(booking),
                        idempotencyKey: crypto.randomUUID(),
                    });
                    sent++;
                } catch (error) {
                    failed++;
                    console.error("Unpaid reminder could not be sent.", booking.booking_reference, error);
                    await restPatch(`${TABLE}?id=eq.${booking.id}`, { reminder_sent_at: null });
                }
            } catch (error) {
                failed++;
                console.error("Unpaid reminder failed.", booking.booking_reference, error);
            }
        }
    } catch (error) {
        console.error("Reminder run failed.", error);
        return new Response("Run failed.", { status: 500 });
    }

    return new Response(JSON.stringify({ sent, skipped, failed }), {
        headers: { "Content-Type": "application/json" },
    });
});
