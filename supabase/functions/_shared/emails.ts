export type Booking = {
    id: string;
    booking_reference: string;
    full_name: string;
    email: string;
    telephone: string;
    amount_due_pence: number;
    amount_paid_pence: number | null;
    payment_url: string;
    status: string;
};

const escapeHtml = (value: string): string =>
    value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[character] ?? character);

const firstName = (name: string): string => name.trim().split(/\s+/)[0] || "there";
const pounds = (pence: number): string => `£${(pence / 100).toFixed(0)}`;
const oakHouseUrl = "https://www.theoak-house.co.uk/";
const directionsUrl = "https://www.google.com/maps/search/?api=1&query=The+Oak+House+Studio+and+Therapies%2C+Church+Street%2C+Hatfield+AL9+5AR";
const websiteUrl = "https://www.andersontherapies.co.uk/";

function documentHtml(content: string): string {
    return `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#f7f1f7;color:#3b3b4d;font-family:Arial,sans-serif;line-height:1.6"><main style="max-width:640px;margin:auto;padding:28px;background:#fff;border:1px solid #e6d9ef;border-radius:16px">${content}</main></body></html>`;
}

export type BookingDetails = Booking & {
    access_needs?: string | null;
    photo_consent?: boolean | null;
    attendee_type?: string | null;
    age_groups?: string[] | null;
    heard_about?: string | null;
    marketing_opt_in?: boolean | null;
};

export function adminNotificationEmail(
    kind: "booked" | "paid",
    booking: BookingDetails,
): { subject: string; html: string; text: string } {
    const paid = kind === "paid";
    const subject = paid
        ? `PAID: Parent Space ${booking.booking_reference} - ${booking.full_name}`
        : `New Parent Space booking ${booking.booking_reference} - ${booking.full_name}`;
    const rows: [string, string][] = [
        ["Status", paid ? `PAID ${pounds(booking.amount_paid_pence ?? booking.amount_due_pence)} - place confirmed` : `Awaiting payment of ${pounds(booking.amount_due_pence)}`],
        ["Reference", booking.booking_reference],
        ["Name", booking.full_name],
        ["Email", booking.email],
        ["Telephone", booking.telephone],
        ["Attending as", booking.attendee_type || "Not given"],
        ["Children's age groups", booking.age_groups?.length ? booking.age_groups.join(", ") : "Not given"],
        ["Access needs", booking.access_needs?.trim() || "None given"],
        ["How they heard about it", booking.heard_about || "Not given"],
        ["Photo consent", booking.photo_consent === true ? "Yes" : booking.photo_consent === false ? "No" : "Not answered"],
        ["Future events emails", booking.marketing_opt_in ? "Yes" : "No"],
    ];
    const html = documentHtml(`
        <p><strong>${paid ? "A payment has been received." : "Someone has just booked The Parent Space."}</strong></p>
        <table style="border-collapse:collapse">${rows.map(([label, value]) =>
            `<tr><td style="padding:4px 14px 4px 0;font-weight:bold;vertical-align:top">${label}</td><td style="padding:4px 0">${escapeHtml(value).replace(/\n/g, "<br>")}</td></tr>`
        ).join("")}</table>
        <p style="color:#777;font-size:13px">Internal notification - please don't forward, as it contains personal details.</p>
    `);
    const text = `${paid ? "A payment has been received." : "Someone has just booked The Parent Space."}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\nInternal notification - please don't forward, as it contains personal details.`;
    return { subject, html, text };
}

