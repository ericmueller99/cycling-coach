import type { Extensions } from '../extensions';

/** A deployment's logo image (DECISIONS #70). `tone` is the background it sits on. */
export function BrandLogo({ logo, alt, height, tone = 'light' }: { logo: NonNullable<Extensions['logo']>; alt: string; height: number; tone?: 'light' | 'dark' }) {
  return <img src={logo[tone]} alt={alt} className="block w-fit shrink-0" style={{ height }} />;
}
