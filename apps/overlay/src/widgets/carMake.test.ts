import { describe, expect, it } from 'vitest';
import { carMake } from './carMake.tsx';

describe('car make', () => {
  it('finds the make in iRacing car names', () => {
    expect(carMake('Porsche 911 GT3 R (992)')).toMatchObject({ name: 'Porsche' });
    expect(carMake('Mercedes-AMG GT3 2020')).toMatchObject({ name: 'Mercedes-AMG' });
    expect(carMake('Mclaren 570s GT4')).toMatchObject({ name: 'McLaren' });
    expect(carMake('Aston Martin Vantage GT3 EVO').icon).not.toBeNull();
    expect(carMake('Chevrolet Corvette Z06 GT3.R').icon).not.toBeNull();
  });

  it('a make without emblem gets a short text', () => {
    expect(carMake('Dallara P217 LMP2')).toEqual({ name: 'Dallara', icon: null, short: 'DAL' });
    expect(carMake('Radical SR10')).toMatchObject({ icon: null, short: 'RAD' });
  });
});
