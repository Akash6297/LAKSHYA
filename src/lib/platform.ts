// Build-time platform flags. VITE_NATIVE / VITE_SITE_URL are set by .env.android
// for the personal Android app; the Vercel web build leaves them unset.
export const IS_NATIVE_APP = import.meta.env.VITE_NATIVE === '1'

/**
 * Public address of the web app, used for links inside emails (sign-up
 * confirmation, password reset). In the Android app the page origin is
 * https://localhost, which must never end up in an email.
 */
export const SITE_URL = ((import.meta.env.VITE_SITE_URL as string | undefined) || window.location.origin).replace(/\/+$/, '')
