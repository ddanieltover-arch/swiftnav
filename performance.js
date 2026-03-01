/**
 * SwiftNav Logistics - Performance & Animation System
 * Handles scroll-triggered animations and media optimization.
 */

document.addEventListener('DOMContentLoaded', () => {
    // === Scroll-Triggered Animations ===
    const animationObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-in');
                // stop observing once animated
                animationObserver.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1, // Trigger when 10% of element is visible
        rootMargin: '0px 0px -50px 0px' // Trigger slightly before it enters the view
    });

    // Elements to animate
    const animatableElements = document.querySelectorAll('.reveal, .fade-up, .fade-left, .fade-right, .zoom-in');
    animatableElements.forEach(el => animationObserver.observe(el));

    // === Lazy Loading for Videos ===
    const videoObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const video = entry.target;
                if (video.dataset.src) {
                    video.src = video.dataset.src;
                    video.load();
                    video.classList.remove('lazy-video');
                }
                videoObserver.unobserve(video);
            }
        });
    });

    const lazyVideos = document.querySelectorAll('video.lazy-video');
    lazyVideos.forEach(v => videoObserver.observe(v));

    // === Image Optimization (Lazy Load fallback for older browsers) ===
    if (!('loading' in HTMLImageElement.prototype)) {
        // Simple fallback for browsers without native loading="lazy"
        const lazyImages = document.querySelectorAll('img[loading="lazy"]');
        const imgObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    img.src = img.dataset.src || img.src;
                    imgObserver.unobserve(img);
                }
            });
        });
        lazyImages.forEach(img => imgObserver.observe(img));
    }
});
