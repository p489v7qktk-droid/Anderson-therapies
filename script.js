document.addEventListener('DOMContentLoaded', () => {
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
