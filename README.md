# Anderson Therapies website

The public website is a static HTML, CSS and JavaScript site hosted on GitHub Pages.

- `index.html` is the home page.
- `events/index.html` contains The Parent Space booking page.
- `events/admin.html` is the private booking administration page.
- `styles.css` contains shared site styling.
- `script.js` contains shared browser behaviour and the event booking form.
- `supabase/` contains the Parent Space database migration and secure server-side booking/email functions.

Parent Space bookings use Supabase for the database and server-side functions, and Microsoft 365 (via Microsoft Graph) for business email. These services are not configured or deployed by default. Follow [the backend setup and test guide](./supabase/README.md) before publishing booking changes. The booking form stays disabled until the public Supabase URL and anon key are set in `events/booking-config.js`.

Never put Supabase service-role keys, Microsoft client secrets or other credentials in website files or source control. Tide payment status is verified manually in the authenticated admin page; a browser redirect is not proof of payment.
