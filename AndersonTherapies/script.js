document.addEventListener('DOMContentLoaded', () => {
    const floatingLogoWrap = document.querySelector('.floating-logo-wrap');

    if (floatingLogoWrap) {
        const footer = document.querySelector('.site-footer');

        const updateFloat = () => {
            const scrollShift = window.scrollY * 0.12;
            const maxShift = footer
                ? Math.max(0, footer.getBoundingClientRect().top - window.innerHeight + 80)
                : Number.POSITIVE_INFINITY;

            floatingLogoWrap.style.transform = `translateY(${Math.min(scrollShift, maxShift)}px)`;
        };

        updateFloat();
        window.addEventListener('scroll', updateFloat, { passive: true });
        window.addEventListener('resize', updateFloat, { passive: true });
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
