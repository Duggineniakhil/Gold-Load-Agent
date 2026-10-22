/** Mask an Indian mobile number for any API response or log line: 9876543210 -> 9876XXXX10. */
export const maskMobile = (mobileNumber: string) =>
  `${mobileNumber.slice(0, 4)}XXXX${mobileNumber.slice(-2)}`;
