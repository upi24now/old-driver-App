import colors from "@/constants/colors";
import { useTheme } from "@/contexts/ThemeContext";

/**
 * Returns the design tokens for the current color scheme.
 *
 * Driven by the in-app ThemeContext (user-controlled Dark mode toggle).
 */
export function useColors() {
  const { isDark } = useTheme();
  const palette = isDark ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius };
}
