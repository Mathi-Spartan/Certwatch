/**
 * Certwatch speaks to one reseller platform: TheSSLStore, on either its live
 * or sandbox API. Which of the two a partner uses is decided by the partner
 * when they save their credentials and is stored with those credentials, so
 * nothing in the UI has to carry a platform around.
 */
export const PLATFORM = 'thesslstore';
export const PLATFORM_NAME = 'TheSSLStore';

export const ENVIRONMENTS = [
  { id: 'live',    label: 'Live (Production)', hint: 'Real orders against your production TheSSLStore account.' },
  { id: 'sandbox', label: 'Sandbox (Testing)', hint: 'Test orders only. Sandbox credentials are separate from live ones.' },
];

export const envLabel = (id) => (ENVIRONMENTS.find(e => e.id === id) || ENVIRONMENTS[0]).label;
