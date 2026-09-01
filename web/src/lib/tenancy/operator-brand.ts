import type { PublishedBrand } from "./types.ts";

export type OperatorBrandPresentation = {
  logoUrl?: string;
  previewColor?: string;
  shellStyle?: Record<string, string>;
};

export function operatorBrandPresentation(
  brand?: PublishedBrand,
): OperatorBrandPresentation {
  const previewColor = brand?.accentColor ?? brand?.primaryColor;
  const primaryColor = brand?.primaryColor ?? brand?.accentColor;
  const logoUrl = brand?.logoUrl;
  if (!previewColor && !logoUrl) return {};

  return {
    logoUrl,
    previewColor,
    shellStyle: primaryColor
      ? {
          "--primary": primaryColor,
          "--ring": brand?.accentColor ?? primaryColor,
          "--sidebar-primary": primaryColor,
          "--sidebar-ring": brand?.accentColor ?? primaryColor,
        }
      : undefined,
  };
}
