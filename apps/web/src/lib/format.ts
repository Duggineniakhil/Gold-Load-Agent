const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/** Whole rupees for display. Paise are dropped, never rounded up, so a loan is never overstated. */
export function formatRupees(paise: number): string {
  return rupees.format(Math.trunc(paise / 100));
}

export function formatDate(iso: string, withYear = true): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

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
