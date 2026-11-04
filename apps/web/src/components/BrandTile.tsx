import { useExtensions } from '../extensions';
import { LogoIcon } from './icons';

/**
 * The small square logo: a deployment's `logoMark` image, or the lime tile with the training line
 * (DECISIONS #74). `size` and `radius` are in px; the line scales with the tile.
 */
export function BrandTile({ size, radius, className = '' }: { size: number; radius: number; className?: string }) {
  const { logoMark } = useExtensions();
  if (logoMark) return <img src={logoMark} alt="" width={size} height={size} className={`flex-none ${className}`} />;
  return (
    <div className={`flex flex-none items-center justify-center bg-accent text-on-accent ${className}`} style={{ width: size, height: size, borderRadius: radius }}>
      <LogoIcon size={Math.round(size * 0.53)} />
    </div>
  );
}
