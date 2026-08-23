// Approximate visible-spectrum wavelength (nm) → sRGB triplet.
// Adapted from the standard piecewise CIE approximation. Returns [r, g, b] in 0-255.
export function wavelengthToRgb(nm: number): [number, number, number] {
  let r = 0, g = 0, b = 0
  if (nm >= 380 && nm < 440) {
    r = -(nm - 440) / (440 - 380); g = 0; b = 1
  } else if (nm < 490) {
    r = 0; g = (nm - 440) / (490 - 440); b = 1
  } else if (nm < 510) {
    r = 0; g = 1; b = -(nm - 510) / (510 - 490)
  } else if (nm < 580) {
    r = (nm - 510) / (580 - 510); g = 1; b = 0
  } else if (nm < 645) {
    r = 1; g = -(nm - 645) / (645 - 580); b = 0
  } else if (nm <= 780) {
    r = 1; g = 0; b = 0
  }
  let factor = 1
  if (nm >= 380 && nm < 420) factor = 0.3 + 0.7 * (nm - 380) / (420 - 380)
  else if (nm <= 700) factor = 1
  else if (nm <= 780) factor = 0.3 + 0.7 * (780 - nm) / (780 - 700)
  const gamma = 0.8
  const to8 = (c: number) => Math.round(255 * Math.pow(c * factor, gamma))
  return [to8(r), to8(g), to8(b)]
}

export function wavelengthCss(nm: number, alpha = 1): string {
  const [r, g, b] = wavelengthToRgb(nm)
  return `rgba(${r},${g},${b},${alpha})`
}
