import { darkenColor } from '@/utils/color-utils';

describe('darkenColor', () => {
  it('returns a hex string in #rrggbb form', () => {
    const result = darkenColor('#FFFFFF', 0.5);
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('handles hex input without leading #', () => {
    expect(darkenColor('FFFFFF', 0.5)).toBe('#808080');
  });

  it('darkening pure white by 0.5 yields mid-grey', () => {
    expect(darkenColor('#FFFFFF', 0.5)).toBe('#808080');
  });

  it('darkening pure black by any factor yields black', () => {
    expect(darkenColor('#000000', 0.6)).toBe('#000000');
  });

  it('darkening by factor 1 yields black for any colour', () => {
    expect(darkenColor('#FF5733', 1)).toBe('#000000');
  });

  it('darkening by factor 0 yields the original colour', () => {
    expect(darkenColor('#FF5733', 0)).toBe('#ff5733');
  });

  it('uses default factor of 0.6 when factor is omitted', () => {
    // Default factor 0.6 means each channel becomes round(channel * 0.4).
    // 0xFF * 0.4 = 102 = 0x66.
    expect(darkenColor('#FFFFFF')).toBe('#666666');
  });

  it('pads single-digit hex components to two digits', () => {
    // 0x10 * 0.5 = 8 -> '08', not '8'
    expect(darkenColor('#101010', 0.5)).toBe('#080808');
  });
});
