"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"
// This version of next-themes ships a single entrypoint; the old
// "next-themes/dist/types" subpath no longer exists.
import { type ThemeProviderProps } from "next-themes"

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}