export function unpaidReminderEmail(booking: Booking): { subject: string; html: string; text: string } {
    const name = escapeHtml(firstName(booking.full_name));
    const reference = escapeHtml(booking.booking_reference);
    const bookingPage = `${websiteUrl}events/index.html`;
    const subject = "Your Parent Space place is not confirmed yet";
    const html = documentHtml(`
        <p>Hello ${name},</p>
        <p>Thank you for your interest in The Parent Space!</p>
        <p><strong>Your place is not confirmed</strong>, as we haven't received your payment.</p>
        <p>If you'd still like to join us, you can book again here:</p>
        <p><a href="${bookingPage}" style="display:inline-block;padding:12px 20px;border-radius:24px;background:#6b4c8a;color:#fff;text-decoration:none;font-weight:bold">Go to the booking page</a></p>
        <p>If you've only just paid, there's nothing more to do and please don't pay again - your confirmation email will arrive shortly.</p>
        <p><strong>Booking reference:</strong> ${reference}</p>
        <p>Warm wishes,<br><strong>Sabrina &amp; Malachi (KB)</strong><br>The Parent Space<br><a href="${websiteUrl}">Anderson Therapies</a><br>+447927188998</p>
    `);
    const text = `Hello ${firstName(booking.full_name)},\n\nThank you for your interest in The Parent Space!\n\nYour place is not confirmed, as we haven't received your payment.\n\nIf you'd still like to join us, you can book again here:\n${bookingPage}\n\nIf you've only just paid, there's nothing more to do and please don't pay again - your confirmation email will arrive shortly.\n\nBooking reference: ${booking.booking_reference}\n\nWarm wishes,\nSabrina & Malachi (KB)\nThe Parent Space\nAnderson Therapies\n${websiteUrl}\n+447927188998`;
    return { subject, html, text };
}
export function confirmationEmail(booking: Booking): { subject: string; html: string; text: string } {
    const name = escapeHtml(firstName(booking.full_name));
    const reference = escapeHtml(booking.booking_reference);
    const price = pounds(booking.amount_paid_pence ?? booking.amount_due_pence);
    const subject = "Your Parent Space place is confirmed";
    const html = documentHtml(`
        <p>Hello ${name},</p>
        <p>Thank you for booking The Parent Space! We're looking forward to welcoming you for an afternoon of connection, reflection, music and drumming.</p>
        <p><strong>Your place is confirmed!</strong></p>
        <p><strong>Sunday 28 February 2027</strong><br><strong>Time:</strong> 2:00–4:00 pm<br><strong>Venue:</strong> The Oak House Studio and Therapies<br>Church Street, Hatfield, AL9 5AR</p>
        <p><strong>Payment received:</strong> ${price}<br><strong>Booking reference:</strong> ${reference}</p>
        <h2 style="font-size:18px;color:#4a148c">A little about the afternoon</h2>
        <p>We'll explore creative ways of responding to children's anxiety and emotional distress through reflection, rhythm, drumming and shared activities.</p>
        <p>No previous experience of CBT, music or drumming is needed. Just come as you are!</p>
        <h2 style="font-size:18px;color:#4a148c">Getting here</h2>
        <p>Complimentary on-site parking is available. The venue is also a short walk from Hatfield train station.</p>
        <p><a href="${escapeHtml(oakHouseUrl)}">Visit The Oak House Studio and Therapies</a> · <a href="${escapeHtml(directionsUrl)}">Get directions</a></p>
        <p>We look forward to meeting you!</p>
        <p>Warm wishes,<br><strong>Sabrina &amp; Malachi (KB)</strong><br>The Parent Space<br><a href="${websiteUrl}">Anderson Therapies</a><br>+447927188998</p>
    `);
    const text = `Hello ${firstName(booking.full_name)},\n\nThank you for booking The Parent Space! We're looking forward to welcoming you for an afternoon of connection, reflection, music and drumming.\n\nYour place is confirmed!\n\nSunday 28 February 2027\nTime: 2:00–4:00 pm\nVenue: The Oak House Studio and Therapies\nChurch Street, Hatfield, AL9 5AR\n\nPayment received: ${price}\nBooking reference: ${booking.booking_reference}\n\nA little about the afternoon\nWe'll explore creative ways of responding to children's anxiety and emotional distress through reflection, rhythm, drumming and shared activities.\n\nNo previous experience of CBT, music or drumming is needed. Just come as you are!\n\nGetting here\nComplimentary on-site parking is available. The venue is also a short walk from Hatfield train station.\n\nThe Oak House Studio and Therapies: ${oakHouseUrl}\nGet directions: ${directionsUrl}\n\nWe look forward to meeting you!\n\nWarm wishes,\nSabrina & Malachi (KB)\nThe Parent Space\nAnderson Therapies\n${websiteUrl}\n+447927188998`;
    return { subject, html, text };
}
