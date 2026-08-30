/**
 * Turn a User-Agent string into a short human label like "Chrome · Windows"
 * for the device-management UI. Best-effort: an unrecognised UA falls back to
 * its first 40 characters.
 */
export function describeUserAgent(ua: string | null | undefined): string {
  const s = (ua ?? '').trim();
  if (!s) return '未知设备';

  let os = '';
  if (/Windows NT/i.test(s)) os = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/Mac OS X/i.test(s)) os = 'macOS';
  else if (/Linux/i.test(s)) os = 'Linux';

  let browser = '';
  // Order matters: Edge/OPR/Chrome all also contain "Chrome"/"Safari".
  if (/Edg[A-Z]?\//i.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(s)) browser = 'Opera';
  else if (/Firefox\//i.test(s)) browser = 'Firefox';
  else if (/CriOS\//i.test(s)) browser = 'Chrome';
  else if (/Chrome\//i.test(s)) browser = 'Chrome';
  else if (/Safari\//i.test(s)) browser = 'Safari';

  const parts = [browser, os].filter(Boolean);
  return parts.length ? parts.join(' · ') : s.slice(0, 40);
}
