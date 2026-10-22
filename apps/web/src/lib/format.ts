const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/** Whole rupees for display. Paise are dropped, never rounded up, so a loan is never overstated. */
export function formatRupees(paise: number): string {
  return rupees.format(Math.trunc(paise / 100));
}

/** Rupees with paise, built from integers (₹8,814.86); used where paise matter, like an EMI. */
export function formatRupeesWithPaise(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const absolute = Math.abs(paise);
  return `${sign}${rupees.format(Math.trunc(absolute / 100))}.${String(absolute % 100).padStart(2, '0')}`;
}

export function formatDate(iso: string, withYear = true): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

const statusLabels: Record<string, string> = {
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export const statusLabel = (status: string) => statusLabels[status] ?? status;

/** The 409 message the spec asks for: "You already applied on 3 Oct, application GL-1042." */
export function duplicateMessage(existing: { applicationId: string; createdAt: string }): string {
  return `You already applied on ${formatDate(existing.createdAt, false)}, application ${existing.applicationId}.`;
}

/**
 * The API already masks mobiles (9876XXXX10). This is a second line of defence so the
 * UI never shows a full 10-digit number even if a response regresses.
 */
export function displayMobile(value: string): string {
  return value.replace(/\d{10}/g, (digits) => `${digits.slice(0, 4)}XXXX${digits.slice(-2)}`);
}
