import { describe, expect, it } from 'vitest';
import { quoteInputFrom, validateDetails, validateWeights, type DetailsForm } from './validation';

const valid: DetailsForm = {
  name: 'Ravi Kumar',
  mobileNumber: '9876543210',
  grossWeightGrams: '50',
  netWeightGrams: '45',
  karat: 22,
};

describe('validateDetails', () => {
  it('accepts a complete, valid form', () => {
    expect(validateDetails(valid)).toEqual({});
  });

  it('asks for every empty field in plain words', () => {
    expect(
      validateDetails({
        ...valid,
        name: ' ',
        mobileNumber: '',
        grossWeightGrams: '',
        netWeightGrams: '',
      }),
    ).toEqual({
      name: 'Enter the full name.',
      mobileNumber: 'Enter a mobile number.',
      grossWeightGrams: 'Enter the gross weight in grams.',
      netWeightGrams: 'Enter the net gold weight in grams.',
    });
  });

  it('uses the shared schema rules for mobile numbers and weights', () => {
    expect(validateDetails({ ...valid, mobileNumber: '5876543210' }).mobileNumber).toBe(
      'Enter a valid 10-digit Indian mobile number.',
    );
    expect(validateDetails({ ...valid, mobileNumber: '98765' }).mobileNumber).toBe(
      'Enter a valid 10-digit Indian mobile number.',
    );
    expect(validateDetails({ ...valid, netWeightGrams: '45.1234' }).netWeightGrams).toBe(
      'Use a weight with at most 3 decimal places.',
    );
  });

  it('puts net-over-gross on the net weight field', () => {
    expect(validateDetails({ ...valid, netWeightGrams: '52' })).toEqual({
      netWeightGrams: 'Net weight cannot exceed gross weight.',
    });
  });
});

describe('quoteInputFrom', () => {
  it('builds a quote request only from valid weights', () => {
    expect(quoteInputFrom(valid)).toEqual({
      netWeightGrams: '45',
      grossWeightGrams: '50',
      karat: 22,
    });
    expect(quoteInputFrom({ ...valid, grossWeightGrams: '' })).toBeNull();
    expect(quoteInputFrom({ ...valid, netWeightGrams: '52' })).toBeNull();
  });
});

describe('validateWeights', () => {
  it('checks only the weights and karat', () => {
    expect(validateWeights({ grossWeightGrams: '50', netWeightGrams: '45', karat: 22 })).toEqual(
      {},
    );
    expect(validateWeights({ grossWeightGrams: '50', netWeightGrams: '52', karat: 22 })).toEqual({
      netWeightGrams: 'Net weight cannot exceed gross weight.',
    });
    expect(validateWeights({ grossWeightGrams: '', netWeightGrams: '45', karat: 22 })).toEqual({
      grossWeightGrams: 'Enter the gross weight in grams.',
    });
  });
});
