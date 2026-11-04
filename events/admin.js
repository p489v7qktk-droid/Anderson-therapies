document.addEventListener("DOMContentLoaded", () => {
    const config = window.PARENT_SPACE_CONFIG;
    const message = document.querySelector("[data-admin-message]");
    const loginPanel = document.querySelector("[data-login-panel]");
    const mfaPanel = document.querySelector("[data-mfa-panel]");
    const mfaTitle = document.querySelector("[data-mfa-title]");
    const mfaInstructions = document.querySelector("[data-mfa-instructions]");
    const mfaEnrollment = document.querySelector("[data-mfa-enrollment]");
    const mfaQr = document.querySelector("[data-mfa-qr]");
    const mfaSecret = document.querySelector("[data-mfa-secret]");
    const mfaForm = document.querySelector("[data-mfa-form]");
    const dashboard = document.querySelector("[data-dashboard]");
    const loginForm = document.querySelector("[data-login-form]");
    const linkForm = document.querySelector("[data-standard-link-form]");
    const bookingsBody = document.querySelector("[data-bookings]");
    const tokenKey = "parentSpaceAdminAccessToken";
    let mfaFactorId = "";
    let mfaChallengeId = "";

    const showMessage = (type, text) => {
        message.className = `form-message ${type}`;
        message.textContent = text;
    };

    const serviceUrl = () => config.supabaseUrl.replace(/\/+$/, "");
    const getToken = () => sessionStorage.getItem(tokenKey);
    const tokenClaims = (token) => {
        const parts = token.split(".");
        if (parts.length !== 3) return {};
        try {
            const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
            const bytes = Uint8Array.from(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")), character => character.charCodeAt(0));
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch {
            return {};
        }
    };

    const apiRequest = async (path, options = {}) => {
        const response = await fetch(`${serviceUrl()}${path}`, {
            ...options,
            headers: {
                apikey: config.anonKey,
                ...(options.headers || {}),
            },
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.msg || result.error_description || result.message || result.error || "The request could not be completed.");
        return result;
    };

    const adminRequest = async (body) => {
        const token = getToken();
        if (!token) throw new Error("Please sign in again.");
        return apiRequest("/functions/v1/parent-space-admin", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });
    };

    const mfaRequest = (path, token, options = {}) => apiRequest(path, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(options.headers || {}),
        },
    });

    const requireAuthenticator = async (token) => {
        const factorsResult = await mfaRequest("/auth/v1/factors", token);
        const factors = Array.isArray(factorsResult.totp)
            ? factorsResult.totp
            : (factorsResult.all || []).filter(factor => factor.factor_type === "totp");
        let factor = factors.find(item => item.status === "verified");

        if (factor) {
            mfaTitle.textContent = "Verify your authenticator";
            mfaInstructions.textContent = "Enter the current 6-digit code from your authenticator app to continue.";
            mfaEnrollment.hidden = true;
        } else {
            factor = await mfaRequest("/auth/v1/factors", token, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ factor_type: "totp", friendly_name: "Parent Space admin" }),
            });
            if (!factor.id || !factor.totp?.qr_code || !factor.totp?.secret) {
                throw new Error("Authenticator setup could not be started. Please sign in again.");
            }
            mfaTitle.textContent = "Set up your authenticator";
            mfaInstructions.textContent = "Scan this QR code with an authenticator app, then enter the 6-digit code it displays. This is required before the booking dashboard can be opened.";
            if (!factor.totp.qr_code.startsWith("data:image/")) {
                throw new Error("Authenticator setup returned an invalid QR code.");
            }
            mfaQr.src = factor.totp.qr_code;
            mfaSecret.textContent = factor.totp.secret;
            mfaEnrollment.hidden = false;
        }

        if (!factor?.id) throw new Error("No usable authenticator factor was found.");
        const challenge = await mfaRequest(`/auth/v1/factors/${encodeURIComponent(factor.id)}/challenge`, token, {
            method: "POST",
        });
        if (!challenge.id) throw new Error("Authenticator verification could not be started.");
        mfaFactorId = factor.id;
        mfaChallengeId = challenge.id;
        loginPanel.hidden = true;
        dashboard.hidden = true;
        mfaPanel.hidden = false;
        document.querySelector("#admin-mfa-code").focus();
    };

    const showDashboard = (signedIn) => {
        loginPanel.hidden = signedIn;
        dashboard.hidden = !signedIn;
    };

    const addCell = (row, value, className = "") => {
        const cell = document.createElement("td");
        cell.textContent = value ?? "";
        if (className) cell.className = className;
        row.append(cell);
        return cell;
    };

    const loadBookings = async () => {
        showMessage("notice", "Loading bookings…");
        const result = await adminRequest({ action: "list" });
        bookingsBody.replaceChildren();

        for (const booking of result.bookings) {
            const row = document.createElement("tr");
            addCell(row, booking.booking_reference);
            addCell(row, new Date(booking.created_at).toLocaleString());
            addCell(row, booking.full_name);
            addCell(row, `${booking.email}\n${booking.telephone}`);
            addCell(row, `Photos: ${booking.photo_consent === true ? "consent" : booking.photo_consent === false ? "no consent" : "no choice"}${booking.access_needs ? `\nAccess: ${booking.access_needs}` : ""}`);
            addCell(row, `£${(booking.amount_due_pence / 100).toFixed(0)} due${booking.amount_paid_pence === null ? "" : ` · £${(booking.amount_paid_pence / 100).toFixed(0)} received`}`);
            addCell(row, booking.status.replaceAll("_", " "), "admin-status");

            const actionCell = document.createElement("td");
            const actions = document.createElement("div");
            actions.className = "booking-action";

            if (booking.status !== "paid") {
                const amount = document.createElement("select");
                amount.setAttribute("aria-label", `Amount verified in Tide for ${booking.booking_reference}`);
                for (const pence of [2000, 3000]) {
                    const option = document.createElement("option");
                    option.value = String(pence);
                    option.textContent = `£${(pence / 100).toFixed(0)} received`;
                    option.selected = pence === booking.amount_due_pence;
                    amount.append(option);
                }

                const paidButton = document.createElement("button");
                paidButton.type = "button";
                paidButton.className = "btn primary";
                paidButton.textContent = "Verify & confirm";
                paidButton.addEventListener("click", async () => {
                    if (!window.confirm(`Have you checked Tide and verified receipt of £${(Number(amount.value) / 100).toFixed(0)} for ${booking.booking_reference}? This will mark the booking as paid and send the confirmation email.`)) return;
                    paidButton.disabled = true;
                    try {
                        const result = await adminRequest({
                            action: "mark-paid",
                            booking_id: booking.id,
                            amount_paid_pence: Number(amount.value),
                        });
                        await loadBookings();
                        if (result.warning) showMessage("error", result.warning);
                        else showMessage("success", result.confirmation_email_sent ? "Payment recorded and confirmation email sent." : "Payment is recorded. The confirmation email was already sent or is being processed.");
                    } catch (error) {
                        try {
                            await loadBookings();
                            showMessage("error", error.message);
                        } catch (refreshError) {
                            showMessage("error", `${error.message} Booking list refresh also failed: ${refreshError.message}`);
                        }
                    }
                });
                actions.append(amount, paidButton);
            } else {
                const resendButton = document.createElement("button");
                resendButton.type = "button";
                resendButton.className = "btn secondary";
                resendButton.textContent = "Send confirmation again";
                resendButton.addEventListener("click", async () => {
                    resendButton.disabled = true;
                    try {
                        const result = await adminRequest({
                            action: "resend-confirmation",
                            booking_id: booking.id,
                            request_id: crypto.randomUUID(),
                        });
                        showMessage("success", result.confirmation_email_sent ? "Confirmation email sent again." : "The confirmation email is already being processed.");
                    } catch (error) {
                        resendButton.disabled = false;
                        showMessage("error", error.message);
                    }
                });
                actions.append(resendButton);
            }

            actionCell.append(actions);
            row.append(actionCell);
            bookingsBody.append(row);
        }

        const sold = result.settings.early_bird_sold;
        showMessage("notice", `${result.bookings.length} most recent booking(s) shown. ${sold} of ${result.settings.early_bird_limit} early-bird tickets marked paid. ${result.settings.places_reserved} of ${result.settings.capacity} places reserved.`);
        if (result.settings.standard_payment_url) {
            document.querySelector("#standard-payment-link").value = result.settings.standard_payment_url;
        }
        showDashboard(true);
    };

    if (!config?.supabaseUrl || !config?.anonKey) {
        showMessage("error", "Admin sign-in is not configured yet. Complete the private setup steps before using this page.");
        loginForm.hidden = true;
        return;
    }

    const hash = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = hash.get("access_token");
    if (accessToken) {
        sessionStorage.setItem(tokenKey, accessToken);
        history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }

    const resumeAdminSession = async () => {
        const token = getToken();
        if (!token) {
            showDashboard(false);
            return;
        }

        if (tokenClaims(token).aal !== "aal2") {
            await requireAuthenticator(token);
            return;
        }

        await loadBookings();
    };

    resumeAdminSession().catch((error) => {
        sessionStorage.removeItem(tokenKey);
        showDashboard(false);
        mfaPanel.hidden = true;
        showMessage("error", error.message);
    });

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const email = new FormData(loginForm).get("email").toString().trim();
        const redirectTo = `${window.location.origin}${window.location.pathname}`;
        try {
            await apiRequest(`/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, create_user: false }),
            });
            showMessage("success", "If this email is authorised, a secure sign-in link will arrive shortly.");
        } catch (error) {
            showMessage("error", error.message);
        }
    });

    mfaForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitButton = mfaForm.querySelector('button[type="submit"]');
        const code = new FormData(mfaForm).get("code").toString().trim();
        submitButton.disabled = true;
        try {
            const token = getToken();
            if (!token || !mfaFactorId || !mfaChallengeId) {
                throw new Error("Authenticator verification expired. Please sign in again.");
            }
            const result = await mfaRequest(`/auth/v1/factors/${encodeURIComponent(mfaFactorId)}/verify`, token, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ challenge_id: mfaChallengeId, code }),
            });
            if (!result.access_token || tokenClaims(result.access_token).aal !== "aal2") {
                throw new Error("The authenticator code was not verified. Check the code and try again.");
            }
            sessionStorage.setItem(tokenKey, result.access_token);
            mfaPanel.hidden = true;
            await loadBookings();
        } catch (error) {
            showMessage("error", error.message);
        } finally {
            submitButton.disabled = false;
        }
    });

    linkForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const paymentUrl = new FormData(linkForm).get("payment_url").toString().trim();
        try {
            await adminRequest({ action: "set-standard-link", payment_url: paymentUrl });
            showMessage("success", "The £30 Tide link is saved. Future standard-price bookings can now proceed.");
            await loadBookings();
        } catch (error) {
            showMessage("error", error.message);
        }
    });

    document.querySelector("[data-refresh]").addEventListener("click", () => {
        loadBookings().catch((error) => showMessage("error", error.message));
    });

    document.querySelector("[data-sign-out]").addEventListener("click", () => {
        sessionStorage.removeItem(tokenKey);
        mfaPanel.hidden = true;
        showDashboard(false);
        showMessage("notice", "You have signed out.");
    });
});
