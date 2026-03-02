document.addEventListener('DOMContentLoaded', () => {
    // === Navbar Scroll Effect ===
    const navbar = document.querySelector('.navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // === Mobile Menu Toggle ===
    const mobileBtn = document.querySelector('.mobile-menu-btn');
    const navLinks = document.querySelector('.nav-links');
    if (mobileBtn && navLinks) {
        mobileBtn.addEventListener('click', () => {
            navLinks.classList.toggle('open');
            // Toggle hamburger icon to X
            const isOpen = navLinks.classList.contains('open');
            mobileBtn.innerHTML = isOpen
                ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
                : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"/><path d="M4 6h16"/><path d="M4 18h16"/></svg>';
        });
        // Close menu when a link is clicked
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                navLinks.classList.remove('open');
                mobileBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"/><path d="M4 6h16"/><path d="M4 18h16"/></svg>';
            });
        });
    }

    // === Authentication & Modals ===
    const loginBtn = document.getElementById('nav-login-btn');
    const dashboardBtn = document.getElementById('nav-dashboard-btn');
    const loginModal = document.getElementById('login-modal');
    const registerModal = document.getElementById('register-modal');
    const forgotModal = document.getElementById('forgot-modal');
    const resetModal = document.getElementById('reset-modal');
    const privacyModal = document.getElementById('privacy-modal');
    const termsModal = document.getElementById('terms-modal');
    const closeModals = document.querySelectorAll('.close-modal');

    // Check if user is logged in
    const token = localStorage.getItem('swiftnav_token');
    const userRole = localStorage.getItem('swiftnav_role');
    if (token) {
        loginBtn.classList.add('hidden');
        dashboardBtn.classList.remove('hidden');
        dashboardBtn.href = userRole === 'admin' ? 'admin.html' : 'dashboard.html';
    }

    // Modal Toggles
    loginBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        loginModal.classList.remove('hidden');
    });

    closeModals.forEach(btn => {
        btn.addEventListener('click', () => {
            if (loginModal) loginModal.classList.add('hidden');
            if (registerModal) registerModal.classList.add('hidden');
            if (forgotModal) forgotModal.classList.add('hidden');
            if (resetModal) resetModal.classList.add('hidden');
            if (privacyModal) privacyModal.classList.add('hidden');
            if (termsModal) termsModal.classList.add('hidden');
        });
    });

    document.getElementById('show-register')?.addEventListener('click', (e) => {
        e.preventDefault();
        loginModal.classList.add('hidden');
        registerModal.classList.remove('hidden');
    });

    document.getElementById('show-login')?.addEventListener('click', (e) => {
        e.preventDefault();
        registerModal.classList.add('hidden');
        loginModal.classList.remove('hidden');
    });

    document.getElementById('show-forgot')?.addEventListener('click', (e) => {
        e.preventDefault();
        loginModal.classList.add('hidden');
        forgotModal.classList.remove('hidden');
    });

    document.getElementById('back-to-login')?.addEventListener('click', (e) => {
        e.preventDefault();
        forgotModal.classList.add('hidden');
        loginModal.classList.remove('hidden');
    });

    // Legal Modals
    document.getElementById('privacy-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        privacyModal.classList.remove('hidden');
    });

    document.getElementById('terms-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        termsModal.classList.remove('hidden');
    });

    // Login Form Submit
    document.getElementById('login-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const errorMsg = document.getElementById('login-error');

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();

            if (res.ok) {
                localStorage.setItem('swiftnav_token', data.token);
                localStorage.setItem('swiftnav_role', data.user.role);
                window.location.href = data.user.role === 'admin' ? 'admin.html' : 'dashboard.html';
            } else {
                errorMsg.textContent = data.message + (data.detail ? `: ${data.detail}` : '');
                errorMsg.classList.remove('hidden');
            }
        } catch (err) {
            errorMsg.textContent = 'Server error. Try again.';
            errorMsg.classList.remove('hidden');
        }
    });

    // Register Form Submit
    document.getElementById('register-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('reg-name').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-password').value;
        const errorMsg = document.getElementById('reg-error');

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password })
            });
            const data = await res.json();

            if (res.ok) {
                // Auto login after register
                const loginRes = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const loginData = await loginRes.json();
                localStorage.setItem('swiftnav_token', loginData.token);
                localStorage.setItem('swiftnav_role', loginData.user.role);
                window.location.href = 'dashboard.html';
            } else {
                errorMsg.textContent = data.message + (data.detail ? `: ${data.detail}` : '');
                errorMsg.classList.remove('hidden');
            }
        } catch (err) {
            errorMsg.textContent = 'Server error. Try again.';
            errorMsg.classList.remove('hidden');
        }
    });

    // Forgot Password Form Submit
    document.getElementById('forgot-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('forgot-email').value;
        const btn = e.target.querySelector('button');
        btn.textContent = 'Sending...';

        try {
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await res.json();

            if (res.ok) {
                forgotModal.classList.add('hidden');
                document.getElementById('reset-stored-email').value = email;
                resetModal.classList.remove('hidden');
            } else {
                alert(data.message || 'Error sending reset code');
            }
        } catch (err) {
            alert('Server error. Try again.');
        }
        btn.textContent = 'Send Code';
    });

    // Reset Password Form Submit
    document.getElementById('reset-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('reset-stored-email').value;
        const code = document.getElementById('reset-code').value;
        const newPassword = document.getElementById('reset-new-password').value;
        const btn = e.target.querySelector('button');
        btn.textContent = 'Updating...';

        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, code, newPassword })
            });
            const data = await res.json();

            if (res.ok) {
                alert('Password reset successfully! Please login with your new password.');
                resetModal.classList.add('hidden');
                loginModal.classList.remove('hidden');
            } else {
                alert(data.message || 'Failed to reset password');
            }
        } catch (err) {
            alert('Server error. Try again.');
        }
        btn.textContent = 'Update Password';
    });

    // === Live Tracking Logic ===
    const trackForm = document.getElementById('quick-track-form');
    const trackInput = document.getElementById('tracking-input');
    const trackingDetailSection = document.getElementById('track');
    const trackingNumberDisplay = document.getElementById('tracking-number-display');
    const timelineContainer = document.getElementById('tracking-timeline-container');
    const closeTrackingBtn = document.getElementById('close-tracking-btn');

    trackForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const trackingNum = trackInput.value.trim().toUpperCase();
        const email = document.getElementById('tracking-email')?.value.trim();

        if (trackingNum && email) {
            trackingDetailSection.classList.remove('hidden');
            trackingNumberDisplay.textContent = `Authenticating...`;
            timelineContainer.innerHTML = '<p style="text-align:center;">Securing connection...</p>';
            document.getElementById('tracking-summary-box')?.classList.add('hidden');
            trackingDetailSection.scrollIntoView({ behavior: 'smooth' });

            try {
                const res = await fetch(`/api/track`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ trackingNumber: trackingNum, email })
                });
                const data = await res.json();

                if (res.ok) {
                    localStorage.setItem('swiftnav_token', data.token);
                    localStorage.setItem('swiftnav_role', data.user.role);
                    window.location.href = 'dashboard.html';
                } else {
                    trackingNumberDisplay.textContent = 'Authentication Failed';
                    timelineContainer.innerHTML = `<p style="text-align:center; color:#ef4444;">${data.message || 'Please check the tracking number and email.'}</p>`;
                }
            } catch (err) {
                trackingNumberDisplay.textContent = 'Error Fetching Data';
                timelineContainer.innerHTML = `<p style="text-align:center; color:#ef4444;">Could not connect to tracking server.</p>`;
            }
        }
    });

    closeTrackingBtn?.addEventListener('click', () => {
        trackingDetailSection.classList.add('hidden');
        trackInput.value = '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // === Leaflet Map Initialization ===
    // Assuming container is in viewport or will be shortly. 
    // Coordinates roughly centered on North America/Atlantic for a global feel
    const map = L.map('leaflet-map', {
        scrollWheelZoom: false // disable scroll zoom to prevent hijacking page scroll
    }).setView([40.7128, -74.0060], 4); // Centered near NY

    // Add CartoDB Positron basemap for a clean, modern look matching the aesthetic
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    // Custom Icon (using a simple SVG marker for nice branding)
    const customIcon = L.divIcon({
        className: 'custom-map-marker',
        html: `<div style="background-color: #f97316; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(249, 115, 22, 0.6);"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });

    // Add some mock hubs/active shipments
    const locations = [
        { name: "New York Hub", coords: [40.7128, -74.0060] },
        { name: "Toronto Facility", coords: [43.6510, -79.3470] },
        { name: "London Logistics Center", coords: [51.5074, -0.1278] },
        { name: "Miami Port", coords: [25.7617, -80.1918] },
        { name: "Los Angeles Hub", coords: [34.0522, -118.2437] }
    ];

    locations.forEach(loc => {
        L.marker(loc.coords, { icon: customIcon })
            .addTo(map)
            .bindPopup(`<strong>${loc.name}</strong><br>Status: Operational`);
    });

    // Add a polyline to simulate a shipping route (e.g., NY to London)
    const routeCoords = [
        [40.7128, -74.0060], // NY
        [46.0, -40.0],       // Mid-Atlantic
        [51.5074, -0.1278]   // London
    ];

    L.polyline(routeCoords, {
        color: '#1e3a8a',
        weight: 3,
        opacity: 0.6,
        dashArray: '10, 10' // Dashed line for a route effect
    }).addTo(map);

    // Force map to recalculate size after taking bounds, useful if hidden/shown
    setTimeout(() => {
        map.invalidateSize();
    }, 500);
    // Rate Calculator Logic
    const rateCalcForm = document.getElementById('rate-calculator-form');
    if (rateCalcForm) {
        rateCalcForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = rateCalcForm.querySelector('button');
            const originalText = btn.textContent;
            btn.textContent = 'Calculating...';

            const resultsDiv = document.getElementById('calculator-results');
            resultsDiv.classList.add('hidden');

            const payload = {
                origin: document.getElementById('calc-origin').value,
                destination: document.getElementById('calc-dest').value,
                weight: parseFloat(document.getElementById('calc-weight').value),
                dimensions: document.getElementById('calc-dim').value,
                service_type: document.getElementById('calc-speed').value
            };

            try {
                const res = await fetch(`/api/rates/calculate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();

                if (res.ok) {
                    document.getElementById('calc-result-price').textContent = `$${data.total_cost} ${data.currency}`;
                    document.getElementById('calc-result-time').textContent = `Estimated Transit Time: ${data.estimated_transit_days} Days`;
                    resultsDiv.classList.remove('hidden');
                } else {
                    alert(data.message || 'Error calculating rate');
                }
            } catch (err) {
                alert('Could not connect to rate server.');
            } finally {
                btn.textContent = originalText;
            }
        });
    }

});
