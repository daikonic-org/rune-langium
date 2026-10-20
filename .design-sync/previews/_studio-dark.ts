// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

// Preview harness side effect (imported by every authored preview): Studio
// uses <html class="dark" data-theme="daikonic"> and the design-system base layer paints
// body with bg-background. The card shell forces `body{background:#fff}`,
// so restore the Studio surface here. Portaled overlays (dialogs, menus,
// toasts) mount on <body>, so the class must live on <html>, not a wrapper.
document.documentElement.classList.add('dark');
document.documentElement.dataset.theme = 'daikonic';
document.body.dataset.studioApp = 'true';
document.body.style.background = 'var(--background)';
document.body.style.color = 'var(--foreground)';
