# Parent Space booking backend

The public website remains on GitHub Pages. Supabase provides the booking database, server-side booking functions and authenticated admin actions. Booking emails are sent through Microsoft 365 using Microsoft Graph from your business mailbox. Tide payment status is **not** inferred from a browser redirect: Sabrina checks Tide and marks a booking paid in the admin.

## Important payment-link limitation

The current Tide checkout is a shared £20 payment link. Tide's published Payment Links guidance describes checking payments in the Tide app/dashboard; it does not document a payment-status webhook or API that links this existing shared link to a specific Parent Space booking. The site therefore verifies payment manually.

The site switches new booking requests to £30 when eight £20 bookings have been marked paid, or on 1 February 2027, whichever happens first. The £30 Tide link must be created and saved in the admin before standard-price bookings can proceed. The switch changes the website and emails; it cannot deactivate Tide's old £20 link. Disable that link in Tide when the early-bird allocation ends. A late £20 payment is flagged for review and is not confirmed automatically.

## One-time setup

1. Create the Supabase project in the specific **West Europe (London), `eu-west-2`** region, rather than a general Europe region, and note its project URL, anon key and service-role key. The project region determines the location of primary database, Auth and Storage data, but does not guarantee that every backup, log, Edge Function or subprocessor activity remains in that region. Review the [Supabase DPA](https://supabase.com/legal/customer-resources/data-processing-addendum), [GDPR/residency guidance](https://supabase.com/docs/guides/security/gdpr-compliance) and [current subprocessor list](https://supabase.com/legal/customer-resources/subprocessor-list). The URL and anon key are used by the public site; protect the service-role key and never put it in website files or send it in chat.
2. Apply the migration in `migrations/20261031230000_parent_space_bookings.sql` using the Supabase SQL editor or Supabase CLI. With the CLI, link the project and run `supabase db push` from the repository root.
3. In Supabase Auth, create only the authorised `sabrinaanderson@andersontherapies.co.uk` admin account, disable public sign-ups, and allow the exact admin redirect URL `https://www.andersontherapies.co.uk/events/admin.html`. The admin signs in with a one-time email link and must enrol an authenticator app (TOTP); the admin page requires an AAL2 session and the server rejects requests without it. Protect the mailbox with its own MFA, use a unique password, and do not share the admin account. The application allows only the configured admin email and keeps its access token in session storage.
4. Configure a Microsoft Entra app for server-side email sending from `sabrinaanderson@andersontherapies.co.uk` (or your chosen sender mailbox):
   - Create an app registration in your Microsoft tenant.
   - Do not grant Entra Graph `Mail.Send` (it allows sending as any mailbox). Use RBAC for Applications in Exchange Online PowerShell instead: `New-ServicePrincipal` (app ID and the Enterprise application object ID), `New-ManagementScope -Name ParentSpaceMailbox -RecipientRestrictionFilter "PrimarySmtpAddress -eq '<sender>'"`, then `New-ManagementRoleAssignment -App <object ID> -Role "Application Mail.Send" -CustomResourceScope ParentSpaceMailbox`. Check with `Test-ServicePrincipalAuthorization`.
   - Create a client secret.
   - Restrict who can access your tenant/admin accounts and keep MFA enabled on administrator mailboxes.
   Review your Microsoft 365 tenant's data residency, DPA/Online Services Terms, and transfer safeguards through your Microsoft admin/legal documentation.
5. Add these server-side Supabase Edge Function secrets in the Supabase dashboard. Do not commit them:
   - `ADMIN_EMAIL=sabrinaanderson@andersontherapies.co.uk`
   - `MICROSOFT_TENANT_ID`
   - `MICROSOFT_CLIENT_ID`
   - `MICROSOFT_CLIENT_SECRET`
   - `MICROSOFT_SENDER_UPN` (for example, `sabrinaanderson@andersontherapies.co.uk`)
   - `ALLOWED_ORIGINS=https://www.andersontherapies.co.uk,https://andersontherapies.co.uk`
   - `RATE_LIMIT_SECRET` set to a randomly generated secret of at least 32 characters
   Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions.
6. Deploy `parent-space-booking` and `parent-space-admin` with `supabase functions deploy parent-space-booking` and `supabase functions deploy parent-space-admin`. Both functions disable gateway JWT checking intentionally: the public booking endpoint validates its input, and the admin endpoint independently verifies the signed-in user and exact allowlisted admin email before every privileged action.
7. Copy the Supabase project URL and **anon** key into `events/booking-config.js`. The anon key is public; database access is still denied by row-level security. Never put the service-role key there.
8. Before standard sales start, create a £30 Tide payment link. Sign in at `/events/admin.html`, save the link and disable the old £20 link in Tide. The old QR code is shown only while the £20 ticket is current; no £30 QR code is assumed.

## Test before the production site is published

Use a private preview served over HTTP(S), not a `file://` URL. Add that preview origin to both `ALLOWED_ORIGINS` and Supabase Auth's allowed redirect URLs. Keep the production GitHub Pages site unchanged until all checks pass.

1. Set the public URL and anon key in `events/booking-config.js`; deploy the migration and functions to a test Supabase project; configure Microsoft Graph email credentials and sender mailbox.
2. Open `/events/` in the preview and submit one booking using the provided test email address. Confirm it appears in the authenticated admin list with a unique reference, booking timestamp, quoted amount and `pending_payment` status.
3. Confirm the pending email contains the same first name, amount, reference and working £20 Tide link. Confirm the page still says payment is required and not confirmed.
4. The current £20 Tide link is live and collects real money. Do not use it for a test payment unless you explicitly approve that charge and any refund/fee implications. If an authorised real payment appears in Tide, enter the received amount in the admin and choose **Verify & confirm**. Confirm that the status becomes `paid` and the confirmation email contains the verified amount, booking reference, venue links, reflection wording, `Sabrina & Malachi`, and the phone number.
5. Repeat the same booking request and reload/resubmit the same attendee to verify idempotency and duplicate protection; verify no extra booking or pending email is created. Use **Send confirmation again** once and confirm it sends only the explicitly requested additional message.
6. Exercise capacity, 30-minute pending holds, wrong-amount review, the eight-paid-ticket price transition, missing £30 link behaviour, and standard-price link configuration in the test project. Do not use production Tide payments for simulated cases.
7. Do not publish the website or accept real bookings until Sabrina has reviewed the preview and completed a test booking. No test payment will be initiated automatically.

## Data and access

Booking tables have row-level security enabled and no `anon`/`authenticated` table policies. Only server functions use the service-role key. Admin requests require a verified Supabase session for `ADMIN_EMAIL`. Admin rows include booking time, name, email, telephone, amount due/paid, booking reference, payment state, access notes and photo-consent choice.

The admin page guides the authorised user through TOTP authenticator enrolment and verification. The server independently checks the signed-in user and requires the JWT's `aal` claim to be `aal2` before any admin action; a magic-link-only session cannot list or change bookings. Keep the authenticator and the admin mailbox secured, and restrict account/project access to the named administrator. Supabase Free does not provide automatic database backups; export the database regularly and store the export securely. The privacy notice describes that Supabase's region choice covers primary data, not necessarily every log, backup, function or subprocessor.

The booking form reserves a place for 30 minutes. Paid bookings and active pending holds count toward the 15-person capacity; expired holds and payment-review cases do not reserve a place. The public endpoint rate-limits requests to five per email address and ten per detected client IP per hour, storing only keyed hashes for those limits. If Tide shows a payment that does not match the ticket price, or arrives after the early-bird allocation/capacity is full, the record is flagged for review and no confirmation is sent.
