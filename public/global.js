/**
 * SwiftNav Logistics — Global Site Enhancements
 * #2  Toast Notifications
 * #11 Smooth Page Transitions
 * #12 Dark Mode Toggle
 * #13 Back to Top Button
 */

(function () {
    'use strict';

    /* =============================================
     * #2  TOAST NOTIFICATION SYSTEM
     * ============================================= */
    const toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.style.cssText = `
        position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 99999;
        display: flex; flex-direction: column; gap: 0.75rem;
        pointer-events: none;
    `;
    document.body.appendChild(toastContainer);

    window.showToast = function (message, type = 'info', duration = 4000) {
        const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
        const colors = {
            success: { bg: '#f0fdf4', border: '#22c55e', text: '#15803d' },
            error: { bg: '#fef2f2', border: '#ef4444', text: '#b91c1c' },
            info: { bg: '#eff6ff', border: '#3b82f6', text: '#1d4ed8' },
            warning: { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' },
        };
        const c = colors[type] || colors.info;

        const toast = document.createElement('div');
        toast.style.cssText = `
            display: flex; align-items: center; gap: 0.75rem;
            background: ${c.bg}; border: 1.5px solid ${c.border}; color: ${c.text};
            padding: 0.9rem 1.2rem; border-radius: 10px;
            font-family: 'Inter', sans-serif; font-size: 0.9rem; font-weight: 500;
            box-shadow: 0 8px 24px rgba(0,0,0,0.12);
            animation: toastSlideIn 0.3s ease;
            pointer-events: all; max-width: 340px; min-width: 240px;
            cursor: pointer;
        `;
        toast.innerHTML = `<span style="font-size:1.1rem">${icons[type] || '💬'}</span><span style="flex:1;line-height:1.4">${message}</span><span style="opacity:.5;font-size:1rem;margin-left:4px">×</span>`;
        toast.onclick = () => dismissToast(toast);
        toastContainer.appendChild(toast);

        function dismissToast(el) {
            el.style.animation = 'toastSlideOut 0.3s ease forwards';
            setTimeout(() => el.remove(), 300);
        }

        setTimeout(() => dismissToast(toast), duration);
        return toast;
    };

    // Inject toast keyframe animations
    const toastStyle = document.createElement('style');
    toastStyle.textContent = `
        @keyframes toastSlideIn {
            from { opacity: 0; transform: translateX(60px) scale(0.95); }
            to   { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes toastSlideOut {
            from { opacity: 1; transform: translateX(0) scale(1); }
            to   { opacity: 0; transform: translateX(60px) scale(0.95); }
        }
    `;
    document.head.appendChild(toastStyle);


    /* =============================================
     * #11 SMOOTH PAGE TRANSITIONS
     * ============================================= */
    const fadeOverlay = document.createElement('div');
    fadeOverlay.id = 'page-fade-overlay';
    fadeOverlay.style.cssText = `
        position: fixed; inset: 0; z-index: 99998; pointer-events: none;
        background: #ffffff; opacity: 0; transition: opacity 0.25s ease;
    `;
    document.body.appendChild(fadeOverlay);

    // Fade in on load
    window.addEventListener('load', () => {
        fadeOverlay.style.opacity = '0';
    });
    document.addEventListener('DOMContentLoaded', () => {
        fadeOverlay.style.opacity = '0';
    });

    // Intercept navigation links to fade out before going
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href]');
        if (!link) return;
        const href = link.getAttribute('href');
        // Only for same-origin .html links, not anchors or external
        if (!href || href.startsWith('#') || href.startsWith('javascript') ||
            href.startsWith('http') || link.target === '_blank') return;
        if (link.hasAttribute('data-no-transition')) return;

        e.preventDefault();
        fadeOverlay.style.pointerEvents = 'all';
        fadeOverlay.style.opacity = '1';
        setTimeout(() => { window.location.href = href; }, 260);
    });


    /* =============================================
     * #12 DARK MODE TOGGLE
     * ============================================= */
    const DARK_KEY = 'swiftnav_dark_mode';
    const savedDark = localStorage.getItem(DARK_KEY) === 'true';
    if (savedDark) document.documentElement.setAttribute('data-theme', 'dark');

    function injectDarkModeStyles() {
        const style = document.createElement('style');
        style.id = 'dark-mode-styles';
        style.textContent = `
            [data-theme="dark"] {
                --clr-surface: #0f172a;
                --clr-surface-alt: #1e293b;
                --clr-text: #f1f5f9;
                --clr-text-muted: #94a3b8;
                --clr-border: #334155;
                --clr-secondary-light: #1e3a8a33;
            }
            [data-theme="dark"] body { background: #0f172a; color: #f1f5f9; }
            [data-theme="dark"] .navbar { background: rgba(15,23,42,0.95) !important; border-color: #334155; }
            [data-theme="dark"] .nav-links.open { background: #1e293b !important; }
            [data-theme="dark"] .tracking-widget, [data-theme="dark"] .modal-content,
            [data-theme="dark"] .orders-section, [data-theme="dark"] .card-panel,
            [data-theme="dark"] .details-pane, [data-theme="dark"] .create-section,
            [data-theme="dark"] .shipment-card {
                background: #1e293b !important; border-color: #334155 !important; color: #f1f5f9;
            }
            [data-theme="dark"] input, [data-theme="dark"] select, [data-theme="dark"] textarea {
                background: #0f172a !important; color: #f1f5f9 !important; border-color: #334155 !important;
            }
            [data-theme="dark"] .orders-table th { background: #0f172a !important; color: #94a3b8; }
            [data-theme="dark"] .orders-table td { border-color: #334155 !important; }
            [data-theme="dark"] .stat-card { background: #1e293b !important; border-color: #334155 !important; }
            [data-theme="dark"] .footer { background: #020617; }
            [data-theme="dark"] .hero { background: linear-gradient(135deg, #0c1a42 0%, #020617 100%) !important; }
            [data-theme="dark"] #page-fade-overlay { background: #0f172a; }
        `;
        document.head.appendChild(style);
    }
    injectDarkModeStyles();

    function buildDarkToggle() {
        // Find nav right area (admin or public nav)
        const navRight = document.querySelector('.nav-right') || document.querySelector('.nav-links') || document.querySelector('.nav-container');
        if (!navRight) return;

        const btn = document.createElement('button');
        btn.id = 'dark-mode-toggle';
        btn.title = 'Toggle dark mode';
        btn.innerHTML = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
        btn.style.cssText = `
            background: none; border: 1.5px solid var(--clr-border); border-radius: 8px;
            padding: 5px 10px; cursor: pointer; font-size: 1.1rem;
            transition: all 0.2s; color: var(--clr-text); line-height: 1;
        `;
        btn.addEventListener('click', () => {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            if (isDark) {
                document.documentElement.removeAttribute('data-theme');
                localStorage.setItem(DARK_KEY, 'false');
                btn.innerHTML = '🌙';
            } else {
                document.documentElement.setAttribute('data-theme', 'dark');
                localStorage.setItem(DARK_KEY, 'true');
                btn.innerHTML = '☀️';
            }
        });

        // Insert before the last child (logout/avatar) or just append
        const lastChild = navRight.lastElementChild;
        if (lastChild) navRight.insertBefore(btn, lastChild);
        else navRight.appendChild(btn);
    }

    document.addEventListener('DOMContentLoaded', buildDarkToggle);


    /* =============================================
     * #13 BACK TO TOP BUTTON
     * ============================================= */
    const backToTopBtn = document.createElement('button');
    backToTopBtn.id = 'back-to-top';
    backToTopBtn.innerHTML = '↑';
    backToTopBtn.title = 'Back to top';
    backToTopBtn.style.cssText = `
        position: fixed; bottom: 1.5rem; left: 1.5rem; z-index: 9999;
        width: 44px; height: 44px; border-radius: 50%;
        background: var(--clr-secondary); color: white;
        border: none; font-size: 1.2rem; cursor: pointer;
        box-shadow: 0 4px 16px rgba(30,58,138,0.35);
        opacity: 0; transform: translateY(10px);
        transition: opacity 0.3s ease, transform 0.3s ease;
        pointer-events: none; display: flex; align-items: center; justify-content: center;
    `;
    document.body.appendChild(backToTopBtn);

    window.addEventListener('scroll', () => {
        const show = window.scrollY > 400;
        backToTopBtn.style.opacity = show ? '1' : '0';
        backToTopBtn.style.transform = show ? 'translateY(0)' : 'translateY(10px)';
        backToTopBtn.style.pointerEvents = show ? 'all' : 'none';
    }, { passive: true });

    backToTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

})();
