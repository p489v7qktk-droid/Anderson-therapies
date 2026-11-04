document.addEventListener('DOMContentLoaded', () => {
    const navToggle = document.querySelector('.nav-toggle');
    const mainNavigation = document.querySelector('.main-nav');

    if (navToggle && mainNavigation) {
        const setNavigationState = (isOpen) => {
            navToggle.setAttribute('aria-expanded', String(isOpen));
            mainNavigation.classList.toggle('is-open', isOpen);
        };

        navToggle.addEventListener('click', () => {
            const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
            setNavigationState(!isOpen);
        });

        mainNavigation.addEventListener('click', (event) => {
            if (event.target.closest('a')) setNavigationState(false);
        });

        document.addEventListener('click', (event) => {
            if (!event.target.closest('header')) setNavigationState(false);
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                setNavigationState(false);
                navToggle.focus();
            }
        });
    }

    const contactForm = document.querySelector('[data-contact-form]');

    if (contactForm) {
        const formMessage = contactForm.querySelector('.form-message');
        const showMessage = (type, text) => {
            if (!formMessage) return;
            formMessage.className = `form-message ${type}`;
            formMessage.textContent = text;
        };

        contactForm.addEventListener('submit', (event) => {
            const requiredFields = [...contactForm.querySelectorAll('[required]')];
            const missing = requiredFields.filter((field) => !field.value.trim());

            if (missing.length > 0) {
                event.preventDefault();
                showMessage('error', 'Please complete all required fields before sending your enquiry.');
                return;
            }

            const emailField = contactForm.querySelector('#email');
            const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

            if (emailField && !emailPattern.test(emailField.value.trim())) {
                event.preventDefault();
                showMessage('error', 'Please enter a valid email address.');
            }
        });
    }

    const eventsForm = document.querySelector('[data-events-form]');

    if (eventsForm) {
        const formMessage = eventsForm.querySelector('[data-events-form-message]');
        const paymentMessage = document.querySelector('[data-events-message]');
        const paymentSection = document.querySelector('.payment-section');
        const paymentInstructions = document.querySelector('[data-payment-instructions]');
        const paymentLink = document.querySelector('[data-payment-link]');
        const paymentQrLink = document.querySelector('[data-payment-qr-link]');
        const paymentQr = document.querySelector('[data-payment-qr]');
        const paymentEmbed = document.querySelector('[data-payment-embed]');
        const loadStripeScript = () => new Promise((resolve, reject) => {
            if (window.Stripe) return resolve();
            const script = document.createElement('script');
            script.src = 'https://js.stripe.com/v3/';
            script.onload = resolve;
            script.onerror = () => reject(new Error('The secure payment form could not be loaded. Please check your connection and try again.'));
            document.head.append(script);
        });
        const priceCopy = document.querySelector('[data-price-copy]');
        const eventPriceCue = document.querySelector('[data-event-price]');
        const submitButton = eventsForm.querySelector('button[type="submit"]');
        const config = window.PARENT_SPACE_CONFIG;
        let isSubmitting = false;
        const idempotencyKey = crypto.randomUUID();
        let bookingReady = false;
        const setMessage = (target, type, text) => {
            if (!target) return;
            target.className = `form-message ${type}`;
            target.textContent = text;
        };

        paymentSection.hidden = true;

        const returnParams = new URLSearchParams(window.location.search);
        if (returnParams.get('paid') === '1') {
            setMessage(formMessage, 'success', 'Thank you - your payment is being confirmed. Your confirmation email will arrive shortly. Please check your junk folder if you do not see it.');
        } else if (returnParams.get('cancelled') === '1') {
            setMessage(formMessage, 'notice', 'Your payment was not completed. Your place is held for 30 minutes after booking; use the link in your email to pay, or submit the form again.');
        }
        const fetchBookingConfig = async () => {
            if (!config?.supabaseUrl || !config?.anonKey) {
                throw new Error('Online booking is not set up yet. Please contact Anderson Therapies to book.');
            }

            const baseUrl = config.supabaseUrl.replace(/\/+$/, '');
            const response = await fetch(`${baseUrl}/functions/v1/parent-space-booking`, {
                headers: {
                    apikey: config.anonKey,
                    Authorization: `Bearer ${config.anonKey}`,
                },
                cache: 'no-store',
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || 'Booking availability could not be checked.');

            if (priceCopy) {
                priceCopy.textContent = result.is_early_bird
                    ? 'Limited early bird tickets: £20. Standard tickets: £30 after that.'
                    : 'Early bird tickets are no longer available. Standard tickets: £30.';
            }
            if (eventPriceCue) {
                eventPriceCue.textContent = result.is_early_bird
                    ? 'Early bird £20'
                    : 'Standard tickets · £30';
            }

            if (!result.booking_open) {
                throw new Error(result.payment_link_ready
                    ? 'All places are currently held or booked. Please contact Anderson Therapies to check availability.'
                    : 'Standard ticket payment is being set up. Please try again later or contact Anderson Therapies.');
            }

            bookingReady = true;
            if (submitButton) submitButton.disabled = false;
        };

        fetchBookingConfig().catch((error) => {
            setMessage(formMessage, 'error', error.message);
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = 'Bookings temporarily unavailable';
            }
        });

        eventsForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            if (isSubmitting) {
                return;
            }

            const nameField = eventsForm.querySelector('#booking-name');
            const emailField = eventsForm.querySelector('#booking-email');
            const phoneField = eventsForm.querySelector('#booking-phone');
            const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

            if (!bookingReady) {
                setMessage(formMessage, 'error', 'Booking availability has not been confirmed. Please refresh the page or contact Anderson Therapies.');
                return;
            }

            if (!nameField.value.trim() || !emailField.value.trim() || !phoneField.value.trim()) {
                setMessage(formMessage, 'error', 'Please complete your name, email address and contact number.');
                return;
            }

            if (!emailPattern.test(emailField.value.trim())) {
                setMessage(formMessage, 'error', 'Please enter a valid email address.');
                return;
            }

            const attendeeChoice = eventsForm.querySelector('input[name="attendee_type"]:checked');
            if (!attendeeChoice) {
                setMessage(formMessage, 'error', 'Please tell us whether you are attending as a parent or carer, a professional, both or other.');
                return;
            }

            isSubmitting = true;
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = 'Saving booking details…';
            }
            setMessage(formMessage, 'notice', 'Saving your booking details…');

            const payload = {
                idempotency_key: idempotencyKey,
                name: nameField.value.trim(),
                email: emailField.value.trim(),
                telephone: phoneField.value.trim(),
                attendee_type: attendeeChoice.value,
                age_groups: Array.from(eventsForm.querySelectorAll('input[name="age_groups"]:checked')).map((box) => box.value),
                heard_about: eventsForm.querySelector('#booking-heard').value,
                photo_consent: eventsForm.querySelector('#photo-consent').checked,
                marketing_opt_in: eventsForm.querySelector('#marketing-opt-in').checked,
                access_needs: eventsForm.querySelector('#booking-needs').value.trim(),
                website: eventsForm.querySelector('[name="website"]').value,
            };

            try {
                const config = window.PARENT_SPACE_CONFIG;
                const baseUrl = config.supabaseUrl.replace(/\/+$/, '');
                const response = await fetch(`${baseUrl}/functions/v1/parent-space-booking`, {
                    method: 'POST',
                    headers: {
                        apikey: config.anonKey,
                        Authorization: `Bearer ${config.anonKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                    cache: 'no-store',
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result.ok) throw new Error(result.error || 'Your booking could not be saved.');

                const isEmbedded = result.payment_provider === 'stripe' && Boolean(result.stripe_client_secret && result.stripe_publishable_key);
                const isStripe = result.payment_provider === 'stripe';
                const paymentUrl = isEmbedded ? null : new URL(result.payment_url);
                const allowedHost = isStripe ? 'checkout.stripe.com' : 'pay.tide.co';
                if (paymentUrl && (paymentUrl.protocol !== 'https:' || paymentUrl.hostname !== allowedHost)) {
                    throw new Error('The payment link is not configured correctly. Please contact Anderson Therapies.');
                }
                const providerName = isStripe ? 'Stripe' : 'Tide';

                const price = result.amount_due_pence / 100;
                const verifyNotice = isStripe
                    ? 'Your place is confirmed automatically as soon as your payment goes through, and we’ll email you.'
                    : 'Payment is checked manually in Tide; we’ll email you once it has been verified.';
                const bookingNotice = `We’ve received your booking details. Payment of £${price} is still required, so your place is not confirmed yet. Booking reference: ${result.booking_reference}. Your place is held for 30 minutes while payment is pending. ${verifyNotice}`;
                setMessage(paymentMessage, 'notice', bookingNotice);
                paymentInstructions.textContent = isEmbedded
                    ? `Pay £${price} securely below. Your place is confirmed as soon as the payment is complete.`
                    : isStripe
                        ? `Pay £${price} securely with Stripe using the button below. Your place is confirmed as soon as the payment is complete.`
                        : `Pay £${price} with Tide using the button below. Your place is not confirmed until the payment has been checked and verified.`;
                if (paymentUrl) {
                    paymentLink.href = paymentUrl.toString();
                    paymentLink.textContent = `Pay £${price} with ${providerName}`;
                    paymentLink.hidden = false;
                }
                paymentQrLink.hidden = isStripe || result.amount_due_pence !== 2000;
                if (!isStripe && result.amount_due_pence === 2000) {
                    paymentQrLink.href = paymentUrl.toString();
                    paymentQrLink.setAttribute('aria-label', `Open Tide payment link for a £${price} early-bird ticket`);
                    paymentQr.alt = `QR code for the £${price} The Parent Space early-bird ticket payment`;
                }
                paymentSection.hidden = false;
                eventsForm.reset();
                if (result.email_error) setMessage(formMessage, 'error', result.email_error);
                else setMessage(formMessage, 'success', 'Your booking details have been saved.');
                if (submitButton) submitButton.textContent = 'Booking details received';
                paymentSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

                if (isEmbedded) {
                    await loadStripeScript();
                    const stripe = window.Stripe(result.stripe_publishable_key);
                    const checkout = await stripe.initEmbeddedCheckout({
                        fetchClientSecret: async () => result.stripe_client_secret,
                        onComplete: () => {
                            paymentEmbed.hidden = true;
                            paymentInstructions.textContent = 'Thank you - your payment has been received.';
                            setMessage(paymentMessage, 'success', `Payment received - thank you! Your booking reference is ${result.booking_reference}. Your place is being confirmed and a confirmation email is on its way. Please check your junk folder if it doesn’t arrive within a few minutes.`);
                            checkout.destroy();
                        },
                    });
                    paymentEmbed.hidden = false;
                    checkout.mount(paymentEmbed);
                } else {
                    paymentInstructions.textContent += ` Taking you to the secure ${providerName} payment page in a few seconds…`;
                    window.setTimeout(() => window.location.assign(paymentUrl.toString()), 4000);
                }
            } catch (error) {
                setMessage(formMessage, 'error', `${error.message} You can retry safely; this form uses the same booking request ID to avoid duplicate bookings.`);
                isSubmitting = false;
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.textContent = 'Send details & continue to payment';
                }
            }
        });
    }

    const approachVideo = document.querySelector('.approach-video-wrap video');

    if (!approachVideo) return;

    const setVideoPoster = () => {
        if (!approachVideo.videoWidth || !approachVideo.videoHeight || approachVideo.dataset.posterSet === 'true') return;

        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f5ecff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(approachVideo, 0, 0, canvas.width, canvas.height);

        approachVideo.poster = canvas.toDataURL('image/png');
        approachVideo.dataset.posterSet = 'true';
    };

    approachVideo.addEventListener('loadeddata', setVideoPoster);
    approachVideo.addEventListener('loadedmetadata', setVideoPoster);

    if (approachVideo.readyState >= 2) {
        setVideoPoster();
    }
});
