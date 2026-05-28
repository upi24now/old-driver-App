import { createContext, type ReactNode, useContext, useState } from "react";

type Scheme = "light" | "dark";

type ThemeState = {
  scheme: Scheme;
  isDark: boolean;
  setDark: (v: boolean) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setScheme] = useState<Scheme>("light");
  const value: ThemeState = {
    scheme,
    isDark: scheme === "dark",
    setDark: (v) => setScheme(v ? "dark" : "light"),
    toggle: () => setScheme((s) => (s === "dark" ? "light" : "dark")),
  };
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
