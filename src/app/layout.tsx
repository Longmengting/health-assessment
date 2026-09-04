import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { APP_NAME } from "@/lib/app-config";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Educational health assessment estimates, not medical advice.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
